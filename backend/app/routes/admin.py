from __future__ import annotations

import json
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi import Query
from sqlalchemy.orm import Session

from ..activity import log_activity
from ..auth import hash_password
from .. import content_io
from ..database import get_db
from ..models import ActivityLog, ContentItem, ContentPermission, ContentRevision, User, utcnow
from ..permissions import require_admin
from ..schemas import (
  ActivityListResponse,
  ActivityLogRead,
  AdminUserCreate,
  AdminUserUpdate,
  AdminOverviewResponse,
  ContentDetailResponse,
  ContentItemRead,
  ContentListResponse,
  ContentPermissionGrant,
  ContentPermissionRead,
  ContentScanResponse,
  ContentUpdateRequest,
  MaintainerRead,
  UserListResponse,
  UserRead,
)


router = APIRouter(prefix="/api/admin", tags=["admin"])


def _active_admin_count(db: Session) -> int:
  return db.query(User).filter(User.role == "admin", User.is_active.is_(True)).count()


def _ensure_not_removing_last_admin(db: Session, user: User, *, next_role: str | None = None, next_active: bool | None = None) -> None:
  would_be_admin = next_role if next_role is not None else user.role
  would_be_active = next_active if next_active is not None else user.is_active
  if user.role == "admin" and user.is_active and (would_be_admin != "admin" or not would_be_active):
    if _active_admin_count(db) <= 1:
      raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Cannot demote or deactivate the last active admin user",
      )


def _ensure_unique_user_fields(db: Session, *, user: User | None, username: str | None = None, email: str | None = None) -> None:
  if username is not None:
    existing = db.query(User).filter(User.username == username).first()
    if existing is not None and (user is None or existing.id != user.id):
      raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username is already registered")
  if email is not None:
    existing = db.query(User).filter(User.email == email).first()
    if existing is not None and (user is None or existing.id != user.id):
      raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")


def _details(entry: ActivityLog) -> dict:
  if not entry.details_json:
    return {}
  try:
    data = json.loads(entry.details_json)
    return data if isinstance(data, dict) else {}
  except json.JSONDecodeError:
    return {}


def _activity_read(entry: ActivityLog) -> ActivityLogRead:
  return ActivityLogRead(
    id=entry.id,
    actor_user_id=entry.actor_user_id,
    target_user_id=entry.target_user_id,
    event_type=entry.event_type,
    created_at=entry.created_at,
    ip_address=entry.ip_address,
    user_agent=entry.user_agent,
    details=_details(entry),
  )


def _maintainer_read(user: User, include_email: bool = True) -> MaintainerRead:
  return MaintainerRead(id=user.id, username=user.username, email=user.email if include_email else None)


def _content_read(item: ContentItem, include_email: bool = True) -> ContentItemRead:
  maintainers = [
    _maintainer_read(permission.user, include_email=include_email)
    for permission in item.permissions
    if permission.user is not None and permission.permission in {"maintain", "edit"}
  ]
  return ContentItemRead(
    id=item.id,
    type=item.type,
    title=item.title,
    slug=item.slug,
    file_path=item.file_path,
    route_path=item.route_path,
    anchor=item.anchor,
    is_editable=item.is_editable,
    created_at=item.created_at,
    updated_at=item.updated_at,
    maintainers=maintainers,
  )


def visible_content_items(db: Session) -> list[ContentItem]:
  items = db.query(ContentItem).order_by(ContentItem.type, ContentItem.slug, ContentItem.anchor).all()
  has_file_backed_aiformula_chapters = any(
    item.type == "chapter" and item.file_path.startswith("src/content/docs/aiformula-chapters/")
    for item in items
  )
  if not has_file_backed_aiformula_chapters:
    return items

  return [
    item
    for item in items
    if not (
      item.type == "chapter"
      and item.file_path == "src/content/docs/aiformula.md"
      and item.anchor is not None
      and not item.is_editable
    )
  ]


def ensure_content_inventory(db: Session) -> None:
  has_content = db.query(ContentItem.id).first() is not None
  has_file_backed_aiformula_chapters = (
    db.query(ContentItem.id)
    .filter(ContentItem.type == "chapter", ContentItem.file_path.like("src/content/docs/aiformula-chapters/%"))
    .first()
    is not None
  )
  if has_content and has_file_backed_aiformula_chapters:
    return

  scan_content_sources(db)
  db.commit()


def _permission_read(permission: ContentPermission) -> ContentPermissionRead:
  return ContentPermissionRead(
    id=permission.id,
    content_item_id=permission.content_item_id,
    user=_maintainer_read(permission.user),
    permission=permission.permission,
    created_at=permission.created_at,
  )


def _active_maintainer_names(db: Session, item: ContentItem) -> list[str]:
  permissions = (
    db.query(ContentPermission)
    .join(User)
    .filter(ContentPermission.content_item_id == item.id, User.is_active.is_(True))
    .order_by(User.username)
    .all()
  )
  return [permission.user.username for permission in permissions if permission.permission in {"maintain", "edit"}]


def _sync_frontmatter_maintainers(db: Session, item: ContentItem) -> None:
  if not item.is_editable:
    return
  content_io.update_file_maintainers(item.file_path, _active_maintainer_names(db, item))


def _find_or_create_content_item(
  db: Session,
  *,
  type_: str,
  title: str,
  slug: str,
  file_path: str,
  route_path: str,
  anchor: str | None = None,
  is_editable: bool = True,
) -> ContentItem:
  item = db.query(ContentItem).filter(ContentItem.file_path == file_path, ContentItem.anchor == anchor).first()
  if item is None and type_ == "chapter" and is_editable:
    item = db.query(ContentItem).filter(ContentItem.file_path == file_path, ContentItem.type == "chapter").first()
  if item is None:
    item = ContentItem(
      type=type_,
      title=title,
      slug=slug,
      file_path=file_path,
      route_path=route_path,
      anchor=anchor,
      is_editable=is_editable,
    )
    db.add(item)
    db.flush()
    return item

  item.type = type_
  item.title = title
  item.slug = slug
  item.route_path = route_path
  item.anchor = anchor
  item.is_editable = is_editable
  item.updated_at = utcnow()
  db.add(item)
  db.flush()
  return item


def scan_content_sources(db: Session) -> ContentScanResponse:
  scanned_files = 0
  chapter_count = 0
  source_files = content_io.iter_source_markdown()
  has_file_backed_aiformula_chapters = any(content_io.is_aiformula_chapter_file(path) for path in source_files)
  for path in source_files:
    scanned_files += 1
    frontmatter, _body, _raw = content_io.read_markdown_file(path)
    file_path = content_io.to_repo_relative(path)
    anchor = None
    if content_io.is_aiformula_chapter_file(path):
      title = str(frontmatter.get("title") or path.stem)
      anchor = content_io.slugify(title)
      type_ = "chapter"
      slug = f"aiformula/{anchor}"
      route_path = f"/docs/aiformula/#{anchor}"
      chapter_count += 1
    else:
      type_, slug, route_path = content_io.route_for_file(path)
      title = str(frontmatter.get("title") or slug)
    item = _find_or_create_content_item(
      db,
      type_=type_,
      title=title,
      slug=slug,
      file_path=file_path,
      route_path=route_path,
      anchor=anchor if type_ == "chapter" else None,
      is_editable=True,
    )

    for username in content_io.extract_maintainers(frontmatter):
      user = db.query(User).filter(User.username == username).first()
      if user is None:
        continue
      existing = (
        db.query(ContentPermission)
        .filter(ContentPermission.content_item_id == item.id, ContentPermission.user_id == user.id)
        .first()
      )
      if existing is None:
        db.add(ContentPermission(content_item_id=item.id, user_id=user.id, permission="maintain"))

    if path.name.lower() == "aiformula.md" and not has_file_backed_aiformula_chapters:
      for chapter in content_io.find_markdown_chapters(path):
        chapter_count += 1
        _find_or_create_content_item(
          db,
          type_="chapter",
          title=chapter["title"],
          slug=f"{slug}/{chapter['anchor']}",
          file_path=file_path,
          route_path=f"{route_path}#{chapter['anchor']}",
          anchor=chapter["anchor"],
          is_editable=False,
        )

  db.flush()
  total = db.query(ContentItem).count()
  return ContentScanResponse(
    scanned_files=scanned_files,
    content_items=total,
    chapters=chapter_count,
    message="Content scan completed. Existing records were updated; no content records were silently deleted.",
  )


def _content_detail(item: ContentItem) -> ContentDetailResponse:
  path = content_io.resolve_content_path(item.file_path)
  frontmatter, body, raw = content_io.read_markdown_file(path)
  if item.type == "chapter" and item.anchor and not item.is_editable:
    # Virtual chapters are inventoried for ownership, but not split into source files yet.
    body = f"<!-- Virtual chapter record for #{item.anchor}. Full-file editing remains disabled for this chapter item. -->"
  return ContentDetailResponse(
    **_content_read(item).model_dump(),
    frontmatter=frontmatter,
    body=body,
    body_hash=content_io.content_hash(raw),
  )


def update_content_item(
  db: Session,
  item: ContentItem,
  payload: ContentUpdateRequest,
  actor: User,
  request: Request,
) -> ContentDetailResponse:
  if not item.is_editable:
    raise HTTPException(
      status_code=status.HTTP_409_CONFLICT,
      detail="This content item is not directly editable. Split the source into a dedicated Markdown file first.",
    )

  path = content_io.resolve_content_path(item.file_path)
  frontmatter, current_body, previous_raw = content_io.read_markdown_file(path)
  if payload.body_hash and payload.body_hash != content_io.content_hash(previous_raw):
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Content changed since it was loaded")

  allowed_frontmatter = {"title", "description", "category", "tags", "updatedAt", "date", "order", "source", "legacyPath"}
  for key, value in payload.frontmatter.items():
    if key in allowed_frontmatter:
      frontmatter[key] = value
  if "updatedAt" not in frontmatter:
    frontmatter["updatedAt"] = utcnow().isoformat()

  next_body = current_body if payload.body is None else payload.body
  next_raw = content_io.write_markdown_file(path, frontmatter, next_body)

  item.title = str(frontmatter.get("title") or item.title)
  item.updated_at = utcnow()
  db.add(item)
  db.add(
    ContentRevision(
      content_item_id=item.id,
      editor_user_id=actor.id,
      previous_content=previous_raw,
      new_content=next_raw,
      diff_summary="Updated Markdown content and/or frontmatter.",
    )
  )
  log_activity(
    db,
    "content_update",
    actor_user_id=actor.id,
    target_user_id=actor.id,
    request=request,
    details={"content_item_id": item.id, "file_path": item.file_path, "route_path": item.route_path},
  )
  db.commit()
  db.refresh(item)
  return _content_detail(item)


@router.get("/overview", response_model=AdminOverviewResponse)
def admin_overview(
  admin: User = Depends(require_admin),
  db: Session = Depends(get_db),
) -> AdminOverviewResponse:
  ensure_content_inventory(db)
  cutoff = utcnow() - timedelta(days=7)
  recent_events = db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(8).all()
  return AdminOverviewResponse(
    total_users=db.query(User).count(),
    active_users=db.query(User).filter(User.is_active.is_(True)).count(),
    admin_count=db.query(User).filter(User.role == "admin").count(),
    editor_count=db.query(User).filter(User.role == "editor").count(),
    user_count=db.query(User).filter(User.role == "user").count(),
    content_items=len(visible_content_items(db)),
    assigned_permissions=db.query(ContentPermission).count(),
    recent_logins=db.query(ActivityLog).filter(ActivityLog.event_type == "login_success", ActivityLog.created_at >= cutoff).count(),
    recent_login_failures=db.query(ActivityLog).filter(ActivityLog.event_type == "login_failure", ActivityLog.created_at >= cutoff).count(),
    recent_content_edits=db.query(ActivityLog).filter(ActivityLog.event_type == "content_update", ActivityLog.created_at >= cutoff).count(),
    recent_content_updates=db.query(ActivityLog).filter(ActivityLog.event_type == "content_update", ActivityLog.created_at >= cutoff).count(),
    default_admin_password_warning=admin.username == "adm1n" and admin.must_change_password,
    recent_activity_events=[_activity_read(entry) for entry in recent_events],
  )


@router.get("/users", response_model=UserListResponse)
def list_users(_admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> UserListResponse:
  return UserListResponse(users=[UserRead.model_validate(user) for user in db.query(User).order_by(User.username).all()])


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
  payload: AdminUserCreate,
  request: Request,
  admin: User = Depends(require_admin),
  db: Session = Depends(get_db),
) -> UserRead:
  _ensure_unique_user_fields(db, user=None, username=payload.username, email=payload.email)
  password_hash = hash_password(payload.temporary_password)
  user = User(
    username=payload.username,
    email=payload.email,
    password_hash=password_hash,
    hashed_password=password_hash,
    role=payload.role,
    is_active=payload.is_active,
    must_change_password=payload.must_change_password,
  )
  db.add(user)
  db.flush()
  log_activity(
    db,
    "admin_user_create",
    actor_user_id=admin.id,
    target_user_id=user.id,
    request=request,
    details={"username": user.username, "email": user.email, "role": user.role, "is_active": user.is_active},
  )
  db.commit()
  db.refresh(user)
  return UserRead.model_validate(user)


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user(
  user_id: int,
  payload: AdminUserUpdate,
  request: Request,
  admin: User = Depends(require_admin),
  db: Session = Depends(get_db),
) -> UserRead:
  user = db.get(User, user_id)
  if user is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

  next_role = payload.role if payload.role is not None else user.role
  next_active = payload.is_active if payload.is_active is not None else user.is_active
  _ensure_not_removing_last_admin(db, user, next_role=next_role, next_active=next_active)
  _ensure_unique_user_fields(db, user=user, username=payload.username, email=payload.email)

  changed: list[str] = []
  if payload.username is not None and payload.username != user.username:
    user.username = payload.username
    changed.append("username")
  if payload.email is not None and payload.email != user.email:
    user.email = payload.email
    changed.append("email")
  if payload.role is not None and payload.role != user.role:
    user.role = payload.role
    changed.append("role")
  if payload.is_active is not None and payload.is_active != user.is_active:
    user.is_active = payload.is_active
    changed.append("is_active")
  if payload.must_change_password is not None and payload.must_change_password != user.must_change_password:
    user.must_change_password = payload.must_change_password
    changed.append("must_change_password")
  if payload.temporary_password:
    password_hash = hash_password(payload.temporary_password)
    user.password_hash = password_hash
    user.hashed_password = password_hash
    user.must_change_password = True
    changed.extend(["temporary_password", "must_change_password"])

  user.updated_at = utcnow()
  db.add(user)
  log_activity(
    db,
    "admin_user_update",
    actor_user_id=admin.id,
    target_user_id=user.id,
    request=request,
    details={"username": user.username, "changed": sorted(set(changed))},
  )
  db.commit()
  db.refresh(user)
  return UserRead.model_validate(user)


@router.get("/activity", response_model=ActivityListResponse)
def list_activity(
  _admin: User = Depends(require_admin),
  db: Session = Depends(get_db),
  event_type: str | None = Query(default=None, min_length=1, max_length=80),
) -> ActivityListResponse:
  query = db.query(ActivityLog)
  if event_type:
    query = query.filter(ActivityLog.event_type == event_type)
  entries = query.order_by(ActivityLog.created_at.desc()).limit(100).all()
  return ActivityListResponse(events=[_activity_read(entry) for entry in entries])


@router.get("/content", response_model=ContentListResponse)
def list_content(_admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> ContentListResponse:
  ensure_content_inventory(db)
  items = visible_content_items(db)
  return ContentListResponse(items=[_content_read(item) for item in items])


@router.post("/content/scan", response_model=ContentScanResponse)
def scan_content(
  request: Request,
  admin: User = Depends(require_admin),
  db: Session = Depends(get_db),
) -> ContentScanResponse:
  result = scan_content_sources(db)
  log_activity(db, "content_scan", actor_user_id=admin.id, target_user_id=admin.id, request=request, details=result.model_dump())
  db.commit()
  return result


@router.get("/content/{content_id}", response_model=ContentDetailResponse)
def read_content_admin(
  content_id: int,
  _admin: User = Depends(require_admin),
  db: Session = Depends(get_db),
) -> ContentDetailResponse:
  item = db.get(ContentItem, content_id)
  if item is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")
  return _content_detail(item)


@router.patch("/content/{content_id}", response_model=ContentDetailResponse)
def update_content_admin(
  content_id: int,
  payload: ContentUpdateRequest,
  request: Request,
  admin: User = Depends(require_admin),
  db: Session = Depends(get_db),
) -> ContentDetailResponse:
  item = db.get(ContentItem, content_id)
  if item is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")
  return update_content_item(db, item, payload, admin, request)


@router.get("/content/{content_id}/permissions", response_model=list[ContentPermissionRead])
def list_content_permissions(
  content_id: int,
  _admin: User = Depends(require_admin),
  db: Session = Depends(get_db),
) -> list[ContentPermissionRead]:
  item = db.get(ContentItem, content_id)
  if item is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")
  permissions = db.query(ContentPermission).filter(ContentPermission.content_item_id == item.id).all()
  return [_permission_read(permission) for permission in permissions]


@router.post("/content/{content_id}/permissions", response_model=ContentPermissionRead, status_code=status.HTTP_201_CREATED)
def grant_content_permission(
  content_id: int,
  payload: ContentPermissionGrant,
  request: Request,
  admin: User = Depends(require_admin),
  db: Session = Depends(get_db),
) -> ContentPermissionRead:
  item = db.get(ContentItem, content_id)
  if item is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")
  if payload.user_id is None and payload.username is None:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="user_id or username is required")

  user = db.get(User, payload.user_id) if payload.user_id is not None else db.query(User).filter(User.username == payload.username).first()
  if user is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

  permission = (
    db.query(ContentPermission)
    .filter(ContentPermission.content_item_id == item.id, ContentPermission.user_id == user.id)
    .first()
  )
  if permission is None:
    permission = ContentPermission(content_item_id=item.id, user_id=user.id, permission=payload.permission)
    db.add(permission)
  else:
    permission.permission = payload.permission
    db.add(permission)
  db.flush()
  _sync_frontmatter_maintainers(db, item)
  log_activity(
    db,
    "content_permission_grant",
    actor_user_id=admin.id,
    target_user_id=user.id,
    request=request,
    details={"content_item_id": item.id, "permission": payload.permission, "file_path": item.file_path},
  )
  db.commit()
  db.refresh(permission)
  return _permission_read(permission)


@router.delete("/content/{content_id}/permissions/{user_id}", response_model=ContentListResponse)
def revoke_content_permission(
  content_id: int,
  user_id: int,
  request: Request,
  admin: User = Depends(require_admin),
  db: Session = Depends(get_db),
) -> ContentListResponse:
  item = db.get(ContentItem, content_id)
  if item is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")
  permission = (
    db.query(ContentPermission)
    .filter(ContentPermission.content_item_id == item.id, ContentPermission.user_id == user_id)
    .first()
  )
  if permission is not None:
    db.delete(permission)
    db.flush()
    _sync_frontmatter_maintainers(db, item)
    log_activity(
      db,
      "content_permission_revoke",
      actor_user_id=admin.id,
      target_user_id=user_id,
      request=request,
      details={"content_item_id": item.id, "file_path": item.file_path},
    )
    db.commit()
  items = visible_content_items(db)
  return ContentListResponse(items=[_content_read(content_item) for content_item in items])

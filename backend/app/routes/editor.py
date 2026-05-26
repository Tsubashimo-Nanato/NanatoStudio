from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ContentItem, ContentPermission, User
from ..auth import get_current_user
from ..permissions import require_content_editor, user_can_edit_content
from ..schemas import ContentDetailResponse, ContentItemRead, ContentListResponse, ContentUpdateRequest
from .admin import _content_detail, _content_read, ensure_content_inventory, update_content_item, visible_content_items


router = APIRouter(prefix="/api/editor", tags=["editor"])


@router.get("/content", response_model=ContentListResponse)
def list_editor_content(
  current_user: User = Depends(get_current_user),
  db: Session = Depends(get_db),
) -> ContentListResponse:
  ensure_content_inventory(db)
  if current_user.role == "admin":
    items = visible_content_items(db)
  else:
    visible_ids = {item.id for item in visible_content_items(db)}
    items = (
      db.query(ContentItem)
      .join(ContentPermission)
      .filter(ContentPermission.user_id == current_user.id)
      .order_by(ContentItem.type, ContentItem.slug, ContentItem.anchor)
      .all()
    )
    items = [item for item in items if item.id in visible_ids]
  return ContentListResponse(items=[_content_read(item, include_email=False) for item in items])


@router.get("/content/{content_id}", response_model=ContentDetailResponse)
def read_editor_content(
  content_id: int,
  current_user: User = Depends(get_current_user),
  db: Session = Depends(get_db),
) -> ContentDetailResponse:
  item = db.get(ContentItem, content_id)
  if item is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")
  require_content_editor(item, current_user, db)
  return _content_detail(item)


@router.patch("/content/{content_id}", response_model=ContentDetailResponse)
def update_editor_content(
  content_id: int,
  payload: ContentUpdateRequest,
  request: Request,
  current_user: User = Depends(get_current_user),
  db: Session = Depends(get_db),
) -> ContentDetailResponse:
  item = db.get(ContentItem, content_id)
  if item is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content item not found")
  if not user_can_edit_content(db, current_user, item):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Content maintainer access required")
  return update_content_item(db, item, payload, current_user, request)

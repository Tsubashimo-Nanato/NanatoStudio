from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import ContentItem, ContentPermission, User
from ..auth import get_current_user
from ..permissions import require_content_editor, user_can_edit_content
from ..schemas import ContentDetailResponse, ContentListResponse, ContentUpdateRequest
from .admin import _content_detail, _content_read, ensure_content_inventory, update_content_item, visible_content_items


router = APIRouter(prefix="/api/editor", tags=["editor"])


def _project_root() -> Path:
  return Path(__file__).resolve().parents[3]


def _ensure_build_access(current_user: User, db: Session) -> None:
  if current_user.role == "admin":
    return
  if not current_user.is_active:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Active editor account required")
  permission = db.query(ContentPermission).filter(ContentPermission.user_id == current_user.id).first()
  if permission is None:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Content maintainer access required")


def _npm_executable() -> str:
  npm = shutil.which("npm.cmd") or shutil.which("npm")
  if npm is None:
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="npm was not found on PATH")
  return npm


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


@router.post("/build")
def run_editor_build(
  current_user: User = Depends(get_current_user),
  db: Session = Depends(get_db),
) -> dict[str, str]:
  _ensure_build_access(current_user, db)
  try:
    completed = subprocess.run(
      [_npm_executable(), "run", "build"],
      cwd=_project_root(),
      capture_output=True,
      text=True,
      timeout=180,
      check=False,
    )
  except subprocess.TimeoutExpired as error:
    output = "\n".join(part for part in [error.stdout, error.stderr] if part)[-4000:]
    raise HTTPException(
      status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
      detail=f"npm run build timed out. {output}".strip(),
    ) from error

  output = "\n".join(part for part in [completed.stdout, completed.stderr] if part).strip()
  if completed.returncode != 0:
    raise HTTPException(
      status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
      detail=f"npm run build failed with exit code {completed.returncode}. {output[-4000:]}",
    )

  return {
    "message": "npm run build completed successfully.",
    "output": output[-4000:],
  }

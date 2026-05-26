from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from .auth import get_current_user
from .database import get_db
from .models import ContentItem, ContentPermission, User


def require_admin(current_user: User = Depends(get_current_user)) -> User:
  if current_user.role != "admin":
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
  return current_user


def user_can_edit_content(db: Session, user: User, content_item: ContentItem) -> bool:
  if user.role == "admin":
    return True
  if not user.is_active:
    return False
  permission = (
    db.query(ContentPermission)
    .filter(
      ContentPermission.content_item_id == content_item.id,
      ContentPermission.user_id == user.id,
      ContentPermission.permission.in_(["maintain", "edit"]),
    )
    .first()
  )
  return permission is not None


def require_content_editor(content_item: ContentItem, current_user: User, db: Session) -> None:
  if not user_can_edit_content(db, current_user, content_item):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Content maintainer access required")

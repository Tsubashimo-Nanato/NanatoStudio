from __future__ import annotations

from sqlalchemy.orm import Session

from .activity import log_activity
from .auth import hash_password
from .models import User


DEFAULT_ADMIN_USERNAME = "adm1n"
DEFAULT_ADMIN_EMAIL = "adm1n@example.local"
DEFAULT_ADMIN_PASSWORD = "adm1n"


def seed_default_admin(db: Session) -> None:
  existing_admin = db.query(User).filter(User.role == "admin").first()
  if existing_admin is not None:
    return

  user = db.query(User).filter(User.username == DEFAULT_ADMIN_USERNAME).first()
  details = {"default_admin_seeded": True}

  if user is None:
    password_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
    user = User(
      username=DEFAULT_ADMIN_USERNAME,
      email=DEFAULT_ADMIN_EMAIL,
      password_hash=password_hash,
      hashed_password=password_hash,
      role="admin",
      is_active=True,
      must_change_password=True,
    )
    db.add(user)
    db.flush()
    details["created"] = True
  else:
    password_hash = hash_password(DEFAULT_ADMIN_PASSWORD)
    user.email = user.email or DEFAULT_ADMIN_EMAIL
    user.password_hash = password_hash
    user.hashed_password = password_hash
    user.role = "admin"
    user.is_active = True
    user.must_change_password = True
    db.add(user)
    db.flush()
    details["promoted_existing_user"] = True

  log_activity(db, "default_admin_seed", actor_user_id=None, target_user_id=user.id, details=details)
  db.commit()

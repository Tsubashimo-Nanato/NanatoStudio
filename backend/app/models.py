from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from .database import Base


def utcnow() -> datetime:
  return datetime.now(timezone.utc)


class User(Base):
  __tablename__ = "users"

  id = Column(Integer, primary_key=True, index=True)
  username = Column(String(80), unique=True, index=True, nullable=False)
  email = Column(String(320), unique=True, index=True, nullable=False)
  password_hash = Column(String(255), nullable=False)
  hashed_password = Column(String(255), nullable=True)
  role = Column(String(20), default="user", nullable=False)
  is_active = Column(Boolean, default=True, nullable=False)
  must_change_password = Column(Boolean, default=False, nullable=False)
  created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
  updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
  last_login_at = Column(DateTime(timezone=True), nullable=True)

  sessions = relationship("AuthSession", back_populates="user", cascade="all, delete-orphan")
  content_permissions = relationship("ContentPermission", back_populates="user", cascade="all, delete-orphan")


class AuthSession(Base):
  __tablename__ = "auth_sessions"

  id = Column(Integer, primary_key=True, index=True)
  user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
  token_hash = Column(String(128), unique=True, index=True, nullable=False)
  created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
  expires_at = Column(DateTime(timezone=True), index=True, nullable=False)
  revoked_at = Column(DateTime(timezone=True), nullable=True)
  last_seen_at = Column(DateTime(timezone=True), nullable=True)
  ip_address = Column(String(64), nullable=True)
  user_agent = Column(String(512), nullable=True)

  user = relationship("User", back_populates="sessions")


class HumanChallenge(Base):
  __tablename__ = "human_challenges"

  id = Column(String(64), primary_key=True)
  purpose = Column(String(32), index=True, nullable=False)
  question = Column(String(255), nullable=False)
  answer_hash = Column(String(128), nullable=False)
  created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
  expires_at = Column(DateTime(timezone=True), index=True, nullable=False)
  consumed_at = Column(DateTime(timezone=True), nullable=True)
  attempt_count = Column(Integer, default=0, nullable=False)
  ip_address = Column(String(64), nullable=True)


class ActivityLog(Base):
  __tablename__ = "activity_logs"

  id = Column(Integer, primary_key=True, index=True)
  actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
  target_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
  event_type = Column(String(80), index=True, nullable=False)
  created_at = Column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)
  ip_address = Column(String(64), nullable=True)
  user_agent = Column(String(512), nullable=True)
  details_json = Column(Text, nullable=True)


class ContentItem(Base):
  __tablename__ = "content_items"
  __table_args__ = (UniqueConstraint("file_path", "anchor", name="uq_content_items_file_anchor"),)

  id = Column(Integer, primary_key=True, index=True)
  type = Column(String(20), index=True, nullable=False)
  title = Column(String(255), nullable=False)
  slug = Column(String(255), index=True, nullable=False)
  file_path = Column(String(1024), index=True, nullable=False)
  route_path = Column(String(1024), nullable=False)
  anchor = Column(String(255), nullable=True)
  is_editable = Column(Boolean, default=True, nullable=False)
  created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
  updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

  permissions = relationship("ContentPermission", back_populates="content_item", cascade="all, delete-orphan")
  revisions = relationship("ContentRevision", back_populates="content_item", cascade="all, delete-orphan")


class ContentPermission(Base):
  __tablename__ = "content_permissions"
  __table_args__ = (UniqueConstraint("content_item_id", "user_id", name="uq_content_permissions_item_user"),)

  id = Column(Integer, primary_key=True, index=True)
  content_item_id = Column(Integer, ForeignKey("content_items.id"), index=True, nullable=False)
  user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
  permission = Column(String(20), default="maintain", nullable=False)
  created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

  content_item = relationship("ContentItem", back_populates="permissions")
  user = relationship("User", back_populates="content_permissions")


class ContentRevision(Base):
  __tablename__ = "content_revisions"

  id = Column(Integer, primary_key=True, index=True)
  content_item_id = Column(Integer, ForeignKey("content_items.id"), index=True, nullable=False)
  editor_user_id = Column(Integer, ForeignKey("users.id"), index=True, nullable=False)
  previous_content = Column(Text, nullable=False)
  new_content = Column(Text, nullable=False)
  diff_summary = Column(Text, nullable=True)
  created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

  content_item = relationship("ContentItem", back_populates="revisions")

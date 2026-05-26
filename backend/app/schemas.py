from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


ChallengePurpose = Literal["register", "login", "password_change"]
UserRole = Literal["admin", "editor", "user"]


class UserCreate(BaseModel):
  username: str = Field(min_length=1, max_length=80)
  email: str = Field(min_length=3, max_length=320)
  confirm_email: str = Field(min_length=3, max_length=320)
  password: str = Field(min_length=8, max_length=256)
  confirm_password: str = Field(min_length=8, max_length=256)
  challenge_id: str = Field(min_length=1, max_length=128)
  challenge_answer: str = Field(min_length=1, max_length=64)

  @field_validator("username")
  @classmethod
  def normalize_username(cls, value: str) -> str:
    normalized = value.strip()
    if not normalized:
      raise ValueError("username is required")
    return normalized

  @field_validator("email", "confirm_email")
  @classmethod
  def normalize_email(cls, value: str) -> str:
    normalized = value.strip().lower()
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
      raise ValueError("email must be a valid email-like address")
    return normalized


class LoginRequest(BaseModel):
  username_or_email: str = Field(min_length=1, max_length=320)
  password: str = Field(min_length=1, max_length=256)
  challenge_id: str = Field(min_length=1, max_length=128)
  challenge_answer: str = Field(min_length=1, max_length=64)

  @field_validator("username_or_email")
  @classmethod
  def normalize_identifier(cls, value: str) -> str:
    normalized = value.strip()
    if not normalized:
      raise ValueError("username or email is required")
    return normalized


class ChangePasswordRequest(BaseModel):
  current_password: str = Field(min_length=1, max_length=256)
  new_password: str = Field(min_length=8, max_length=256)
  confirm_new_password: str = Field(min_length=8, max_length=256)


class UserRead(BaseModel):
  model_config = ConfigDict(from_attributes=True)

  id: int
  email: str
  username: str
  role: UserRole
  is_active: bool
  must_change_password: bool
  created_at: datetime
  updated_at: datetime
  last_login_at: datetime | None


class AdminUserCreate(BaseModel):
  username: str = Field(min_length=1, max_length=80)
  email: str = Field(min_length=3, max_length=320)
  role: UserRole = "user"
  is_active: bool = True
  must_change_password: bool = True
  temporary_password: str = Field(min_length=8, max_length=256)

  @field_validator("username")
  @classmethod
  def normalize_username(cls, value: str) -> str:
    normalized = value.strip()
    if not normalized:
      raise ValueError("username is required")
    return normalized

  @field_validator("email")
  @classmethod
  def normalize_email(cls, value: str) -> str:
    normalized = value.strip().lower()
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
      raise ValueError("email must be a valid email-like address")
    return normalized


class AdminUserUpdate(BaseModel):
  username: str | None = Field(default=None, min_length=1, max_length=80)
  email: str | None = Field(default=None, min_length=3, max_length=320)
  role: UserRole | None = None
  is_active: bool | None = None
  must_change_password: bool | None = None
  temporary_password: str | None = Field(default=None, min_length=8, max_length=256)

  @field_validator("username")
  @classmethod
  def clean_username(cls, value: str | None) -> str | None:
    if value is None:
      return value
    normalized = value.strip()
    if not normalized:
      raise ValueError("username is required")
    return normalized

  @field_validator("email")
  @classmethod
  def clean_email(cls, value: str | None) -> str | None:
    if value is None:
      return value
    normalized = value.strip().lower()
    if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
      raise ValueError("email must be a valid email-like address")
    return normalized


class AuthResponse(BaseModel):
  user: UserRead
  session_expires_at: datetime


class ChallengeResponse(BaseModel):
  challenge_id: str
  question: str
  expires_at: datetime


class MessageResponse(BaseModel):
  message: str


ContentType = Literal["blog", "doc", "chapter"]
ContentPermissionName = Literal["maintain", "edit"]


class MaintainerRead(BaseModel):
  id: int
  username: str
  email: str | None = None


class ContentItemRead(BaseModel):
  model_config = ConfigDict(from_attributes=True)

  id: int
  type: ContentType
  title: str
  slug: str
  file_path: str
  route_path: str
  anchor: str | None
  is_editable: bool
  created_at: datetime
  updated_at: datetime
  maintainers: list[MaintainerRead] = []


class ContentListResponse(BaseModel):
  items: list[ContentItemRead]


class ContentScanResponse(BaseModel):
  scanned_files: int
  content_items: int
  chapters: int
  message: str


class ContentDetailResponse(ContentItemRead):
  frontmatter: dict[str, Any]
  body: str
  body_hash: str


class ContentUpdateRequest(BaseModel):
  frontmatter: dict[str, Any] = Field(default_factory=dict)
  body: str | None = None
  body_hash: str | None = None


class ContentPermissionRead(BaseModel):
  id: int
  content_item_id: int
  user: MaintainerRead
  permission: ContentPermissionName
  created_at: datetime


class ContentPermissionGrant(BaseModel):
  user_id: int | None = None
  username: str | None = None
  permission: ContentPermissionName = "maintain"

  @field_validator("username")
  @classmethod
  def clean_username(cls, value: str | None) -> str | None:
    if value is None:
      return value
    normalized = value.strip()
    return normalized or None


class ActivityLogRead(BaseModel):
  id: int
  actor_user_id: int | None
  target_user_id: int | None
  event_type: str
  created_at: datetime
  ip_address: str | None
  user_agent: str | None
  details: dict[str, Any]


class ActivityListResponse(BaseModel):
  events: list[ActivityLogRead]


class UserListResponse(BaseModel):
  users: list[UserRead]


class AdminOverviewResponse(BaseModel):
  total_users: int
  active_users: int
  admin_count: int
  editor_count: int
  user_count: int
  content_items: int
  assigned_permissions: int
  recent_logins: int
  recent_login_failures: int
  recent_content_edits: int
  recent_content_updates: int
  default_admin_password_warning: bool
  recent_activity_events: list[ActivityLogRead]

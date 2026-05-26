from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from .models import ActivityLog


def log_activity(
  db: Session,
  event_type: str,
  *,
  actor_user_id: int | None = None,
  target_user_id: int | None = None,
  request: Request | None = None,
  details: dict[str, Any] | None = None,
) -> ActivityLog:
  entry = ActivityLog(
    actor_user_id=actor_user_id,
    target_user_id=target_user_id,
    event_type=event_type,
    ip_address=request.client.host if request and request.client else None,
    user_agent=request.headers.get("user-agent") if request else None,
    details_json=json.dumps(details or {}, sort_keys=True),
  )
  db.add(entry)
  db.flush()
  return entry

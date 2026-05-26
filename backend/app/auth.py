from __future__ import annotations

import base64
import hashlib
import hmac
import os
import random
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import AuthSession, HumanChallenge, User, utcnow


SECRET_KEY = os.getenv("SECRET_KEY", "replace-this-development-secret-with-at-least-32-bytes")
PASSWORD_ITERATIONS = 210_000
SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "nanato_session")
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "24"))
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes", "on"}
CHALLENGE_TTL_MINUTES = int(os.getenv("CHALLENGE_TTL_MINUTES", "10"))
security = HTTPBearer(auto_error=False)
password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
  return password_hasher.hash(password)


def _verify_legacy_pbkdf2(password: str, encoded_hash: str) -> bool:
  try:
    algorithm, iterations, encoded_salt, expected_digest = encoded_hash.split("$", 3)
    if algorithm != "pbkdf2_sha256":
      return False
    salt = base64.urlsafe_b64decode(encoded_salt.encode("ascii"))
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
    actual_digest = base64.urlsafe_b64encode(digest).decode("ascii")
    return hmac.compare_digest(actual_digest, expected_digest)
  except (ValueError, TypeError):
    return False


def verify_password(password: str, encoded_hash: str) -> bool:
  if encoded_hash.startswith("pbkdf2_sha256$"):
    return _verify_legacy_pbkdf2(password, encoded_hash)

  try:
    return password_hasher.verify(encoded_hash, password)
  except (InvalidHashError, VerificationError, VerifyMismatchError, TypeError):
    return False


def password_needs_rehash(encoded_hash: str) -> bool:
  if encoded_hash.startswith("pbkdf2_sha256$"):
    return True

  try:
    return password_hasher.check_needs_rehash(encoded_hash)
  except (InvalidHashError, TypeError):
    return True


def _hmac_sha256(value: str) -> str:
  return hmac.new(SECRET_KEY.encode("utf-8"), value.encode("utf-8"), hashlib.sha256).hexdigest()


def hash_session_token(token: str) -> str:
  return _hmac_sha256(f"session:{token}")


def _request_ip(request: Request | None) -> str | None:
  return request.client.host if request and request.client else None


def _request_user_agent(request: Request | None) -> str | None:
  return request.headers.get("user-agent") if request else None


def _as_utc(value: datetime) -> datetime:
  if value.tzinfo is None:
    return value.replace(tzinfo=timezone.utc)
  return value.astimezone(timezone.utc)


def create_auth_session(db: Session, user: User, request: Request | None = None) -> tuple[str, AuthSession]:
  raw_token = secrets.token_urlsafe(32)
  expires_at = utcnow() + timedelta(hours=SESSION_TTL_HOURS)
  session = AuthSession(
    user_id=user.id,
    token_hash=hash_session_token(raw_token),
    expires_at=expires_at,
    ip_address=_request_ip(request),
    user_agent=_request_user_agent(request),
  )
  db.add(session)
  db.flush()
  return raw_token, session


def set_session_cookie(response: Response, token: str, expires_at: datetime) -> None:
  max_age = max(int((_as_utc(expires_at) - utcnow()).total_seconds()), 0)
  response.set_cookie(
    SESSION_COOKIE_NAME,
    token,
    max_age=max_age,
    expires=max_age,
    httponly=True,
    secure=SESSION_COOKIE_SECURE,
    samesite="lax",
    path="/",
  )


def clear_session_cookie(response: Response) -> None:
  response.delete_cookie(SESSION_COOKIE_NAME, path="/", secure=SESSION_COOKIE_SECURE, samesite="lax")


def revoke_auth_session(db: Session, session: AuthSession) -> None:
  session.revoked_at = utcnow()
  db.add(session)


def _normalize_challenge_answer(answer: str) -> str:
  return answer.strip().lower()


def hash_challenge_answer(challenge_id: str, answer: str) -> str:
  return _hmac_sha256(f"challenge:{challenge_id}:{_normalize_challenge_answer(answer)}")


def create_human_challenge(db: Session, purpose: str, request: Request | None = None) -> HumanChallenge:
  if purpose not in {"register", "login", "password_change"}:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Unsupported challenge purpose")

  left = random.randint(2, 12)
  right = random.randint(2, 12)
  operator = random.choice(["+", "-"])
  answer = left + right if operator == "+" else left - right
  challenge_id = secrets.token_urlsafe(24)
  challenge = HumanChallenge(
    id=challenge_id,
    purpose=purpose,
    question=f"What is {left} {operator} {right}?",
    answer_hash=hash_challenge_answer(challenge_id, str(answer)),
    expires_at=utcnow() + timedelta(minutes=CHALLENGE_TTL_MINUTES),
    ip_address=_request_ip(request),
  )
  db.add(challenge)
  db.flush()
  return challenge


def validate_human_challenge(db: Session, purpose: str, challenge_id: str, answer: str) -> None:
  challenge = db.get(HumanChallenge, challenge_id)
  now = utcnow()
  if challenge is None or challenge.purpose != purpose or challenge.consumed_at is not None or _as_utc(challenge.expires_at) <= now:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired human challenge")

  challenge.attempt_count += 1
  challenge.consumed_at = now
  db.add(challenge)

  expected = hash_challenge_answer(challenge.id, answer)
  if not hmac.compare_digest(expected, challenge.answer_hash):
    db.flush()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid human challenge answer")


def _session_from_token(db: Session, token: str) -> AuthSession | None:
  token_hash = hash_session_token(token)
  return db.query(AuthSession).filter(AuthSession.token_hash == token_hash).first()


def get_current_auth_session(
  request: Request,
  credentials: HTTPAuthorizationCredentials | None = Depends(security),
  db: Session = Depends(get_db),
) -> AuthSession:
  token = request.cookies.get(SESSION_COOKIE_NAME)
  if not token and credentials is not None:
    token = credentials.credentials

  if not token:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing session")

  session = _session_from_token(db, token)
  if session is None or session.revoked_at is not None or _as_utc(session.expires_at) <= utcnow():
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")

  if session.user is None or not session.user.is_active:
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")

  session.last_seen_at = utcnow()
  db.add(session)
  db.commit()
  db.refresh(session)
  return session


def get_current_user(
  current_session: AuthSession = Depends(get_current_auth_session),
) -> User:
  return current_session.user

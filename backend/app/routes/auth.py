from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from ..activity import log_activity
from .. import auth as auth_service
from ..database import get_db
from ..models import AuthSession, User, utcnow
from ..schemas import AuthResponse, ChallengePurpose, ChallengeResponse, ChangePasswordRequest, LoginRequest, MessageResponse, UserCreate, UserRead


router = APIRouter(prefix="/api/auth", tags=["auth"])


def _auth_response(user: User, session: AuthSession) -> AuthResponse:
  return AuthResponse(user=UserRead.model_validate(user), session_expires_at=session.expires_at)


@router.get("/challenge", response_model=ChallengeResponse)
def create_challenge(
  request: Request,
  purpose: ChallengePurpose = "login",
  db: Session = Depends(get_db),
) -> ChallengeResponse:
  challenge = auth_service.create_human_challenge(db, purpose, request)
  db.commit()
  return ChallengeResponse(challenge_id=challenge.id, question=challenge.question, expires_at=challenge.expires_at)


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, request: Request, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
  if payload.email != payload.confirm_email:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Email confirmation does not match")
  if payload.password != payload.confirm_password:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Password confirmation does not match")

  existing_email = db.query(User).filter(User.email == payload.email).first()
  if existing_email:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")
  existing_username = db.query(User).filter(User.username == payload.username).first()
  if existing_username:
    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username is already registered")

  auth_service.validate_human_challenge(db, "register", payload.challenge_id, payload.challenge_answer)

  password_hash = auth_service.hash_password(payload.password)
  user = User(
    email=payload.email,
    username=payload.username,
    password_hash=password_hash,
    hashed_password=password_hash,
    role="user",
    is_active=True,
    must_change_password=False,
  )
  db.add(user)
  db.flush()
  token, session = auth_service.create_auth_session(db, user, request)
  log_activity(db, "register", actor_user_id=user.id, target_user_id=user.id, request=request, details={"username": user.username})
  db.commit()
  db.refresh(user)
  db.refresh(session)
  auth_service.set_session_cookie(response, token, session.expires_at)
  return _auth_response(user, session)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> AuthResponse:
  try:
    auth_service.validate_human_challenge(db, "login", payload.challenge_id, payload.challenge_answer)
  except HTTPException:
    log_activity(db, "login_failure", request=request, details={"reason": "challenge"})
    db.commit()
    raise

  identifier = payload.username_or_email
  if "@" in identifier:
    user = db.query(User).filter(User.email == identifier.lower()).first()
  else:
    user = db.query(User).filter(User.username == identifier).first()

  if user is None:
    log_activity(db, "login_failure", request=request, details={"reason": "invalid_credentials"})
    db.commit()
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
  if not user.is_active:
    log_activity(db, "login_failure", target_user_id=user.id, request=request, details={"reason": "inactive_user"})
    db.commit()
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive user")
  if not auth_service.verify_password(payload.password, user.password_hash):
    log_activity(db, "login_failure", target_user_id=user.id, request=request, details={"reason": "invalid_credentials"})
    db.commit()
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username/email or password")

  if auth_service.password_needs_rehash(user.password_hash):
    password_hash = auth_service.hash_password(payload.password)
    user.password_hash = password_hash
    user.hashed_password = password_hash

  user.last_login_at = utcnow()
  db.add(user)
  token, session = auth_service.create_auth_session(db, user, request)
  log_activity(db, "login_success", actor_user_id=user.id, target_user_id=user.id, request=request)
  db.commit()
  db.refresh(user)
  db.refresh(session)
  auth_service.set_session_cookie(response, token, session.expires_at)
  return _auth_response(user, session)


@router.post("/logout", response_model=MessageResponse)
def logout(
  request: Request,
  response: Response,
  current_session: AuthSession = Depends(auth_service.get_current_auth_session),
  db: Session = Depends(get_db),
) -> MessageResponse:
  auth_service.revoke_auth_session(db, current_session)
  log_activity(
    db,
    "logout",
    actor_user_id=current_session.user_id,
    target_user_id=current_session.user_id,
    request=request,
  )
  db.commit()
  auth_service.clear_session_cookie(response)
  return MessageResponse(message="Logged out")


@router.get("/me", response_model=UserRead)
def read_current_auth_user(current_user: User = Depends(auth_service.get_current_user)) -> User:
  return current_user


@router.post("/change-password", response_model=MessageResponse)
def change_password(
  payload: ChangePasswordRequest,
  request: Request,
  current_user: User = Depends(auth_service.get_current_user),
  db: Session = Depends(get_db),
) -> MessageResponse:
  if payload.new_password != payload.confirm_new_password:
    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Password confirmation does not match")
  if not auth_service.verify_password(payload.current_password, current_user.password_hash):
    log_activity(
      db,
      "password_change_failure",
      actor_user_id=current_user.id,
      target_user_id=current_user.id,
      request=request,
      details={"reason": "invalid_current_password"},
    )
    db.commit()
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Current password is incorrect")

  password_hash = auth_service.hash_password(payload.new_password)
  current_user.password_hash = password_hash
  current_user.hashed_password = password_hash
  current_user.must_change_password = False
  db.add(current_user)
  log_activity(
    db,
    "password_change",
    actor_user_id=current_user.id,
    target_user_id=current_user.id,
    request=request,
  )
  db.commit()
  return MessageResponse(message="Password changed")

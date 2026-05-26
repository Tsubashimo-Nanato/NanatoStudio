from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .bootstrap import seed_default_admin
from .database import SessionLocal, initialize_database
from .routes import admin, auth, editor, health, users


initialize_database()
with SessionLocal() as db:
  seed_default_admin(db)

app = FastAPI(title="Nanato Studio API", version="0.1.0")

default_cors_origins = ",".join(
  [
    "http://localhost:4321",
    "http://127.0.0.1:4321",
    "http://localhost:4322",
    "http://127.0.0.1:4322",
    "http://localhost:4323",
    "http://127.0.0.1:4323",
    "http://localhost:4324",
    "http://127.0.0.1:4324",
    "http://localhost:4331",
    "http://127.0.0.1:4331",
    "http://localhost:4334",
    "http://127.0.0.1:4334",
    "http://localhost:4335",
    "http://127.0.0.1:4335",
    "http://localhost:4339",
    "http://127.0.0.1:4339",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
  ]
)

cors_origins = [
  origin.strip()
  for origin in os.getenv("CORS_ORIGINS", default_cors_origins).split(",")
  if origin.strip()
]

app.add_middleware(
  CORSMiddleware,
  allow_origins=cors_origins,
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(admin.router)
app.include_router(editor.router)

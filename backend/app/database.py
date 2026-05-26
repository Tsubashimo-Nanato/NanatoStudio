from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./nanatostudio.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db() -> Generator:
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()


def _sqlite_columns(table_name: str) -> set[str]:
  with engine.begin() as connection:
    rows = connection.execute(text(f'PRAGMA table_info("{table_name}")')).mappings().all()
  return {str(row["name"]) for row in rows}


def _add_sqlite_column(table_name: str, column_sql: str) -> None:
  with engine.begin() as connection:
    connection.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN {column_sql}'))


def _migrate_sqlite_users_table() -> None:
  inspector = inspect(engine)
  if "users" not in inspector.get_table_names():
    return

  columns = _sqlite_columns("users")
  additions = {
    "password_hash": "password_hash VARCHAR(255)",
    "role": "role VARCHAR(20) DEFAULT 'user' NOT NULL",
    "must_change_password": "must_change_password BOOLEAN DEFAULT 0 NOT NULL",
    "updated_at": "updated_at DATETIME",
    "last_login_at": "last_login_at DATETIME",
  }

  for column_name, ddl in additions.items():
    if column_name not in columns:
      _add_sqlite_column("users", ddl)
      columns.add(column_name)

  with engine.begin() as connection:
    if "hashed_password" in columns:
      connection.execute(
        text("UPDATE users SET password_hash = hashed_password WHERE password_hash IS NULL AND hashed_password IS NOT NULL")
      )
    connection.execute(text("UPDATE users SET role = 'user' WHERE role IS NULL OR role = ''"))
    connection.execute(text("UPDATE users SET must_change_password = 0 WHERE must_change_password IS NULL"))
    connection.execute(text("UPDATE users SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)"))
    connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users (username)"))


def initialize_database() -> None:
  from . import models as _models  # noqa: F401

  Base.metadata.create_all(bind=engine)
  if DATABASE_URL.startswith("sqlite"):
    _migrate_sqlite_users_table()

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from uuid import uuid4

import pytest

db_path = Path(tempfile.gettempdir()) / f"nanato_auth_test_{uuid4().hex}.db"
repo_path = Path(tempfile.gettempdir()) / f"nanato_content_test_{uuid4().hex}"
(repo_path / "src" / "content" / "blog").mkdir(parents=True)
(repo_path / "src" / "content" / "docs").mkdir(parents=True)
(repo_path / "src" / "content" / "blog" / "welcome.md").write_text(
  """---
title: Welcome Test
description: First test blog post.
category: Test
tags: [Test]
maintainers: [adm1n]
date: "2026-05-21"
---

## Welcome

Original welcome body.
""",
  encoding="utf-8",
)
(repo_path / "src" / "content" / "blog" / "second.md").write_text(
  """---
title: Second Test
description: Second test blog post.
category: Test
tags: [Test]
date: "2026-05-21"
---

## Second

Original second body.
""",
  encoding="utf-8",
)
(repo_path / "src" / "content" / "docs" / "aiformula.md").write_text(
  """---
title: AI Formula Test
description: Test manual.
category: Projects
tags: []
---

## 0. Introduction

Intro body.

## 1. Chapter

Chapter body.
""",
  encoding="utf-8",
)
os.environ["DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
os.environ["REPO_ROOT"] = repo_path.as_posix()
os.environ["SESSION_COOKIE_SECURE"] = "false"
os.environ["SECRET_KEY"] = "test-secret-key-for-auth-foundation"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.content_io import resolve_content_path  # noqa: E402


client = TestClient(app)


def solve_question(question: str) -> str:
  match = re.fullmatch(r"What is (-?\d+) ([+-]) (-?\d+)\?", question)
  assert match is not None
  left = int(match.group(1))
  operator = match.group(2)
  right = int(match.group(3))
  return str(left + right if operator == "+" else left - right)


def challenge_payload(purpose: str) -> dict[str, str]:
  response = client.get("/api/auth/challenge", params={"purpose": purpose})
  assert response.status_code == 200
  data = response.json()
  return {
    "challenge_id": data["challenge_id"],
    "challenge_answer": solve_question(data["question"]),
  }


def login_admin() -> None:
  client.post("/api/auth/logout")
  response = client.post(
    "/api/auth/login",
    json={
      "username_or_email": "adm1n",
      "password": "adm1n",
      **challenge_payload("login"),
    },
  )
  assert response.status_code == 200


def register_user(username: str) -> None:
  client.post("/api/auth/logout")
  response = client.post(
    "/api/auth/register",
    json={
      "username": username,
      "email": f"{username}@example.test",
      "confirm_email": f"{username}@example.test",
      "password": "strong-password-1",
      "confirm_password": "strong-password-1",
      **challenge_payload("register"),
    },
  )
  assert response.status_code == 201


def login_user(username: str) -> None:
  client.post("/api/auth/logout")
  response = client.post(
    "/api/auth/login",
    json={
      "username_or_email": username,
      "password": "strong-password-1",
      **challenge_payload("login"),
    },
  )
  assert response.status_code == 200


def login_with_password(username: str, password: str) -> None:
  client.post("/api/auth/logout")
  response = client.post(
    "/api/auth/login",
    json={
      "username_or_email": username,
      "password": password,
      **challenge_payload("login"),
    },
  )
  assert response.status_code == 200


def test_default_admin_can_login_and_logout() -> None:
  login_payload = {
    "username_or_email": "adm1n",
    "password": "adm1n",
    **challenge_payload("login"),
  }
  login_response = client.post("/api/auth/login", json=login_payload)
  assert login_response.status_code == 200
  login_data = login_response.json()
  assert login_data["user"]["username"] == "adm1n"
  assert login_data["user"]["role"] == "admin"
  assert login_data["user"]["must_change_password"] is True

  me_response = client.get("/api/auth/me")
  assert me_response.status_code == 200
  me_data = me_response.json()
  assert me_data["email"] == "adm1n@example.local"
  assert "password_hash" not in me_data

  logout_response = client.post("/api/auth/logout")
  assert logout_response.status_code == 200
  assert client.get("/api/auth/me").status_code == 401


def test_register_login_and_challenge_reuse_rejection() -> None:
  register_challenge = challenge_payload("register")
  register_payload = {
    "username": "editor1",
    "email": "editor1@example.test",
    "confirm_email": "editor1@example.test",
    "password": "strong-password-1",
    "confirm_password": "strong-password-1",
    **register_challenge,
  }
  register_response = client.post("/api/auth/register", json=register_payload)
  assert register_response.status_code == 201
  register_data = register_response.json()
  assert register_data["user"]["username"] == "editor1"
  assert register_data["user"]["role"] == "user"
  assert register_data["user"]["must_change_password"] is False

  reuse_response = client.post("/api/auth/register", json={**register_payload, "username": "editor2", "email": "editor2@example.test", "confirm_email": "editor2@example.test"})
  assert reuse_response.status_code == 400

  client.post("/api/auth/logout")
  login_response = client.post(
    "/api/auth/login",
    json={
      "username_or_email": "editor1@example.test",
      "password": "strong-password-1",
      **challenge_payload("login"),
    },
  )
  assert login_response.status_code == 200
  assert login_response.json()["user"]["username"] == "editor1"


def test_registration_validation_errors() -> None:
  payload = {
    "username": "broken-user",
    "email": "one@example.test",
    "confirm_email": "two@example.test",
    "password": "strong-password-2",
    "confirm_password": "strong-password-2",
    **challenge_payload("register"),
  }
  response = client.post("/api/auth/register", json=payload)
  assert response.status_code == 422


def test_admin_user_management_overview_and_access_control() -> None:
  login_admin()
  overview_response = client.get("/api/admin/overview")
  assert overview_response.status_code == 200
  overview = overview_response.json()
  assert overview["total_users"] >= 1
  assert overview["active_users"] >= 1
  assert overview["admin_count"] >= 1
  assert "assigned_permissions" in overview
  assert "recent_login_failures" in overview
  assert overview["default_admin_password_warning"] is True

  create_response = client.post(
    "/api/admin/users",
    json={
      "username": "managed_user",
      "email": "managed_user@example.test",
      "role": "user",
      "is_active": True,
      "must_change_password": True,
      "temporary_password": "temporary-password-1",
    },
  )
  assert create_response.status_code == 201
  created = create_response.json()
  assert created["username"] == "managed_user"
  assert "password_hash" not in created

  update_response = client.patch(
    f"/api/admin/users/{created['id']}",
    json={
      "username": "managed_editor",
      "email": "managed_editor@example.test",
      "role": "editor",
      "is_active": True,
      "must_change_password": True,
      "temporary_password": "temporary-password-2",
    },
  )
  assert update_response.status_code == 200
  updated = update_response.json()
  assert updated["username"] == "managed_editor"
  assert updated["role"] == "editor"
  assert updated["must_change_password"] is True

  last_admin_block = client.patch("/api/admin/users/1", json={"role": "user"})
  assert last_admin_block.status_code == 409

  activity_response = client.get("/api/admin/activity", params={"event_type": "admin_user_update"})
  assert activity_response.status_code == 200
  assert any(event["target_user_id"] == created["id"] for event in activity_response.json()["events"])

  login_with_password("managed_editor", "temporary-password-2")
  assert client.get("/api/admin/users").status_code == 403


def test_content_scan_permissions_and_restricted_editing() -> None:
  login_admin()
  scan_response = client.post("/api/admin/content/scan")
  assert scan_response.status_code == 200
  scan_data = scan_response.json()
  assert scan_data["scanned_files"] == 3
  assert scan_data["chapters"] == 2

  content_response = client.get("/api/admin/content")
  assert content_response.status_code == 200
  items = content_response.json()["items"]
  welcome = next(item for item in items if item["slug"] == "welcome")
  second = next(item for item in items if item["slug"] == "second")
  chapter = next(item for item in items if item["type"] == "chapter")
  assert welcome["maintainers"][0]["username"] == "adm1n"
  assert chapter["is_editable"] is False

  register_user("maintainer1")
  login_admin()
  grant_response = client.post(
    f"/api/admin/content/{welcome['id']}/permissions",
    json={"username": "maintainer1", "permission": "maintain"},
  )
  assert grant_response.status_code == 201

  login_user("maintainer1")
  editor_list_response = client.get("/api/editor/content")
  assert editor_list_response.status_code == 200
  editor_items = editor_list_response.json()["items"]
  assert [item["slug"] for item in editor_items] == ["welcome"]

  welcome_detail = client.get(f"/api/editor/content/{welcome['id']}")
  assert welcome_detail.status_code == 200
  welcome_data = welcome_detail.json()
  assert "Original welcome body" in welcome_data["body"]

  blocked_detail = client.get(f"/api/editor/content/{second['id']}")
  assert blocked_detail.status_code == 403

  update_response = client.patch(
    f"/api/editor/content/{welcome['id']}",
    json={
      "frontmatter": {"title": "Welcome Edited", "tags": ["Test", "Edited"]},
      "body": "## Welcome\n\nEdited by maintainer.",
      "body_hash": welcome_data["body_hash"],
    },
  )
  assert update_response.status_code == 200
  assert "Edited by maintainer" in (repo_path / "src" / "content" / "blog" / "welcome.md").read_text(encoding="utf-8")

  blocked_update = client.patch(
    f"/api/editor/content/{second['id']}",
    json={"frontmatter": {"title": "Blocked"}, "body": "Nope"},
  )
  assert blocked_update.status_code == 403

  login_admin()
  admin_update = client.patch(
    f"/api/admin/content/{second['id']}",
    json={"frontmatter": {"title": "Second Edited"}, "body": "## Second\n\nEdited by admin."},
  )
  assert admin_update.status_code == 200

  chapter_update = client.patch(
    f"/api/admin/content/{chapter['id']}",
    json={"frontmatter": {"title": "Chapter Edited"}, "body": "Unsafe chapter edit"},
  )
  assert chapter_update.status_code == 409


def test_content_path_traversal_is_rejected() -> None:
  with pytest.raises(Exception):
    resolve_content_path("../README.md")
  with pytest.raises(Exception):
    resolve_content_path("src/content/blog/../../../../README.md")

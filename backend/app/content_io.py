from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException, status


REPO_ROOT = Path(os.getenv("REPO_ROOT", Path(__file__).resolve().parents[2])).resolve()
BLOG_ROOT = (REPO_ROOT / "src" / "content" / "blog").resolve()
DOCS_ROOT = (REPO_ROOT / "src" / "content" / "docs").resolve()
ALLOWED_ROOTS = (BLOG_ROOT, DOCS_ROOT)
ALLOWED_SUFFIXES = {".md", ".mdx"}


def to_repo_relative(path: Path) -> str:
  return path.resolve().relative_to(REPO_ROOT).as_posix()


def content_root_for(path: Path) -> Path:
  resolved = path.resolve()
  for root in ALLOWED_ROOTS:
    if resolved.is_relative_to(root):
      return root
  raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Content path is outside allowed roots")


def resolve_content_path(file_path: str) -> Path:
  candidate = Path(file_path)
  if candidate.is_absolute():
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Absolute content paths are not allowed")
  if any(part == ".." for part in candidate.parts):
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Path traversal is not allowed")

  resolved = (REPO_ROOT / candidate).resolve()
  content_root_for(resolved)
  if resolved.suffix.lower() not in ALLOWED_SUFFIXES:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only Markdown and MDX files can be edited")
  if not resolved.exists() or not resolved.is_file():
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Content source file not found")
  return resolved


def content_hash(text: str) -> str:
  return hashlib.sha256(text.encode("utf-8")).hexdigest()


def slugify(value: str) -> str:
  slug = re.sub(r"[^\w\s-]", "", value.lower(), flags=re.UNICODE)
  slug = re.sub(r"[-\s]+", "-", slug, flags=re.UNICODE).strip("-")
  return slug or "section"


def route_for_file(path: Path) -> tuple[str, str, str]:
  root = content_root_for(path)
  relative = path.resolve().relative_to(root)
  slug = relative.as_posix()
  slug = re.sub(r"\.(md|mdx)$", "", slug, flags=re.IGNORECASE)
  slug = re.sub(r"/index$", "", slug, flags=re.IGNORECASE)
  if root == BLOG_ROOT:
    return "blog", slug, f"/blog/{slug}/"
  return "doc", slug, f"/docs/{slug}/"


def is_aiformula_chapter_file(path: Path) -> bool:
  root = content_root_for(path)
  if root != DOCS_ROOT:
    return False
  relative = path.resolve().relative_to(root)
  if len(relative.parts) >= 2 and relative.parts[0] == "aiformula-chapters":
    return True
  return len(relative.parts) >= 3 and relative.parts[0] == "aiformula" and relative.parts[1] == "chapters"


def iter_source_markdown() -> list[Path]:
  files: list[Path] = []
  for root in ALLOWED_ROOTS:
    if root.exists():
      files.extend(path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in ALLOWED_SUFFIXES)
  return sorted(files)


def _parse_scalar(value: str) -> Any:
  stripped = value.strip()
  if not stripped:
    return ""
  if stripped.startswith("[") and stripped.endswith("]"):
    try:
      return json.loads(stripped.replace("'", '"'))
    except json.JSONDecodeError:
      inner = stripped[1:-1].strip()
      return [part.strip().strip('"').strip("'") for part in inner.split(",") if part.strip()]
  if (stripped.startswith('"') and stripped.endswith('"')) or (stripped.startswith("'") and stripped.endswith("'")):
    return stripped[1:-1]
  if stripped.lower() in {"true", "false"}:
    return stripped.lower() == "true"
  try:
    return int(stripped)
  except ValueError:
    return stripped


def parse_frontmatter(raw: str) -> tuple[dict[str, Any], str]:
  normalized = raw.lstrip("\ufeff").replace("\r\n", "\n")
  if not normalized.startswith("---\n"):
    return {}, normalized
  end = normalized.find("\n---", 4)
  if end == -1:
    return {}, normalized

  frontmatter_text = normalized[4:end].strip("\n")
  body = normalized[end + 4 :]
  if body.startswith("\n"):
    body = body[1:]

  data: dict[str, Any] = {}
  current_list_key: str | None = None
  for line in frontmatter_text.splitlines():
    if not line.strip() or line.lstrip().startswith("#"):
      continue
    list_match = re.match(r"^\s*-\s*(.+?)\s*$", line)
    if list_match and current_list_key:
      data.setdefault(current_list_key, []).append(_parse_scalar(list_match.group(1)))
      continue
    key_match = re.match(r"^([A-Za-z0-9_-]+):(?:\s*(.*))?$", line)
    if not key_match:
      current_list_key = None
      continue
    key = key_match.group(1)
    value = key_match.group(2) or ""
    if value.strip() == "":
      data[key] = []
      current_list_key = key
    else:
      data[key] = _parse_scalar(value)
      current_list_key = None
  return data, body


def _yaml_scalar(value: Any) -> str:
  if isinstance(value, bool):
    return "true" if value else "false"
  if isinstance(value, int | float):
    return str(value)
  text = str(value)
  if text == "" or any(char in text for char in [":", "#", "[", "]", "{", "}", '"']) or text.strip() != text:
    return json.dumps(text, ensure_ascii=False)
  return text


def serialize_frontmatter(data: dict[str, Any], body: str) -> str:
  lines = ["---"]
  for key, value in data.items():
    if isinstance(value, list):
      if not value:
        lines.append(f"{key}: []")
      else:
        lines.append(f"{key}:")
        for item in value:
          lines.append(f"  - {_yaml_scalar(item)}")
    else:
      lines.append(f"{key}: {_yaml_scalar(value)}")
  lines.append("---")
  lines.append("")
  lines.append(body.lstrip("\n"))
  return "\n".join(lines)


def read_markdown_file(path: Path) -> tuple[dict[str, Any], str, str]:
  raw = path.read_text(encoding="utf-8")
  frontmatter, body = parse_frontmatter(raw)
  return frontmatter, body, raw


def write_markdown_file(path: Path, frontmatter: dict[str, Any], body: str) -> str:
  content_root_for(path)
  next_raw = serialize_frontmatter(frontmatter, body)
  path.write_text(next_raw, encoding="utf-8", newline="\n")
  return next_raw


def extract_maintainers(frontmatter: dict[str, Any]) -> list[str]:
  maintainers = frontmatter.get("maintainers", [])
  if isinstance(maintainers, str):
    return [maintainers] if maintainers else []
  if not isinstance(maintainers, list):
    return []
  names: list[str] = []
  for item in maintainers:
    if isinstance(item, str) and item.strip():
      names.append(item.strip())
    elif isinstance(item, dict):
      username = item.get("username")
      if isinstance(username, str) and username.strip():
        names.append(username.strip())
  return names


def update_file_maintainers(file_path: str, maintainers: list[str]) -> None:
  path = resolve_content_path(file_path)
  frontmatter, body, _raw = read_markdown_file(path)
  frontmatter["maintainers"] = sorted(dict.fromkeys(maintainers))
  write_markdown_file(path, frontmatter, body)


def find_markdown_chapters(path: Path) -> list[dict[str, str]]:
  _frontmatter, body, _raw = read_markdown_file(path)
  chapters: list[dict[str, str]] = []
  seen: dict[str, int] = {}
  for match in re.finditer(r"^##\s+(.+?)\s*$", body, flags=re.MULTILINE):
    title = match.group(1).strip()
    base_slug = slugify(title)
    count = seen.get(base_slug, 0)
    seen[base_slug] = count + 1
    anchor = base_slug if count == 0 else f"{base_slug}-{count + 1}"
    chapters.append({"title": title, "anchor": anchor})
  return chapters

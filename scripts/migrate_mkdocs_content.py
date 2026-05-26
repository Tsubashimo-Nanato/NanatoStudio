from __future__ import annotations

import json
import posixpath
import re
import shutil
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class MigrationPage:
  source: str
  collection: str
  slug: str
  description: str
  category: str
  order: int
  date: str | None = None


PAGES = [
  MigrationPage("index.md", "docs", "home", "Original MkDocs home page preserved as migrated documentation.", "Standalone", 1),
  MigrationPage("about/index.md", "docs", "about", "Studio background, mission, and documentation scope placeholder.", "Standalone", 10),
  MigrationPage("projects/index.md", "docs", "projects", "Overview of migrated project documentation pages.", "Projects", 20),
  MigrationPage("projects/aiformula.md", "docs", "aiformula", "AI Formula onboarding manual with MkDocs snippets expanded.", "Projects", 21),
  MigrationPage("projects/cooking.md", "docs", "cooking", "Cooking project placeholder migrated from MkDocs.", "Projects", 22),
  MigrationPage("projects/gaming.md", "docs", "gaming", "Gaming project placeholder migrated from MkDocs.", "Projects", 23),
  MigrationPage("projects/embedded.md", "docs", "embedded", "Embedded project placeholder migrated from MkDocs.", "Projects", 24),
  MigrationPage("projects/softwares.md", "docs", "softwares", "Softwares project placeholder migrated from MkDocs.", "Projects", 25),
  MigrationPage("gallery/index.md", "docs", "gallery", "Visual gallery placeholder migrated from MkDocs.", "Standalone", 40),
  MigrationPage("c/index.md", "docs", "c", "Content editing example migrated from MkDocs syntax.", "Reference", 50),
  MigrationPage("contact/index.md", "docs", "contact", "Contact and contribution placeholder migrated from MkDocs.", "Standalone", 60),
  MigrationPage("assets/aiformula/text/22.md", "docs", "aiformula-temp-zhao-wei", "Unclassified AI Formula temporary note preserved from excluded MkDocs source.", "Unclassified", 90),
  MigrationPage("blog/index.md", "blog", "welcome", "Original MkDocs blog placeholder preserved as the first Astro blog entry.", "Blog", 1, "2026-04-28"),
]

ROUTES = {
  "index.md": "/",
  "about/index.md": "/docs/about/",
  "projects/index.md": "/docs/projects/",
  "projects/aiformula.md": "/docs/aiformula/",
  "projects/cooking.md": "/docs/cooking/",
  "projects/gaming.md": "/docs/gaming/",
  "projects/embedded.md": "/docs/embedded/",
  "projects/softwares.md": "/docs/softwares/",
  "blog/index.md": "/blog/",
  "gallery/index.md": "/docs/gallery/",
  "c/index.md": "/docs/c/",
  "contact/index.md": "/docs/contact/",
}

DOWNLOAD_PREFIXES_BY_TITLE = {
  "Vehicle Document": "01_",
  "Board Details": "02_",
  "Motor Controller Guide": "03_",
  "CAN Commands for Ubuntu": "04_CAN",
  "CAN ID Allocation Sheet": "AIF_CAN-ID",
  "RoboteQ CAN Manual": "RoboteQ_CAN",
}


def find_docs_root() -> Path:
  active = ROOT / "docs"
  archived = ROOT / "legacy" / "mkdocs" / "docs"
  if active.exists():
    return active
  if archived.exists():
    return archived
  raise FileNotFoundError("Could not find docs/ or legacy/mkdocs/docs/")


def read_text(path: Path) -> str:
  return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(content, encoding="utf-8", newline="\n")


def posix(path: Path) -> str:
  return path.as_posix()


def extract_title(markdown: str, fallback: str) -> tuple[str, str]:
  lines = markdown.splitlines()
  for index, line in enumerate(lines):
    match = re.match(r"^(#{1,2})\s+(.+?)\s*$", line)
    if match:
      title = match.group(2).strip()
      del lines[index]
      return title, "\n".join(lines).strip() + "\n"
  return fallback, markdown.strip() + "\n"


def expand_snippets(markdown: str, docs_root: Path) -> str:
  def replace(match: re.Match[str]) -> str:
    snippet_rel = match.group(1)
    snippet_path = docs_root / snippet_rel
    if not snippet_path.exists():
      return f"> **Migration note:** Missing MkDocs snippet `{snippet_rel}`."
    return read_text(snippet_path).strip()

  return re.sub(r'--8<--\s+"([^"]+)"', replace, markdown)


def flatten_mkdocs_markdown_html(markdown: str) -> str:
  flattened: list[str] = []
  markdown_div_depth = 0

  for line in markdown.splitlines():
    stripped = line.strip()
    if re.match(r"<div\b[^>]*\bmarkdown\b[^>]*>", stripped):
      markdown_div_depth += 1
      continue
    if markdown_div_depth and stripped == "</div>":
      markdown_div_depth -= 1
      continue
    flattened.append(line)

  return "\n".join(flattened)


def convert_admonitions(markdown: str) -> str:
  lines = markdown.splitlines()
  converted: list[str] = []
  index = 0

  while index < len(lines):
    line = lines[index]
    admonition = re.match(r"^!!!\s+(\w+)(?:\s+\"(.+?)\")?\s*$", line)
    collapsible = re.match(r"^\?\?\?\s+(\w+)(?:\s+\"(.+?)\")?\s*$", line)
    tab = re.match(r"^===\s+\"(.+?)\"\s*$", line)

    if admonition:
      label = admonition.group(2) or admonition.group(1).title()
      converted.append(f"> **{label}**")
      index += 1
      while index < len(lines) and (lines[index].startswith("    ") or not lines[index].strip()):
        nested = lines[index][4:] if lines[index].startswith("    ") else ""
        converted.append(f"> {nested}" if nested else ">")
        index += 1
      continue

    if collapsible:
      label = collapsible.group(2) or collapsible.group(1).title()
      converted.append(f"<details>\n<summary>{label}</summary>\n")
      index += 1
      while index < len(lines) and (lines[index].startswith("    ") or not lines[index].strip()):
        converted.append(lines[index][4:] if lines[index].startswith("    ") else "")
        index += 1
      converted.append("\n</details>")
      continue

    if tab:
      converted.append(f"**{tab.group(1)}**")
      index += 1
      while index < len(lines) and (lines[index].startswith("    ") or not lines[index].strip()):
        converted.append(lines[index][4:] if lines[index].startswith("    ") else "")
        index += 1
      continue

    converted.append(line)
    index += 1

  return "\n".join(converted) + "\n"


def strip_mkdocs_attrs(markdown: str) -> str:
  markdown = re.sub(r"(\[[^\]]+\]\([^)]+\))\{[^}]+\}", r"\1", markdown)
  markdown = re.sub(r"(!\[[^\]]*\]\([^)]+\))\{[^}]+\}", r"\1", markdown)
  return markdown


def rewrite_page_link(url: str, source_rel: str) -> str:
  if not url or url.startswith(("#", "http://", "https://", "mailto:", "tel:", "/")):
    return url

  if url.startswith("<") and url.endswith(">"):
    inner = url[1:-1]
    return f"<{rewrite_page_link(inner, source_rel)}>"

  path_part, hash_part = (url.split("#", 1) + [""])[:2] if "#" in url else (url, "")
  if path_part.startswith(("assets/", "../assets/", "../../assets/")) or "assets/aiformula/" in path_part:
    normalized = path_part
    while normalized.startswith("../"):
      normalized = normalized[3:]
    return f"/{normalized}{('#' + hash_part) if hash_part else ''}"

  source_parent = PurePosixPath(source_rel).parent
  normalized = posixpath.normpath((source_parent / path_part).as_posix())
  while normalized.startswith("./"):
    normalized = normalized[2:]

  route = ROUTES.get(normalized)
  if route:
    return f"{route}{('#' + hash_part) if hash_part else ''}"

  return url


def rewrite_links(markdown: str, source_rel: str) -> str:
  markdown = markdown.replace("](../assets/", "](/assets/")
  markdown = markdown.replace("](../../assets/", "](/assets/")
  markdown = markdown.replace("](assets/", "](/assets/")
  markdown = markdown.replace('href="../assets/', 'href="/assets/')
  markdown = markdown.replace('href="../../assets/', 'href="/assets/')
  markdown = markdown.replace('href="assets/', 'href="/assets/')

  def replace_markdown_link(match: re.Match[str]) -> str:
    prefix, url, fragment, suffix = match.groups()
    new_url = rewrite_page_link(url + (fragment or ""), source_rel)
    return f"{prefix}{new_url}{suffix}"

  markdown = re.sub(r"(\[[^\]]+\]\()([^)\s]+?\.md)(#[^)]+)?(\))", replace_markdown_link, markdown)

  def replace_href(match: re.Match[str]) -> str:
    url = match.group(1)
    return f'href="{rewrite_page_link(url, source_rel)}"'

  return re.sub(r'href="([^"]+)"', replace_href, markdown)


def find_download_file(title: str, docs_root: Path) -> str | None:
  documents = docs_root / "assets" / "aiformula" / "documents"
  if not documents.exists():
    return None

  files = [path for path in documents.iterdir() if path.is_file()]
  prefix = DOWNLOAD_PREFIXES_BY_TITLE.get(title)
  if prefix:
    match = next((path for path in files if path.name.startswith(prefix)), None)
    return match.name if match else None

  formula_pdfs = [
    path for path in files
    if path.name.startswith("AIFormula") and path.suffix.lower() == ".pdf"
  ]
  if title == "AI Formula Briefing" and formula_pdfs:
    return max(formula_pdfs, key=lambda path: path.stat().st_size).name
  if title == "Parts List" and formula_pdfs:
    return min(formula_pdfs, key=lambda path: path.stat().st_size).name

  return None


def convert_download_buttons(markdown: str, docs_root: Path) -> str:
  def replace_button(match: re.Match[str]) -> str:
    block = match.group(0)
    title_match = re.search(r'<strong class="download-card__title">(.+?)</strong>', block)
    if not title_match:
      return block

    file_name = find_download_file(title_match.group(1).strip(), docs_root)
    if not file_name:
      return block

    href = f"/assets/aiformula/documents/{quote(file_name)}"
    block = re.sub(
      r'<button class="download-card" type="button" data-download-file="[^"]+">',
      f'<a class="download-card" href="{href}" download>',
      block,
      count=1,
    )
    block = re.sub(
      r'(<span class="download-card__meta">)(.*?)(</span>)',
      lambda meta: f"{meta.group(1)}{file_name}{meta.group(3)}",
      block,
      count=1,
    )
    return block.replace("</button>", "</a>")

  return re.sub(r'<button class="download-card" type="button" data-download-file="[^"]+">.*?</button>', replace_button, markdown, flags=re.S)


def frontmatter(page: MigrationPage, title: str) -> str:
  data = {
    "title": title,
    "description": page.description,
    "order": page.order,
    "category": page.category,
    "legacyPath": f"docs/{page.source}",
    "source": "mkdocs-migration",
    "tags": [],
  }
  if page.date:
    data["date"] = page.date

  lines = ["---"]
  for key, value in data.items():
    lines.append(f"{key}: {json.dumps(value, ensure_ascii=False)}")
  lines.append("---")
  return "\n".join(lines) + "\n\n"


def migrate_page(page: MigrationPage, docs_root: Path) -> Path:
  source_path = docs_root / page.source
  if not source_path.exists():
    raise FileNotFoundError(f"Missing source page: {source_path}")

  markdown = read_text(source_path)
  markdown = expand_snippets(markdown, docs_root)
  markdown = markdown.replace(
    "<!-- Edit chapter content only in docs/assets/aiformula/text/0.md to 21.md. -->",
    "<!-- Migrated from the old MkDocs AI Formula shell with snippet files 0.md to 21.md expanded inline. -->",
  )
  markdown = flatten_mkdocs_markdown_html(markdown)
  title, body = extract_title(markdown, page.slug.replace("-", " ").title())
  body = strip_mkdocs_attrs(body)
  body = convert_admonitions(body)
  body = rewrite_links(body, page.source)
  body = convert_download_buttons(body, docs_root)

  target = ROOT / "src" / "content" / page.collection / f"{page.slug}.md"
  write_text(target, frontmatter(page, title) + body.strip() + "\n")
  return target


def copy_assets(docs_root: Path) -> None:
  source_assets = docs_root / "assets"
  target_assets = ROOT / "public" / "assets"
  if source_assets.exists():
    shutil.copytree(source_assets, target_assets, dirs_exist_ok=True)


def main() -> None:
  docs_root = find_docs_root()
  for collection in ("blog", "docs"):
    (ROOT / "src" / "content" / collection).mkdir(parents=True, exist_ok=True)

  migrated = [migrate_page(page, docs_root) for page in PAGES]
  copy_assets(docs_root)

  print(f"Migrated {len(migrated)} Markdown entries from {docs_root}")
  for path in migrated:
    print(f"- {path.relative_to(ROOT)}")


if __name__ == "__main__":
  main()

import type { CollectionEntry } from "astro:content";

type BlogEntry = CollectionEntry<"blog">;
type DocsEntry = CollectionEntry<"docs">;

export function contentSlug(entry: BlogEntry | DocsEntry): string {
  return entry.id.replace(/\.(md|mdx)$/i, "").replace(/\/index$/i, "");
}

export function textSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/[-\s]+/gu, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}

export function isEmbeddedDocEntry(entry: DocsEntry): boolean {
  return entry.id.startsWith("aiformula-chapters/") || entry.id.startsWith("aiformula/chapters/");
}

export function publicDocs(entries: DocsEntry[]): DocsEntry[] {
  return entries.filter((entry) => !isEmbeddedDocEntry(entry));
}

export function docsUrl(entry: DocsEntry): string {
  return `/docs/${contentSlug(entry)}/`;
}

export function blogUrl(entry: BlogEntry): string {
  return `/blog/${contentSlug(entry)}/`;
}

export function formatContentDate(date: Date): string {
  return date.toLocaleDateString("en", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

export function estimateReadingMinutes(text = ""): number {
  const words = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .match(/[\p{L}\p{N}'-]+/gu);

  return Math.max(1, Math.ceil((words?.length ?? 0) / 220));
}

export function readingTimeLabel(text = ""): string {
  const minutes = estimateReadingMinutes(text);
  return `${minutes} min read`;
}

export function sortByOrderThenTitle<T extends BlogEntry | DocsEntry>(entries: T[]): T[] {
  return [...entries].sort((left, right) => {
    const byOrder = left.data.order - right.data.order;
    if (byOrder !== 0) return byOrder;
    return left.data.title.localeCompare(right.data.title);
  });
}

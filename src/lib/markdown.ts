/**
 * Remove a leading heading that just repeats the article title.
 *
 * The generator writes articles with the title as an H1 at the top of the body.
 * Consumers that render the title separately (the Knowledge Hub, previews) don't
 * want it twice. Strips the first heading only when it's an H1 (the title
 * pattern) or its text matches the given title — never a real H2 section.
 */
export function stripTitleHeading(markdown: string, title: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const target = norm(title);

  const lines = markdown.replace(/^﻿/, "").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;

  const match = (lines[i] ?? "").match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (match) {
    const isH1 = match[1].length === 1;
    const matchesTitle = norm(match[2]) === target;
    if (isH1 || matchesTitle) {
      lines.splice(0, i + 1);
      while (lines.length && lines[0].trim() === "") lines.shift();
      return lines.join("\n");
    }
  }
  return markdown;
}

/**
 * The article's own title: the H1 its first line carries, or undefined when
 * it opens with anything else. Trailing `#`s are dropped, as Markdown allows
 * them to close a heading.
 */
export function leadingTitle(markdown: string | undefined | null): string | undefined {
  const first = (markdown ?? "")
    .replace(/^﻿/, "")
    .split("\n")
    .find((line) => line.trim() !== "");
  const match = first?.match(/^#\s+(.+?)\s*#*\s*$/);
  return match?.[1].trim() || undefined;
}

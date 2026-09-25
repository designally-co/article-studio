/** Shapes the model returns for an outline (long-form) or content plan (short-form). */
export type OutlineJson = {
  // long-form
  title?: string;
  introAngle?: string;
  sections?: { heading: string; points: string[] }[];
  sources?: { name: string; url: string; whyRelevant: string }[];
  cta?: string;
  // short-form
  hook?: string;
  bodyAngle?: string;
  hashtags?: string[];
};

/** Render the model's outline/plan JSON to editable Markdown. */
export function outlineToMarkdown(o: OutlineJson, longForm: boolean): string {
  if (longForm) {
    const lines: string[] = [];
    if (o.title) lines.push(`# ${o.title}`, "");
    if (o.introAngle) lines.push(`**Intro angle:** ${o.introAngle}`, "");
    for (const s of o.sections ?? []) {
      lines.push(`## ${s.heading}`);
      for (const p of s.points ?? []) lines.push(`- ${p}`);
      lines.push("");
    }
    if (o.sources?.length) {
      lines.push("## Research notes");
      for (const source of o.sources) {
        const url = safeHttpUrl(source.url);
        lines.push(url
          ? `- [${source.name}](${url}) — ${source.whyRelevant}`
          : `- ${source.name} — ${source.whyRelevant}`);
      }
      lines.push("");
    }
    if (o.cta) lines.push(`**CTA:** ${o.cta}`);
    return lines.join("\n").trim();
  }

  const lines: string[] = [];
  if (o.title) lines.push(`**Working title:** ${o.title}`);
  if (o.hook) lines.push(`**Hook:** ${o.hook}`);
  if (o.bodyAngle) lines.push(`**Body angle:** ${o.bodyAngle}`);
  if (o.cta) lines.push(`**CTA:** ${o.cta}`);
  if (o.hashtags?.length) lines.push(`**Hashtags:** ${o.hashtags.join(" ")}`);
  return lines.join("\n\n").trim();
}

/**
 * Pull the research sources out of a stored outline's Markdown. The only links
 * an outline carries are its research sources (rendered as `- [name](url)`), so
 * we collect every Markdown link and de-duplicate by URL. Used to append a
 * "Sources" section to the drafted article.
 */
export function extractOutlineSources(markdown: string): { name: string; url: string }[] {
  const seen = new Set<string>();
  const out: { name: string; url: string }[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const name = match[1].trim();
    const url = match[2].trim();
    if (!name || seen.has(url)) continue;
    seen.add(url);
    out.push({ name, url });
  }
  return out.slice(0, 12);
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Lift the article's own "## Sources" block out of the body.
 *
 * The Knowledge Hub has a structured `references` field and renders the list
 * itself, so shipping the same links as prose leaves them as paragraphs in
 * Lexical rich text — unlistable, uncheckable, and duplicated under a heading
 * the Hub is about to draw again. This returns the body without that section
 * and the links as data.
 *
 * Scoped to the Sources heading deliberately: the body also carries inline
 * links on names and claims, and those belong in the prose where the writer
 * put them.
 */
const SOURCES_SECTION = /\n#{1,6}[ \t]*(?:sources|references)[ \t]*\n([\s\S]*?)(?=\n#{1,6}[ \t]|$)/i;

/**
 * The same markdown with one more link at the end of its Sources list, or a
 * Sources list holding just that link if it had none.
 *
 * For the Publish stage's preview, so a cover's credit is seen where it will
 * appear — `publishToHubCore` adds it to the references it sends, and the
 * preview draws the references from this markdown.
 */
export function withReference(markdown: string, reference: { label: string; url: string }): string {
  const label = reference.label.replace(/[[\]]/g, "").trim();
  const url = reference.url.trim();
  if (!label || !/^https?:\/\//.test(url)) return markdown;
  const line = `- [${label}](${url})`;
  const section = markdown.match(SOURCES_SECTION);
  if (!section || section.index === undefined) return `${markdown.trimEnd()}\n\n## Sources\n\n${line}\n`;
  if (splitSourcesSection(markdown).references.some((existing) => existing.url === url && existing.label === label)) {
    return markdown;
  }
  const end = section.index + section[0].length;
  return `${markdown.slice(0, end).trimEnd()}\n${line}\n${markdown.slice(end)}`;
}

export function splitSourcesSection(markdown: string): {
  body: string;
  references: { label: string; url: string }[];
} {
  const section = markdown.match(SOURCES_SECTION);
  if (!section || section.index === undefined) return { body: markdown, references: [] };

  const references: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  const link = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = link.exec(section[1])) !== null) {
    const label = match[1].trim();
    const url = match[2].trim();
    if (!label || seen.has(url)) continue;
    seen.add(url);
    references.push({ label, url });
  }

  // A Sources heading with nothing linkable under it is left alone rather than
  // silently deleted — better a redundant heading than lost text.
  if (!references.length) return { body: markdown, references: [] };

  const body = (markdown.slice(0, section.index) + markdown.slice(section.index + section[0].length)).trimEnd();
  return { body, references };
}

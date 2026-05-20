import { promises as fs } from 'node:fs';
import path from 'node:path';

// Methodology docs live as markdown at the repo root (../docs/methodology), outside
// web/. outputFileTracingRoot in next.config.ts is the repo root, so these ship to
// Vercel the same way data/ does. Read at build time (pages are statically generated).
const DOCS_ROOT = path.join(process.cwd(), '..', 'docs', 'methodology');

export interface DocMeta {
  slug: string;
  title: string;
  order: number;
}

export interface DocPage extends DocMeta {
  /** Markdown body with the frontmatter block stripped. */
  body: string;
}

/**
 * Minimal frontmatter parser. Our frontmatter is a trivial `key: value` block fenced
 * by leading `---` lines — not worth pulling in gray-matter for three keys. Anything
 * before the closing fence is metadata; everything after is the markdown body.
 */
function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) data[key] = val;
  }
  return { data, body: m[2] };
}

async function readDoc(slug: string): Promise<DocPage> {
  const raw = await fs.readFile(path.join(DOCS_ROOT, `${slug}.md`), 'utf8');
  const { data, body } = parseFrontmatter(raw);
  return {
    slug,
    title: data.title ?? slug,
    order: data.order ? Number(data.order) : 999,
    body,
  };
}

export async function listDocSlugs(): Promise<string[]> {
  const entries = await fs.readdir(DOCS_ROOT);
  return entries.filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
}

/** Ordered nav metadata for the sidebar (no bodies). */
export async function loadDocNav(): Promise<DocMeta[]> {
  const slugs = await listDocSlugs();
  const pages = await Promise.all(slugs.map(readDoc));
  return pages
    .map(({ slug, title, order }) => ({ slug, title, order }))
    .sort((a, b) => a.order - b.order);
}

export async function loadDoc(slug: string): Promise<DocPage | null> {
  try {
    return await readDoc(slug);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

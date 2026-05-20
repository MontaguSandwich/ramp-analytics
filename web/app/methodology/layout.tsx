import { loadDocNav } from '@/lib/docs';
import DocsSidebar from '@/components/docs-sidebar';

/**
 * Methodology docs shell — GitBook-style two-column layout: a sticky section sidebar
 * (built from the ordered docs/methodology/*.md frontmatter) plus the rendered page.
 * Modeled on DefiLlama's category-docs structure.
 */
export default async function MethodologyLayout({ children }: { children: React.ReactNode }) {
  const nav = await loadDocNav();
  return (
    <div className="container">
      <div className="docs-layout">
        <DocsSidebar nav={nav} />
        <article className="docs-content">{children}</article>
      </div>
    </div>
  );
}

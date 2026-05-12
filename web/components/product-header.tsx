import type { ProductYaml } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/format';

/**
 * Reusable header shown above the tab nav for any product with capability-gated subpages.
 * Renders the display name, category badge, and link pills.
 *
 * Per the locked decision in CLAUDE.md, the category label is derived from `CATEGORY_LABEL`
 * (e.g. `onchain` → "Onchain P2P", `cex_p2p` → "CEX P2P") — not hardcoded per product.
 *
 * Link pills are populated from `yaml.links.*` with sensible fallbacks: `website` falls
 * back to `yaml.website`, `docs` falls back to `yaml.docs_url`, `github` falls back to
 * `yaml.open_source.repo_url`. The intro paragraph (when present) is rendered separately
 * inside the detail page body, not here — this component is the header only.
 */
export default function ProductHeader({ yaml: y }: { yaml: ProductYaml }) {
  const links = y.links ?? {};
  const linkBar: Array<{ key: string; href: string; label: string }> = [];
  if (links.website ?? y.website)
    linkBar.push({ key: 'website', href: links.website ?? y.website, label: 'Website' });
  if (links.twitter) linkBar.push({ key: 'twitter', href: links.twitter, label: 'X' });
  if (links.docs ?? y.docs_url)
    linkBar.push({ key: 'docs', href: links.docs ?? y.docs_url!, label: 'Docs' });
  if (links.github ?? y.open_source?.repo_url)
    linkBar.push({
      key: 'github',
      href: links.github ?? y.open_source!.repo_url!,
      label: 'GitHub',
    });
  if (links.telegram) linkBar.push({ key: 'telegram', href: links.telegram, label: 'Telegram' });
  if (links.discord) linkBar.push({ key: 'discord', href: links.discord, label: 'Discord' });

  const displayName = y.display_name ?? y.name;
  const altName = y.display_name && y.display_name !== y.name ? y.name : null;

  return (
    <div className="protocol-header">
      <div className="protocol-header-main">
        <h1 className="protocol-title">{displayName}</h1>
        {altName ? <span className="protocol-altname">{altName}</span> : null}
        <div className="protocol-tags">
          <span className={`tag cat-${y.category}`}>{CATEGORY_LABEL[y.category] ?? y.category}</span>
        </div>
      </div>
      <div className="protocol-links">
        {linkBar.map((l) => (
          <a key={l.key} href={l.href} target="_blank" rel="noreferrer" className="link-pill">
            {l.label} ↗
          </a>
        ))}
      </div>
    </div>
  );
}

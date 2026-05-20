'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { DocMeta } from '@/lib/docs';

/** Canonical href for a doc slug. Overview is the section root (/methodology). */
function docHref(slug: string): string {
  return slug === 'overview' ? '/methodology' : `/methodology/${slug}`;
}

export default function DocsSidebar({ nav }: { nav: DocMeta[] }) {
  const pathname = usePathname();
  return (
    <nav className="docs-sidebar" aria-label="Methodology sections">
      <div className="docs-sidebar-title">Methodology</div>
      <ul className="docs-sidebar-list">
        {nav.map((d) => {
          const href = docHref(d.slug);
          const active = pathname === href;
          return (
            <li key={d.slug}>
              <Link
                href={href}
                className={`docs-sidebar-link${active ? ' is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {d.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

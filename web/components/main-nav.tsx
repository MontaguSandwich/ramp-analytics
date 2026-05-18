'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Top-level tab nav for the dashboard's primary sections. Active tab gets a different
 * style so users always know where they are. Sits beneath the header brand on every
 * page via web/app/layout.tsx.
 */
const TABS = [
  { href: '/', label: 'Overview' },
  { href: '/categories', label: 'Categories' },
  { href: '/aggregator', label: 'Aggregator' },
] as const;

export default function MainNav() {
  const pathname = usePathname();
  return (
    <nav className="main-nav" aria-label="Primary sections">
      {TABS.map((t) => {
        // Overview is only active at exact /; the others match by prefix so /venues?category=X
        // still highlights Venues.
        const active = t.href === '/' ? pathname === '/' : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`main-nav-tab${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

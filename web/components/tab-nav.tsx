'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

interface Tab {
  href: Route;
  label: string;
}

export default function TabNav({ id }: { id: string }) {
  const pathname = usePathname();
  const tabs: Tab[] = [
    { href: `/products/${id}` as Route, label: 'Overview' },
    { href: `/products/${id}/orderbook` as Route, label: 'Orderbook' },
    { href: `/products/${id}/quote` as Route, label: 'Get a Quote' },
  ];

  return (
    <nav className="tab-nav" role="tablist" aria-label="Product views">
      {tabs.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`tab-nav-item${active ? ' tab-nav-active' : ''}`}
            role="tab"
            aria-selected={active}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

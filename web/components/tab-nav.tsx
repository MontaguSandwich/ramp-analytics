'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';

interface Tab {
  href: Route;
  label: string;
  enabled: boolean;
}

interface TabNavProps {
  id: string;
  /**
   * Snapshot capabilities — drives which tabs are visible. If undefined, falls back to
   * the historical zkp2p-only behavior so legacy snapshot JSON without `capabilities`
   * still renders correctly.
   */
  capabilities?: { orderbook: boolean; quote: boolean };
}

export default function TabNav({ id, capabilities }: TabNavProps) {
  const pathname = usePathname();
  // Backward compat: zkp2p shows both tabs even when capabilities is missing
  // (e.g. reading an older snapshot JSON). Remove the `?? id === 'zkp2p'` fallback
  // once all snapshots on disk include capabilities.
  const orderbookEnabled = capabilities?.orderbook ?? id === 'zkp2p';
  const quoteEnabled = capabilities?.quote ?? id === 'zkp2p';

  const tabs: Tab[] = [
    { href: `/products/${id}` as Route, label: 'Overview', enabled: true },
    { href: `/products/${id}/orderbook` as Route, label: 'Orderbook', enabled: orderbookEnabled },
    { href: `/products/${id}/quote` as Route, label: 'Get a Quote', enabled: quoteEnabled },
  ];

  return (
    <nav className="tab-nav" role="tablist" aria-label="Product views">
      {tabs
        .filter((t) => t.enabled)
        .map((t) => {
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

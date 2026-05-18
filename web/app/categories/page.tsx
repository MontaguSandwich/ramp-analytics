import Link from 'next/link';
import { loadAllProducts } from '@/lib/data';
import type { ProductYaml } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Categories tab — top-level taxonomy of the venue types we track. Each card uses an
 * editorial title (often the canonical example product, e.g. "ZKP2P" for the onchain
 * category) plus a short description and a KYC note. Click → pre-filtered Overview.
 */
interface CategoryCard {
  slug: ProductYaml['category'];
  title: string;
  blurb: string;
  kycNote: string;
}

const CATEGORIES: CategoryCard[] = [
  {
    slug: 'onchain',
    title: 'ZKP2P',
    blurb:
      'Permissionless, P2P marketplace facilitating USDC ↔ Fiat swaps that settle on-chain. Makers lock stablecoins and quote preferred rates and payment methods; takers make payments off-chain on required payment methods and submit proofs to unlock stablecoins.',
    kycNote:
      'This category has no KYC requirements besides that of the payment method used for off-chain payment.',
  },
  {
    slug: 'ramp',
    title: 'Ramps',
    blurb:
      'On/off-ramp services that act as the counterparty for users converting into/out of crypto.',
    kycNote: 'This category has KYC requirements.',
  },
  {
    slug: 'cex_p2p',
    title: 'Binance P2P',
    blurb:
      "CEX-hosted P2P marketplace facilitating crypto ↔ Fiat swaps. The venue acts as the escrow and arbitrates disputes; trades settle on the venue's custodial wallets.",
    kycNote: 'This category has KYC requirements.',
  },
  {
    slug: 'rtpn',
    title: 'Crypto-friendly RTPNs',
    blurb:
      'Real-time payment networks / neo banks that support crypto assets and allow users to buy/sell crypto assets in-app.',
    kycNote: 'This category has KYC requirements.',
  },
];

export default async function CategoriesPage() {
  const products = await loadAllProducts();
  const byCategory = new Map<string, typeof products>();
  for (const p of products) {
    const arr = byCategory.get(p.yaml.category) ?? [];
    arr.push(p);
    byCategory.set(p.yaml.category, arr);
  }

  return (
    <div className="container">
      <div className="page-intro">
        <h1>Categories</h1>
        <p className="muted">
          Four kinds of on/off-ramp serve different user needs. Pick a category to see the
          venues in it side-by-side.
        </p>
      </div>
      <div className="category-grid">
        {CATEGORIES.map((c) => {
          const venues = byCategory.get(c.slug) ?? [];
          const hasVenues = venues.length > 0;
          const venueNames =
            venues.map((v) => v.yaml.display_name ?? v.yaml.name).join(' · ') ||
            'No venues tracked yet';

          // Card is a Link only when venues exist — clicking through to an empty filter
          // would be a dead end. RTPN today has 0 venues; render as a static card.
          const inner = (
            <>
              <div className="category-card-head">
                <h3 className={`category-card-title cat-${c.slug}`}>{c.title}</h3>
                <span className="category-card-count">
                  {venues.length} venue{venues.length === 1 ? '' : 's'}
                </span>
              </div>
              <p className="category-card-blurb">{c.blurb}</p>
              <p className="category-card-kyc">{c.kycNote}</p>
              <div className="category-card-venues">{venueNames}</div>
              {hasVenues ? <div className="category-card-cta">View venues →</div> : null}
            </>
          );

          return hasVenues ? (
            <Link
              key={c.slug}
              href={`/?category=${c.slug}`}
              className="category-card"
              aria-label={`${c.title} — view venues`}
            >
              {inner}
            </Link>
          ) : (
            <div key={c.slug} className="category-card category-card-disabled">
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { notFound } from 'next/navigation';
import { loadProduct } from '@/lib/data';
import QuoteView from '@/components/quote-view';

export const dynamic = 'force-dynamic';

const SUPPORTED = new Set(['zkp2p']);

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SUPPORTED.has(id)) notFound();

  // Load coverage so the form gets the current list of supported fiats + flags
  // and platforms without an extra client roundtrip on first paint.
  const product = await loadProduct(id);
  const coverage = product.snapshot?.coverage?.value;
  const fiats = coverage?.fiats ?? ['USD', 'EUR', 'GBP'];
  const platforms = coverage?.platforms ?? [];
  const fiatFlags = coverage?.fiat_flags ?? {};

  return <QuoteView fiats={fiats} platforms={platforms} fiatFlags={fiatFlags} />;
}

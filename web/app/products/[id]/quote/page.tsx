import { notFound } from 'next/navigation';
import { loadProduct } from '@/lib/data';
import QuoteView from '@/components/quote-view';
import BinanceP2pQuoteView from '@/components/binance-p2p-quote-view';

export const dynamic = 'force-dynamic';

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (id === 'zkp2p') {
    // Load coverage so the form gets the current list of supported fiats + flags
    // and platforms without an extra client roundtrip on first paint.
    const product = await loadProduct(id);
    const coverage = product.snapshot?.coverage?.value;
    const fiats = coverage?.fiats ?? ['USD', 'EUR', 'GBP'];
    const platforms = coverage?.platforms ?? [];
    const fiatFlags = coverage?.fiat_flags ?? {};
    return <QuoteView fiats={fiats} platforms={platforms} fiatFlags={fiatFlags} />;
  }

  if (id === 'binance_p2p') {
    // Mirrors the orderbook page's prop wiring: load coverage server-side so the
    // form can render the fiat list + per-fiat method scoping without a client fetch.
    const product = await loadProduct(id);
    const cov = product.snapshot?.coverage?.value;
    return (
      <BinanceP2pQuoteView
        fiats={cov?.fiats ?? []}
        paymentMethods={cov?.platforms ?? []}
        methodsByFiat={cov?.payment_methods_by_fiat ?? {}}
      />
    );
  }

  notFound();
}

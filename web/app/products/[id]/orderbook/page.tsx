import { notFound } from 'next/navigation';
import { loadProduct } from '@/lib/data';
import OrderbookView from '@/components/orderbook-view';
import BinanceP2pOrderbookView from '@/components/binance-p2p-orderbook-view';

export const dynamic = 'force-dynamic';

export default async function OrderbookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (id === 'zkp2p') {
    return <OrderbookView />;
  }

  if (id === 'binance_p2p') {
    // The view needs the coverage data (fiat list + payment methods, plus the per-fiat
    // method map for the fiat-aware chip filter) for its filter controls. We load it
    // server-side here so the client component gets it as props — avoids a second
    // round-trip to fetch the snapshot from the browser.
    const product = await loadProduct(id);
    const cov = product.snapshot?.coverage?.value;
    return (
      <BinanceP2pOrderbookView
        fiats={cov?.fiats ?? []}
        paymentMethods={cov?.platforms ?? []}
        methodsByFiat={cov?.payment_methods_by_fiat ?? {}}
      />
    );
  }

  notFound();
}

import { notFound } from 'next/navigation';
import { listProductIds, loadHistory, loadProduct } from '@/lib/data';
import Zkp2pDetail from '@/components/zkp2p-detail';
import GenericDetail from '@/components/generic-detail';

export const dynamic = 'force-dynamic';

export async function generateStaticParams() {
  const ids = await listProductIds();
  return ids.map((id) => ({ id }));
}

export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ids = await listProductIds();
  if (!ids.includes(id)) notFound();

  const product = await loadProduct(id);

  // zkp2p uses the rich DefiLlama-style layout with charts + markets + composition.
  // Layout (app/products/[id]/layout.tsx) provides the container + header + tab nav.
  if (id === 'zkp2p') {
    const history = await loadHistory(id);
    return <Zkp2pDetail product={product} history={history} />;
  }

  // Every other product (binance_p2p, ramp_network, kraken_otc) renders through the
  // generic detail page. The layout always provides the container + back-link +
  // ProductHeader hero (and tab nav when capabilities are set); GenericDetail just
  // renders the body content.
  return <GenericDetail product={product} />;
}

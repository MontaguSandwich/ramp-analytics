import { notFound } from 'next/navigation';
import OrderbookView from '@/components/orderbook-view';

export const dynamic = 'force-dynamic';

const SUPPORTED = new Set(['zkp2p']);

export default async function OrderbookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!SUPPORTED.has(id)) notFound();
  return <OrderbookView />;
}

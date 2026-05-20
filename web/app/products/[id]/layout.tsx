import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listProductIds, loadProduct } from '@/lib/data';
import ProductHeader from '@/components/product-header';
import TabNav from '@/components/tab-nav';

export const dynamic = 'force-dynamic';

export default async function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ids = await listProductIds();
  if (!ids.includes(id)) notFound();

  const product = await loadProduct(id);
  const caps = product.snapshot?.capabilities;
  // Every product gets the ProductHeader hero. Tab nav is still capability-gated:
  // it only renders when at least one subpage exists (orderbook / quote). zkp2p is
  // grandfathered in until older snapshots without `capabilities` are refreshed.
  const hasTabs = id === 'zkp2p' || caps?.orderbook === true || caps?.quote === true;

  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← All venues
      </Link>
      <ProductHeader yaml={product.yaml} />
      {hasTabs ? <TabNav id={id} capabilities={caps} /> : null}
      {children}
    </div>
  );
}

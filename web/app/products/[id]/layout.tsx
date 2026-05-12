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
  // A product gets the tab-nav wrapper when it has at least one interactive subpage.
  // zkp2p is grandfathered in until older snapshots without `capabilities` are refreshed.
  const hasTabs = id === 'zkp2p' || caps?.orderbook === true || caps?.quote === true;

  if (!hasTabs) {
    // Pass-through: GenericDetail provides its own container + back-link.
    return <>{children}</>;
  }

  // Tab-nav wrapper: container + back-link + ProductHeader + tabs.
  // ProductHeader (formerly Zkp2pHeader) is now product-agnostic — it reads the YAML's
  // display_name, category, and links to render the same shape for any product with
  // capability-gated subpages. GenericDetail suppresses its own inline hero in this case
  // (see the `wrapped` prop in generic-detail.tsx).
  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← All products
      </Link>
      <ProductHeader yaml={product.yaml} />
      <TabNav id={id} capabilities={caps} />
      {children}
    </div>
  );
}

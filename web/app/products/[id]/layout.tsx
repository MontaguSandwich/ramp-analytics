import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listProductIds, loadProduct } from '@/lib/data';
import Zkp2pHeader from '@/components/zkp2p-header';
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

  // Generic products: pass-through. The page handles its own header.
  if (id !== 'zkp2p') {
    return <>{children}</>;
  }

  // zkp2p: shared header + tab nav across Overview / Orderbook / Get a Quote.
  const product = await loadProduct(id);
  return (
    <div className="container">
      <Link href="/" className="back-link">
        ← All products
      </Link>
      <Zkp2pHeader yaml={product.yaml} />
      <TabNav id={id} />
      {children}
    </div>
  );
}

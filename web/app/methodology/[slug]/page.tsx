import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { listDocSlugs, loadDoc } from '@/lib/docs';
import Markdown from '@/components/markdown';

// Statically generate every doc page except overview (which is the section root at
// /methodology). Hitting /methodology/overview redirects to the canonical URL.
export async function generateStaticParams() {
  const slugs = await listDocSlugs();
  return slugs.filter((slug) => slug !== 'overview').map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await loadDoc(slug);
  return { title: doc ? `${doc.title} — Methodology` : 'Methodology' };
}

export default async function MethodologyDoc({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug === 'overview') redirect('/methodology');
  const doc = await loadDoc(slug);
  if (!doc) notFound();
  return (
    <>
      <h1 className="docs-title">{doc.title}</h1>
      <Markdown>{doc.body}</Markdown>
    </>
  );
}

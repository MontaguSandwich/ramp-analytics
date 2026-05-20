import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadDoc } from '@/lib/docs';
import Markdown from '@/components/markdown';

// The Overview doc is the section root: /methodology renders docs/methodology/overview.md.
export const metadata: Metadata = { title: 'Methodology — Payments/ OOI' };

export default async function MethodologyOverview() {
  const doc = await loadDoc('overview');
  if (!doc) notFound();
  return (
    <>
      <h1 className="docs-title">{doc.title}</h1>
      <Markdown>{doc.body}</Markdown>
    </>
  );
}

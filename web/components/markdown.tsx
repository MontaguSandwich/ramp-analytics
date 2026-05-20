import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

// Renders trusted, in-repo markdown (docs/methodology/*.md). remark-gfm adds table
// support. No raw-HTML plugin on purpose — the source is ours and we don't want an
// HTML-injection surface in the doc pipeline.
const components: Components = {
  a({ href, children }) {
    const url = href ?? '#';
    // Internal doc links navigate client-side; everything else opens in a new tab.
    if (url.startsWith('/')) {
      return <Link href={url}>{children}</Link>;
    }
    return (
      <a href={url} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
};

export default function Markdown({ children }: { children: string }) {
  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

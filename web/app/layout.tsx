import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'hip3 — on/off-ramp dashboard',
  description: 'Neutral, transparent comparison of crypto on/off-ramp products',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning silences the React warning when browser extensions
    // (e.g. the Peer extension, MetaMask, others) inject attributes onto <html> or
    // <body> before hydration. Scoped to one level — extension noise is the only
    // thing it suppresses; mismatches inside the tree still surface as errors.
    <html lang="en" suppressHydrationWarning>
      <body>
        <header className="header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              hip3<small>on/off-ramp dashboard · MVP</small>
            </Link>
            <nav className="nav">
              <span>Methodology</span>
              <span>Open data</span>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

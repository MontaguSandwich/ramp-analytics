import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import MainNav from '@/components/main-nav';

export const metadata: Metadata = {
  title: 'Payments/ OOI — on/off-ramp dashboard',
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
              Payments/ OOI<small>on/off-ramp dashboard · MVP</small>
            </Link>
            <nav className="nav">
              <span>Methodology (in the works)</span>
            </nav>
          </div>
          <div className="container">
            <MainNav />
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import './globals.css';
import MainNav from '@/components/main-nav';

// Inter is the dashboard's single typeface (self-hosted by next/font at build time).
// Loaded as a variable font so weights 400/500/600/700 all come from one file.
// The CSS variable is consumed by --font-sans in globals.css.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Payments/ OOI — on/off-ramp dashboard',
  description: 'Neutral, transparent comparison of crypto on/off-ramp products',
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning silences the React warning when browser extensions
    // (e.g. the Peer extension, MetaMask, others) inject attributes onto <html> or
    // <body> before hydration. Scoped to one level — extension noise is the only
    // thing it suppresses; mismatches inside the tree still surface as errors.
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <header className="header">
          <div className="header-bar">
            <div className="container header-inner">
              <Link href="/" className="brand">
                Payments/ OOI<small>on/off-ramp dashboard · MVP</small>
              </Link>
              <nav className="nav">
                <Link href="/methodology">Methodology</Link>
              </nav>
            </div>
          </div>
          <div className="header-tabs">
            <div className="container">
              <MainNav />
            </div>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

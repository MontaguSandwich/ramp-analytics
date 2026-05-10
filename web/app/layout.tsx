import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'hip3 — on/off-ramp dashboard',
  description: 'Neutral, transparent comparison of crypto on/off-ramp products',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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

import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Ecommerce Platform', template: '%s | Ecommerce Platform' },
  description: 'Multi-store e-commerce platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f5f6fa' }, { media: '(prefers-color-scheme: dark)', color: '#0a0e1a' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme class is set before React loads, to avoid a flash of the wrong theme
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

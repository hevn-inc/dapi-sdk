import type { Metadata, Viewport } from 'next';
import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

const display = Fraunces({ subsets: ['latin'], variable: '--font-display', axes: ['opsz'], display: 'swap' });
const text = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-text', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Mini HEVN',
  description: 'A small business bank built on the HEVN whitelabel API.',
};

export const viewport: Viewport = {
  themeColor: '#16463a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

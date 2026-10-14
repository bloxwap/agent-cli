import type { Metadata } from 'next';
import { BloxwapSans as sans } from '@bloxwap/font/sans';
import { BloxwapMono as mono } from '@bloxwap/font/mono';
import type { ReactNode } from 'react';
import { Provider } from '@/components/provider';
import { basePath, siteUrl } from '@/lib/site';
import { homeSocial, socialImagePath, socialMetadata } from '@/lib/social';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL(`${siteUrl}${basePath}/`),
  title: { default: '@bloxwap/agent-cli — Hyperliquid trading for agents', template: '%s · @bloxwap/agent-cli' },
  description: 'Hyperliquid trading with JSON commands, Privy custody, Relay funding, and a persistent signing runner.',
  icons: { icon: `${basePath}/icon.svg` },
  ...socialMetadata({ ...homeSocial, path: '/', imagePath: socialImagePath() }),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} dark`}>
    <body className="flex min-h-screen flex-col antialiased">
      <Provider>{children}</Provider>
    </body>
  </html>;
}

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Anbieter } from './anbieter';
import './globals.css';

export const metadata: Metadata = {
  title: 'MeinBaulotse',
  description:
    'Behalten Sie den Überblick über Ihren Hausbau: was gerade läuft, was als Nächstes kommt und was von Ihnen gebraucht wird.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="de" className="h-full">
      <body className="flex min-h-full flex-col antialiased">
        <a
          href="#inhalt"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
        >
          Zum Inhalt springen
        </a>
        <Anbieter>{children}</Anbieter>
      </body>
    </html>
  );
}

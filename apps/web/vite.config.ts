import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `autoUpdate`, nicht `prompt`.
      //
      // `prompt` war eine Absichtserklärung ohne Umsetzung: Der neue Service
      // Worker installiert sich und wartet, bis ihn jemand freischaltet — und
      // dieses „jemand" gab es nie, denn kein Modul importiert
      // `virtual:pwa-register`. Folge im Betrieb: Drei aufeinanderfolgende
      // Auslieferungen kamen beim Nutzer nicht an, er sah tagelang dieselbe
      // alte Fassung, während die CI grün meldete.
      //
      // `autoUpdate` erzeugt einen Service Worker mit `skipWaiting` und
      // `clientsClaim`; die neue Fassung übernimmt beim nächsten Laden. Der
      // Preis ist ein möglicher Neuaufbau der Seite mitten in einer Eingabe.
      // Das ist der kleinere Schaden — eine Auslieferung, die niemanden
      // erreicht, ist gar keine.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Ohne diese Ausnahme beantwortet der Service Worker **jede**
        // Navigation aus dem Zwischenspeicher — auch die Eingabe von
        // `/api/health/db` in der Adresszeile. Statt der Auskunft bekommt man
        // die Anwendung, und die Gegenprobe, die im Betrieb helfen soll, ist
        // ausgerechnet dort nicht erreichbar.
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'MeinBaulotse',
        short_name: 'Baulotse',
        description: 'Wir sagen dir, was als Nächstes kommt.',
        lang: 'de',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0a0a',
        theme_color: '#ffffff',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Web und API laufen auf Vercel unter derselben Herkunft. Lokal bildet der
    // Proxy das nach.
    //
    // Bewusst **ohne** rewrite: Auf Vercel kommt der Pfad mit `/api` bei der
    // Funktion an, und die Hono-App haengt entsprechend unter `/api`. Wuerde
    // der Proxy das Praefix hier abschneiden, liefe lokal ein anderer Pfad als
    // im Betrieb — und der Unterschied faellt erst im Betrieb auf.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env['API_PORT'] ?? 8787}`,
        changeOrigin: true,
      },
    },
  },
});

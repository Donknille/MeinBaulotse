/** Lokaler Entwicklungsserver. Auf Vercel läuft dieselbe App unter /api. */

import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env['API_PORT'] ?? 8787);

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`MeinBaulotse API auf http://localhost:${info.port}`);
});

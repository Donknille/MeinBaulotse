/**
 * Prüfung des Supabase-Zugangstokens.
 *
 * Der Server vertraut ausschließlich der Signatur, nie dem Inhalt eines
 * ungeprüften Tokens. Was danach erlaubt ist, entscheidet die Datenbank — hier
 * wird nur festgestellt, *wer* fragt.
 */

import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { jwtVerify } from 'jose';
import type { JwtClaims } from '@meinbaulotse/db';

export interface AuthedVariables {
  claims: JwtClaims;
}

let secret: Uint8Array | undefined;

function jwtSecret(): Uint8Array {
  if (secret !== undefined) return secret;
  const raw = process.env['SUPABASE_JWT_SECRET'];
  if (raw === undefined || raw === '') {
    throw new Error('SUPABASE_JWT_SECRET ist nicht gesetzt.');
  }
  secret = new TextEncoder().encode(raw);
  return secret;
}

export async function verifyAccessToken(token: string): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, jwtSecret());
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new Error('Das Token nennt keinen Nutzer.');
  }
  return payload as unknown as JwtClaims;
}

export const requireAuth = createMiddleware<{ Variables: AuthedVariables }>(async (c, next) => {
  const header = c.req.header('authorization');
  if (header === undefined || !header.toLowerCase().startsWith('bearer ')) {
    throw new HTTPException(401, {
      message: 'Bitte melde dich an.',
    });
  }

  try {
    c.set('claims', await verifyAccessToken(header.slice(7).trim()));
  } catch {
    throw new HTTPException(401, {
      message: 'Deine Anmeldung ist abgelaufen. Melde dich bitte neu an.',
    });
  }

  await next();
});

/**
 * Testzugang ohne Mailversand.
 *
 * Die Anmeldung im Betrieb läuft über Supabase Auth und braucht dafür einen
 * Mailversand. Solange der nicht eingerichtet ist, kommt niemand in die
 * Anwendung außer den Mitgliedern des Supabase-Kontos — auch nicht, um sie
 * vorzuführen oder eine zweite Rolle auszuprobieren. Diese Datei öffnet dafür
 * eine zweite, ausdrücklich benannte Tür: zwei feste Demo-Identitäten und ein
 * Token aus demselben Geheimnis, mit dem `auth.ts` ohnehin prüft.
 *
 * Drei Riegel halten die Tür im Betrieb zu:
 *
 * 1. Ohne `DEMO_LOGIN_KEY` wird die Route gar nicht erst montiert. In der
 *    Produktionsumgebung setzt du die Variable schlicht nicht.
 * 2. Der Schlüssel muss mit jeder Anfrage kommen, ist mindestens 16 Zeichen
 *    lang und wird zeitkonstant verglichen.
 * 3. Es gibt genau zwei Identitäten, beide hier fest verdrahtet. Ein Token auf
 *    einen echten Nutzer lässt sich hierüber nicht ausstellen.
 *
 * Das Token trägt keine Rechte in sich. Es sagt nur, *wer* fragt; was diese
 * Kennung darf, entscheidet weiterhin allein die RLS in der Datenbank.
 */

import { timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { SignJWT } from 'jose';
import { jwtSecret } from './auth.js';

export interface DemoIdentity {
  /** Feste Kennung, damit der Seed und das Token denselben Nutzer meinen. */
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly company: string | null;
  /** Rolle im Demo-Projekt. Bestimmt über die Rechtematrix, was sichtbar ist. */
  readonly projectRole: 'owner' | 'contractor';
  readonly label: string;
  readonly explanation: string;
}

/**
 * Die beiden Demo-Identitäten.
 *
 * Die Kennungen sind bewusst konstant und nicht zufällig: Der Seed legt genau
 * diese Nutzer an, die Route stellt Token auf genau diese Kennungen aus. Damit
 * braucht die Anmeldung keinen Datenbankzugriff — und keine privilegierte
 * Rolle, die es im Anwendungscode nicht geben darf.
 */
export const DEMO_IDENTITIES = {
  bauherr: {
    userId: '11111111-1111-4111-8111-111111111111',
    email: 'bauherr@demo.meinbaulotse.de',
    displayName: 'Familie Sonnenweg',
    company: null,
    projectRole: 'owner',
    label: 'Bauherr',
    explanation: 'Sieht alles, entscheidet alles. Ihm gehört das Projekt.',
  },
  gu: {
    userId: '22222222-2222-4222-8222-222222222222',
    email: 'gu@demo.meinbaulotse.de',
    displayName: 'Jörg Baumeister',
    company: 'Baumeister Bau GmbH',
    projectRole: 'contractor',
    label: 'Generalunternehmer',
    explanation: 'Plant und meldet Termine, darf aber weder Geld freigeben noch einladen.',
  },
} as const satisfies Record<string, DemoIdentity>;

export type DemoRole = keyof typeof DEMO_IDENTITIES;

export const DEMO_ROLES = Object.keys(DEMO_IDENTITIES) as DemoRole[];

export function isDemoRole(value: unknown): value is DemoRole {
  return typeof value === 'string' && Object.hasOwn(DEMO_IDENTITIES, value);
}

/** Ein Arbeitstag reicht für eine Vorführung und ist kurz genug, wenn ein Token liegen bleibt. */
const TOKEN_LIFETIME = '12h';

/**
 * Der eingestellte Schlüssel, oder `null`, wenn der Testzugang aus ist.
 *
 * Ein zu kurzer Schlüssel gilt als nicht gesetzt. Lieber gar keine Tür als
 * eine, die sich raten lässt.
 */
export function demoLoginKey(): string | null {
  const raw = process.env['DEMO_LOGIN_KEY'];
  if (raw === undefined || raw.trim() === '') return null;
  if (raw.length < 16) {
    console.warn('DEMO_LOGIN_KEY ist kürzer als 16 Zeichen. Der Testzugang bleibt deshalb aus.');
    return null;
  }
  return raw;
}

function keyMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  // Die Längenprüfung vorweg ist unvermeidlich; timingSafeEqual verlangt
  // gleiche Länge. Sie verrät nur die Länge des Schlüssels, nicht seinen Inhalt.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function mintDemoToken(identity: DemoIdentity): Promise<string> {
  return new SignJWT({
    role: 'authenticated',
    email: identity.email,
    name: identity.displayName,
    demo: true,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(identity.userId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_LIFETIME)
    .sign(jwtSecret());
}

interface SessionRequest {
  role?: unknown;
  key?: unknown;
}

/**
 * Die Route. Wird in `app.ts` nur montiert, wenn ein Schlüssel eingestellt ist.
 *
 * Sie antwortet auf **GET und POST**. Der Testzugang benutzt GET, und das ist
 * kein Schönheitsfehler, sondern eine Lehre aus dem Betrieb: Der
 * Anfragekörper einer POST-Anfrage erreichte die Function auf Vercel nicht,
 * `await c.req.json()` wartete ewig, und die Plattform brach mit 504 ab. Ohne
 * Körper kann das nicht passieren.
 *
 * Der Schlüssel steht bei GET in der Adresse. Er steht ohnehin im Link, den
 * man verschickt, und das Token gilt zwölf Stunden.
 */
export function demoRoutes(expectedKey: string): Hono {
  const demo = new Hono();

  demo.get('/identities', (c) =>
    c.json({
      identities: DEMO_ROLES.map((role) => ({
        role,
        label: DEMO_IDENTITIES[role].label,
        displayName: DEMO_IDENTITIES[role].displayName,
        projectRole: DEMO_IDENTITIES[role].projectRole,
        explanation: DEMO_IDENTITIES[role].explanation,
      })),
    }),
  );

  /** Prüfung und Antwort, gemeinsam für beide Methoden. */
  async function issue(c: Context, role: unknown, key: unknown): Promise<Response> {
    if (!keyMatches(expectedKey, typeof key === 'string' ? key : '')) {
      throw new HTTPException(401, {
        message: 'Dieser Zugangsschlüssel stimmt nicht. Prüf bitte den Link.',
      });
    }

    if (!isDemoRole(role)) {
      throw new HTTPException(422, {
        message: `Wähle eine der hinterlegten Rollen: ${DEMO_ROLES.join(', ')}.`,
      });
    }

    const identity = DEMO_IDENTITIES[role];
    // Kein Zwischenspeicher darf ein Token festhalten.
    c.header('cache-control', 'no-store');
    return c.json({
      token: await mintDemoToken(identity),
      role,
      label: identity.label,
      displayName: identity.displayName,
      projectRole: identity.projectRole,
    });
  }

  demo.get('/session', (c) => issue(c, c.req.query('role'), c.req.query('key')));

  demo.post('/session', async (c) => {
    const body = (await c.req.json().catch(() => null)) as SessionRequest | null;
    return issue(c, body?.role, body?.key);
  });

  return demo;
}

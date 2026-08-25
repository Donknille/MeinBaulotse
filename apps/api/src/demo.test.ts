/**
 * Die drei Stellungen der Tür (`apps/api/src/demo.ts`).
 *
 * Diese Datei gibt es, weil der Testzugang die einzige Stelle der Anwendung
 * ist, an der eine Umgebungsvariable darüber entscheidet, **ob** geprüft wird.
 * Überall sonst prüft die Datenbank, und die fragt niemanden. Ein
 * Konfigurationsfehler wäre hier still: Eine offene Tür sieht von außen aus wie
 * eine, die den Schlüssel gerade akzeptiert hat.
 *
 * Ohne Datenbank — es geht um Signaturen und Riegel, nicht um Daten.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { jwtVerify } from 'jose';
import { createApp } from './app.js';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const KEY = 'ein-langer-eigener-schluessel';

function appMit(umgebung: Record<string, string | undefined>) {
  process.env['SUPABASE_JWT_SECRET'] = SECRET;
  process.env['WEATHER_API_URL'] = '';
  for (const [name, wert] of Object.entries(umgebung)) {
    if (wert === undefined) delete process.env[name];
    else process.env[name] = wert;
  }
  return createApp();
}

function anmelden(
  app: ReturnType<typeof createApp>,
  frage: string,
): Promise<Response> {
  return app.request(`http://localhost/api/demo/session?${frage}`);
}

const AUS = { DEMO_OPEN: undefined, DEMO_LOGIN_KEY: undefined };

beforeEach(() => {
  delete process.env['DEMO_OPEN'];
  delete process.env['DEMO_LOGIN_KEY'];
});

afterEach(() => {
  delete process.env['DEMO_OPEN'];
  delete process.env['DEMO_LOGIN_KEY'];
});

describe('Die Tür steht offen', () => {
  it('lässt ohne Schlüssel herein', async () => {
    const antwort = await anmelden(appMit({ ...AUS, DEMO_OPEN: '1' }), 'role=bauherr');
    expect(antwort.status).toBe(200);
    const sitzung = (await antwort.json()) as { token: string; projectRole: string };
    expect(sitzung.projectRole).toBe('owner');

    // Das Token ist ein echtes: Es trägt die feste Kennung des Demo-Bauherrn
    // und ist mit demselben Geheimnis unterschrieben, mit dem `auth.ts` prüft.
    const { payload } = await jwtVerify(sitzung.token, new TextEncoder().encode(SECRET));
    expect(payload.sub).toBe('11111111-1111-4111-8111-111111111111');
    expect(payload.demo).toBe(true);
  });

  it('sagt der Startseite, dass sie nicht nach einem Schlüssel fragen muss', async () => {
    const antwort = await appMit({ ...AUS, DEMO_OPEN: '1' }).request(
      'http://localhost/api/demo/identities',
    );
    expect(antwort.status).toBe(200);
    const body = (await antwort.json()) as { open: boolean; identities: unknown[] };
    expect(body.open).toBe(true);
    expect(body.identities).toHaveLength(2);
  });

  it('gilt auch, wenn zusätzlich ein Schlüssel eingestellt ist', async () => {
    // Wer beides setzt, hat zuletzt „offen" gesagt. Eine halb offene Tür gibt
    // es nicht — und ein Schlüssel, der nicht mehr greift, wäre schlimmer als
    // keiner: Man hielte ihn für einen Riegel.
    const app = appMit({ DEMO_OPEN: 'true', DEMO_LOGIN_KEY: KEY });
    expect((await anmelden(app, 'role=gu')).status).toBe(200);
  });

  it('bleibt bei den zwei hinterlegten Rollen', async () => {
    const app = appMit({ ...AUS, DEMO_OPEN: '1' });
    // Ein Token auf einen echten Nutzer lässt sich hierüber nicht ausstellen.
    expect((await anmelden(app, 'role=admin')).status).toBe(422);
    expect(
      (await anmelden(app, 'role=11111111-1111-4111-8111-111111111111')).status,
    ).toBe(422);
  });
});

describe('Die Tür ist verschlossen', () => {
  it('weist eine Anmeldung ohne Schlüssel ab', async () => {
    const antwort = await anmelden(appMit({ ...AUS, DEMO_LOGIN_KEY: KEY }), 'role=bauherr');
    expect(antwort.status).toBe(401);
  });

  it('weist den falschen Schlüssel ab', async () => {
    const app = appMit({ ...AUS, DEMO_LOGIN_KEY: KEY });
    expect((await anmelden(app, `role=bauherr&key=${KEY}x`)).status).toBe(401);
    expect((await anmelden(app, 'role=bauherr&key=ein-langer-eigener-schluessek')).status).toBe(401);
  });

  it('lässt mit dem richtigen Schlüssel herein', async () => {
    const app = appMit({ ...AUS, DEMO_LOGIN_KEY: KEY });
    expect((await anmelden(app, `role=bauherr&key=${KEY}`)).status).toBe(200);
  });

  it('sagt der Startseite, dass sie nach einem Schlüssel fragen muss', async () => {
    const antwort = await appMit({ ...AUS, DEMO_LOGIN_KEY: KEY }).request(
      'http://localhost/api/demo/identities',
    );
    expect(((await antwort.json()) as { open: boolean }).open).toBe(false);
  });
});

describe('Die Tür ist zu', () => {
  it('kennt die Route gar nicht, wenn nichts eingestellt ist', async () => {
    const app = appMit(AUS);
    expect((await anmelden(app, 'role=bauherr')).status).toBe(404);
    expect((await app.request('http://localhost/api/demo/identities')).status).toBe(404);
  });

  it('bleibt zu bei einem zu kurzen Schlüssel', async () => {
    // Lieber gar keine Tür als eine, die sich raten lässt.
    expect((await anmelden(appMit({ ...AUS, DEMO_LOGIN_KEY: 'kurz' }), 'role=bauherr')).status).toBe(
      404,
    );
  });

  it('bleibt zu, wenn DEMO_OPEN wie ein Nein aussieht', async () => {
    // `DEMO_OPEN=0` ist der Versuch, sie zu schließen. Eine Variable, die schon
    // durch ihr Dasein öffnet, wäre eine Falle.
    for (const nein of ['0', 'false', 'nein', '']) {
      expect((await anmelden(appMit({ ...AUS, DEMO_OPEN: nein }), 'role=bauherr')).status).toBe(404);
    }
  });
});

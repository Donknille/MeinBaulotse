# MeinBaulotse — Arbeitsregeln für dieses Repository

Web-Anwendung, die private Bauherren durch ihren Hausbau lotst. Die verbindlichen
Dokumente sind `meinbaulotse-spec.md` (Produkt und Umsetzung) und
`meinbaulotse-ci.md` (Gestaltung). Beide vor größeren Änderungen lesen.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `packages/schedule` | Berechnungskern: Werktage, Feiertage, Vorwärts-/Rückwärtsrechnung. **Null Laufzeitabhängigkeiten.** |
| `packages/db` | Drizzle-Schema, Migrationsläufer, RLS-Testmatrix |
| `packages/shared` | Zod-Verträge und Enums, geteilt zwischen API und Web |
| `apps/api` | Hono. Lokal Node-Server, auf Vercel Function unter `/api` |
| `api/index.js` | **Erzeugt.** Die Function auf Vercel, fertig gebündelt |
| `apps/web` | Vite + React, installierbare PWA |
| `supabase/migrations` | Einzige Quelle der Wahrheit für das Datenbankschema |
| `supabase/local` | Nur lokal: bildet das Supabase-Umfeld im nackten Postgres nach |

## Unverhandelbare Regeln

1. **Rechte gehören in die Datenbank.** Jede Tabelle hat RLS. Der Anwendungscode
   benutzt **niemals** `service_role` oder eine andere privilegierte Rolle.
   Datenzugriff läuft über `withUserTx` aus `packages/db`.
2. **Terminfelder sind `date`, nie `timestamptz`.** Im Berechnungskern gibt es
   keine `Date`-Objekte — gerechnet wird auf Epochentagen, ausgetauscht wird
   `YYYY-MM-DD`. Das schließt Zeitzonenfehler konstruktiv aus.
3. **Der Berechnungskern bleibt rein.** Keine Datenbank, kein Netzwerk, keine
   Uhrzeit, keine Abhängigkeiten. Alles, was `packages/schedule` braucht, kommt
   als Parameter herein.
4. **Nichts wird still überschrieben.** `schedule_change` ist append-only, per
   Rechteentzug *und* Trigger. Änderungen erzeugen Einträge, keine Ersetzungen.
5. **Redaktionsinhalt und Stammdaten liegen als Daten in der Datenbank**, nicht
   als Konstanten im Code: Bauphasen, Gewerke, Ablaufvorlagen, Rechtematrix,
   später die Lotsenkarten.
6. **Der Ton bleibt beruhigend.** Auch schlechte Nachrichten kommen mit einem
   nächsten Schritt. Wortwahl siehe `meinbaulotse-ci.md`, Abschnitt Tonalität.
7. **Die API hängt unter `/api`, lokal wie im Betrieb.** Der Hono-Adapter
   entfernt kein Präfix, deshalb hängt die App selbst unter `/api` und der
   Vite-Proxy schneidet nichts ab. **Fünf** Stellen halten das zusammen:
   `apps/api/src/app.ts` (`basePath`), `apps/web/vite.config.ts` (Proxy ohne
   `rewrite` **und** `navigateFallbackDenylist: [/^\/api\//]` im Service
   Worker), `apps/api/src/vercel.ts` und die Umschreibung in `vercel.json`
   (`/api/(.*)` → `/api`). Wer eine ändert, ändert alle fünf.

   Die fünfte ist die unauffälligste und hat am längsten gekostet: Ohne die
   Ausnahme beantwortet der Service Worker **jede** Navigation aus dem
   Zwischenspeicher, auch `/api/health` in der Adresszeile. Die Gegenprobe aus
   Regel 8 ist dann ausgerechnet dort blind, wo man sie braucht.

   Und `registerType` gehört auf `autoUpdate`. Mit `prompt` wartet der neue
   Service Worker, bis ihn jemand freischaltet — solange kein Modul
   `virtual:pwa-register` importiert, gibt es dieses „jemand" nicht, und
   Auslieferungen erreichen niemanden, während die CI grün meldet.

8. **Die Vercel-Function ist ein Bündel, kein Quelltext.** `pnpm build:function`
   macht aus `apps/api/src/vercel.ts` die eingecheckte Datei `api/index.js`,
   die außer Node-Bausteinen nichts mehr importiert. Nach jeder Änderung an
   der API neu erzeugen; die CI prüft es.

   Der Grund steht in vier gescheiterten Anläufen: Vercel bündelt diese Datei
   **nicht**, sondern übersetzt sie und legt Abhängigkeiten daneben. Alles,
   was zur Laufzeit aufgelöst werden muss, ist eine Wette auf das Verhalten
   der Plattform. Die vier Fallen, jede mit eigenem Symptom:

   | Falle | Symptom |
   |---|---|
   | Dateiname `[[...route]].ts` (Next.js) | keine Function, `/api/health` liefert die Anmeldemaske |
   | `export const GET = …` statt Default-Export | dieselbe Fehlanzeige |
   | `hono/vercel` als Adapter | FUNCTION_INVOCATION_FAILED, denn Vercel ruft `(req, res)` |
   | Import auf `../apps/api/src` oder `@meinbaulotse/api` | `Cannot find module` im Lambda |

   Die Gegenprobe nach jedem Deployment sind zwei Aufrufe, beide ohne
   Anmeldung: `/api/health` muss `{"ok":true,"path":"/api/health"}` liefern —
   dann läuft die Function. `/api/health/db` muss `{"ok":true,"phases":9,…}`
   liefern — dann kommt sie auch an die Datenbank. Ohne den zweiten sieht eine
   fehlende Verbindung aus wie eine leere Datenlage.

## Befehle

```bash
pnpm install
pnpm test           # Berechnungskern
pnpm db:up          # Postgres 17 im Container
pnpm db:reset       # Shim + Migrationen + Seed
pnpm db:test        # RLS-Matrix und Invarianten
pnpm dev            # API und Web parallel
pnpm build:function # Vercel-Function neu bündeln (nach API-Änderungen)
pnpm typecheck && pnpm lint
```

## Umgebung

Keine Zugangsdaten im Repository. `.env.example` kopieren nach `.env`.
Für die Einrichtung eines eigenen Supabase- und Vercel-Projekts siehe
`docs/SETUP.md`.

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
| `api/index.ts` | Einstiegspunkt der Function auf Vercel |
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
7. **Die API hängt unter `/api`, lokal wie im Betrieb.** Der Hono-Adapter auf
   Vercel entfernt kein Präfix, deshalb hängt die App selbst unter `/api` und
   der Vite-Proxy schneidet nichts ab. Vier Stellen halten das zusammen:
   `apps/api/src/app.ts` (`basePath`), `apps/web/vite.config.ts` (Proxy ohne
   `rewrite`), `api/index.ts` und die Umschreibung in `vercel.json`
   (`/api/(.*)` → `/api`). Wer eine ändert, ändert alle vier — sonst antwortet
   im Betrieb jede Route mit 404, und die Tests merken es nicht.

   Ohne Framework erkennt Vercel im Ordner `api/` nur eine Datei mit einem
   echten Pfad als Namen und einen **Default-Export**. `[[...route]].ts` und
   `export const GET = …` sind Next.js-Konventionen; hier entsteht damit gar
   keine Function, und `/api/health` liefert die Anmeldemaske statt JSON.

## Befehle

```bash
pnpm install
pnpm test           # Berechnungskern
pnpm db:up          # Postgres 17 im Container
pnpm db:reset       # Shim + Migrationen + Seed
pnpm db:test        # RLS-Matrix und Invarianten
pnpm dev            # API und Web parallel
pnpm typecheck && pnpm lint
```

## Umgebung

Keine Zugangsdaten im Repository. `.env.example` kopieren nach `.env`.
Für die Einrichtung eines eigenen Supabase- und Vercel-Projekts siehe
`docs/SETUP.md`.

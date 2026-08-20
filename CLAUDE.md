# MeinBaulotse — Arbeitsregeln für dieses Repository

Web-Anwendung, die private Bauherren durch ihren Hausbau lotst. Die verbindlichen
Dokumente sind `meinbaulotse-spec.md` (Produkt und Umsetzung) und
`meinbaulotse-ci.md` (Gestaltung). Beide vor größeren Änderungen lesen.

## Aufbau

| Pfad | Inhalt |
|---|---|
| `packages/schedule` | Berechnungskern: Werktage, Feiertage, Vorwärts-/Rückwärtsrechnung. **Null Laufzeitabhängigkeiten.** |
| `packages/db` | Drizzle-Schema, Migrationsläufer, RLS-Testmatrix |
| `packages/shared` | Zod-Verträge, Enums und Wortwahl, geteilt zwischen API und Web |
| `apps/api` | Hono. Lokal Node-Server, auf Vercel Function unter `/api` |
| `api/[[...route]].ts` | Einstiegspunkt der Function auf Vercel |
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
7. **Termine, die der Nutzer setzt, sind Beschränkungen — keine Ergebnisse.**
   Ein von Hand gesetzter Anfangstermin landet in `task.pinned_start` und geht
   als `earliestStart` in die Vorwärtsrechnung. `current_start` und
   `current_end` sind immer gerechnet und werden nie direkt geschrieben. Wer
   das vermischt, wirft bei der nächsten Neuberechnung entweder die Eingabe des
   Nutzers weg oder den Bauablauf.
8. **Abgeleitete Felder schreibt `mbl.apply_plan`, nicht die Anwendung.**
   Ein Einzelgewerk darf nur den eigenen Vorgang anfassen, aber seine Meldung
   muss den ganzen Ablauf verschieben. Deshalb der Schnitt: was der Nutzer
   *behauptet* (Anfangstermin, Dauer, Status, Ist-Stände, Bestätigung) geht
   durch das gewöhnliche UPDATE mit RLS; was daraus *folgt* (Termine, Puffer,
   kritischer Pfad, Entscheidungsfristen) schreibt die `security definer`-
   Funktion nach einmaliger Rechteprüfung. Gelesen wird die Ausgangslage
   entsprechend über `mbl.plan_input`. Beides sind **keine**
   Leseschnittstellen: Was ein Anrufer zu sehen bekommt, entscheidet weiterhin
   `task_read`.
9. **Die API hängt unter `/api`, lokal wie im Betrieb.** Der Hono-Adapter auf
   Vercel entfernt kein Präfix, deshalb hängt die App selbst unter `/api` und
   der Vite-Proxy schneidet nichts ab. Drei Stellen halten das zusammen:
   `apps/api/src/app.ts` (`basePath`), `apps/web/vite.config.ts` (Proxy ohne
   `rewrite`) und `api/[[...route]].ts`. Wer eine ändert, ändert alle drei —
   sonst antwortet im Betrieb jede Route mit 404, und die Tests merken es nicht.

## Befehle

```bash
pnpm install
pnpm test           # Berechnungskern
pnpm test:all       # alles: Kern, RLS, API von Ende zu Ende, Zeitachse
pnpm db:up          # Postgres 17 im Container
pnpm db:reset       # Shim + Migrationen + Seed
pnpm db:test        # RLS-Matrix und Invarianten
pnpm dev            # API und Web parallel
pnpm typecheck && pnpm lint
```

## Rollen in der Oberfläche

Zwei Dinge, die gern verwechselt werden, sind getrennt und müssen es bleiben:

- **Rolle ändern** (`/projekt/:id/beteiligte`) ändert die Daten. Sie wirkt für
  die betroffene Person und läuft über `project_member`.
- **Ansicht wechseln** (Kopfzeile) ist eine Vorschau für dich selbst. Sie kann
  ausschließlich *wegnehmen*: Gezeigt wird der Durchschnitt aus den eigenen
  Rechten und denen der gewählten Rolle. Sie erteilt nichts und ändert nichts.

Die Rechtematrix wird in der Oberfläche **nicht abgetippt**. Sie kommt über
`GET /api/v1/roles` aus `role_permission` — derselben Tabelle, die auch
`mbl.has_perm()` liest. Zwei Kopien derselben Regel laufen auseinander, und
dann zeigt die App einen Knopf, den die Datenbank ablehnt.

## Umgebung

Keine Zugangsdaten im Repository. `.env.example` kopieren nach `.env`.
Für die Einrichtung eines eigenen Supabase- und Vercel-Projekts siehe
`docs/SETUP.md`.

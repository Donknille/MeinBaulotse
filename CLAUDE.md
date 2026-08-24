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
| `content/lotsenkarten` | Redaktionsinhalt der Wissensschicht als Markdown. Erstbefüllung, siehe README dort |
| `apps/web/src/lib/queue.ts` | Offline-Warteschlange der Erfassung. IndexedDB, jeder Schritt wiederholbar |
| `apps/web/src/routes/Guest.tsx` | Abstimmung ohne Konto. Steht außerhalb der Anmeldeprüfung |
| `apps/api/src/assistant-guardrails.ts` | Die Leitplanken aus 3.7 als Code, nicht als Bitte an das Modell |
| `apps/api/src/contract-rules.ts` | Die fünf Prüfregeln aus 3.9. Rein, ohne Datenbank |
| `packages/schedule/src/interest.ts` | Bereitstellungszinsen. Gehört in den Kern: 30/360 auf Epochentagen, keine Uhr |
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
   Lotsenkarten.

   Für die Lotsenkarten kommt eine Verschärfung dazu: Eine **veröffentlichte**
   Karte ist unveränderlich, durchgesetzt vom Trigger
   `mbl.guard_guide_card_published` — auch gegenüber dem Eigentümer im
   SQL-Editor. Eine Korrektur ist eine neue Fassung, die alte wird über
   `superseded_by` verkettet. Der Grund ist nicht Ordnungsliebe: Sonst lässt
   sich hinterher nicht mehr sagen, welchen Rat der Bauherr damals bekommen
   hat, und genau diese Frage ist die einzige, die im Streitfall zählt.

   Ausgangspunkt sind die Dateien in `content/lotsenkarten`;
   `pnpm cards:generate` macht daraus `0006_guide_cards.sql`.

   Die Entscheidungsvorlagen aus Abschnitt 7.3 liegen dagegen als Datensatz in
   `packages/schedule/src/templates/entscheidungen.ts` — vierzehn Einträge mit
   vier kurzen Feldern sind als Tabelle besser zu überblicken als als vierzehn
   winzige Markdown-Dateien. `pnpm decisions:generate` macht daraus
   `0008_decision_templates.sql`.
6. **Fotos gehen nie durch den Anwendungsserver.** Der Browser lädt mit seiner
   eigenen Supabase-Sitzung direkt in den Objektspeicher; die API bekommt nur
   Pfad, Größe und Prüfsumme (`apps/web/src/lib/media-store.ts`). Der erste
   Ordner im Pfad **ist** die Kennung des Bauvorhabens — daraus leitet die
   Policy auf `storage.objects` ihre Rechte ab. Wer den Pfadaufbau ändert,
   ändert eine Rechteprüfung.

   Ein versiegelter Tagebucheintrag trägt die Prüfsummen seiner Fotos im Hash.
   Ein Foto danach zu tauschen bricht die Kette; deshalb weist ein Trigger es
   schon vorher ab.

7. **Ein Gast ist ein Mitglied mit anderem Türschlüssel.** Es gibt keinen
   zweiten Rechteweg: `withGuestTx` hinterlegt den Hash des Tokens,
   `mbl.current_member_id` löst daraus die Mitgliedschaft auf, und ab da gilt
   jede Policy unverändert. Zusätzlich verengen die Scopes aus Abschnitt 2.3
   die Rechte seiner Rolle — `mbl.has_perm` bildet den **Schnitt**, nie die
   Vereinigung.

   Der Token steht im **Fragment** des Links (`…/abstimmung#<token>`) und im
   Anfragekörper, niemals im Pfad: Fragmente sendet kein Browser an einen
   Server, und ein Token in der Adresse landet in jedem Zugriffsprotokoll.
   Gespeichert wird nur sein sha256.

8. **Der Assistent bekommt nur das eigene Projekt, und die Leitplanken stehen
   im Code.** Der Kontextaufbau ist serverseitig (`buildContext`) und vom
   Client nicht steuerbar — die Anfrage kennt nur Frage und Unterhaltung. Die
   Zusicherung stammt aus der RLS, nicht aus einem `where`, das man vergessen
   kann.

   Rechtshinweis und Sachverständigenhinweis hängt `withGuardrailNotes` an die
   fertige Antwort, ob das Modell sie selbst gab oder nicht. Ein Systemprompt
   ist die weiche Ebene; die harte ist eine Zeichenkette. Was das Modell gesehen
   hat, steht als `context_snapshot` bei der Antwort — ohne das lässt sich eine
   falsche Auskunft nie einordnen.

9. **Eine Zahlung ist gesperrt, solange ein wesentlicher Mangel offen ist.**
   Abschnitt 3.10, und die Sperre steht als Trigger in der Datenbank
   (`mbl.guard_payment_release`), nicht als Bestätigungsdialog: Eine Sperre,
   die man mit einem zweiten Klick übergeht, ist keine. Die Oberfläche fragt
   dieselbe Funktion (`mbl.payment_blockers`) vorher ab und sagt, **was**
   fehlt — sonst wäre die Sperre eine Falle statt einer Hilfe.

   „Behoben gemeldet" zählt dabei als offen. Sonst könnte das ausführende
   Unternehmen die Sperre selbst aufheben, indem es „erledigt" sagt.

   Der Ausweg heißt Teilfreigabe unter Vorbehalt und verlangt Betrag **und**
   Grund: Ein Einbehalt ohne Grund ist in einem halben Jahr nicht mehr
   erklärbar.

10. **Der Ton bleibt beruhigend.** Auch schlechte Nachrichten kommen mit einem
   nächsten Schritt. Wortwahl siehe `meinbaulotse-ci.md`, Abschnitt Tonalität.
11. **Die API hängt unter `/api`, lokal wie im Betrieb.** Der Hono-Adapter
   entfernt kein Präfix, deshalb hängt die App selbst unter `/api` und der
   Vite-Proxy schneidet nichts ab. **Fünf** Stellen halten das zusammen:
   `apps/api/src/app.ts` (`basePath`), `apps/web/vite.config.ts` (Proxy ohne
   `rewrite` **und** `navigateFallbackDenylist: [/^\/api\//]` im Service
   Worker), `apps/api/src/vercel.ts` und die Umschreibung in `vercel.json`
   (`/api/(.*)` → `/api`). Wer eine ändert, ändert alle fünf.

   Die fünfte ist die unauffälligste und hat am längsten gekostet: Ohne die
   Ausnahme beantwortet der Service Worker **jede** Navigation aus dem
   Zwischenspeicher, auch `/api/health` in der Adresszeile. Die Gegenprobe aus
   Regel 12 ist dann ausgerechnet dort blind, wo man sie braucht.

   Und `registerType` gehört auf `autoUpdate`. Mit `prompt` wartet der neue
   Service Worker, bis ihn jemand freischaltet — solange kein Modul
   `virtual:pwa-register` importiert, gibt es dieses „jemand" nicht, und
   Auslieferungen erreichen niemanden, während die CI grün meldet.

12. **Die Vercel-Function ist ein Bündel, kein Quelltext.** `pnpm build:function`
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
   dann läuft die Function. `/api/health/db` muss `{"ok":true,…,"schema":
   {"current":true}}` liefern — dann kommt sie an die Datenbank **und** das
   Schema passt zur ausgelieferten Fassung. Ohne den zweiten sieht eine
   fehlende Verbindung aus wie eine leere Datenlage.

13. **Eine Migration, die der Code braucht, gehört in `schema-check.ts`.**
   Sonst geht eine Auslieferung live, bevor die Migration eingespielt ist, und
   jede betroffene Ansicht endet in `column … does not exist` — während
   `/api/health/db` fröhlich `ok` meldet, denn die Verbindung stand ja. Genau
   so ist es bei 0004 passiert. Die Liste in `apps/api/src/schema-check.ts` ist
   kein Abbild des Schemas, sondern die Aussage „ohne das läuft nichts";
   dadurch nennt die Fehlermeldung den Dateinamen statt einer Spalte.

14. **Die Bauakte entsteht im Browser, nicht auf dem Server.** Abschnitt 6.1
   nennt für PDF „serverseitig, React-PDF oder Headless-Chromium". Das geht
   hier nicht, und der Grund ist keine Bequemlichkeit, sondern Regel 1: Der
   Fotoanhang aus Abschnitt 5.6 bräuchte einen Server, der die Bilder lesen
   kann — lesen darf sie nur, wer eine Sitzung hat. Ein serverseitiges PDF mit
   Fotoanhang wäre nur mit `service_role` zu haben.

   Also andersherum: `apps/api/src/dossier.ts` stellt die Akte als Daten
   zusammen — Chronologie, Prüfsummen, Reihenfolge —, und
   `apps/web/src/routes/Dossier.tsx` **ist** das PDF; „Drucken → Als PDF
   sichern" kann jedes Gerät, auf dem die Anwendung läuft.

   Die Abnahme hängt an der **Unterscheidbarkeit** der Bestätigungsgrade, und
   die funktioniert deshalb ohne Farbe: ein Zeichen (`CONFIRMATION_MARK` in
   `packages/shared`), ein Wort und die Rahmenstärke. Ein ausgedrucktes PDF ist
   oft schwarzweiß, und eine Unterscheidung, die den Bürodrucker nicht
   übersteht, ist im Streitfall keine.

## Befehle

```bash
pnpm install
pnpm test           # Berechnungskern
pnpm db:up          # Postgres 17 im Container
pnpm db:reset       # Shim + Migrationen + Seed
pnpm db:test        # RLS-Matrix und Invarianten
pnpm dev            # API und Web parallel
pnpm build:function # Vercel-Function neu bündeln (nach API-Änderungen)
pnpm cards:generate # Lotsenkarten aus content/lotsenkarten neu einlesen
pnpm decisions:generate # Entscheidungsvorlagen aus packages/schedule neu einlesen
pnpm typecheck && pnpm lint
```

## Umgebung

Keine Zugangsdaten im Repository. `.env.example` kopieren nach `.env`.
Für die Einrichtung eines eigenen Supabase- und Vercel-Projekts siehe
`docs/SETUP.md`.

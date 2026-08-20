# Testzugang

Zum Ausprobieren und Vorführen: zwei feste Anmeldungen auf dasselbe
Bauvorhaben, eine als **Bauherr**, eine als **Generalunternehmer**. Ohne
Mailversand, ohne Registrierung, mit einem Link.

Der Zugang ist ausdrücklich eine Behelfstür. Er existiert, weil die richtige
Anmeldung per Magic Link erst funktioniert, wenn in Supabase ein eigener
SMTP-Server hinterlegt ist — bis dahin stellt Supabase Mails **nur an
Mitglieder der eigenen Organisation** zu und weist jede andere Adresse ab.
Steht der Mailversand, kann dieser Zugang ersatzlos verschwinden.

---

## Lokal einrichten

```bash
cp .env.example .env                      # falls noch nicht geschehen
# in der .env einen Schlüssel setzen, mindestens 16 Zeichen:
#   DEMO_LOGIN_KEY=ein-langer-eigener-schluessel

pnpm install
pnpm -r --filter './packages/*' build
docker compose up -d db
pnpm db:reset                             # Schema, Migrationen, Stammdaten
pnpm demo:seed                            # zwei Nutzer, ein Projekt, beide Rollen
pnpm dev
```

`pnpm demo:seed` schreibt am Ende den fertigen Anmeldelink in die Konsole:

```
Anmelden unter:  http://localhost:5173/demo?key=…
```

Diesen Link öffnen, Rolle wählen, fertig. Der Schlüssel steht im Link; wer ihn
nicht hat, kommt nicht hinein.

## Wer ist wer

| Rolle im Link | Person | Rolle im Projekt | Darf laut Rechtematrix |
|---|---|---|---|
| Bauherr | Familie Sonnenweg | `owner` | alles: einladen, Geld freigeben, Vertrag pflegen |
| Generalunternehmer | Jörg Baumeister | `contractor` | Vorgänge und Termine — **nicht** einladen, **nicht** freigeben |

Das Demo-Projekt heißt *Musterhaus Sonnenweg*: Einfamilienhaus mit Keller in
Bayern, Baubeginn in vier Wochen, 38 Vorgänge, und ein Vertragstermin, den der
gerechnete Plan um gut zwei Wochen reißt — damit im Cockpit eine echte
Abweichung steht und nicht die beruhigende Null.

Angelegt hat das Projekt der **Bauherr**, nicht der GU. Das ist keine
Bequemlichkeit, sondern Abschnitt 2.1 der Spezifikation: Das Projekt gehört dem
Bauherrn, und nur `owner` und `co_owner` dürfen Mitglieder einladen. Der GU
kommt über eine Einladung hinein.

## Rolle wechseln

Oben rechts steht im Testzugang, aus wessen Sicht du gerade schaust
(„Generalunternehmer · Rolle wechseln"). Der Link führt zurück auf `/demo`.
*Abmelden* wirft beide Anmeldungen weg, die echte wie die Test-Anmeldung.

Das Testtoken gilt zwölf Stunden. Läuft es ab, landest du wieder auf der
Anmeldemaske.

## Was du sehen wirst

Der Plan trägt neben dem Projektnamen deine Rolle, und darunter steht, was du
in diesem Bauvorhaben tun kannst. Diese Liste ist nicht im Code notiert: Sie
kommt aus `role_permission`, also aus derselben Tabelle, die `mbl.has_perm()`
für die RLS befragt. Was die Karte verspricht, lässt die Datenbank auch zu.

Als **Bauherr** stehen dort dreizehn Zeilen und der Satz „Du hast in diesem
Bauvorhaben alle Rechte". Als **Generalunternehmer** sind es sechs, und die
Fehlanzeige nennt die Grenze beim Namen: Mängel erfassen, Entscheidungen
pflegen, Mitglieder einladen, Zahlungen freigeben — „Das entscheidet der
Bauherr."

## Was noch fehlt

- **Schreibende Ansichten.** Rechte werden angezeigt, aber noch nirgends
  ausgeübt: Die API kennt bisher nur Onboarding und Lesen. Ein GU sieht also,
  dass er Termine ändern dürfte, kann es aber noch nicht.
- **Der Einladungsvorgang.** Der Seed trägt den GU direkt ein. Die Policy dafür
  (`member.invite`) steht, die Route dazu fehlt noch.

## Nach `pnpm db:test`

Die RLS-Tests leeren die lokale Datenbank. Danach ist auch die Demolage weg —
einfach `pnpm demo:seed` erneut aufrufen.

Ein zweiter Aufruf bei bestehender Demolage ändert nichts: Ein Projekt lässt
sich nicht löschen, solange `schedule_change` daran hängt, denn diese Historie
ist append-only. Für einen frischen Plan `pnpm db:reset && pnpm demo:seed`.

## Online vorführen: Supabase und Vercel

Der Weg ohne einen einzigen Befehl auf deinem Rechner. Reihenfolge einhalten —
die Datenlage muss stehen, bevor sich jemand anmeldet.

### 1. Datenlage in Supabase anlegen

Voraussetzung: Die Dateien aus `supabase/migrations` sind in diesem Projekt
eingespielt (siehe `docs/SETUP.md`, Abschnitt 2).

Dann im Dashboard: **SQL Editor → New query**, den Inhalt von
[`docs/demo-seed.sql`](demo-seed.sql) einfügen, **Run**.

Das Skript legt die beiden Demo-Nutzer, das Bauvorhaben, beide Mitgliedschaften,
38 Vorgänge und 43 Abhängigkeiten an. Am Ende zeigt es eine Gegenprobe:

```
bauvorhaben          | beteiligte | vorgaenge | abhaengigkeiten | errechnetes_ende
Musterhaus Sonnenweg |          2 |        38 |              43 | …
```

Ein zweiter Lauf ändert nichts und bricht nicht ab. Gelöscht wird nie —
`schedule_change` ist append-only.

Das Skript schreibt bewusst nicht als Datenbankeigentümer: Es setzt den
JWT-Claim des Bauherrn und wechselt auf die Rolle `authenticated`. Damit greifen
dieselben Policies wie im Betrieb, und die Historie nennt einen Verursacher
statt einer Leerstelle. Wer einen anderen Baustart braucht, ruft `pnpm demo:sql`
auf und erzeugt das Skript neu.

### 2. Umgebungsvariablen in Vercel

Settings → Environment Variables. Vier Variablen braucht die Anwendung ohnehin,
die fünfte schaltet den Testzugang frei:

| Variable | Wert |
|---|---|
| `DATABASE_URL` | Transaction-Pooler des Projekts, Port 6543 |
| `SUPABASE_JWT_SECRET` | Settings → JWT Keys → Legacy JWT Secret |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Settings → API Keys |
| `DEMO_LOGIN_KEY` | dein Schlüssel, mindestens 16 Zeichen |

`SUPABASE_JWT_SECRET` ist hier nicht optional: Mit genau diesem Geheimnis
unterschreibt der Testzugang seine Token, und mit ihm prüft die API sie.
Stimmt es nicht, endet jede Anmeldung in „Deine Anmeldung ist abgelaufen".

**Nach dem Eintragen neu deployen.** Umgebungsvariablen wirken nicht
rückwirkend, und die beiden `VITE_`-Werte werden beim Bauen ins Bundle gebacken.

### 3. Wo der Zugang liegt

Sauberer ist *Preview*: Dann gibt es die Tür in der Produktionsumgebung gar
nicht. Achte aber darauf, dass **Deployment Protection** für Previews
abgeschaltet ist — sonst steht dein Gast vor der Vercel-Anmeldung statt vor der
Anwendung.

Willst du unter der Produktionsadresse vorführen, trägst du `DEMO_LOGIN_KEY` in
*Production* ein. Das ist vertretbar, solange der Schlüssel lang ist und du ihn
danach wieder entfernst — die drei Riegel unten gelten dort genauso. **Lösch die
Variable nach der Vorführung und deploye neu**; dann ist die Route wieder weg.

### 4. Anmelden

Ein Link mit Auswahl:

```
https://<deine-adresse>/demo?key=<DEMO_LOGIN_KEY>
```

Oder je ein Link pro Person — steht die Rolle im Link, meldet die Seite direkt
an, ohne Auswahl:

```
https://<deine-adresse>/demo?key=<DEMO_LOGIN_KEY>&role=bauherr
https://<deine-adresse>/demo?key=<DEMO_LOGIN_KEY>&role=gu
```

Für die Vorführung zu zweit: Einer nimmt den Bauherrn, der andere den
Generalunternehmer, beide sehen dasselbe Bauvorhaben aus ihrer Rolle.

Beide Links tragen denselben Schlüssel — wer einen davon hat, kommt über
`/demo` auch in die andere Rolle. Für getrennte Zugänge im Wortsinn bräuchte es
je Rolle einen eigenen Schlüssel; für eine Vorführung zu zweit ist das
unnötig.

## Warum das vertretbar ist

Drei Riegel, nachzulesen in `apps/api/src/demo.ts`:

1. Ohne `DEMO_LOGIN_KEY` wird die Route nicht montiert.
2. Der Schlüssel muss mitkommen, ist mindestens 16 Zeichen lang und wird
   zeitkonstant verglichen. Ein kürzerer gilt als nicht gesetzt.
3. Es gibt genau zwei fest verdrahtete Identitäten. Ein Token auf einen echten
   Nutzer lässt sich hierüber nicht ausstellen.

Das Token sagt nur, *wer* fragt. Was diese Kennung darf, entscheidet
unverändert die RLS in der Datenbank — der Testzugang hebelt keine einzige
Policy aus.

## Rückbau

Wenn der Mailversand steht, fällt der Zugang in einem Rutsch weg:

```
apps/api/src/demo.ts
apps/api/scripts/demo.ts
apps/api/scripts/demo-sql.ts
apps/web/src/lib/demo-auth.ts
apps/web/src/routes/DemoLogin.tsx
docs/demo-seed.sql
```

dazu die vier Stellen, die darauf verweisen: `apps/api/src/app.ts`,
`apps/web/src/App.tsx`, `apps/web/src/lib/api.ts`,
`apps/web/src/routes/Projects.tsx`. An der echten Anmeldung wurde nichts
geändert.

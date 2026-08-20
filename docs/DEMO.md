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

Link öffnen, auf einen der beiden Knöpfe klicken, drin. Der Schlüssel steht im
Link, es gibt kein Eingabefeld. Wer den Link nicht hat, kommt nicht hinein.

`pnpm demo:seed` legt **ein** Bauvorhaben an. Wer lokal beide sehen will, nimmt
denselben Weg wie im Betrieb und spielt das erzeugte Skript ein:

```bash
pnpm demo:sql
psql "$DATABASE_URL" -f docs/demo-seed.sql
```

## Wer ist wer

| Rolle im Link | Person | Rolle im Projekt | Darf laut Rechtematrix |
|---|---|---|---|
| Bauherr | Familie Sonnenweg | `owner` | alles: einladen, Geld freigeben, Vertrag pflegen |
| Generalunternehmer | Jörg Baumeister | `contractor` | Vorgänge und Termine — **nicht** einladen, **nicht** freigeben |

Angelegt hat beide Projekte der **Bauherr**, nicht der GU. Das ist keine
Bequemlichkeit, sondern Abschnitt 2.1 der Spezifikation: Das Projekt gehört dem
Bauherrn, und nur `owner` und `co_owner` dürfen Mitglieder einladen. Der GU
kommt über eine Einladung hinein.

## Die beiden Bauvorhaben

In der Liste stehen zwei, und der Unterschied ist Absicht. An einem einzigen
Projekt bleiben ganze Teile der Oberfläche unsichtbar.

| | *Musterhaus Sonnenweg* | *Stadthaus Ahornweg* |
|---|---|---|
| Bundesland | Bayern | Niedersachsen |
| Keller | mit, 38 Vorgänge | ohne, 34 Vorgänge |
| Vertragsart | Verbraucherbauvertrag | Einzelgewerke |
| Baubeginn | in vier Wochen | vor acht Wochen |
| Abweichung | rund zwei Wochen **später** | zwanzig Werktage **früher** |
| Bestätigungsgrade | alle grau | alle vier Sorten |

Was das zweite Projekt zeigt und das erste nicht kann:

- **Die Phasenleiste steht mittendrin.** Sie richtet sich nach dem heutigen
  Datum. Ein Bau, der vor acht Wochen begann, steht in Phase vier von neun,
  nicht am Anfang.
- **Die gute Nachricht.** Die Abweichung steht in Grün statt in Tangerine —
  „20 Werktage früher". Am ersten Projekt gibt es nur den anderen Fall.
- **Alle vier Bestätigungsgrade nebeneinander:** grau „Von dir eingetragen",
  blau „Vom GU genannt", grün „Abgestimmt", Tangerine „Zwei Angaben".
- **Ist-Termine und Status.** Was heute vorbei ist, steht als `fertig` in der
  Datenbank, das Laufende als `laeuft`. Die Planansicht zeigt beides noch
  nicht — die Daten stimmen aber schon.

## Rolle wechseln

Oben rechts steht im Testzugang, aus wessen Sicht du gerade schaust
(„Generalunternehmer · Rolle wechseln"). Der Link führt zurück auf `/demo`,
und dort genügt wieder ein Klick: Der Schlüssel aus dem Link ist gemerkt.
*Abmelden* wirft beide Anmeldungen weg, die echte wie die Test-Anmeldung, und
vergisst den Schlüssel.

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

Das Skript legt die beiden Demo-Nutzer an und dazu **beide Bauvorhaben** mit
je zwei Mitgliedschaften — 38 und 34 Vorgänge. Am Ende zeigt es eine
Gegenprobe:

```
bauvorhaben          | beteiligte | vorgaenge | abhaengigkeiten | errechnetes_ende | geschuldet
Stadthaus Ahornweg   |          2 |        34 |              39 | …                | …
Musterhaus Sonnenweg |          2 |        38 |              43 | …                | …
```

Ein zweiter Lauf ändert nichts und bricht nicht ab: Jedes `insert` endet auf
`on conflict do nothing`, alle Kennungen sind fest. Wer das Skript später
erneut einfügt, bekommt also nur das, was ihm fehlt — ein bestehendes
Bauvorhaben bleibt samt seiner Termine unangetastet. Gelöscht wird nie,
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

Ein Link, ein Klick:

```
https://<deine-adresse>/demo?key=<DEMO_LOGIN_KEY>
```

Die Seite zeigt zwei Knöpfe, *Als Bauherr starten* und *Als Generalunternehmer
starten*. Ein Klick genügt, ein Eingabefeld gibt es nicht.

Oder je ein Link pro Person — steht die Rolle im Link, meldet die Seite direkt
an, ganz ohne Klick:

```
https://<deine-adresse>/demo?key=<DEMO_LOGIN_KEY>&role=bauherr
https://<deine-adresse>/demo?key=<DEMO_LOGIN_KEY>&role=gu
```

Für die Vorführung zu zweit: Einer nimmt den Bauherrn, der andere den
Generalunternehmer, beide sehen dieselben Bauvorhaben aus ihrer Rolle.

Alle Links tragen denselben Schlüssel — wer einen davon hat, kommt über
*Rolle wechseln* auch in die andere Rolle, ohne ihn erneut einzugeben. Der
Browser merkt sich den Schlüssel dafür, und *Abmelden* vergisst ihn wieder.
Für getrennte Zugänge im Wortsinn bräuchte es je Rolle einen eigenen Schlüssel;
für eine Vorführung zu zweit ist das unnötig.

Fehlt der Schlüssel im Link, etwa weil ein Messenger ihn abgeschnitten hat,
sagt die Seite das und bietet ein Feld zum Einfügen an.

## Wenn die Liste leer bleibt

„Hier stehen deine Bauvorhaben. Leg eines an" — obwohl das Skript gelaufen ist.
Drei Ursachen kommen in Frage. Der Reihe nach, jede mit einem Aufruf zu prüfen.

### 1. Kommt die API an die Datenbank?

```
https://<deine-adresse>/api/health/db
```

- `{"ok":true,"phases":9,"roles":47}` → die Verbindung steht und die
  Migrationen sind eingespielt.
- `{"ok":false,…}` → der Grund steht in `detail`. Meist ist `DATABASE_URL` in
  Vercel nicht gesetzt, zeigt auf die *Direct connection* statt auf den
  Transaction-Pooler, oder das Passwort stimmt nicht. Zugangsdaten werden in
  dieser Meldung maskiert.
- `phases: 0` bekommst du hier nie zu sehen; fehlen die Migrationen, scheitert
  schon die Abfrage und der Grund steht in `detail`.

### 2. Wen sieht die Datenbank?

Steht die Liste leer da, nennt die Seite darunter in kleiner Schrift, wen die
Datenbank erkannt hat:

```
Angemeldet als bauherr@demo.meinbaulotse.de · keine Beteiligung eingetragen
```

- **Deine eigene Adresse** statt der des Testzugangs → du schaust mit deinem
  Supabase-Konto auf eine Liste, in der nichts steht. Einmal *Abmelden*, dann
  den Demo-Link öffnen. Das passiert von selbst, wenn das Testtoken nach zwölf
  Stunden abläuft und daneben eine echte Anmeldung liegt; dann steht dort auch
  „Du warst zuletzt im Testzugang".
- **„Die Datenbank erkennt diese Anmeldung nicht"** → `auth.uid()` löst den
  JWT-Claim nicht auf. Dann bleibt jede Liste leer, egal was in den Tabellen
  steht.

Dieselbe Auskunft gibt es als Aufruf, mit dem Token im Kopf der Anfrage:
`GET /api/v1/me` liefert `tokenSub`, `databaseUserId`, `email` und
`memberships`.

### 3. Ist die Datenlage in *dieser* Datenbank?

Im SQL Editor genau die Abfrage, die die API stellt — als Demo-Bauherr:

```sql
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', false);
select set_config('role', 'authenticated', false);

select p.name, m.role
  from project p
  join project_member m on m.project_id = p.id
 where m.user_id = mbl.current_user_id() and m.revoked_at is null;

reset role;
```

Zwei Zeilen → die Datenlage steht, es liegt an der Anwendung. Null Zeilen →
das Skript ist hier nicht angekommen, und dann ist es die falsche Datenbank.

Was es **nicht** ist: der `DEMO_LOGIN_KEY`. Der bewacht allein die
Anmelderoute. Stimmt er nicht, sagt die Seite beim Klick „Dieser
Zugangsschlüssel stimmt nicht" — bis zur Liste kommt man damit gar nicht.
Sobald das Token ausgestellt ist, entscheidet allein die RLS, was zu sehen ist.

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

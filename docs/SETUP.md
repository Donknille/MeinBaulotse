# Einrichtung

MeinBaulotse läuft vollständig lokal, ohne dass irgendwo ein Konto angelegt sein
muss. Für den Betrieb braucht es ein Supabase-Projekt und ein Vercel-Projekt.
Beides legst du in deinen eigenen Konten an; im Repository steht keine
Projektkennung und kein Schlüssel.

---

## 1. Lokal entwickeln

Voraussetzungen: Node 22, pnpm 10, Docker.

```bash
pnpm install
pnpm -r --filter './packages/*' build   # Berechnungskern und Verträge bauen
docker compose up -d db                 # Postgres 17 auf Port 54329
cp .env.example .env
pnpm db:reset                           # Shim, Migrationen, Stammdaten
pnpm test                               # Berechnungskern
pnpm db:test                            # RLS-Matrix und Invarianten
pnpm dev                                # API auf 8787, Web auf 5173
```

Ohne Supabase-Zugangsdaten erklärt die Anmeldemaske, was fehlt, statt einen
Fehler zu zeigen. Zum Durchklicken braucht es dann kein Supabase-Konto: Der
Testzugang aus `docs/DEMO.md` legt zwei feste Anmeldungen und ein fertiges
Bauvorhaben an (`pnpm demo:seed`). Der Styleguide unter <http://localhost:5173/styleguide> ist
ohne Anmeldung erreichbar und zeigt die Planübersicht mit fester Datenlage.

**Ohne Docker:** Jedes erreichbare Postgres ab Version 16 genügt. Setz
`DATABASE_URL` entsprechend und fahr `pnpm db:reset`.

### Der lokale Auth-Shim

`supabase/local/0000_auth_shim.sql` bildet nach, was ein Supabase-Projekt
mitbringt: das Schema `auth` mit `auth.uid()` und die Rollen `anon`,
`authenticated`, `service_role`. Dadurch laufen dieselben Migrationen lokal wie
dort, und die RLS-Tests prüfen exakt dieselben Policies wie im Betrieb.

**Der Shim wird nie gegen ein Supabase-Projekt angewandt.** `pnpm db:reset`
bricht ab, wenn `DATABASE_URL` auf `supabase.co` zeigt.

---

## 2. Supabase-Projekt anlegen

Ein Projekt, `meinbaulotse`.

| Feld | Empfehlung |
|---|---|
| Region | **EU Frankfurt (`eu-central-1`)** — DSGVO und Latenz |
| Postgres | 17 |
| Datenbank-Passwort | stark, in den Passwortmanager |

> **Ein Projekt heißt: Preview-Deployments müssen aus.** Vercel baut sonst für
> jeden Branch eine Vorschau, und die schriebe in dieselbe Datenbank wie die
> Produktion — mitsamt der `schedule_change`-Historie, die sich per Entwurf
> nicht bereinigen lässt. Die Einstellung dazu steht in Abschnitt 3.

### Schema einspielen

#### Weg A — SQL-Editor, eine Datei

Dashboard → **SQL Editor** → *New query* → den Inhalt von
[`docs/db-setup.sql`](db-setup.sql) vollständig einfügen → **Run**.

Das ist eine erzeugte Datei: die drei Migrationen aus `supabase/migrations/` in
der richtigen Reihenfolge zusammengefügt. Ein Einfügen, ein Durchlauf.

#### Weg B — psql

```bash
# Zum Einspielen den Session-Pooler auf Port 5432 nehmen, nicht 6543.
export DATABASE_URL="postgresql://postgres.<project-ref>:<passwort>@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/db-setup.sql

# oder einzeln, in dieser Reihenfolge:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0003_seed.sql
```

**Port 5432, nicht 6543.** Der Transaction-Pooler ist für die laufende
Anwendung richtig, für Migrationen aber der falsche Modus: `create type` und
`do $$…$$` gehören in eine Sitzung, nicht in eine Transaktion mit wechselnder
Verbindung.

#### Nicht einspielen

`supabase/local/0000_auth_shim.sql` bleibt außen vor. Sie bildet nur in einem
nackten Postgres nach, was ein Supabase-Projekt ohnehin mitbringt.

#### Zur Kontrolle

```sql
select
  (select count(*) from phase)              as phasen,             -- 9
  (select count(*) from trade)              as gewerke,            -- 21
  (select count(*) from role_permission)    as rechte,             -- 47
  (select count(*) from plan_template_task) as vorlagenvorgaenge;  -- 38

select count(*) filter (where rowsecurity) as mit_rls,
       count(*)                            as tabellen
from pg_tables where schemaname = 'public';                        -- 14 von 14
```

Die zweite Abfrage ist die wichtigere. Die Zählung oben stimmt auch dann, wenn
`0002_rls.sql` nur zur Hälfte durchgelaufen ist — dann stehen die Stammdaten
da, aber die Rechte fehlen.

> **Die Supabase-CLI trägt hier derzeit nicht.** `supabase db push` erwartet
> Migrationsdateien im Format `YYYYMMDDHHMMSS_name.sql` und verfolgt sie über
> genau diesen Zeitstempel in `supabase_migrations.schema_migrations`. Unsere
> heißen `0001_schema.sql` und so weiter. Wer die CLI später will, benennt die
> drei Dateien auf Zeitstempel um und zieht `packages/db/scripts/reset.ts` und
> diesen Abschnitt nach.

### Anmeldung einrichten

**Authentication → Providers → Email:** einschalten. Die Anwendung nutzt Magic
Link, kein Passwort.

**Authentication → Providers → Google:** einschalten. Dafür brauchst du einen
OAuth-Client in der Google Cloud Console:

1. APIs & Services → Credentials → *Create OAuth client ID* → *Web application*
2. Als autorisierte Weiterleitungs-URI eintragen:
   `https://<dein-project-ref>.supabase.co/auth/v1/callback`
3. Client-ID und Client-Secret ins Supabase-Dashboard eintragen

Client-ID und Secret gehören ausschließlich ins Supabase-Dashboard — nicht ins
Repository und nicht in eine `.env`, die eingecheckt wird.

**Authentication → URL Configuration:**

| Feld | Wert |
|---|---|
| Site URL | deine Produktionsadresse |
| Redirect URLs | `http://localhost:5173/**` und `https://<deine-domain>/**` |

---

## 3. Vercel-Projekt anlegen

Ein Projekt für beides: Das Vite-Bundle wird statisch ausgeliefert, die
Hono-API läuft als Function unter `/api`. Dadurch teilen sich Web und API
dieselbe Herkunft — keine CORS-Schicht, keine Basis-URL, kein Unterschied
zwischen den Umgebungen.

Die Bau- und Ausgabepfade stehen in `vercel.json`; im Dashboard muss dafür
nichts eingestellt werden.

### Branch und Vorschauen

| Einstellung | Wert | Wo |
|---|---|---|
| Production Branch | `main` | Settings → Git |
| Preview Deployments | **Only Production Branch** | Settings → Git |

Die zweite Zeile ist nicht kosmetisch. Solange es nur ein Supabase-Projekt
gibt, schriebe jede Branch-Vorschau in die Produktionsdatenbank.

### Umgebungsvariablen

Sechs Stück, alle im Bereich *Production*:

| Name | Quelle |
|---|---|
| `DATABASE_URL` | Database → Connection string → **Transaction pooler, Port 6543** |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Project Settings → API |
| `SUPABASE_JWT_SECRET` | Project Settings → API → JWT Settings |
| `VITE_SUPABASE_URL` | wie `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | wie `SUPABASE_ANON_KEY` |

**`DATABASE_URL`: Transaction-Pooler auf 6543, nicht die Direktverbindung.**
Eine Serverless-Funktion baut je Instanz ihre eigene Verbindung auf; die
Direktverbindung ist nach wenigen gleichzeitigen Instanzen erschöpft. Der
Anwendungscode setzt Rolle und JWT-Claim transaktionslokal
(`set_config(…, true)`), und das verträgt sich mit dem Transaction-Modus.

*(Zum Einspielen des Schemas gilt das Gegenteil — dort Port 5432, siehe
Abschnitt 2.)*

Die beiden `VITE_`-Werte landen im Browser-Bundle. Das ist so vorgesehen: Der
Anon-Key ist öffentlich, alles Weitere entscheidet die Datenbank über RLS.

**Alle sechs vor dem ersten Deploy setzen.** Die `VITE_`-Werte werden beim Bauen
ins Bundle eingebacken; wer sie nachträgt, braucht einen neuen Build.

**Der `service_role`-Key wird nirgends gebraucht.** Abschnitt 6.4 der
Spezifikation verbietet privilegierte Rollen im Anwendungscode, und der Code
hält sich daran. Trag ihn nicht ein.

### Nach dem ersten Deploy

Unter Authentication → URL Configuration nachtragen:

| Feld | Wert |
|---|---|
| Site URL | deine Produktionsadresse |
| Redirect URLs | `https://<deine-domain>/**` |

Ohne diesen Schritt bricht die Anmeldung nach dem Klick auf den Magic Link ab —
Supabase leitet dann nicht auf eine Adresse weiter, die es nicht kennt.

### Wie die API auf Vercel liegt

Die Funktion ist `api/index.js`, und sie ist **erzeugt**: `pnpm build:function`
bündelt `apps/api/src/vercel.ts` samt aller Abhängigkeiten zu einer Datei, die
außer Node-Bausteinen nichts mehr importiert. Sie liegt im Repository, die CI
prüft, dass sie zu ihrer Quelle passt.

Das ist kein Selbstzweck. Vercel bündelt diese Datei nicht, sondern übersetzt
sie und legt Abhängigkeiten daneben. Ein Import auf ein anderes Paket des
Monorepos scheitert dort mit `Cannot find module`, und ein Absturz beim Laden
meldet sich nur als FUNCTION_INVOCATION_FAILED. Ein Bündel ohne Importe kennt
dieses Problem nicht.

Sie bedient `/api`; die Umschreibung in `vercel.json` (`/api/(.*)` → `/api`)
reicht alles Tiefere an dieselbe Funktion weiter, mit **vollständigem** Pfad,
also `/api/v1/projects/…`. Deshalb hängt die Hono-App unter `/api`, und deshalb
schneidet der Vite-Proxy lokal nichts ab: derselbe Pfad in beiden Umgebungen.

Zur Kontrolle nach jedem Deployment: `https://<deine-adresse>/api/health` muss
`{"ok":true,"path":"/api/health"}` liefern.

---

## 4. Anzeigenschrift ergänzen

Das Gestaltungssystem sieht **Satoshi** in Gewicht 500 für Überschriften ab
36 px vor. Sie ist über [Fontshare](https://www.fontshare.com/fonts/satoshi)
kostenfrei auch kommerziell nutzbar, liegt aber nicht im Repository.

So kommt sie hinein:

1. Satoshi bei Fontshare herunterladen, Gewicht 500 genügt
2. `Satoshi-Medium.woff2` nach `apps/web/public/fonts/` legen
3. In `apps/web/src/styles/base.css` ergänzen:

```css
@font-face {
  font-family: 'Satoshi';
  src: url('/fonts/Satoshi-Medium.woff2') format('woff2');
  font-weight: 500;
  font-display: swap;
}
```

Ohne diesen Schritt greift die im CI vorgesehene Ersatzwahl: Inter in Gewicht
500 mit −0.02em Laufweite. Die Anwendung funktioniert vollständig, nur die
Überschriften tragen dann nicht die Marken-Schrift.

---

## 5. Wenn du Stammdaten änderst

Zwei Dateien werden erzeugt und dürfen nicht von Hand bearbeitet werden:

| Datei | Quelle | Befehl |
|---|---|---|
| `supabase/migrations/0003_seed.sql` | Ablaufvorlage und Rechtematrix | `pnpm --filter @meinbaulotse/db seed:generate` |
| `docs/db-setup.sql` | die drei Migrationen | `pnpm --filter @meinbaulotse/db build:db-setup` |
| `apps/web/src/routes/plan-fixture.ts` | Ablaufvorlage und Berechnungskern | `pnpm --filter @meinbaulotse/web fixture` |

Die Pipeline prüft, dass alle drei zu ihren Quellen passen. **Wer eine Migration
ändert, muss `db-setup.sql` neu erzeugen** — sonst spielt der nächste jemand
ein veraltetes Schema ein.

`0003_seed.sql` ist die **Erstbefüllung**. Sobald sie eingespielt ist, ist die
Datenbank die Autorität: Die Ablaufvorlage soll ohne Deployment pflegbar sein.
Für ein bereits eingespieltes Projekt gehören Änderungen an den Stammdaten
deshalb in eine neue Migration oder direkt in die Datenbank, nicht in eine
Neuerzeugung von `0003`.

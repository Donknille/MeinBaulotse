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

## 2. Supabase-Projekte anlegen

**Zwei Projekte, nicht eines.** Vercel erzeugt für jeden Branch und jeden Pull
Request ein Preview-Deployment. Zeigen die auf dieselbe Datenbank wie die
Produktion, schreibt jeder Versuch in deine echten Bauprojektdaten — mitsamt
der `schedule_change`-Historie, die sich per Entwurf nicht bereinigen lässt.

| Projekt | Zweck | Gebunden an |
|---|---|---|
| `meinbaulotse` | Produktion | Vercel-Bereich *Production* |
| `meinbaulotse-staging` | Preview-Deployments | Vercel-Bereich *Preview* |

### Beim Anlegen, für beide

| Feld | Empfehlung |
|---|---|
| Region | **EU Frankfurt (`eu-central-1`)** — DSGVO und Latenz |
| Postgres | 17 |
| Datenbank-Passwort | stark, in den Passwortmanager |

Alle folgenden Schritte gelten für **beide** Projekte.

### Migrationen einspielen

Die Migrationen sind reines SQL. Die Supabase-CLI ist bequem, aber nicht
Voraussetzung.

```bash
# Variante A — mit der Supabase-CLI
supabase link --project-ref <dein-project-ref>
supabase db push

# Variante B — mit psql, in dieser Reihenfolge
psql "$DEIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0001_schema.sql
psql "$DEIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0002_rls.sql
psql "$DEIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0003_seed.sql
```

Zur Kontrolle: Danach stehen 9 Bauphasen, 21 Gewerke, 47 Rechteeinträge und 38
Vorlagenvorgänge in der Datenbank.

```sql
select
  (select count(*) from phase)              as phasen,
  (select count(*) from trade)              as gewerke,
  (select count(*) from role_permission)    as rechte,
  (select count(*) from plan_template_task) as vorlagenvorgaenge;
```

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

### Production-Branch

Auf `main` stellen (Settings → Git → Production Branch). Alles andere wird zum
Preview-Deployment.

### Umgebungsvariablen

Jede Variable **zweimal** anlegen, einmal für *Production* und einmal für
*Preview*, mit den Werten des jeweiligen Supabase-Projekts:

| Name | Production | Preview |
|---|---|---|
| `DATABASE_URL` | Produktions-Pooler | Staging-Pooler |
| `SUPABASE_URL` | `https://<prod-ref>.supabase.co` | `https://<staging-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Produktion | Staging |
| `SUPABASE_JWT_SECRET` | Produktion | Staging |
| `VITE_SUPABASE_URL` | wie `SUPABASE_URL` | wie `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | wie `SUPABASE_ANON_KEY` | wie `SUPABASE_ANON_KEY` |

**`DATABASE_URL`: den Transaction-Pooler nehmen, nicht die Direktverbindung.**
Project Settings → Database → Connection string → *Transaction pooler*,
Port **6543**. Grund: Eine Serverless-Funktion baut je Instanz ihre eigene
Verbindung auf; die Direktverbindung ist nach wenigen gleichzeitigen Instanzen
erschöpft. Der Anwendungscode setzt Rolle und JWT-Claim transaktionslokal
(`set_config(…, true)`), und das verträgt sich mit dem Transaction-Modus.

Die beiden `VITE_`-Werte landen im Browser-Bundle. Das ist so vorgesehen: Der
Anon-Key ist öffentlich, alles Weitere entscheidet die Datenbank über RLS.

**Alle sechs vor dem ersten Deploy setzen.** Die `VITE_`-Werte werden beim Bauen
ins Bundle eingebacken; wer sie nachträgt, braucht einen neuen Build.

**Der `service_role`-Key wird nirgends gebraucht.** Abschnitt 6.4 der
Spezifikation verbietet privilegierte Rollen im Anwendungscode, und der Code
hält sich daran. Trag ihn nicht ein.

### Nach dem ersten Deploy

In **beiden** Supabase-Projekten unter Authentication → URL Configuration
nachtragen:

| Feld | Wert |
|---|---|
| Site URL | deine Produktionsadresse |
| Redirect URLs | `https://<deine-domain>/**` und `https://*-<dein-team>.vercel.app/**` |

Ohne diesen Schritt bricht die Anmeldung nach dem Klick auf den Magic Link ab —
Supabase leitet dann nicht auf eine Adresse weiter, die es nicht kennt.

### Wie die API auf Vercel liegt

Die Funktion ist `api/[[...route]].ts`, Vercels Konvention für Sammelrouten.
Sie erhält den Pfad **vollständig**, also `/api/v1/projects/…`. Deshalb hängt
die Hono-App unter `/api`, und deshalb schneidet der Vite-Proxy lokal nichts ab:
derselbe Pfad in beiden Umgebungen. Wer eine der drei Stellen ändert, muss die
anderen beiden mitziehen, sonst antwortet im Betrieb jede Route mit 404.

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
| `apps/web/src/routes/plan-fixture.ts` | Ablaufvorlage und Berechnungskern | `pnpm --filter @meinbaulotse/web fixture` |

Die Pipeline prüft, dass beide zu ihren Quellen passen.

`0003_seed.sql` ist die **Erstbefüllung**. Sobald sie eingespielt ist, ist die
Datenbank die Autorität: Die Ablaufvorlage soll ohne Deployment pflegbar sein.
Für ein bereits eingespieltes Projekt gehören Änderungen an den Stammdaten
deshalb in eine neue Migration oder direkt in die Datenbank, nicht in eine
Neuerzeugung von `0003`.

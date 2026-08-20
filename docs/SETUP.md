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
Fehler zu zeigen. Der Styleguide unter <http://localhost:5173/styleguide> ist
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

### Beim Anlegen

| Feld | Empfehlung |
|---|---|
| Name | `meinbaulotse` |
| Region | **EU Frankfurt (`eu-central-1`)** — DSGVO und Latenz |
| Postgres | 17 |
| Datenbank-Passwort | stark, in den Passwortmanager |

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

### Umgebungsvariablen

| Name | Sichtbarkeit | Quelle |
|---|---|---|
| `DATABASE_URL` | geheim | Supabase → Project Settings → Database → Connection string (Pooler, Port 6543) |
| `SUPABASE_URL` | geheim | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | geheim | Project Settings → API |
| `SUPABASE_JWT_SECRET` | geheim | Project Settings → API → JWT Settings |
| `VITE_SUPABASE_URL` | öffentlich | wie `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | öffentlich | wie `SUPABASE_ANON_KEY` |

Die beiden `VITE_`-Werte landen im Browser-Bundle. Das ist so vorgesehen: Der
Anon-Key ist öffentlich, alles Weitere entscheidet die Datenbank über RLS.

**Der `service_role`-Key wird nirgends gebraucht.** Abschnitt 6.4 der
Spezifikation verbietet privilegierte Rollen im Anwendungscode, und der Code
hält sich daran. Trag ihn nicht ein.

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

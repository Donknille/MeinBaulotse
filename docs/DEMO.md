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

## Was der Zugang heute noch nicht zeigt

- **Beide Rollen sehen denselben Bildschirm.** Die Oberfläche wertet
  `project.role` noch nicht aus; die Rechte stecken bisher nur in der
  Datenbank. Der Unterschied zwischen Bauherr und GU wird also erst sichtbar,
  wenn schreibende Ansichten dazukommen.
- **Es gibt keinen Einladungsvorgang.** Der Seed trägt den GU direkt ein. Die
  Policy dafür (`member.invite`) steht, die Route dazu fehlt noch.

## Nach `pnpm db:test`

Die RLS-Tests leeren die lokale Datenbank. Danach ist auch die Demolage weg —
einfach `pnpm demo:seed` erneut aufrufen.

Ein zweiter Aufruf bei bestehender Demolage ändert nichts: Ein Projekt lässt
sich nicht löschen, solange `schedule_change` daran hängt, denn diese Historie
ist append-only. Für einen frischen Plan `pnpm db:reset && pnpm demo:seed`.

## Auf Vercel einschalten — nur in *Preview*

1. In Vercel unter Settings → Environment Variables `DEMO_LOGIN_KEY` anlegen
   und **nur bei Preview** anhaken. In *Production* bleibt die Variable leer;
   dann gibt es die Route dort nicht (sie antwortet mit 404 wie jede unbekannte
   Adresse).
2. Im Staging-Supabase unter Authentication → Users die beiden Demo-Nutzer
   anlegen (*Auto Confirm*), mit genau diesen Kennungen:

   | Kennung | Adresse |
   |---|---|
   | `11111111-1111-4111-8111-111111111111` | `bauherr@demo.meinbaulotse.de` |
   | `22222222-2222-4222-8222-222222222222` | `gu@demo.meinbaulotse.de` |

   Die Kennungen sind fest verdrahtet (`apps/api/src/demo.ts`), damit die
   Anmeldung ohne Datenbankzugriff auskommt.
3. `DATABASE_URL` auf das Staging-Projekt zeigen lassen und einmal
   `pnpm demo:seed` laufen lassen.

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
apps/web/src/lib/demo-auth.ts
apps/web/src/routes/DemoLogin.tsx
```

dazu die vier Stellen, die darauf verweisen: `apps/api/src/app.ts`,
`apps/web/src/App.tsx`, `apps/web/src/lib/api.ts`,
`apps/web/src/routes/Projects.tsx`. An der echten Anmeldung wurde nichts
geändert.

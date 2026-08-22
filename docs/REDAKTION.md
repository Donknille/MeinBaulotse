# Lotsenkarten schreiben und ändern

Die Lotsenkarten sind der Inhalt, für den das Produkt bezahlt wird. Der
Terminplan rechnet, was jeder Terminplan rechnet; was MeinBaulotse von einer
Tabelle unterscheidet, steht in diesen Karten.

Sie liegen als Markdown in `content/lotsenkarten/`, eine Datei je Karte. Wer
Bauwissen schreibt, soll Text schreiben und kein SQL — die Migration entsteht
daraus per Generator.

---

## Der Weg von der Datei in die Datenbank

```bash
# 1. Datei in content/lotsenkarten/ anlegen oder ändern
# 2. Import-Migration neu erzeugen
pnpm --filter @meinbaulotse/db guide-cards:generate

# 3. Sammeldatei für Supabase nachziehen
pnpm --filter @meinbaulotse/db build:db-setup

# 4. Prüfen
pnpm --filter @meinbaulotse/db test guide-cards
pnpm db:reset          # spielt 0006_lotsenkarten.sql lokal mit ein
```

Beide erzeugten Dateien werden eingecheckt, und die CI prüft, dass sie zu ihren
Quellen passen. Eine geänderte Karte ohne neu erzeugte Migration fällt damit
auf, bevor sie jemanden erreicht.

Im Betrieb reicht es, `supabase/migrations/0006_lotsenkarten.sql` im SQL-Editor
einzufügen. Das Skript ist beliebig oft einspielbar: Jedes `insert` endet auf
`on conflict do nothing`, und die Kennungen sind aus Schlüssel und Fassung
abgeleitet, nicht gewürfelt.

---

## Der Aufbau einer Karte

```markdown
---
key: estrich                      # stabil über alle Fassungen hinweg
titel: Estrich und Belegreife
phase: ausbau                     # ein phase_key aus Abschnitt 7.1
gewerk: estrich                   # ein trade code, oder ganz weglassen
vorgaenge: t26, t27               # Vorgänge der Ablaufvorlage aus 7.2
fassung: 1
fachpruefung: nein                # ja oder nein
---

## Was passiert

Zwei bis drei Sätze, für jemanden, der das zum ersten Mal erlebt.

## Worauf du achten kannst

- Aussage — warum das zählt

## Fragen an den GU

- Frage? — warum sie wichtig ist

## Was oft schiefgeht

- Das Problem — woran du es erkennst

## Jetzt fotografieren

- Was — warum jetzt und nicht später

## Warum eine Fachprüfung

Nur bei `fachpruefung: ja`. Freitext.

## Quellen

- DIN 18560 — Estriche im Bauwesen
```

Der Trenner ist ein Geviertstrich mit Leerzeichen (` — `), getrennt wird am
**ersten** Vorkommen. In der Begründung darf derselbe Strich noch einmal
auftauchen.

Der Parser ist streng, und das mit Absicht: Ein Tippfehler im Abschnittstitel
bricht ab, statt still einen leeren Abschnitt zu erzeugen. Eine fehlende Liste
sieht ein Bauherr nämlich nicht — er merkt nur nicht, was er nicht erfährt.

---

## Was den Inhalt trägt

**Keine Behauptung ohne Quelle.** Jede Aussage ist auf eine Norm, eine
Verbandsempfehlung oder Fachliteratur zurückführbar (Spezifikation 6.3). An
dieser Stelle hängt die Glaubwürdigkeit des ganzen Produkts: Eine Karte, die
sich als Halbwissen herausstellt, beschädigt auch die elf richtigen.

**Jede Aussage trägt ihre Begründung.** „Randdämmstreifen prüfen" ist eine
Anweisung, der jemand folgt oder nicht. „…, sonst überträgt der Estrich Schall"
ist eine Auskunft, mit der er selbst entscheiden kann. Deshalb erzwingt das
Format das Warum — es ist keine Formsache.

**Prüfbar ohne Fachkenntnis.** Unter „Worauf du achten kannst" steht nur, was
ein Laie tatsächlich sehen kann. Alles andere gehört unter „Fragen an den GU"
oder zur Fachprüfung.

**Der Ton bleibt beruhigend** (`meinbaulotse-ci.md`, Abschnitt 11): Du,
durchgehend. Kurze Sätze. Keine Ausrufezeichen. Nie beschuldigend. Kein
Fachbegriff ohne Erklärung beim ersten Auftreten.

**Eine Empfehlung zur Fachprüfung braucht einen Grund.** Ohne Begründung ist sie
Angstmache — der Parser und eine Datenbankbedingung bestehen beide darauf.

---

## Eine Karte ändern

Veröffentlichte Karten sind unveränderlich (Invariante 4.1.6). Ein Trigger
verweigert jede Änderung, auch dem Eigentümer der Datenbank.

Der Grund ist nicht Bürokratie: Wenn es später Streit gibt, muss sich sagen
lassen, welchen Rat der Bauherr damals bekommen hat. Eine Karte, die sich
nachträglich glattziehen lässt, kann das nicht.

Deshalb: **`fassung` in der Markdown-Datei erhöhen**, Generator laufen lassen,
einspielen. Der Import legt die neue Fassung an und verkettet die alte über
`superseded_by`. Ausgeliefert wird ab dann die neue; wer die alte gelesen hat,
bleibt nachvollziehbar.

---

## Stand des Inhalts

Die zwölf Karten aus Abschnitt 7.4 der Spezifikation sind angelegt und decken
die Bauphasen ab, in denen am meisten schiefgeht. Fünf empfehlen eine
Fachprüfung — Bodenplatte, Kellerabdichtung, Rohinstallation vor der
Verkleidung, Blower-Door und Abnahme. Das sind genau die Termine, die auch
Baubegleiter üblicherweise setzen.

> **Die fachliche Prüfung durch einen Bausachverständigen steht aus.** Abschnitt
> 9.2 der Spezifikation sieht sie ausdrücklich vor, gegen Honorar oder
> Beteiligung. Bis dahin sind die Karten mit Quellen belegt, aber nicht von
> einem Fachmann gegengelesen. Wer sie vor diesem Schritt bewirbt, verspricht
> mehr, als das Produkt gerade halten kann.

Die übrigen 26 Vorgänge der Ablaufvorlage haben noch keine Karte. Die Anwendung
sagt das an Ort und Stelle („Zu … gibt es noch keine Lotsenkarte") statt so zu
tun, als sei nichts.

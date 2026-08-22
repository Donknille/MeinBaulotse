# Lotsenkarten — das Format

Hier liegt der Redaktionsinhalt der Wissensschicht: eine Datei je Karte,
Markdown mit Kopfteil. Aus diesen Dateien erzeugt

```bash
pnpm --filter @meinbaulotse/db cards:generate
```

die Migration `supabase/migrations/0006_guide_cards.sql`. Die Migration wird
eingecheckt, die Datenbank ist zur Laufzeit die Quelle. Diese Dateien sind die
**Erstbefüllung**, so wie `efh-massiv-unterkellert.ts` die Erstbefüllung der
Ablaufvorlage ist.

Warum überhaupt Dateien, wenn der Inhalt ohnehin in der Datenbank landet:
Redaktion ist Textarbeit. Sie will Fassungen vergleichen, Korrekturen begründen
und notfalls zurücknehmen können — dafür ist ein Repository das bessere
Werkzeug als eine Tabellenzeile. Die Datenbank bleibt trotzdem pflegbar: Eine
Korrektur im laufenden Betrieb ist eine neue Fassung im SQL-Editor, und die
Datei zieht nach.

## Die eine Regel

**Keine Aussage ohne Quelle.** Jede Karte nennt am Fuß, worauf sie sich stützt:
eine Norm, eine Verbandsempfehlung, ein Gesetz. Steht dort nichts, gehört der
Satz nicht auf die Karte. An dieser Stelle steht die Glaubwürdigkeit des
gesamten Produkts (Spezifikation 6.3).

Die Karten in diesem Ordner sind ein **fachlicher Erstentwurf**. Vor dem ersten
echten Bauherrn gehören sie durch einen Bausachverständigen — so steht es in
Abschnitt 9 der Spezifikation, und es ist keine Formalie.

## Aufbau einer Datei

```markdown
---
schluessel: bodenplatte
titel: Bodenplatte und Fundamenterder
phase: gruendung
gewerk: rohbau
vorgaenge: t05, t06
fachpruefung: ja
fachpruefung_grund: Was hier verdeckt wird, ist später nur mit Aufwand zu prüfen.
rechtshinweis: nein
---

## Was passiert

Zwei bis drei Sätze Fließtext. Für jemanden, der zum ersten Mal baut.

## Worauf du achten kannst

- Ohne Fachkenntnis prüfbar — Warum: Begründung in einem Halbsatz

## Fragen an den GU

- Wörtlich verwendbare Frage? — Warum: was die Antwort dir sagt

## Was typischerweise schiefgeht

- Der Fehler — Erkennbar: woran du ihn siehst

## Jetzt fotografieren

- Was aufs Bild gehört — Warum: weil es danach verdeckt ist — Vor: t06

## Quellen

- DIN 18014, Fundamenterder — Wozu: Ausführung und Anschlusspunkte
```

### Kopfteil

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `schluessel` | ✓ | Stabile Kennung. Ändert sich nie, auch nicht bei einer neuen Fassung. |
| `titel` | ✓ | Überschrift der Karte |
| `phase` | ✓ | `phase.key` aus der Bauphasengliederung |
| `gewerk` | – | `trade.code`, sofern eindeutig |
| `vorgaenge` | ✓ | Codes aus `plan_template_task`, kommagetrennt |
| `bauweisen` | – | Auf welche `build_type` die Karte passt. Leer heißt: auf alle. |
| `fachpruefung` | – | `ja`, wenn hier ein Sachverständiger sinnvoll ist |
| `fachpruefung_grund` | bei `ja` | Warum gerade hier |
| `rechtshinweis` | – | `ja`, wenn die Karte eine Gesetzesstelle nennt. Dann trägt sie den festen Zusatz aus CI 11.3. |
| `fassung` | – | Ganzzahl, Standard 1. Siehe unten. |

### Abschnitte

Die sechs Überschriften stehen fest und werden wörtlich erkannt. Fehlt eine,
bleibt der Abschnitt leer; `Was passiert` ist Pflicht.

Jede Listenzeile ist `Haupttext`, gefolgt von beliebig vielen Zusätzen der Form
` — Label: Wert`. Der Gedankenstrich mit Leerzeichen davor und dahinter ist das
Trennzeichen — **im Haupttext darf er deshalb nicht vorkommen**. Im Fließtext
unter `Was passiert` ist er erlaubt.

| Abschnitt | Bekannte Label |
|---|---|
| Worauf du achten kannst | `Warum` |
| Fragen an den GU | `Warum` |
| Was typischerweise schiefgeht | `Erkennbar` |
| Jetzt fotografieren | `Warum`, `Vor` (Vorgangscode) |
| Quellen | `Wozu` |

## Ton

Gilt unverändert `meinbaulotse-ci.md`, Abschnitt 11: Du-Form, kurze Sätze, keine
Ausrufezeichen, kein Fachbegriff ohne Erklärung beim ersten Auftreten. Und
nirgends beschuldigend — nicht „der GU hat versäumt", sondern „der Termin wurde
bisher nicht bestätigt".

Die Fragen an den GU sind wörtlich verwendbar formuliert, weil sie genau das
tun sollen: Der Nutzer tippt auf Kopieren und schickt sie ab.

## Eine Karte ändern

Eine veröffentlichte Karte ist in der Datenbank unveränderlich; der Trigger
`mbl.guard_guide_card_published` lässt keine Änderung zu, auch nicht im
SQL-Editor. Das ist Absicht: Sonst lässt sich hinterher nicht mehr sagen,
welchen Rat der Bauherr damals bekommen hat.

Eine Korrektur ist deshalb immer eine **neue Fassung**:

1. In der Datei `fassung` um eins erhöhen und den Text ändern
2. `pnpm --filter @meinbaulotse/db cards:generate`
3. Die erzeugte Migration spielt die neue Fassung ein und verkettet die alte
   über `superseded_by`

Die Reihenfolge der Listenzeilen ist dabei nicht beliebig: Haken an
Checklisten hängen an der Position der Zeile innerhalb ihres Abschnitts. Neue
Punkte gehören ans Ende, bestehende bleiben stehen, wo sie sind. Wer eine Zeile
mittendrin einfügt, verschiebt fremde Haken auf die falsche Aussage.

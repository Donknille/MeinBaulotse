# MeinBaulotse — Gestaltungssystem

**Version:** 2.0
**Grundlage:** Dub-Style-Reference („frosted link dashboard on rice paper"), hell
**Gilt für:** Anwendung (PWA), Wochenbericht, Bauakte, Abstimmungsseite
**Verbindlich zusammen mit:** `meinbaulotse-spec.md`

---

## 1. Leitbild

Das visuelle System ist ruhig, fast redaktionell: eine nahezu weiße Fläche, die
nicht von Schatten, sondern von **1 px Haarlinien** zusammengehalten wird. Die
Struktur macht die Typografie, nicht die Dekoration. Farbe tritt sparsam auf und
hat dann eine Bedeutung.

> **Kanten statt Schatten. Dichte statt Fläche. Eine Farbe, die spricht.**

Für ein Produkt, das einen Laien durch ein Verfahren lotst, passt das genau: Ein
Terminplan ist ein Dokument, kein Erlebnis. Die gedruckte Anmutung — weiße
Fläche, feine Linien, dichte Tabellen — nimmt dem Bauherrn die Angst vor der
Software und lässt die Information vorn stehen.

Drei Haltungen tragen jede Detailentscheidung:

1. **Präzision beruhigt.** Ein exaktes Datum, eine exakte Zahl Werktage, eine
   klare Herkunftsangabe nimmt mehr Angst als jede freundliche Farbe.
2. **Ruhe ist eine Ressource.** Wer ständig warnt, wird ignoriert. Alarmierende
   Mittel sind knapp und werden gespart.
3. **Der Bauherr bleibt der Kapitän.** Die Oberfläche schlägt vor, ordnet und
   erinnert. Sie kommandiert nie und bewertet niemanden.

**Modus:** Stufe 1 ist **ausschließlich hell**. Die Tokens sind semantisch
benannt, ein dunkler Satz lässt sich später ergänzen, ohne Komponenten anzufassen.

---

## 2. Marke

### 2.1 Name

**MeinBaulotse**, ein Wort, Binnenversalie beim L. Nie „Mein Baulotse", nie
„MEINBAULOTSE". Im Fließtext ohne Auszeichnung.

### 2.2 Bildmarke

Ein **Toppzeichen** — das Dreieck auf einer Seetonne, das die Fahrrinne markiert.
Ein gefülltes Dreieck über einem waagerechten Strich, mehr nicht. Es liest sich
als Richtungsweiser und als Dachfirst zugleich.

```
      ▲
   ───────
```

Konstruktion: Dreieck mit 60° Basiswinkeln, Grundlinie 60 % der Bildbreite,
Abstand zum Strich 12 % der Höhe, Strichstärke 8 % der Höhe. Zwei Farben:
`--color-charcoal` auf Weiß, oder Weiß auf `--color-midnight-ink`. Keine
Verläufe, keine Kontur, kein Schlagschatten.

### 2.3 App-Icon

Toppzeichen in Weiß auf `--color-midnight-ink`, optisch zentriert (das Dreieck
sitzt 2 % über der geometrischen Mitte, sonst wirkt es abgesackt). Kein Text,
keine Kachelecken selbst zeichnen — die Plattform rundet. Maskierbares Icon mit
20 % Sicherheitsrand. Formate: 192, 512, maskable 512, Apple-Touch 180.

---

## 3. Farbe

### 3.1 Palette

Übernommen aus der Dub-Referenz, unverändert in den Werten.

```css
:root {
  /* Flächen und Linien */
  --color-canvas-white: #ffffff;   /* Seitengrund, Karten, Popover        */
  --color-paper-mist:   #f5f5f5;   /* zweite Fläche, Hover, Einbettungen  */
  --color-ash:          #e5e5e5;   /* DIE Strukturlinie, 1px, überall     */
  --color-smoke:        #d4d4d4;   /* betonte Kante                       */
  --color-pebble:       #c8c8c8;   /* Bedienelementkontur                 */

  /* Schrift */
  --color-midnight-ink: #0a0a0a;   /* Primärknopf-Fläche, höchste Betonung */
  --color-charcoal:     #171717;   /* Fließtext, Überschriften             */
  --color-graphite:     #262626;   /* Sekundärtext, Iconstriche            */
  --color-slate:        #404040;   /* Tertiärtext, Navigations-Hover       */
  --color-steel:        #525252;   /* gedämpfter Text, Hilfetext           */
  --color-fog:          #737373;   /* Platzhalter, Deaktiviertes           */
  --color-silver:       #a3a3a3;   /* dekorative Striche, feine Trenner    */

  /* Akzente */
  --color-electric-blue: #2563eb;  /* Links, aktive Zustände, Kennzahlen   */
  --color-deep-sapphire: #1e40af;  /* reserviert, siehe 3.3                */
  --color-vivid-green:   #16a34a;
  --color-tangerine:     #ea580c;
  --color-lavender:      #7c3aed;

  /* Tönungen für Plaketten — nie für große Flächen */
  --color-soft-mint:   #dcfce7;
  --color-soft-blue:   #dbeaff;
  --color-soft-amber:  #ffedd5;
  --color-soft-violet: #ede9fe;

  --color-primary-action-fill: #000000;
}
```

### 3.2 Eine Ergänzung, und nur eine

Die Dub-Palette kennt kein Rot. Für dieses Produkt braucht es eines: Tangerine
trägt bereits „zwei Angaben" und „Frist läuft", und wenn ein wesentlicher Mangel
offen ist, muss ein anderer Ton greifen. Deshalb genau zwei zusätzliche Werte,
im selben Farbverfahren wie die übrigen Akzente:

```css
  --color-alarm-red:  #dc2626;
  --color-soft-red:   #fee2e2;
```

Mehr wird der Palette nicht hinzugefügt.

### 3.3 Farbdisziplin

- **Der Primärknopf ist schwarz** (`--color-primary-action-fill`), nicht blau.
  Genau einer je Ansicht. Das ist die Dub-Regel und sie bleibt.
- **Electric Blue ist Akzent, keine Fläche.** Links, aktive Navigation,
  hervorgehobene Kennzahlen, Icon-Akzente. Nie als Hintergrund großer Bereiche.
- **Deep Sapphire wird in der Anwendung nicht benutzt.** Es ist reserviert für
  eine spätere Marketingseite, auf der ein farbiger Primärknopf sinnvoll wird.
- **Ein Element, ein Akzent.** Eine Plakette, ein Chip, eine Kachel trägt genau
  eine Akzentfarbe. Nie zwei.
- **Tönungen nur auf Plaketten.** `--color-soft-*` gehört auf Badges und kleine
  Hervorhebungen, nie auf Karten, Abschnitte oder Seitenflächen.

### 3.4 Die wichtigste Regel: Rot ist rationiert

Aus Leitsatz 1.6.4 der Spezifikation folgt unmittelbar:

- **`disputed` ist Tangerine, nicht Rot.** „Zwei Angaben" ist ein Sachverhalt,
  kein Alarm. Wer hier rot färbt, macht aus einer Terminabweichung einen Streit.
- **`verschoben` ist Tangerine, nicht Rot.** Verschiebungen sind der Normalfall
  auf jeder Baustelle.
- **Rot erscheint an genau zwei Stellen:** eine Entscheidungsfrist ist
  überschritten, oder ein Mangel der Schwere `wesentlich` ist offen. Sonst nie.

Wenn ein Bildschirm rot zeigt, muss der Nutzer sofort verstehen: *hier muss ich
heute etwas tun.* Diese Bedeutung geht verloren, sobald Rot einmal dekorativ
eingesetzt wird.

### 3.5 Bedeutungszuordnung

Vier Akzente, vier Bedeutungen. Keine Überschneidung, keine Ausnahme.

| Akzent | Steht für | Wo |
|---|---|---|
| **Electric Blue** `#2563eb` | Termine und Plan | aktive Navigation, Links, Kennzahlen, „Vom GU genannt" |
| **Vivid Green** `#16a34a` | Einigkeit und Fertigstellung | „Abgestimmt am …", `fertig`, `abgenommen`, erfüllter Fotoauftrag |
| **Tangerine** `#ea580c` | Kümmer dich drum | offene Entscheidungen, laufende Fristen, „Zwei Angaben", Verschiebungen |
| **Lavender** `#7c3aed` | Wissen und Dokumentation | Lotsenkarten, Fotoaufträge, Checklisten, Quellen |
| Alarm Red `#dc2626` | heute handeln | überfällige Frist, offener wesentlicher Mangel |

### 3.6 Semantische Aliase

Komponenten benutzen **ausschließlich** diese Namen, nie die Rohfarben:

```css
  --action-fill:        var(--color-primary-action-fill);
  --action-fill-text:   var(--color-canvas-white);
  --action-outline-bg:  var(--color-canvas-white);
  --action-outline-fg:  var(--color-charcoal);

  --text-primary:   var(--color-charcoal);
  --text-secondary: var(--color-steel);
  --text-muted:     var(--color-fog);
  --border-default: var(--color-ash);
  --border-strong:  var(--color-smoke);

  /* Bestätigungsgrad, Abschnitt 3.4 der Spezifikation */
  --status-self-fg:         var(--color-steel);
  --status-self-bg:         var(--color-paper-mist);
  --status-counterparty-fg: var(--color-electric-blue);
  --status-counterparty-bg: var(--color-soft-blue);
  --status-mutual-fg:       var(--color-vivid-green);
  --status-mutual-bg:       var(--color-soft-mint);
  --status-disputed-fg:     var(--color-tangerine);
  --status-disputed-bg:     var(--color-soft-amber);

  --due-open:     var(--color-tangerine);
  --due-overdue:  var(--color-alarm-red);
  --knowledge:    var(--color-lavender);

  /* Terminplan */
  --track-baseline: var(--color-smoke);        /* blasse Baseline-Spur     */
  --track-actual:   var(--color-electric-blue);/* Ist-Stand                */
  --track-wait:     var(--color-silver);       /* technologische Wartezeit */
  --track-critical: var(--color-tangerine);    /* kritischer Pfad          */
```

Der kritische Pfad ist **Tangerine, nicht Rot**. Er ist eine Eigenschaft des
Plans, kein Problem.

### 3.7 Gewerke und Bauphasen

Gewerke bekommen keine eigenen Farben — bei 20 Gewerken entsteht sonst ein
Farbkasten. Stattdessen neutrale Fläche plus **Kürzel** in `--text-body` /
Gewicht 500 / `--color-steel`: `ELE`, `SHK`, `MAL`.

Bauphasen tragen ebenfalls keine Farbe, sondern **Position**. Die Phasenleiste
zeigt Fortschritt über gefüllte und offene Punkte in `--color-charcoal` und
`--color-ash`; die laufende Phase ist der einzige blaue Punkt.

---

## 4. Typografie

Drei Schriften, drei klar getrennte Aufgaben. Die Grenze zwischen Satoshi und
Inter liegt bei 30 px und wird nicht überschritten.

```css
  --font-satoshi:    'Satoshi', ui-sans-serif, system-ui, -apple-system,
                     BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-inter:      'Inter', ui-sans-serif, system-ui, -apple-system,
                     BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-geist-mono: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo,
                     Monaco, Consolas, monospace;
```

### 4.1 Satoshi — nur Anzeige

Gewicht **500**, Größen **36 / 40 / 48 px**, Zeilenhöhe 1.0–1.11. Ausschließlich
für Anzeigenüberschriften: Onboarding-Fragen, Titel der Bauakte, Kopf des
Wochenberichts. Gewicht 500 statt 700 ist die Signatur — die Überschrift wirkt
sicher, ohne zu schreien.

**Satoshi wird nie unter 36 px eingesetzt.** Ist Satoshi nicht verfügbar: Inter
Gewicht 500 mit `letter-spacing: -0.02em`.

Bezug: Fontshare (kostenfrei auch kommerziell), selbst gehostet als woff2. Kein
Fremd-CDN.

### 4.2 Inter — alles bis 30 px

Das Arbeitspferd. Gewicht 400 für Fließtext, 500 für Betonung und
Knopfbeschriftungen, 600 für wichtige Oberflächenbeschriftungen.

| Rolle | Größe | Zeilenhöhe | Token |
|---|---|---|---|
| `caption` | 11 px | 1.5 | `--text-caption` |
| `body` | 14 px | 1.43 | `--text-body` |
| `body-lg` | 16 px | 1.5 | `--text-body-lg` |
| `body-xl` | 18 px | 1.56 | `--text-body-xl` |
| `subheading` | 20 px | 1.4 | `--text-subheading` |
| `heading-sm` | 24 px | 1.33 | `--text-heading-sm` |
| `heading` | 30 px | 1.38 | `--text-heading` |
| `heading-lg` | 36 px | 1.11 | `--text-heading-lg` (Satoshi) |
| `display` | 48 px | 1.0 | `--text-display` (Satoshi) |

**16 px ist die kanonische Fließtextgröße.** 14 px für dichte Daten — Vorgangs-
listen, Tabellen. 11–12 px für Mikrobeschriftungen. Auf der Baustelle in der
Sonne gilt die Untergrenze 14 px für alles, was gelesen werden muss.

### 4.3 Geist Mono

Ausschließlich für Prüfsummen der Tagebuchkette, Hashes, Token-Kennungen und
technische Metadaten. 12–14 px, 24 px in der Bauakte. **Nie für Zahlen im
Fließtext, nie für Datumsangaben.**

### 4.4 Zahlen

**Tabellenziffern überall, ausnahmslos:**

```css
font-variant-numeric: tabular-nums;
```

In einem Terminplan stehen Daten, Dauern und Puffer untereinander. Proportionale
Ziffern lassen die Spalten zappeln, und zappelnde Zahlen wirken unzuverlässig.
Das gilt auch für Fließtext mit Datumsangaben.

### 4.5 Zeilenlänge

Lesetext maximal 68 Zeichen. Oberflächentext in Listen darf breiter laufen, weil
er gescannt und nicht gelesen wird.

---

## 5. Raster, Abstand, Form

### 5.1 Abstand

Grundeinheit 4 px, Dichte **kompakt**. Andere Werte gibt es nicht.

```
4  8  12  16  20  24  28  32  36  40  48  56  64  80  96  112
```

| Zweck | Wert |
|---|---|
| Abstand zwischen Elementen | 8 |
| Karteninnenabstand | 16 |
| Zwischen Karten | 8 |
| Zwischen Abschnitten | 64 |
| Seitenrand mobil | 16 |
| Seitenrand ab 768 px | 24 |
| Maximale Seitenbreite | 1200 px |

### 5.2 Radien

Drei Stufen, streng eingehalten. Werte außerhalb dieser Liste gibt es nicht.

| Element | Wert |
|---|---|
| Plaketten, Chips, Statuspunkte | `9999px` |
| Eingabefelder | `6px` |
| Knöpfe | `8px` |
| Karten, Listenzeilen | `12px` |
| Große Karten, Blätter, Dialoge | `16px` |

### 5.3 Kanten statt Schatten

Das ist der Kern des Systems und die häufigste Stelle, an der es verwässert wird.

**Der Standardbehälter ist eine weiße Fläche mit `1px solid var(--color-ash)` und
12 px Radius. Kein Schatten.** Struktur entsteht aus Linie und Abstand.

Schatten sind auf drei Fälle beschränkt:

| Fall | Wert |
|---|---|
| Primärknopf, minimale Anhebung | `rgba(0,0,0,0.05) 0px 1px 2px 0px` |
| Hervorgehobene Karte, Produktrahmen | `rgba(0,0,0,0.1) 0px 0px 0px 4px` |
| Blatt, Dialog, Popover über Inhalt | `rgba(0,0,0,0.1) 0px 10px 15px -3px, rgba(0,0,0,0.1) 0px 4px 6px -4px` |

Es gibt keine vierte Stufe. Wer eine braucht, hat ein Layoutproblem.

### 5.4 Trennung

Erst Abstand, dann Fläche (`--color-paper-mist`), zuletzt Linie. Wo Linien nötig
sind: 1 px `--color-ash`, nie doppelt — keine Linie unter der letzten Zeile
einer Liste, wenn direkt darunter schon eine Kartenkante sitzt.

---

## 6. Bedienbarkeit auf der Baustelle

Hier weicht MeinBaulotse **bewusst** von der kompakten Dichte der Referenz ab.
Die Spezifikation verlangt in Abschnitt 5.4 Bedienung mit Handschuhen, und eine
28 px hohe Schaltfläche ist mit Arbeitshandschuh nicht treffbar.

| Kontext | Regel |
|---|---|
| Dichte Datenansichten am Rechner | kompakte Dub-Dichte, 8 px Abstände, 14 px Text |
| Alles Bedienbare, überall | mindestens **44 × 44 px** Trefferfläche |
| Feldaktionen (Erfassen, Bestätigen, Melden) | **56 px** Höhe |
| Auslöser der Schnellerfassung | **64 px** |

Die Trefferfläche darf über den sichtbaren Rand hinausgehen — ein 32 px hoher
Chip mit 44 px Trefferfläche erfüllt die Regel und bleibt optisch kompakt.

---

## 7. Bewegung

Bewegung erklärt Herkunft und Ziel. Sie dekoriert nicht.

| Dauer | Token | Wofür |
|---|---|---|
| 150 ms | `--motion-micro` | Zustandswechsel: Druck, Haken, Chip |
| 220 ms | `--motion-transition` | Einblenden, Ausklappen, Listenwechsel |
| 300 ms | `--motion-page` | Ansichtswechsel, Blatt von unten |

```css
--ease-standard: cubic-bezier(0.22, 1, 0.36, 1);
--ease-exit:     cubic-bezier(0.4, 0, 1, 1);
```

**Regeln:**

- Eintretende Elemente sind schneller am Ziel als austretende.
- Gedrückte Bedienelemente skalieren auf `0.98`. Kein Aufleuchten, kein
  Wellenkreis.
- Das **Verschieben eines Vorgangs** wird animiert: Der Balken wandert von der
  alten auf die neue Position, die Baseline bleibt blass stehen. Das ist die
  einzige Stelle, an der Bewegung Information trägt.
- Zahlen zählen nicht hoch. Sie wechseln hart. Hochzählende Zahlen sind
  Effekthascherei und erschweren das Ablesen.

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Information darf nie ausschließlich in der Animation stecken.

---

## 8. Ikonografie

- **Eine Familie: Lucide.** Keine Mischung mit anderen Sets, nie. Keine
  gefüllten und konturierten Icons nebeneinander.
- 16 px in dichten Zeilen, 20 px als Standard, 24 px in Kopfbereichen.
  Strichstärke 1.75.
- Icon-Striche in `--color-graphite`, im Akzentfall in der zugehörigen
  Akzentfarbe aus 3.5.
- Icons stehen **nie allein**, wenn sie eine Aktion auslösen — Beschriftung oder
  mindestens `aria-label`.
- **Emoji sind keine Ikonografie.** Nicht in der Oberfläche, nicht im
  Wochenbericht, nicht in Zustandsmeldungen. Die farbigen Glyphen der Referenz
  werden hier als Lucide-Icons in Akzentfarbe umgesetzt.
- Zustände nie allein über Farbe: Punkt plus Text, oder Icon plus Text.

---

## 9. Komponenten

### 9.1 Knöpfe

| Variante | Fläche | Rand | Schrift | Wofür |
|---|---|---|---|---|
| `primary` | `#0a0a0a` | – | weiß, Inter 500 | genau **eine** je Ansicht |
| `outline` | weiß | 1 px `--color-ash` | `--color-charcoal`, Inter 500 | das Arbeitspferd |
| `ghost` | transparent | – | `--color-charcoal` | Navigation, tertiäre Aktionen |
| `danger` | weiß | 1 px `--color-alarm-red` | `--color-alarm-red` | Zurückziehen, Löschen — selten |

Radius 8 px, Polsterung 12 px vertikal / 16 px horizontal. Feldaktionen 56 px
hoch (Abschnitt 6). Primärknopf trägt `--shadow-subtle`, sonst kein Schatten.

Fokus: `rgba(0,0,0,0.1) 0px 0px 0px 4px` als Ring. Nie `outline: none` ohne Ersatz.

### 9.2 Eingabefeld

Weiße Fläche, **1 px `#000000`** Rand — die Signatur der Referenz: Felder wirken
wichtig, nicht optional. Radius 6 px, Polsterung 8 px / 12 px, Text 16 px
(kleiner löst auf iOS ungewolltes Zoomen aus).

Beschriftung **über** dem Feld, nie als Platzhalter — Platzhalter verschwinden
beim Tippen, und dann weiß niemand mehr, was er eingibt. Hilfetext darunter in
`--text-caption` / `--color-steel`. Fehlertext ersetzt den Hilfetext, in
`--color-alarm-red`, und benennt **immer** die Abhilfe.

### 9.3 Karte

Weiß, 1 px `--color-ash`, Radius 12 px, Polsterung 16 px, **kein Schatten**.
Große Flächen und Blätter: Radius 16 px. Eingebettete Nebenflächen:
`--color-paper-mist`, Radius 16 px, ohne Rand.

### 9.4 Plakette: Bestätigungsgrad

Die vier Grade aus Abschnitt 3.4 der Spezifikation. Pillenform (9999 px),
6 px / 10 px Polsterung, Punkt plus Text — nie nur Farbe:

| Wert | Punkt | Fläche | Text im Produkt |
|---|---|---|---|
| `self_stated` | offener Ring, `--color-steel` | `--color-paper-mist` | „Von dir eingetragen" |
| `counterparty_stated` | offener Ring, `--color-electric-blue` | `--color-soft-blue` | „Vom GU genannt" |
| `mutual` | gefüllt, `--color-vivid-green` | `--color-soft-mint` | „Abgestimmt am 12.05." |
| `disputed` | halb gefüllt, `--color-tangerine` | `--color-soft-amber` | „Zwei Angaben" |

Der **gefüllte** Punkt bedeutet: beide Seiten sind sich einig. Diese Füllung ist
die eigentliche Information — sie funktioniert auch in Graustufen, etwa im
gedruckten PDF der Bauakte.

### 9.5 Merkmalspille

Das Signaturelement der Referenz, hier für die vier Bedeutungsbereiche aus 3.5:
weiße oder transparente Fläche, Pillenform, Lucide-Icon in der Akzentfarbe,
Beschriftung 14 px Inter 500 in `--color-charcoal`, kein Rand.

Im Cockpit tragen die vier Abschnitte je eine solche Pille: *Diese Woche* (blau),
*Du musst entscheiden* (tangerine), *Jetzt fotografieren* (lavender),
*Verschoben* (tangerine).

### 9.6 Phasenleiste

```
●───●───●───●───◉───○───○───○───○
Phase 5 von 9 · Ausbau
```

Erledigte Phasen gefüllt in `--color-charcoal`, die laufende als blauer Ring mit
Kern, kommende offen in `--color-ash`. Auf schmalen Geräten schrumpft die Leiste
auf drei Phasen um die aktuelle plus Zähler.

Sie ist **kein Fortschrittsbalken in Prozent** — Prozentangaben zum Baufortschritt
sind eine Behauptung, die niemand belegen kann.

### 9.7 Vorgangszeile

Tabellenzeile nach Referenz: transparente Fläche, 1 px `--color-ash` unten,
großzügige Polsterung, 14 px Text. Sie trägt: Datumsspanne (tabellarisch),
Vorgangsname, Gewerkekürzel, Statuspunkt, Bestätigungsgrad, Puffer im Klartext.

Wartezeiten (`is_wait`) bekommen eine eigene Darstellung: gestrichelte Kontur,
`--track-wait`, und den Zusatz **„Trocknung — nicht verkürzbar"**. Der Nutzer
soll sofort verstehen, dass dieser Zeitraum nicht verhandelbar ist.

Puffer wird nie als Zahl allein gezeigt, sondern als Satz:

> „Darf sich um 12 Werktage verschieben, ohne dass der Endtermin kippt."
> „Kein Puffer. Jeder Tag Verzug ist ein Tag später fertig."

### 9.8 Zeitachse (ab 768 px)

Je Vorgang zwei Spuren: **Baseline blass darüber** (`--track-baseline`),
**Ist-Stand darunter** (`--track-actual`). Der Zwischenraum *ist* die
Verschiebung — er muss nicht beschriftet werden, man sieht ihn. Der kritische
Pfad bekommt eine Tangerine-Kante links, kein rotes Feld. Entscheidungsfristen
sitzen als Rauten **vor** dem zugehörigen Vorgang auf der Achse; ihre Linie zum
Vorgang zeigt, warum sie dort liegen.

### 9.9 Lotsenkarte

Vollbildblatt, Radius 16 px, von unten einfahrend. Inter 16 px / 1.5 im
Fließtext, maximal 68 Zeichen breit. Zwischenüberschriften 20 px Inter 600.
Lavender als Akzent des Blattes: Icon in der Kopfzeile, Quellenmarke am Fuß.

Die Fragen an den GU stehen in einem eingebetteten Block
(`--color-paper-mist`, Radius 16 px, ohne Rand) mit Kopieren-Knopf je Frage —
sie sollen direkt in eine Nachricht wandern.

Quellenangaben stehen am Fuß in `--text-caption`, nicht hinter einem Aufklapper.
Die Herkunft einer Aussage ist Teil der Aussage.

Fußzeile: „War das hilfreich?" mit zwei `outline`-Knöpfen. Keine Sterne, keine
Skala von eins bis fünf.

### 9.10 Leere Zustände

Kein Bild, keine Illustration, kein aufmunternder Spruch. Ein Satz, der sagt, was
hier stehen wird, und eine Aktion, die dorthin führt.

> „Noch keine Verschiebungen. Wenn sich ein Termin ändert, steht er hier —
> mit Grund und Auswirkung auf den Endtermin."

---

## 10. Layout

### 10.1 Grundgerüst

Zentriert, maximal 1200 px. Am Rechner das klassische Zwei-Spalten-Gerüst der
Referenz: feste Seitenleiste (240 px) plus Inhaltsbereich. Aktive
Navigationseinträge tragen eine weiche blaue Fläche (`--color-soft-blue`,
Radius 8 px), keine dicke Randmarke.

Mobil ist die Liste die Grundansicht, nicht die Zeitachse. Alles Wichtige liegt
im unteren Bildschirmdrittel in Daumenreichweite; die Kopfzeile trägt
Information, keine Bedienung.

### 10.2 Reihenfolge im Cockpit

Sie ist inhaltlich begründet und **nicht verhandelbar** (Abschnitt 5.1 der
Spezifikation):

1. Wo stehen wir — Phase, geschuldetes und errechnetes Ende
2. Was kommt — diese Woche auf der Baustelle
3. Was **du** tun musst — Entscheidungen, Fotoaufträge
4. Was sich geändert hat — Verschiebungen

Schlechte Nachrichten stehen unten. Nicht um sie zu verstecken, sondern weil ein
Bauherr, der die App öffnet, zuerst Orientierung braucht und nicht Schreck.

### 10.3 Textur

Der feine Punkteraster der Referenz — sehr geringe Deckkraft, kleine Punkte —
darf als Hintergrund von Onboarding und leeren Zuständen eingesetzt werden. Er
bleibt außerhalb datenführender Ansichten; hinter einem Terminplan stört er.

### 10.4 Bildmaterial

Produktoberfläche statt Lebensgefühl. Keine Fotografie, keine Illustration, kein
3D. Die einzigen Bilder in der Anwendung sind die Fotos des Bauherrn selbst —
und die stehen in einem weißen Rahmen mit 12 px Radius und 1 px `--color-ash`,
wie jede andere Karte auch.

---

## 11. Tonalität

### 11.1 Grundhaltung

- **Du**, durchgehend. Kein „Sie", kein unpersönliches Passiv.
- Kurze Sätze. Ein Gedanke je Satz.
- Keine Ausrufezeichen. Nirgends.
- Keine Fachbegriffe ohne Erklärung beim ersten Auftreten — „Belegreife" ist für
  einen Estrichleger selbstverständlich und für einen Bauherren nicht.
- Nie beschuldigend. Nicht „der GU hat versäumt", sondern „der Termin wurde
  bisher nicht bestätigt".

### 11.2 Wortliste

| Nicht | Sondern |
|---|---|
| quittiert, gegengezeichnet | abgestimmt |
| strittig, Konflikt, Widerspruch | zwei Angaben |
| Fehler, fehlgeschlagen | Das hat nicht geklappt |
| Warnung, Achtung | (weglassen, direkt die Sache benennen) |
| Sie müssen | Du kannst / Als Nächstes |
| Beweisakte, Beweissicherung | Bauakte |
| überfällig seit 3 Tagen | seit 3 Werktagen offen |
| Verzug (in der Oberfläche) | später als geplant |
| Verzug (im Vertragsspiegel) | Verzug — dort ist es der Rechtsbegriff |

Der letzte Punkt ist wichtig: In rechtlichen Zusammenhängen wird der Fachbegriff
benutzt, weil Weichzeichnen dort schadet. In der Oberfläche wird die Sache
beschrieben.

### 11.3 Rechtshinweise

Jeder Hinweis nach Abschnitt 3.9 der Spezifikation trägt unverändert und sichtbar
den Zusatz:

> *Hinweis auf eine Gesetzesstelle, keine Rechtsberatung.*

Er wird nie verkürzt, nie ausgeblendet, nie hinter einen Aufklapper gelegt.

### 11.4 Jede schlechte Nachricht trägt einen nächsten Schritt

Kein Hinweis auf ein Problem ohne Angebot einer Handlung — auch wenn die Handlung
nur „Ansehen" heißt. Ein Zustand, den der Nutzer zur Kenntnis nehmen soll, aber
nicht ändern kann, wird als Sachverhalt formuliert, nicht als Warnung.

### 11.5 Datums- und Zahlenformate

| Fall | Format |
|---|---|
| Datum im laufenden Jahr | `12.05.` |
| Datum mit Jahr | `12.05.2026` |
| Datum mit Wochentag | `Di 12.05.` |
| Spanne | `12.–21.05.` |
| Arbeitsdauer | `8 Werktage` |
| Wartezeit | `35 Kalendertage` |
| Geld | `12.500 €` — keine Nachkommastellen, außer sie stehen im Vertrag |

**Werktage und Kalendertage werden nie vermischt und nie abgekürzt.** Der
Unterschied ist für den Bauherren der Unterschied zwischen fünf und sieben Wochen.

---

## 12. Barrierefreiheit

- Kontrast **WCAG AA**: 4.5:1 für Fließtext, 3:1 für Text ab 24 px und für
  Bedienelementgrenzen. Ein Prüfskript validiert die Tokens; es läuft in der
  Pipeline mit.
  **Zu beachten:** `--color-fog` `#737373` erreicht auf Weiß 4.6:1 und ist damit
  die hellste zulässige Textfarbe. `--color-silver` `#a3a3a3` erreicht 2.6:1 und
  ist **keine Textfarbe** — nur Striche und Trenner.
- Tippflächen mindestens 44 × 44 px, Feldaktionen 56 px (Abschnitt 6).
- Sichtbarer Fokus auf allem Bedienbaren. Tastaturbedienung vollständig.
- Zustände nie allein über Farbe (Abschnitte 8 und 9.4).
- Bewegung respektiert `prefers-reduced-motion`.
- Schriftgrößen in `rem`; die Pixelangaben dieses Dokuments sind die
  Bezugsgrößen bei 16 px Wurzelgröße. Layouts dürfen bei 200 % Textgröße nicht
  brechen.
- Sprache: `lang="de"`. Die Gastseiten setzen die Sprache des Empfängers
  (de, pl, ro, tr, en).

---

## 13. PWA

- `viewport-fit=cover`, Layout respektiert `env(safe-area-inset-*)`.
- `theme-color`: `#ffffff`.
- Startbildschirm: Toppzeichen weiß auf `--color-midnight-ink`, ohne Text.
- Der Installationshinweis erscheint **nicht** beim ersten Öffnen, sondern nach
  dem ersten erfolgreichen Erfassen — dann ist der Nutzen belegt.
- Offline: Was aus dem Zwischenspeicher stammt, wird als solches gekennzeichnet.
  Was in der Warteschlange liegt, zeigt „wird gesendet, sobald du wieder Netz
  hast" — nie einen Fehler.

---

## 14. Was ausdrücklich nicht gemacht wird

- **Keine schweren Schlagschatten zur Kartenanhebung.** Container definieren sich
  über 1 px `--color-ash`, nicht über Tiefe.
- **Kein reines Schwarz `#000000` im Fließtext.** Text ist `#171717` oder
  `#0a0a0a`. Reines Schwarz gehört auf Primärknopf und Feldrand.
- **Electric Blue nie als große Hintergrundfläche.**
- **Nie zwei Akzentfarben auf einem Element.**
- **Satoshi nie unter 36 px, Inter nie über 30 px.**
- **Keine Radien außerhalb von 6, 8, 12, 16, 9999.**
- **Der konische Verlauf gehört zur Marke, nie auf Bedienelemente.** In der
  Anwendung kommt er nicht vor.
- **Keine Emoji**, keine Illustrationen in leeren Zuständen, keine Konfetti,
  keine hochzählenden Zahlen.
- **Keine Fortschrittsangaben in Prozent** zum Baufortschritt.
- **Keine Komponentenbibliothek von der Stange** als sichtbare Optik. Radix
  liefert Verhalten und Zugänglichkeit; das Aussehen kommt aus diesem Dokument.
- **Kein Rot außerhalb der zwei in 3.4 genannten Fälle.**

---

## 15. Umsetzung im Code

Die Tokens liegen als CSS-Variablen in `apps/web/src/styles/tokens.css` und
werden über Tailwinds `@theme` verfügbar gemacht. **Dieses Dokument ist die
Quelle**; die CSS-Datei folgt ihm, nicht umgekehrt.

Schriften werden selbst gehostet, kein Fremd-CDN: Inter und Geist Mono über
`@fontsource-variable`, Satoshi als woff2 von Fontshare.

Die Route `/styleguide` in der Anwendung rendert jedes Element dieses Dokuments.
Sie ist die lebende Gegenprobe: Was hier steht und dort nicht erscheint, ist
nicht umgesetzt.

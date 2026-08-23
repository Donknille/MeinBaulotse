# Datenschutz: wer was verarbeitet

Abschnitt 6.5 der Spezifikation verlangt, „Auftragsverarbeitungsverhältnisse
zu dokumentieren, KI-Anbieter eingeschlossen". Das ist diese Datei.

Sie ist keine Datenschutzerklärung — die schreibt, wer das Produkt betreibt,
für seine Nutzer. Sie ist die Grundlage dafür: eine ehrliche Liste, welche
Daten dieses Produkt an wen gibt und warum. Wer sie führt, kann eine
Datenschutzerklärung schreiben. Wer sie nicht führt, schreibt eine, die nicht
stimmt.

## Was überhaupt anfällt

| Art | Beispiel | Woher |
|---|---|---|
| Bestandsdaten | Name, E-Mail-Adresse, Firma | Anmeldung und Einladung |
| Bauvorhaben | Adresse, Bundesland, Vertragsdaten, Termine | Onboarding und Nutzung |
| Beteiligte | Handwerker, Bauleiter, Sachverständige | vom Bauherrn eingetragen |
| Bautagebuch | Text, Datum, Verfasser | Erfassung |
| Fotos | Baustellenbilder samt Aufnahmezeit und ggf. Ort | Erfassung |
| Mängel und Geld | Beschreibungen, Beträge, Fristen | Nutzung |
| Gesprächsverlauf | Fragen an den Lotsen und dessen Antworten | „Frag den Lotsen" |

**Auf Baustellenfotos sind oft Menschen zu sehen**, die dem nicht zugestimmt
haben. Deshalb weist die Erfassung beim ersten Foto darauf hin und bietet an,
Gesichter zu verpixeln — im Browser, bevor das Bild irgendwohin geht. Siehe
`docs/SETUP.md`, Abschnitt 4a.

## An wen etwas geht

| Empfänger | Wofür | Was | Wo verarbeitet |
|---|---|---|---|
| **Supabase** | Datenbank, Anmeldung, Ablage | alles außer dem Gesprächsverlauf mit dem Modell | Projektregion, für die EU wählbar |
| **Vercel** | Auslieferung von Web und API | Anfragedaten, keine dauerhafte Speicherung | Regionen wählbar |
| **Anthropic** | „Frag den Lotsen" | die Frage und der Projektkontext dazu — siehe unten | nach Vertrag mit dem Anbieter |
| **E-Mail-Anbieter** | Wochenbericht, Abstimmungslinks | Adresse und Inhalt der Nachricht | anbieterabhängig, EU-Verarbeitung wählen |

Mit jedem dieser Empfänger braucht der Betreiber einen Vertrag zur
Auftragsverarbeitung nach Art. 28 DSGVO. Alle vier bieten einen an.

### Was der Lotse zu sehen bekommt

Das ist die Stelle, an der die meisten Produkte ungenau werden, deshalb hier
genau:

- Ausschließlich Daten **des angefragten Bauvorhabens**, gelesen unter den
  Rechten des Fragenden — dieselbe Transaktion, dieselben Policies wie jede
  andere Abfrage. Es gibt keinen Pfad, auf dem der Assistent mehr sähe.
- Konkret: Projektstammdaten, laufende und kommende Vorgänge, offene
  Entscheidungen, Terminänderungen der letzten Wochen, Tagebucheinträge der
  letzten sechs Wochen und die Lotsenkarten zu den Vorgängen im Blick.
- **Keine Fotos.** Der Assistent bekommt Text.
- Der Client steuert nichts davon. Die Anfrage trägt eine Frage und sonst
  nichts, auch das heutige Datum kommt vom Server (Abschnitt 6.4).

Wer den Assistenten nicht will, lässt `ANTHROPIC_API_KEY` leer. Dann gibt es
ihn nicht, und die Anwendung sagt das offen.

### Was Gäste zu sehen bekommen

Ein Abstimmungslink zeigt genau den Ausschnitt, der zur Rolle gehört — ein
Einzelgewerk sieht nur seine eigenen Vorgänge. Das ist keine Höflichkeit der
Oberfläche, sondern dieselbe RLS, die auch die App bindet. In der Datenbank
liegt vom Token nur der Hash.

## Wie lange

| Was | Wie lange | Warum |
|---|---|---|
| Bauvorhaben mit allem daran | bis zur Löschung durch den Bauherrn | es sind seine Daten |
| Empfohlen | bis fünf Jahre nach der Abnahme | Gewährleistung, § 634a Abs. 1 Nr. 2 BGB |
| Abstimmungslinks | 180 Tage, jederzeit sperrbar | |
| Gesprächsverlauf mit dem Lotsen | mit dem Bauvorhaben | append-only, damit nachlesbar bleibt, worauf sich jemand verlassen hat |

Die Löschung ist Selbstbedienung und in `docs/BETRIEB.md` beschrieben:
beantragen, dreißig Tage Frist, dann entfernt der Betreiber. Nach der
Aufbewahrungsfrist wird **erinnert und nicht still gelöscht** — der
Wochenbericht sagt es, sobald fünf Jahre seit der Abnahme vergangen sind.

## Die Rechte der Betroffenen

- **Auskunft und Datenübertragbarkeit** (Art. 15, 20 DSGVO): Der vollständige
  Export steht in der Anwendung unter *Bauakte → Alle Daten als Datei*.
- **Löschung** (Art. 17): ebenfalls in der Anwendung, siehe oben.
- **Berichtigung** (Art. 16): Was änderbar ist, ist in der Anwendung änderbar.
  Was versiegelt ist — Tagebuch nach 24 Stunden, Historie, Rückmeldungen zu
  Terminen —, wird **richtiggestellt statt überschrieben**: Ein neuer Eintrag
  korrigiert den alten, und der alte bleibt sichtbar. Das ist kein Versehen,
  sondern der Zweck einer Akte; bei Streit ist gerade die Unveränderlichkeit
  der Wert. Wer ihn nicht will, kann das ganze Bauvorhaben löschen.

## Was hier nicht steht

Diese Datei beschreibt das Produkt, nicht eine bestimmte Installation. Welche
Region ein Supabase-Projekt hat, welcher E-Mail-Anbieter eingerichtet ist und
ob der Assistent überhaupt läuft, entscheidet der Betreiber — und nur er kann
es in seine Datenschutzerklärung schreiben.

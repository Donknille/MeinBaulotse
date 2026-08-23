# Betrieb

Was neben der Anwendung läuft: der Wochenbericht. Einrichtung von Datenbank und
Auslieferung steht in [`SETUP.md`](SETUP.md).

---

## Der Wochenbericht

Montagmorgen, sechs Blöcke, eine Mail je Bauherr. Abschnitt 3.11 der
Spezifikation nennt ihn den Retention-Anker, und das ist keine Übertreibung:
Eine Anwendung, die man aufsuchen muss, wird nicht aufgesucht. Ein Bauherr
öffnet seinen Terminplan nicht jeden Montag von selbst — aber er liest eine
Mail, in der steht, was diese Woche passiert und was er dafür tun muss.

```bash
pnpm report:weekly                 # Probelauf: zeigt, was hinausginge
pnpm report:weekly --send          # verschickt
pnpm report:weekly --today=2026-06-01   # für einen bestimmten Montag
```

Ohne `--send` wird nichts verschickt. Das ist die Voreinstellung, weil ein
Werkzeug, das beim ersten Ausprobieren Mails an echte Menschen schickt, ein
schlechtes Werkzeug ist.

### Was der Lauf voraussetzt

| Variable | Wofür |
|---|---|
| `DATABASE_URL` | dieselbe Verbindung wie die Anwendung |
| `MAIL_API_URL` | HTTP-Schnittstelle des Mailanbieters |
| `MAIL_API_KEY` | dessen Schlüssel, als `Authorization: Bearer` |
| `MAIL_FROM` | Absenderadresse |

Der Körper folgt der Form, die gängige Anbieter verlangen:

```json
{ "from": "…", "to": ["…"], "subject": "…", "text": "…", "html": "…" }
```

Bewusst ohne Bibliothek und ohne festen Anbieter. Wer einen anderen nimmt,
ändert eine Umgebungsvariable statt einer Abhängigkeit — und die
Vercel-Function bleibt frei von Mailcode, den sie nie braucht.

**Zur Auswahl des Anbieters:** Abschnitt 6.1 der Spezifikation verlangt
Verarbeitung in der EU. Das ist eine Frage der Auswahl, nicht des Codes.

### Warum das ein Skript ist und keine Route

Regel 1 des Projekts: Der Anwendungscode benutzt niemals eine privilegierte
Rolle. Jeder Zugriff läuft über `withUserTx` und damit durch die RLS.

Ein Versandlauf kann das nicht. Er muss wissen, welche Bauvorhaben es gibt und
wer dazugehört, und dabei ist niemand angemeldet. Deshalb steht er als Skript
neben der Anwendung — wie `reset.ts` und `demo.ts` auch — und im Anfragepfad
bleibt es bei der Regel.

Der Bericht selbst wird trotzdem **unter der Kennung des Empfängers** gebaut:
`withUserTx({ sub: person.userId })`. Wer eine Mail bekommt, sieht darin genau
das, was er auch in der Anwendung sähe. Ein Bericht, der mehr zeigt als die
Rolle, wäre ein Leck mit Zustellung.

### Wer ihn bekommt

`owner` und `co_owner`. Nicht der Generalunternehmer: Der Bericht ist eine
Aufforderung an den Bauherrn („was du entscheiden musst"), keine
Baustellenmeldung. Und nicht `viewer` — stille Mitleser bleiben still.

Ein Bericht ohne Inhalt wird nicht verschickt. Wer jede Woche eine Mail
bekommt, in der nichts steht, hört auf, sie zu öffnen — und öffnet dann auch
die nicht mehr, in der etwas steht.

### Montags um sechs

Der Lauf braucht einen Zeitgeber. Zwei Wege, beide erprobt:

**Ein Server mit cron.** Die geradlinige Variante:

```cron
0 6 * * 1  cd /pfad/zu/meinbaulotse && pnpm report:weekly --send >> /var/log/mbl-report.log 2>&1
```

**GitHub Actions.** Ohne eigenen Server. `DATABASE_URL` und die
`MAIL_*`-Variablen kommen als Repository-Secrets hinein:

```yaml
on:
  schedule:
    - cron: '0 4 * * 1' # 04:00 UTC ≈ 06:00 deutscher Zeit im Sommer
  workflow_dispatch:
```

> **Zur Uhrzeit.** Cron rechnet in UTC, Deutschland wechselt zweimal im Jahr
> die Zonenzeit. Wer `0 4` einträgt, verschickt im Winter um 05:00 statt 06:00.
> Für einen Wochenbericht ist das gleichgültig; wer es genau haben will,
> braucht einen Zeitgeber mit Zonenkenntnis.

**Was nicht geht: Vercel Cron.** Ein Cron-Aufruf trifft dort eine Route, und
eine Route läuft im Anfragepfad. Sie müsste die Bauvorhaben aller Nutzer lesen,
also privilegiert — genau das, was Regel 1 ausschließt. Der Weg über ein
Skript ist deshalb keine Notlösung, sondern die Folge einer Entscheidung.

### Die Ansicht dazu

Denselben Bericht gibt es in der Anwendung unter
`/projekt/<kennung>/wochenbericht`. Er wird dort unter den Rechten des
Fragenden gebaut, wie jede andere Abfrage. Der Weg existiert, weil eine Mail
eine Einbahnstraße ist: Wer sie zwei Wochen später sucht, findet sie nicht
mehr, und wer nie eine bekommen hat, soll trotzdem sehen können, was darin
gestanden hätte.

## Frag den Lotsen

Der Assistent aus Abschnitt 3.7 läuft über die Anthropic-API. Er meldet sich
nur, wenn `ANTHROPIC_API_KEY` gesetzt ist; ohne Schlüssel sagt die Ansicht das
offen und verweist auf die Lotsenkarten. `ANTHROPIC_MODEL` ist optional.

### Was das kostet, und wer es begrenzt

Zwei Riegel, beide in der Datenbank und nicht im Serverprozess — ein Zähler im
Prozess zählt nach dem nächsten Kaltstart wieder von vorn, und auf Vercel ist
der nächste Kaltstart immer gleich:

| Riegel | Wert | Wo |
|---|---|---|
| Fragen je Minute und Bauvorhaben | 6 | `mbl.claim_assistant_turn` |
| Kosten je Bauvorhaben und Monat | 500 Cent | `assistant_budget.spent_cents` |

Der Monatsdeckel füllt sich beim ersten Zug im neuen Monat von selbst wieder
auf. Wer ihn erreicht, bekommt keine Fehlermeldung, sondern eine Aussage über
den Monat — mit dem Verweis auf die Lotsenkarten, die weiterhin bereitstehen.

Fortgeschrieben wird der Verbrauch von einem Trigger auf `assistant_message`,
nicht von einem zweiten Aufruf im Anwendungscode: Ein Aufruf, den der Code
vergessen kann, ist ein Kostendeckel, den er vergessen kann.

Was gerade verbraucht ist, steht in einer Zeile:

```sql
select p.name, b.month, b.spent_cents
  from assistant_budget b join project p on p.id = b.project_id
 order by b.spent_cents desc;
```

### Was in den Kontext geht

Ausschließlich Daten des angefragten Bauvorhabens, gelesen unter den Rechten
des Fragenden — dieselbe Transaktion, dieselben Policies wie jede andere
Abfrage. Es gibt keinen Pfad, auf dem der Assistent mehr sähe als der Mensch,
der ihn fragt.

Der Client schickt eine Frage und sonst nichts. Kein Feld sagt, was in den
Kontext gehört; auch das heutige Datum kommt vom Server. Das ist Abschnitt
6.4 der Spezifikation, und es ist der Grund, warum die Anfrage so karg ist.

### Wenn eine Antwort schlecht war

Gespräche sind append-only. Ein Beitrag lässt sich nicht ändern und nicht
löschen — auch nicht der des Assistenten. Was der Lotse einmal geraten hat,
bleibt nachlesbar, samt der Hinweise, die damals darunterstanden. Genau
danach wird bei Streit gefragt.

Nachlesen lässt sich das so:

```sql
select m.created_at, m.role, left(m.text, 120) as anfang,
       m.guardrails, m.cost_cents
  from assistant_message m
 where m.project_id = '<projekt>'
 order by m.created_at;
```

## Mängel, Zahlungen, Vertragsspiegel

### Die Freigabesperre sitzt in der Datenbank

`mbl.guard_payment_release` ist ein Trigger auf `payment_milestone`. Er lässt
den Wechsel auf `freigegeben` nicht zu, solange `mbl.payment_blockers` etwas
zurückgibt — ein Vorgang, der nicht `fertig` oder `abgenommen` ist, oder ein
offener Mangel mit Schwere `wesentlich` an einem dieser Vorgänge.

Das gilt auch für den Datenbankeigentümer. Wer eine Zahlung von Hand
freischalten muss, hebt zuerst den Grund auf:

```sql
-- Was steht im Weg?
select * from mbl.payment_blockers('<zahlung>');
```

Eine Zahlung, die trotz offener Punkte fließen soll, ist eine **Teilfreigabe**
mit Einbehalt und Grund — dafür ist `teilfreigabe` da, und der Constraint
`payment_withheld_reason` erzwingt die Begründung. Ein Einbehalt ohne Grund
ist im Streit wertlos.

### Der Vertragsspiegel rechnet bei jedem Aufruf neu

`GET /api/v1/projects/:id/contract` wendet die Regeln aus
`apps/api/src/contract-rules.ts` an und schreibt die Befunde in
`contract_check` fort. Was nicht mehr zutrifft, verschwindet; was jemand mit
Begründung beiseitegelegt hat, bleibt beiseitegelegt.

Die Regeln sind reine Rechnung — kein Datenbankzugriff, keine Uhrzeit — und in
`contract-rules.test.ts` bis in jeden Zweig geprüft. Wer eine Regel ergänzt,
ergänzt sie dort und nicht in einer Abfrage.

### Der Verlauf eines Mangels

`defect_event` ist append-only, geschrieben von einem Trigger auf `defect`.
Bei Streit ist nicht der heutige Stand die Frage, sondern wann angezeigt
wurde, welche Frist lief und was die Gegenseite gesagt hat:

```sql
select e.created_at, e.action, e.old_status, e.new_status, e.note
  from defect_event e
 where e.defect_id = '<mangel>'
 order by e.created_at;
```

### Bereitstellungszinsen

Gerechnet wird nach der deutschen Bankmethode 30/360 — nicht die genaueste
Methode, aber die, nach der die Bank abrechnet. Die Zahl soll zur Abrechnung
passen und nicht zum Kalender. Grundlage sind `project.loan_total_cents`,
`commitment_interest_pct`, `commitment_free_months` und die Abrufe in
`loan_drawdown`.

## Die Bauakte

### Warum es keinen PDF-Erzeuger gibt

`GET /api/v1/projects/:id/dossier` liefert die Akte als Daten. Gesetzt wird sie
in `apps/web/src/routes/Dossier.tsx`, gedruckt vom Browser.

Zwei Gründe, und der zweite wiegt schwerer:

1. Eine PDF-Bibliothek in der Vercel-Function wäre ein Vielfaches ihrer
   heutigen Größe, samt eingebetteter Schriften, und lieferte eine schlechtere
   Typografie als der Browser, der die CI-Schriften ohnehin hat.
2. **Fotos gehen nie durch den Anwendungsserver** (Abschnitt 6.1). Ein
   Erzeuger dort müsste jedes Baustellenfoto durch die Function ziehen — genau
   der Weg, den die Spezifikation ausschließt.

Die Druckregeln stehen am Ende von `apps/web/src/styles/base.css`: A4, links
mehr Rand zum Abheften, keine Überschrift allein am Seitenende, Bedienelemente
weg.

### Wer die Akte anlegen darf

`export.run` aus der Rechtematrix: `owner`, `co_owner`, `expert`. Geprüft wird
in `dossier.ts` und nicht nur über die RLS — die begrenzt, **was** jemand
sieht, und ein GU bekäme damit seinen Ausschnitt als Dokument mit Deckblatt
und Prüfsumme. Das ist etwas anderes als eine Bildschirmansicht.

### Der vollständige Datenexport

`GET /api/v1/projects/:id/export` gibt jede Tabelle des Bauvorhabens als JSON,
mit `content-disposition: attachment`. Die Liste der Tabellen steht in
`EXPORT_TABELLEN`; wer eine Tabelle ergänzt, ergänzt sie dort — sonst fehlt
sie still im Export, und das fällt erst auf, wenn jemand sie braucht.

## Datenschutz

Welche Daten anfallen und an wen sie gehen, steht in `docs/DATENSCHUTZ.md` —
samt der Frage, was „Frag den Lotsen" zu sehen bekommt. Wer das Produkt
betreibt, braucht die Datei als Grundlage seiner Datenschutzerklärung und
seiner Verträge nach Art. 28 DSGVO.

## Löschung (Abschnitt 6.5)

Zwei Schritte, und die Trennung ist Absicht.

**Der Bauherr beantragt.** Im Plan ganz unten steht *Dieses Bauvorhaben
löschen*. Er tippt den Projektnamen ab, das Bauvorhaben verschwindet aus
seiner Liste, und dreißig Tage lang kann er es zurückholen. Gelöscht ist bis
dahin nichts.

**Der Betreiber löscht.** Danach, mit einem Werkzeug, das die Anwendung nicht
hat:

```bash
pnpm project:purge              # zeigt nur an, was anliegt
pnpm project:purge --wirklich   # entfernt, was die Frist hinter sich hat
```

Der Grund für die Trennung: Die Anwendungsrolle hat auf `schedule_change`,
`diary_entry`, `task_confirmation`, `defect_event`, `assistant_message` und
`media` **kein** Löschrecht, und Trigger halten zusätzlich dagegen. Das ist
die Grenze, an der es hängen soll — ein Fehler im Anwendungscode kann keine
Akte vernichten.

Das Skript schaltet die Schutztrigger ab, löscht und schaltet sie wieder ein,
alles in **einer** Transaktion. Bricht etwas ab, war nichts.

**Die Fotos gehen nicht mit.** Sie liegen in der Ablage unter
`bauakte/<projektkennung>/` und sind dort zu entfernen — im Supabase-Dashboard
unter *Storage* oder über die Storage-API. Sie wandern nicht automatisch mit,
weil kein Anwendungspfad Dateien löscht: Was einmal in der Bauakte war, soll
nicht durch einen Programmfehler verschwinden können.

**Was der Bauherr vorher mitnehmen sollte:** die Bauakte als PDF und den
vollständigen Datenexport. Beides steht unter *Bauakte*. Die Ansicht sagt es
ihm auch.

Die Gewährleistung läuft fünf Jahre ab Abnahme (§ 634a Abs. 1 Nr. 2 BGB). Ist
das Bauvorhaben abgenommen und liegt die Abnahme weniger als fünf Jahre
zurück, weist die Ansicht darauf hin — als Auskunft, nicht als Sperre. Es sind
seine Daten.

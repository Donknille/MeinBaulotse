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

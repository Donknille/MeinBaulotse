/**
 * Die Montagsmail verschicken.
 *
 * Aufruf: `pnpm report:weekly [--send] [--today=2026-06-01]`
 *
 * **Dies ist ein Betriebswerkzeug, kein Anwendungscode.** Der Unterschied ist
 * wichtig genug, um ihn hier hinzuschreiben:
 *
 * Regel 1 des Projekts lautet, dass der Anwendungscode niemals eine
 * privilegierte Rolle benutzt — jeder Zugriff läuft über `withUserTx` und
 * damit durch die RLS. Ein Versandlauf kann das nicht: Er muss wissen, welche
 * Bauvorhaben es gibt und wer dazugehört, und niemand ist dabei angemeldet.
 *
 * Deshalb steht er hier und nicht in einer Route. Er läuft neben der
 * Anwendung, wie `reset.ts` und `demo.ts` auch, und im Anfragepfad bleibt es
 * bei der Regel. Der Bericht selbst wird trotzdem **unter der Kennung des
 * Empfängers** gebaut: Wer eine Mail bekommt, sieht darin genau das, was er
 * auch in der Anwendung sähe — nicht mehr.
 *
 * Ohne `--send` wird nichts verschickt, sondern ausgegeben. Das ist die
 * Voreinstellung, weil ein Werkzeug, das beim ersten Ausprobieren Mails an
 * echte Menschen schickt, ein schlechtes Werkzeug ist.
 */

import { closePool, withAdminTx, withUserTx } from '@meinbaulotse/db';
import { buildWeeklyReport } from '../src/weekly-report.js';
import { alsHtml, alsText, betreff } from '../src/weekly-report-render.js';

interface Empfaenger {
  projectId: string;
  projectName: string;
  userId: string;
  email: string;
  role: string;
}

const args = process.argv.slice(2);
const senden = args.includes('--send');
const heuteArg = args.find((arg) => arg.startsWith('--today='))?.slice('--today='.length);
const heute =
  heuteArg !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(heuteArg)
    ? heuteArg
    : new Date().toISOString().slice(0, 10);

/**
 * Wer bekommt den Bericht?
 *
 * Bauherr und Partner. Nicht der Generalunternehmer: Der Bericht ist eine
 * Aufforderung an den Bauherrn („was du entscheiden musst"), keine
 * Baustellenmeldung. Und nicht `viewer` — stille Mitleser bleiben still.
 */
async function empfaenger(): Promise<Empfaenger[]> {
  return withAdminTx(async (tx) => {
    const result = await tx.query<Empfaenger>(
      `select m.project_id as "projectId", p.name as "projectName",
              m.user_id as "userId", coalesce(m.email, u.email) as email, m.role::text as role
         from project_member m
         join project p on p.id = m.project_id
         left join auth.users u on u.id = m.user_id
        where m.role in ('owner','co_owner')
          and m.revoked_at is null
          and m.user_id is not null
        order by p.name`,
    );
    return result.rows.filter((row) => row.email !== null && row.email !== '');
  });
}

/**
 * Versand über die HTTP-Schnittstelle eines Mailanbieters.
 *
 * Bewusst ohne Bibliothek und ohne festen Anbieter: `MAIL_API_URL` und
 * `MAIL_API_KEY` zeigen auf den Dienst, der Körper folgt der Form, die
 * gängige Anbieter verlangen. Wer einen anderen nimmt, ändert eine
 * Umgebungsvariable statt einer Abhängigkeit.
 *
 * Abschnitt 6.1 der Spezifikation verlangt einen Anbieter mit Verarbeitung in
 * der EU. Das ist eine Frage der Auswahl, nicht des Codes — hier steht nur
 * die Adresse.
 */
async function verschicken(an: string, subject: string, text: string, html: string): Promise<void> {
  const url = process.env['MAIL_API_URL'];
  const key = process.env['MAIL_API_KEY'];
  const from = process.env['MAIL_FROM'];

  if (url === undefined || key === undefined || from === undefined) {
    throw new Error(
      'Für --send fehlen MAIL_API_URL, MAIL_API_KEY und MAIL_FROM. Siehe docs/BETRIEB.md.',
    );
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ from, to: [an], subject, text, html }),
  });

  if (!response.ok) {
    const grund = await response.text().catch(() => '');
    throw new Error(`Der Mailanbieter hat mit ${response.status} geantwortet. ${grund.slice(0, 200)}`);
  }
}

async function main(): Promise<void> {
  const liste = await empfaenger();
  console.log(
    `Wochenbericht für ${heute}: ${liste.length} ${liste.length === 1 ? 'Empfänger' : 'Empfänger'}` +
      `${senden ? '' : ' (Probelauf, es wird nichts verschickt)'}`,
  );

  let verschickt = 0;
  let leer = 0;

  for (const person of liste) {
    // Unter der Kennung des Empfängers: derselbe Bericht, den er auch in der
    // Anwendung sieht. Damit kann eine Mail nicht mehr zeigen als die Rolle.
    const report = await withUserTx({ sub: person.userId }, (tx) =>
      buildWeeklyReport(tx, person.projectId, heute),
    );

    // Ein Bericht ohne Inhalt wird nicht verschickt. Wer jede Woche eine Mail
    // bekommt, in der nichts steht, hört auf, sie zu öffnen — und öffnet dann
    // auch die, in der etwas steht, nicht mehr.
    const hatInhalt =
      report.thisWeek.length > 0 || report.decisions.length > 0 || report.changes.length > 0;
    if (!hatInhalt) {
      leer += 1;
      console.log(`  ${person.projectName} → ${person.email}: nichts zu berichten, übersprungen`);
      continue;
    }

    const subject = betreff(report);
    if (senden) {
      await verschicken(person.email, subject, alsText(report), alsHtml(report));
      verschickt += 1;
      console.log(`  ${person.projectName} → ${person.email}: verschickt`);
    } else {
      console.log(`\n${'='.repeat(72)}`);
      console.log(`An: ${person.email}   Betreff: ${subject}`);
      console.log('='.repeat(72));
      console.log(alsText(report));
    }
  }

  if (senden) {
    console.log(`\nFertig: ${verschickt} verschickt, ${leer} ohne Inhalt übersprungen.`);
  } else {
    console.log(`\nProbelauf beendet. Mit --send würden ${liste.length - leer} Mails hinausgehen.`);
  }
}

main()
  .then(() => closePool())
  .catch(async (error: unknown) => {
    console.error('\nFehlgeschlagen:', error instanceof Error ? error.message : error);
    await closePool().catch(() => undefined);
    process.exit(1);
  });

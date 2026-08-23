/**
 * Den Wochenbericht in eine Mail gießen.
 *
 * Reine Funktionen: Bericht herein, Text und HTML heraus. Kein Datenbank-,
 * kein Netzzugriff — dadurch lässt sich der Wortlaut prüfen, ohne etwas zu
 * verschicken.
 *
 * Zwei Fassungen, und beide sind vollständig: Wer HTML abschaltet, bekommt
 * denselben Bericht, nicht eine Notlösung. Der Textteil ist die eigentliche
 * Fassung; das HTML folgt ihm.
 *
 * Der Ton kommt aus `meinbaulotse-ci.md`, Abschnitt 11: Du, kurze Sätze, keine
 * Ausrufezeichen, nie beschuldigend, und jede schlechte Nachricht trägt einen
 * nächsten Schritt.
 */

import type { WeeklyReport } from '@meinbaulotse/shared';

/** `12.05.` — im Bericht steht immer das Jahr dazu, er wird auch später gelesen. */
function datum(iso: string | null): string {
  if (iso === null) return '—';
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function spanne(start: string | null, end: string | null): string {
  if (start === null) return '—';
  if (end === null || end === start) return datum(start);
  return `${datum(start)} bis ${datum(end)}`;
}

const REASON_LABEL: Readonly<Record<string, string>> = {
  witterung: 'Witterung',
  lieferzeit: 'Lieferzeit',
  kapazitaet: 'Kapazität beim Gewerk',
  planungsaenderung: 'Planungsänderung',
  bauherren_entscheidung: 'Entscheidung des Bauherrn',
  vorgewerk_verzug: 'Vorgewerk später fertig',
  behoerde: 'Behörde',
  mangelbeseitigung: 'Mängelbeseitigung',
  nachtrag: 'Nachtrag',
  planinitialisierung: 'Plan angelegt',
  sonstiges: 'Sonstiges',
};

export function betreff(report: WeeklyReport): string {
  const dringend = report.decisions.filter(
    (entry) => entry.remainingWorkdays !== null && entry.remainingWorkdays <= 10,
  ).length;

  if (dringend > 0) {
    return `${report.project.name}: ${dringend === 1 ? 'eine Entscheidung' : `${dringend} Entscheidungen`} stehen an`;
  }
  if (report.thisWeek.length > 0) {
    return `${report.project.name}: diese Woche ${report.thisWeek.length === 1 ? 'ein Vorgang' : `${report.thisWeek.length} Vorgänge`}`;
  }
  return `${report.project.name}: die Woche im Überblick`;
}

/** Die Prognose als ein Satz — die Zahl allein sagt einem Laien nichts. */
export function prognoseSatz(report: WeeklyReport): string {
  const { computedEnd, contractualEnd, deviationWorkdays } = report.forecast;
  if (computedEnd === null) return 'Für den Endtermin fehlen noch Termine im Plan.';
  if (contractualEnd === null || deviationWorkdays === null) {
    return `Nach dem heutigen Plan seid ihr am ${datum(computedEnd)} fertig. Sobald der vertraglich geschuldete Termin erfasst ist, rechnen wir die Abweichung dazu.`;
  }
  if (deviationWorkdays === 0) {
    return `Geschuldet ist der ${datum(contractualEnd)}, errechnet der ${datum(computedEnd)}. Das ist genau im Plan.`;
  }
  const tage =
    Math.abs(deviationWorkdays) === 1 ? '1 Werktag' : `${Math.abs(deviationWorkdays)} Werktage`;
  return deviationWorkdays > 0
    ? `Geschuldet ist der ${datum(contractualEnd)}, errechnet der ${datum(computedEnd)} — ${tage} später.`
    : `Geschuldet ist der ${datum(contractualEnd)}, errechnet der ${datum(computedEnd)} — ${tage} früher.`;
}

function fristSatz(remainingWorkdays: number | null): string {
  if (remainingWorkdays === null) return 'ohne Frist';
  if (remainingWorkdays < 0) {
    const tage = Math.abs(remainingWorkdays);
    return `seit ${tage === 1 ? 'einem Werktag' : `${tage} Werktagen`} offen`;
  }
  if (remainingWorkdays === 0) return 'heute ist der letzte Tag';
  return `noch ${remainingWorkdays === 1 ? 'ein Werktag' : `${remainingWorkdays} Werktage`}`;
}

export function alsText(report: WeeklyReport): string {
  const zeilen: string[] = [];

  zeilen.push(report.project.name);
  if (report.phase !== null) {
    zeilen.push(`Phase ${report.phase.ordinal} von ${report.phase.total} · ${report.phase.name}`);
  }
  zeilen.push('');

  zeilen.push('DIESE WOCHE AUF DER BAUSTELLE');
  if (report.thisWeek.length === 0) {
    zeilen.push('  Diese Woche steht nichts an.');
  } else {
    for (const task of report.thisWeek) {
      zeilen.push(`  ${spanne(task.start, task.end)}  ${task.name}${task.tradeName === null ? '' : ` (${task.tradeName})`}`);
      if (task.isWait) zeilen.push('     Wartezeit — nicht verkürzbar.');
      if (task.guideCardSummary !== null) zeilen.push(`     ${task.guideCardSummary}`);
    }
  }
  zeilen.push('');

  zeilen.push('WAS DU ENTSCHEIDEN MUSST');
  if (report.decisions.length === 0) {
    zeilen.push('  Nichts Offenes. Alles Anstehende ist entschieden.');
  } else {
    for (const decision of report.decisions) {
      zeilen.push(
        `  ${decision.title} — ${fristSatz(decision.remainingWorkdays)}` +
          `${decision.dueDate === null ? '' : ` (bis ${datum(decision.dueDate)})`}`,
      );
      if (decision.blocksTaskName !== null) {
        zeilen.push(`     Hängt an: ${decision.blocksTaskName}`);
      }
    }
  }
  zeilen.push('');

  zeilen.push('WAS SICH VERSCHOBEN HAT');
  if (report.changes.length === 0) {
    zeilen.push('  Nichts. Der Plan steht wie letzte Woche.');
  } else {
    for (const change of report.changes) {
      const grund = change.reason === null ? '' : ` · ${REASON_LABEL[change.reason] ?? change.reason}`;
      zeilen.push(
        `  ${change.taskName ?? 'Vorgang'}: ${datum(change.from)} → ${datum(change.to)}${grund}`,
      );
      if (change.reasonText !== null && change.reasonText !== '') {
        zeilen.push(`     „${change.reasonText}"`);
      }
    }
  }
  zeilen.push('');

  zeilen.push('PROGNOSE');
  zeilen.push(`  ${prognoseSatz(report)}`);
  zeilen.push('');

  if (report.photos.length > 0) {
    zeilen.push('FOTOS, DIE JETZT FÄLLIG SIND');
    for (const photo of report.photos) {
      zeilen.push(`  ${photo.what}`);
      zeilen.push(`     ${photo.why} (${photo.taskName})`);
    }
    zeilen.push('');
  }

  if (report.money !== null) {
    zeilen.push('GELD');
    zeilen.push(
      `  ${report.money.name}${report.money.amountCents === null ? '' : ` · ${Math.round(report.money.amountCents / 100).toLocaleString('de-DE')} €`}`,
    );
    zeilen.push(`     ${report.money.requirement}`);
    zeilen.push('');
  }

  // Die Aufbewahrungserinnerung aus 6.5 steht ganz unten und nicht oben: Sie
  // ist keine Aufgabe der Woche, sondern eine Sache, die einmal im Leben des
  // Bauvorhabens zu entscheiden ist.
  if (report.retention !== null) {
    zeilen.push('DEINE BAUAKTE');
    zeilen.push(
      `  Die Abnahme war am ${report.retention.acceptedOn}, also vor ${report.retention.years} Jahren.`,
    );
    zeilen.push('  Die Gewährleistung ist damit abgelaufen. Gelöscht wird trotzdem nichts —');
    zeilen.push('  das entscheidest du. Die Akte liegt weiter für dich bereit.');
    zeilen.push('');
  }

  zeilen.push('—');
  zeilen.push('MeinBaulotse. Du bleibst der Bauherr, wir sagen dir, was als Nächstes kommt.');

  return zeilen.join('\n');
}

const escape = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Die HTML-Fassung.
 *
 * Bewusst genügsam: Tabellenlayout, feste Farben aus dem Gestaltungssystem,
 * keine externen Schriften, keine Bilder. Mailprogramme können wenig, und was
 * sie können, unterscheidet sich. Ein Bericht, der nur in einem Programm
 * richtig aussieht, ist kein Bericht.
 */
export function alsHtml(report: WeeklyReport): string {
  const block = (titel: string, inhalt: string): string => `
    <tr><td style="padding:24px 0 8px 0;border-top:1px solid #e5e5e5;">
      <div style="font:600 13px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.04em;text-transform:uppercase;color:#525252;">${escape(titel)}</div>
    </td></tr>
    <tr><td>${inhalt}</td></tr>`;

  const zeile = (haupt: string, neben?: string): string => `
    <div style="padding:8px 0;border-bottom:1px solid #e5e5e5;">
      <div style="font:400 16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#171717;">${haupt}</div>
      ${neben === undefined ? '' : `<div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#525252;">${neben}</div>`}
    </div>`;

  const wochenBlock =
    report.thisWeek.length === 0
      ? zeile('Diese Woche steht nichts an.')
      : report.thisWeek
          .map((task) =>
            zeile(
              `<strong style="font-weight:500;">${escape(task.name)}</strong> — ${escape(spanne(task.start, task.end))}`,
              [
                task.tradeName === null ? null : escape(task.tradeName),
                task.isWait ? 'Wartezeit — nicht verkürzbar.' : null,
                task.guideCardSummary === null ? null : escape(task.guideCardSummary),
              ]
                .filter((part): part is string => part !== null)
                .join(' · '),
            ),
          )
          .join('');

  const entscheidungsBlock =
    report.decisions.length === 0
      ? zeile('Nichts Offenes. Alles Anstehende ist entschieden.')
      : report.decisions
          .map((decision) =>
            zeile(
              `<strong style="font-weight:500;">${escape(decision.title)}</strong> — ${escape(fristSatz(decision.remainingWorkdays))}`,
              decision.blocksTaskName === null
                ? undefined
                : `Hängt an „${escape(decision.blocksTaskName)}"${decision.dueDate === null ? '' : ` · bis ${escape(datum(decision.dueDate))}`}`,
            ),
          )
          .join('');

  const verschiebungsBlock =
    report.changes.length === 0
      ? zeile('Nichts. Der Plan steht wie letzte Woche.')
      : report.changes
          .map((change) =>
            zeile(
              `${escape(change.taskName ?? 'Vorgang')}: ${escape(datum(change.from))} → ${escape(datum(change.to))}`,
              [
                change.reason === null ? null : escape(REASON_LABEL[change.reason] ?? change.reason),
                change.reasonText === null || change.reasonText === ''
                  ? null
                  : `„${escape(change.reasonText)}"`,
              ]
                .filter((part): part is string => part !== null)
                .join(' · '),
            ),
          )
          .join('');

  const fotoBlock =
    report.photos.length === 0
      ? ''
      : block(
          'Fotos, die jetzt fällig sind',
          report.photos
            .map((photo) => zeile(escape(photo.what), `${escape(photo.why)} · ${escape(photo.taskName)}`))
            .join(''),
        );

  const geldBlock =
    report.money === null
      ? ''
      : block(
          'Geld',
          zeile(
            `<strong style="font-weight:500;">${escape(report.money.name)}</strong>${
              report.money.amountCents === null
                ? ''
                : ` — ${escape(Math.round(report.money.amountCents / 100).toLocaleString('de-DE'))} €`
            }`,
            escape(report.money.requirement),
          ),
        );

  const aufbewahrungBlock =
    report.retention === null
      ? ''
      : block(
          'Deine Bauakte',
          zeile(
            `Die Abnahme war am ${escape(report.retention.acceptedOn)}, also vor `
            + `${report.retention.years} Jahren — die Gewährleistung ist abgelaufen.`,
            'Gelöscht wird trotzdem nichts. Das entscheidest du; die Akte liegt weiter '
            + 'für dich bereit.',
          ),
        );

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${escape(betreff(report))}</title></head>
<body style="margin:0;padding:24px;background:#f5f5f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:12px;">
  <tr><td style="padding:24px 24px 0 24px;">
    <div style="font:500 24px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#0a0a0a;">${escape(report.project.name)}</div>
    ${
      report.phase === null
        ? ''
        : `<div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#525252;">Phase ${report.phase.ordinal} von ${report.phase.total} · ${escape(report.phase.name)}</div>`
    }
  </td></tr>
  <tr><td style="padding:0 24px 24px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${block('Diese Woche auf der Baustelle', wochenBlock)}
      ${block('Was du entscheiden musst', entscheidungsBlock)}
      ${block('Was sich verschoben hat', verschiebungsBlock)}
      ${block('Prognose', zeile(escape(prognoseSatz(report))))}
      ${fotoBlock}
      ${geldBlock}
    ${aufbewahrungBlock}
    </table>
    <div style="padding-top:24px;font:400 13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#737373;">
      MeinBaulotse. Du bleibst der Bauherr, wir sagen dir, was als Nächstes kommt.
    </div>
  </td></tr>
</table>
</body></html>`;
}

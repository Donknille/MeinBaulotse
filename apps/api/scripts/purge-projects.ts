/**
 * Bauvorhaben endgültig entfernen (Abschnitt 6.5).
 *
 * Der zweite Schritt der Löschung. Der erste steht in der Anwendung: Der
 * Bauherr merkt sein Bauvorhaben zur Löschung vor, es verschwindet aus seiner
 * Liste, und dreißig Tage lang kann er es zurückholen. Danach kommt dieses
 * Werkzeug.
 *
 * Warum als Skript und nicht als Route — derselbe Grund wie beim
 * Wochenbericht, nur schärfer: Die Anwendungsrolle hat auf `schedule_change`,
 * `diary_entry`, `task_confirmation`, `defect_event` und `assistant_message`
 * **kein** Löschrecht, und Trigger halten zusätzlich dagegen. Das ist Absicht
 * und soll so bleiben: Ein Fehler im Anwendungscode kann keine Akte
 * vernichten.
 *
 * Löschen kann deshalb nur, wer die Tabellen besitzt — und der schaltet die
 * Trigger für die Dauer der Löschung ab und danach wieder ein, in **einer**
 * Transaktion. Bricht etwas ab, war nichts.
 *
 *     pnpm --filter @meinbaulotse/api purge          # zeigt nur an
 *     pnpm --filter @meinbaulotse/api purge --wirklich
 */

import '../src/env.js';
import { closePool, withAdminTx } from '@meinbaulotse/db';

const wirklich = process.argv.includes('--wirklich');

/** Die Trigger, die Historie schützen. Sie fallen der Löschung sonst zuvor. */
const SCHUTZTRIGGER: readonly [string, string][] = [
  ['schedule_change', 'schedule_change_append_only'],
  ['diary_entry', 'diary_entry_sealed'],
  ['task_confirmation', 'task_confirmation_append_only'],
  ['defect_event', 'defect_event_append_only'],
  ['assistant_message', 'assistant_message_append_only'],
  ['media', 'media_immutable_original'],
  // `guide_card` hängt nicht am Projekt und bleibt deshalb draußen: Der
  // Redaktionsinhalt gehört allen Bauvorhaben, nicht diesem einen.
];

interface Faellig {
  id: string;
  name: string;
  requested_at: Date;
  purge_after: Date;
  within_warranty: boolean;
}

async function main(): Promise<void> {
  const faellig = await withAdminTx(async (tx) =>
    (
      await tx.query<Faellig>(
        `select p.id, p.name, p.deletion_requested_at as requested_at,
                s.purge_after, s.within_warranty
           from project p
           cross join lateral mbl.deletion_state(p.id) s
          where p.deletion_requested_at is not null
          order by p.deletion_requested_at`,
      )
    ).rows,
  );

  if (faellig.length === 0) {
    console.log('Keine Löschung vorgemerkt.');
    return;
  }

  const jetzt = Date.now();
  const reif = faellig.filter((eintrag) => new Date(eintrag.purge_after).getTime() <= jetzt);
  const wartend = faellig.filter((eintrag) => new Date(eintrag.purge_after).getTime() > jetzt);

  for (const eintrag of wartend) {
    const tage = Math.ceil((new Date(eintrag.purge_after).getTime() - jetzt) / 86_400_000);
    console.log(`  wartet  ${eintrag.name} — noch ${tage} Tage, rücknehmbar`);
  }

  for (const eintrag of reif) {
    console.log(
      `  fällig  ${eintrag.name}`
      + (eintrag.within_warranty ? ' — Achtung: Gewährleistung läuft noch' : ''),
    );
  }

  if (reif.length === 0) {
    console.log('\nNichts zu tun: Alle vorgemerkten Bauvorhaben stehen noch in der Frist.');
    return;
  }

  if (!wirklich) {
    console.log(
      `\nProbelauf. ${reif.length} Bauvorhaben wären zu löschen.`
      + '\nMit --wirklich ausführen. Das ist nicht rückgängig zu machen.',
    );
    return;
  }

  for (const eintrag of reif) {
    // Alles in **einer** Transaktion: Trigger aus, löschen, Trigger an.
    // Bricht etwas ab, ist auch das Abschalten zurückgenommen.
    await withAdminTx(async (tx) => {
      for (const [tabelle, trigger] of SCHUTZTRIGGER) {
        await tx.query(`alter table ${tabelle} disable trigger ${trigger}`);
      }
      try {
        // Der Rest hängt über `on delete cascade` daran.
        await tx.query('delete from project where id = $1', [eintrag.id]);
      } finally {
        for (const [tabelle, trigger] of SCHUTZTRIGGER) {
          await tx.query(`alter table ${tabelle} enable trigger ${trigger}`);
        }
      }
    });
    console.log(`  gelöscht  ${eintrag.name}`);
  }

  console.log(
    `\n${reif.length} Bauvorhaben entfernt.`
    + '\nDie Fotos in der Ablage gehen damit **nicht** mit — sie liegen unter'
    + '\n`bauakte/<projektkennung>/` und sind dort zu entfernen. Siehe docs/BETRIEB.md.',
  );
}

try {
  await main();
} finally {
  await closePool();
}

/**
 * Ist die Datenbank auf dem Stand, den dieser Code voraussetzt?
 *
 * Entstanden aus einem Fehler, den ich selbst gebaut habe: Migration 0004 fügte
 * `task.earliest_start` hinzu, die Auslieferung ging live, die Migration war
 * noch nicht eingespielt — und ab da endete jede Planansicht in
 *
 *     column t.earliest_start does not exist
 *
 * `/api/health/db` meldete dabei seelenruhig `ok: true`, weil sie nur zählte,
 * ob Stammdaten zu lesen sind. Die Verbindung stand ja auch. Kaputt war etwas
 * anderes.
 *
 * Diese Liste schließt die Lücke. Sie ist bewusst von Hand gepflegt und nicht
 * aus den Migrationen abgeleitet: Was hier steht, ist keine Aufzählung des
 * Schemas, sondern die Aussage „ohne das läuft die Anwendung nicht". Wer eine
 * Migration schreibt, die der Code braucht, trägt sie hier ein — und bekommt
 * dafür eine Fehlermeldung, die den Dateinamen nennt statt einer Spalte.
 */

import type { Transaction } from '@meinbaulotse/db';

type Tx = Pick<Transaction, 'query'>;

interface Expectation {
  readonly migration: string;
  readonly table: string;
  readonly column: string;
}

/** Nur Spalten aus Migrationen **nach** der ersten Auslieferung. */
const EXPECTED: readonly Expectation[] = [
  { migration: '0004_task_constraint.sql', table: 'task', column: 'earliest_start' },
  // Ohne die Wissensschicht endet jeder Aufruf einer Lotsenkarte in
  // `relation "guide_card" does not exist`. Die Inhalte selbst (0006) stehen
  // hier bewusst nicht: Fehlen sie, gibt es keine Karten, aber die Anwendung
  // läuft. Das ist eine leere Datenlage, kein kaputtes Schema.
  { migration: '0005_guide_card.sql', table: 'guide_card', column: 'key' },
  // Ohne die Entscheidungen endet jede Planansicht in
  // `relation "decision" does not exist` — sie hängen im Plan mit drin. Die
  // Vorlagen (0008) stehen hier wieder nicht: Fehlen sie, entstehen beim
  // Anlegen eines Bauvorhabens keine Entscheidungen, aber nichts bricht.
  { migration: '0007_decision.sql', table: 'decision', column: 'due_date' },
  // Ohne das Tagebuch endet jeder Aufruf der Erfassung in
  // `relation "diary_entry" does not exist`, und das Cockpit fragt die
  // Fotoaufträge bei jedem Laden ab. 0011 steht hier nicht: Fehlt der
  // Bildspeicher, gibt es keine Fotos, aber die Anwendung läuft — sie sagt
  // beim Hochladen offen, was fehlt.
  { migration: '0010_diary.sql', table: 'diary_entry', column: 'content_hash' },
];

export interface SchemaState {
  current: boolean;
  /** Welche Migrationen fehlen, in der Reihenfolge, in der sie einzuspielen sind. */
  missingMigrations: string[];
}

export async function checkSchema(tx: Tx): Promise<SchemaState> {
  if (EXPECTED.length === 0) return { current: true, missingMigrations: [] };

  const found = await tx.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (${EXPECTED.map(
          (_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`,
        ).join(', ')})`,
    EXPECTED.flatMap((expectation) => [expectation.table, expectation.column]),
  );

  const vorhanden = new Set(found.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const missing = [
    ...new Set(
      EXPECTED.filter(
        (expectation) => !vorhanden.has(`${expectation.table}.${expectation.column}`),
      ).map((expectation) => expectation.migration),
    ),
  ];

  return { current: missing.length === 0, missingMigrations: missing };
}

/**
 * Was ist fertig, was läuft, was kommt noch.
 *
 * Eine gemeinsame Sprache für Liste, Zeitachse und Cockpit. Ohne sie sagt
 * jede Ansicht etwas anderes, und das ist genau der Zustand, aus dem diese
 * Datei entstanden ist: Auf dem Bildschirm stand nirgends, was abgeschlossen
 * ist — nicht in der Liste, nicht auf der Zeitachse.
 *
 * Zwei Quellen, und sie widersprechen sich manchmal:
 *
 * - **Der Status** ist eine Aussage eines Menschen. „Fertig" heißt: jemand hat
 *   das gemeldet.
 * - **Die Ist-Termine** sind ebenfalls Aussagen, nur genauer. Ein gemeldetes
 *   Ist-Ende ist ein fertiger Vorgang, auch wenn der Status noch nicht
 *   nachgezogen wurde.
 *
 * Deshalb zählt hier beides, und die stärkere Aussage gewinnt. Was allein aus
 * dem Kalender folgt — „das Enddatum ist vorbei" —, gilt ausdrücklich **nicht**
 * als fertig. Auf einer Baustelle ist ein verstrichener Termin kein erledigter
 * Vorgang, sondern oft das Gegenteil.
 */

import type { ScheduledTaskDto } from '@meinbaulotse/shared';

export type Progress = 'fertig' | 'laeuft' | 'geplant' | 'entfallen';

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function progressOf(task: ScheduledTaskDto): Progress {
  if (task.status === 'entfallen') return 'entfallen';
  if (task.status === 'fertig' || task.status === 'abgenommen' || task.actualEnd !== null) {
    return 'fertig';
  }
  if (task.status === 'laeuft' || task.actualStart !== null) return 'laeuft';
  return 'geplant';
}

/**
 * Läuft dieser Vorgang heute — sei es gemeldet oder laut Plan?
 *
 * Ein Bauherr fragt „was passiert heute", nicht „was ist als laufend
 * gemeldet". Der Plan zählt deshalb mit.
 */
export function istHeute(task: ScheduledTaskDto, today = todayIso()): boolean {
  const fortschritt = progressOf(task);
  if (fortschritt === 'fertig' || fortschritt === 'entfallen') return false;
  if (fortschritt === 'laeuft') return true;
  return (
    task.currentStart !== null &&
    task.currentEnd !== null &&
    task.currentStart <= today &&
    today <= task.currentEnd
  );
}

/** Fehlt zu diesem Vorgang eine Meldung? Sein Ende ist vorbei, fertig ist er nicht. */
export function meldungOffen(task: ScheduledTaskDto, today = todayIso()): boolean {
  const fortschritt = progressOf(task);
  if (fortschritt === 'fertig' || fortschritt === 'entfallen') return false;
  return task.currentEnd !== null && task.currentEnd < today;
}

export interface Zaehlung {
  gesamt: number;
  fertig: number;
  laeuft: number;
  geplant: number;
  entfallen: number;
}

export function zaehle(tasks: readonly ScheduledTaskDto[]): Zaehlung {
  const z: Zaehlung = { gesamt: tasks.length, fertig: 0, laeuft: 0, geplant: 0, entfallen: 0 };
  for (const task of tasks) z[progressOf(task)] += 1;
  return z;
}

/**
 * Wie viele Tage bis dahin — im Klartext, nicht als Zahl mit Vorzeichen.
 *
 * Kalendertage, nicht Werktage: Wer fragt „wann kommt der Dachdecker", denkt
 * in Übermorgen, nicht in Werktagen.
 */
export function inTagen(isoDate: string, today = todayIso()): string {
  const tage = Math.round(
    (Date.parse(`${isoDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (tage === -1) return 'seit gestern überfällig';
  if (tage < 0) return `seit ${Math.abs(tage)} Tagen überfällig`;
  if (tage === 0) return 'heute';
  if (tage === 1) return 'morgen';
  if (tage === 2) return 'übermorgen';
  if (tage <= 13) return `in ${tage} Tagen`;
  if (tage <= 20) return 'in zwei Wochen';
  if (tage <= 45) return `in ${Math.round(tage / 7)} Wochen`;
  return `in ${Math.round(tage / 30)} Monaten`;
}

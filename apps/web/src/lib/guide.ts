/**
 * Wann eine Lotsenkarte von selbst in den Blick rückt.
 *
 * Abschnitt 3.1 der Spezifikation nennt drei Zeitpunkte: sieben Tage vor
 * Beginn, während der Ausführung und beim Abschluss. Daraus folgt eine
 * einzige Frage — steht dieser Vorgang jetzt an? —, und die wird hier
 * beantwortet, damit Cockpit, Liste und Zeitachse dieselbe Antwort geben.
 *
 * Zwei Feinheiten, beide aus der Sache heraus:
 *
 * - **Kalendertage, keine Werktage.** Der Vorlauf ist Vorbereitungszeit des
 *   Bauherrn, nicht Arbeitszeit auf der Baustelle. Wer am Freitag liest, dass
 *   Montag der Estrich kommt, hat das Wochenende — und das zählt.
 * - **Gelesen ist gelesen.** Eine Karte, die einmal offen war, verschwindet
 *   aus der Aufforderung. Ein Hinweis, der bleibt, wird nicht gelesen, sondern
 *   weggeklickt.
 */

import { GUIDE_CARD_LEAD_DAYS, type ScheduledTaskDto } from '@meinbaulotse/shared';
import { progressOf, todayIso } from './progress';

/** `YYYY-MM-DD` plus n Kalendertage, ohne Zeitzonen und ohne Date-Objekt im Ergebnis. */
export function plusTage(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Rückt dieser Vorgang in den Blick?
 *
 * Fertige und entfallene Vorgänge nicht: Zu einem abgeschlossenen Estrich
 * vorher zu lesen, was man hätte beachten können, ist keine Hilfe, sondern
 * ein Vorwurf.
 */
export function istImBlick(task: ScheduledTaskDto, today = todayIso()): boolean {
  if (task.guideCardKey === null) return false;
  const fortschritt = progressOf(task);
  if (fortschritt === 'fertig' || fortschritt === 'entfallen') return false;
  if (fortschritt === 'laeuft') return true;
  if (task.currentStart === null) return false;
  return task.currentStart <= plusTage(today, GUIDE_CARD_LEAD_DAYS);
}

/**
 * Wozu der Fragende jetzt etwas lesen sollte — und noch nicht gelesen hat.
 *
 * Sortiert nach Beginn: Was zuerst kommt, steht oben. Vorgänge ohne Termin
 * stehen hinten, denn ohne Datum gibt es keine Dringlichkeit.
 */
export function karteJetztLesen(
  tasks: readonly ScheduledTaskDto[],
  today = todayIso(),
): ScheduledTaskDto[] {
  return tasks
    .filter((task) => istImBlick(task, today) && !task.guideCardRead)
    .sort((a, b) => (a.currentStart ?? '9999').localeCompare(b.currentStart ?? '9999'));
}

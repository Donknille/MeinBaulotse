/**
 * Die Rechnung hinter der Zeitachse.
 *
 * Bewusst getrennt von der Darstellung: Ein Balken, der zwei Pixel zu weit
 * links sitzt, fällt niemandem auf — ein Balken, der im falschen Monat sitzt,
 * schon, und zwar erst dann, wenn jemand danach disponiert. Deshalb steht die
 * Umrechnung von Datum zu Position hier, als reine Funktion, und lässt sich
 * prüfen.
 *
 * Gerechnet wird auf Epochentagen, wie im Berechnungskern. Ein `Date`-Objekt
 * käme mit einer Zeitzone im Gepäck, und die hat in einem Terminplan nichts
 * verloren.
 */

import { epochDay, fromEpochDay } from './format';

export interface AxisInput {
  dates: readonly (string | null)[];
  /** Luft an beiden Enden, in Tagen. Ein Balken am Rand sieht aus, als ginge es dahinter weiter. */
  padDays?: number;
}

export interface Axis {
  from: number;
  to: number;
  days: number;
  months: ReadonlyArray<{ iso: string; offsetDays: number; days: number }>;
  contains: (iso: string) => boolean;
  /** Abstand vom linken Rand, in Tagen. */
  offsetOf: (iso: string) => number;
}

export function buildAxis({ dates, padDays = 7 }: AxisInput): Axis {
  const numbers = dates.filter((value): value is string => value !== null).map(epochDay);
  if (numbers.length === 0) {
    // Ohne einen einzigen Termin gibt es keine Achse. Statt zu raten, bleibt
    // sie leer — die Darstellung zeigt dann ihren leeren Zustand.
    return { from: 0, to: 0, days: 0, months: [], contains: () => false, offsetOf: () => 0 };
  }

  const from = Math.min(...numbers) - padDays;
  const to = Math.max(...numbers) + padDays;

  const months: Array<{ iso: string; offsetDays: number; days: number }> = [];
  let cursor = startOfMonth(from);
  while (cursor <= to) {
    const next = startOfMonth(cursor + 32);
    months.push({ iso: fromEpochDay(cursor), offsetDays: cursor - from, days: next - cursor });
    cursor = next;
  }

  return {
    from,
    to,
    days: to - from + 1,
    months,
    contains: (iso) => {
      const value = epochDay(iso);
      return value >= from && value <= to;
    },
    offsetOf: (iso) => epochDay(iso) - from,
  };
}

/** Erster Tag des Monats, in dem `epoch` liegt. */
export function startOfMonth(epoch: number): number {
  const date = new Date(epoch * 86_400_000);
  return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 86_400_000);
}

/**
 * Breite eines Balkens in Pixeln, einschließend gezählt.
 *
 * Ein eintägiger Vorgang ist einen Tag breit, nicht null. Und schmaler als ein
 * Tag wird kein Balken, sonst verschwinden im Monatsmaßstab genau die kurzen
 * Vorgänge, an denen es klemmt.
 */
export function barWidth(start: string, end: string, pxPerDay: number): number {
  const days = Math.max(1, epochDay(end) - epochDay(start) + 1);
  return days * pxPerDay;
}

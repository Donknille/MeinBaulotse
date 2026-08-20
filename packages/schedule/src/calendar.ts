/**
 * Bauzeitenkalender: Werktage, Feiertage, Betriebsferien.
 *
 * Zwei Zeitrechnungen laufen im Bauablauf nebeneinander und dürfen nie
 * vermischt werden:
 *
 * - **Arbeitsvorgänge** zählen in Werktagen. Ein Gewerk arbeitet nicht am
 *   Wochenende, nicht an Feiertagen und nicht während seiner Betriebsferien.
 * - **Technologische Wartezeiten** zählen in Kalendertagen. Estrich trocknet
 *   auch an Weihnachten.
 */

import {
  addDays,
  compareDates,
  dayOfWeek,
  toEpochDay,
  type IsoDate,
  type IsoWeekday,
} from './civil-date.js';
import { holidaysForYear, type FederalState, type HolidayOptions } from './holidays.js';

export const DEFAULT_WORKWEEK: readonly IsoWeekday[] = [1, 2, 3, 4, 5];

export interface Calendar extends HolidayOptions {
  federalState: FederalState;
  /** ISO-Wochentage, an denen gearbeitet wird. Standard Montag bis Freitag. */
  workweek?: readonly IsoWeekday[];
  /** Projektweite arbeitsfreie Tage, etwa Betriebsruhe der Baustelle. */
  additionalNonWorkingDays?: readonly IsoDate[];
  /** Betriebsferien je Gewerkekürzel. Greift nur für Vorgänge dieses Gewerks. */
  nonWorkingByTrade?: Readonly<Record<string, readonly IsoDate[]>>;
  /** Ausnahmsweise Arbeitstage, etwa ein angesetzter Samstag. Schlägt alles andere. */
  additionalWorkingDays?: readonly IsoDate[];
}

/** Obergrenze gegen Endlosschleifen bei einem Kalender ohne einen einzigen Werktag. */
const MAX_SEARCH_DAYS = 4000;

function yearOf(date: IsoDate): number {
  return Number(date.slice(0, date.indexOf('-', 1)));
}

function inList(date: IsoDate, list: readonly IsoDate[] | undefined): boolean {
  return list !== undefined && list.includes(date);
}

/**
 * Ist `date` für das angegebene Gewerk ein Arbeitstag?
 *
 * `tradeCode` bleibt in der Regel offen; er wird nur gebraucht, wenn ein Gewerk
 * eigene Betriebsferien hat.
 */
export function isWorkday(date: IsoDate, calendar: Calendar, tradeCode?: string): boolean {
  if (inList(date, calendar.additionalWorkingDays)) return true;

  const workweek = calendar.workweek ?? DEFAULT_WORKWEEK;
  if (!workweek.includes(dayOfWeek(date))) return false;

  if (holidaysForYear(yearOf(date), calendar.federalState, calendar).has(date)) return false;

  if (inList(date, calendar.additionalNonWorkingDays)) return false;

  if (tradeCode !== undefined && inList(date, calendar.nonWorkingByTrade?.[tradeCode])) {
    return false;
  }

  return true;
}

/** Erster Arbeitstag am oder nach `date`. */
export function nextWorkday(date: IsoDate, calendar: Calendar, tradeCode?: string): IsoDate {
  let candidate = date;
  for (let step = 0; step <= MAX_SEARCH_DAYS; step += 1) {
    if (isWorkday(candidate, calendar, tradeCode)) return candidate;
    candidate = addDays(candidate, 1);
  }
  throw new Error(
    `Kein Arbeitstag innerhalb von ${MAX_SEARCH_DAYS} Tagen ab ${date} gefunden — ist der Kalender leer?`,
  );
}

/** Letzter Arbeitstag am oder vor `date`. */
export function previousWorkday(date: IsoDate, calendar: Calendar, tradeCode?: string): IsoDate {
  let candidate = date;
  for (let step = 0; step <= MAX_SEARCH_DAYS; step += 1) {
    if (isWorkday(candidate, calendar, tradeCode)) return candidate;
    candidate = addDays(candidate, -1);
  }
  throw new Error(
    `Kein Arbeitstag innerhalb von ${MAX_SEARCH_DAYS} Tagen vor ${date} gefunden — ist der Kalender leer?`,
  );
}

/**
 * Verschiebt um `days` **Werktage**.
 *
 * Der Anker wird entgegen der Laufrichtung normalisiert: Bei Vorwärtsschritten
 * auf den letzten Arbeitstag am oder vor `date`, bei Rückwärtsschritten auf den
 * ersten Arbeitstag am oder nach `date`. Das ist der Punkt, an dem
 * Werktagsrechnungen sonst schiefgehen.
 *
 * Beispiel: Eine Wartezeit endet an einem Sonntag. `workdayOffset(sonntag, 1)`
 * liefert den Montag — nicht den Dienstag, wie es bei Vorwärtsnormalisierung
 * herauskäme.
 *
 * `workdayOffset(date, 0)` liefert damit den letzten Arbeitstag am oder vor
 * `date`; für einen Arbeitstag also ihn selbst.
 */
export function workdayOffset(
  date: IsoDate,
  days: number,
  calendar: Calendar,
  tradeCode?: string,
): IsoDate {
  if (!Number.isInteger(days)) {
    throw new RangeError(`Werktage müssen ganzzahlig sein: ${days}`);
  }

  const direction = days >= 0 ? 1 : -1;
  let candidate =
    direction === 1
      ? previousWorkday(date, calendar, tradeCode)
      : nextWorkday(date, calendar, tradeCode);

  let remaining = Math.abs(days);
  let guard = 0;
  while (remaining > 0) {
    candidate = addDays(candidate, direction);
    if (isWorkday(candidate, calendar, tradeCode)) remaining -= 1;
    guard += 1;
    if (guard > MAX_SEARCH_DAYS) {
      throw new Error(`Werktagsrechnung ab ${date} über ${days} Tage läuft ins Leere.`);
    }
  }
  return candidate;
}

/**
 * Anzahl der Arbeitstage im geschlossenen Intervall `[from, to]`.
 * Liegt `to` vor `from`, ist das Ergebnis 0.
 */
export function countWorkdays(
  from: IsoDate,
  to: IsoDate,
  calendar: Calendar,
  tradeCode?: string,
): number {
  if (compareDates(from, to) > 0) return 0;
  const last = toEpochDay(to);
  let count = 0;
  let candidate = from;
  for (let day = toEpochDay(from); day <= last; day += 1) {
    if (isWorkday(candidate, calendar, tradeCode)) count += 1;
    candidate = addDays(candidate, 1);
  }
  return count;
}

/**
 * Werktagsschritte von `from` nach `to`, mit Vorzeichen.
 *
 * Es gilt `workdayOffset(from, workdayDifference(from, to)) === to`, sofern
 * beide Enden Arbeitstage sind. Für zwei aufeinanderfolgende Arbeitstage ist
 * das Ergebnis 1, für denselben Tag 0.
 */
export function workdayDifference(
  from: IsoDate,
  to: IsoDate,
  calendar: Calendar,
  tradeCode?: string,
): number {
  const order = compareDates(from, to);
  if (order === 0) return 0;
  if (order < 0) return countWorkdays(from, to, calendar, tradeCode) - 1;
  return -(countWorkdays(to, from, calendar, tradeCode) - 1);
}

/**
 * Endtermin eines Arbeitsvorgangs: Die Dauer zählt **einschließlich** des
 * Starttags. Vier Werktage ab Montag enden am Donnerstag.
 */
export function workdayEnd(
  start: IsoDate,
  durationWorkdays: number,
  calendar: Calendar,
  tradeCode?: string,
): IsoDate {
  if (durationWorkdays < 1) {
    throw new RangeError(`Dauer eines Arbeitsvorgangs muss mindestens 1 betragen: ${durationWorkdays}`);
  }
  return workdayOffset(start, durationWorkdays - 1, calendar, tradeCode);
}

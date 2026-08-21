/**
 * Kalenderdatum ohne Zeit und ohne Zeitzone.
 *
 * Der gesamte Berechnungskern rechnet auf ganzzahligen Epochentagen und tauscht
 * `YYYY-MM-DD` aus. Ein `Date`-Objekt kommt hier bewusst nicht vor: Sobald
 * Zeitzonen im Spiel sind, verschiebt sich irgendwann ein Termin um einen Tag,
 * und in einem Terminplan ist genau das der Fehler, den niemand mehr findet.
 */

/** Kalenderdatum im Format `YYYY-MM-DD`. */
export type IsoDate = string;

/** ISO-Wochentag: 1 = Montag … 7 = Sonntag. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const ISO_DATE_PATTERN = /^(-?\d{4,6})-(\d{2})-(\d{2})$/;

export interface DateParts {
  year: number;
  /** 1 = Januar … 12 = Dezember */
  month: number;
  day: number;
}

export class InvalidDateError extends Error {
  constructor(value: string) {
    super(`Kein gültiges Datum im Format YYYY-MM-DD: ${JSON.stringify(value)}`);
    this.name = 'InvalidDateError';
  }
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) throw new RangeError(`Monat außerhalb 1–12: ${month}`);
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_PER_MONTH[month - 1]!;
}

export function parseIsoDate(value: string): DateParts {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) throw new InvalidDateError(value);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) throw new InvalidDateError(value);
  if (day < 1 || day > daysInMonth(year, month)) throw new InvalidDateError(value);
  return { year, month, day };
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

function pad(value: number, width: number): string {
  const sign = value < 0 ? '-' : '';
  return sign + String(Math.abs(value)).padStart(width, '0');
}

export function formatIsoDate(parts: DateParts): IsoDate {
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

/** Baut ein Datum aus Bestandteilen und prüft es dabei. */
export function makeIsoDate(year: number, month: number, day: number): IsoDate {
  const candidate = formatIsoDate({ year, month, day });
  parseIsoDate(candidate);
  return candidate;
}

/**
 * Tage seit 1970-01-01. Algorithmus nach Howard Hinnant (`days_from_civil`),
 * gültig für den proleptischen gregorianischen Kalender.
 */
export function toEpochDay(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** Umkehrung von {@link toEpochDay} (`civil_from_days`). */
export function fromEpochDay(epochDay: number): IsoDate {
  if (!Number.isInteger(epochDay)) {
    throw new RangeError(`Epochentag muss ganzzahlig sein: ${epochDay}`);
  }
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) /
      365,
  );
  const y = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const mp = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return formatIsoDate({ year: month <= 2 ? y + 1 : y, month, day });
}

/** Verschiebt um Kalendertage. Negative Werte gehen zurück. */
export function addDays(date: IsoDate, days: number): IsoDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/** Kalendertage von `from` bis `to`. Positiv, wenn `to` später liegt. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Negativ, wenn `a` früher liegt — geeignet für `Array.prototype.sort`. */
export function compareDates(a: IsoDate, b: IsoDate): number {
  const left = toEpochDay(a);
  const right = toEpochDay(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function maxDate(...dates: readonly IsoDate[]): IsoDate {
  if (dates.length === 0) throw new RangeError('maxDate braucht mindestens ein Datum');
  return dates.reduce((best, candidate) => (compareDates(candidate, best) > 0 ? candidate : best));
}

export function minDate(...dates: readonly IsoDate[]): IsoDate {
  if (dates.length === 0) throw new RangeError('minDate braucht mindestens ein Datum');
  return dates.reduce((best, candidate) => (compareDates(candidate, best) < 0 ? candidate : best));
}

/** ISO-Wochentag. 1970-01-01 war ein Donnerstag, daher der Versatz von 3. */
export function dayOfWeek(date: IsoDate): IsoWeekday {
  const epochDay = toEpochDay(date);
  return ((((epochDay + 3) % 7) + 7) % 7 + 1) as IsoWeekday;
}

export function isWeekend(date: IsoDate): boolean {
  const weekday = dayOfWeek(date);
  return weekday === 6 || weekday === 7;
}

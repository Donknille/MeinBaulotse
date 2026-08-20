/**
 * Gesetzliche Feiertage in Deutschland, nach Bundesland.
 *
 * Grundlage sind die Feiertagsgesetze der Länder. Bewegliche Feiertage hängen am
 * Ostersonntag; der wird nach dem Verfahren von Meeus/Butcher für den
 * gregorianischen Kalender berechnet.
 */

import { addDays, dayOfWeek, formatIsoDate, makeIsoDate, type IsoDate } from './civil-date.js';

/** Amtliche Länderkürzel. */
export const FEDERAL_STATES = [
  'BW',
  'BY',
  'BE',
  'BB',
  'HB',
  'HH',
  'HE',
  'MV',
  'NI',
  'NW',
  'RP',
  'SL',
  'SN',
  'ST',
  'SH',
  'TH',
] as const;

export type FederalState = (typeof FEDERAL_STATES)[number];

export const FEDERAL_STATE_NAMES: Readonly<Record<FederalState, string>> = {
  BW: 'Baden-Württemberg',
  BY: 'Bayern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
};

export function isFederalState(value: unknown): value is FederalState {
  return typeof value === 'string' && (FEDERAL_STATES as readonly string[]).includes(value);
}

export interface HolidayOptions {
  /**
   * Die Baustelle liegt in einer überwiegend katholischen Gemeinde.
   *
   * Drei Feiertage gelten nicht landesweit, sondern nur in solchen Gemeinden:
   * Mariä Himmelfahrt in Bayern sowie Fronleichnam in Sachsen und Thüringen.
   * Standard ist `false` — das ist die vorsichtigere Annahme, weil ein
   * übersehener Feiertag den Plan zu optimistisch macht.
   */
  catholicMunicipality?: boolean;
}

export interface Holiday {
  date: IsoDate;
  name: string;
}

/**
 * Ostersonntag im gregorianischen Kalender (Meeus/Butcher, „anonymous
 * Gregorian algorithm").
 */
export function easterSunday(year: number): IsoDate {
  if (!Number.isInteger(year)) throw new RangeError(`Jahr muss ganzzahlig sein: ${year}`);
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatIsoDate({ year, month, day });
}

/**
 * Buß- und Bettag: der letzte Mittwoch vor dem 23. November. Nur in Sachsen
 * gesetzlicher Feiertag.
 */
export function pentitenceDay(year: number): IsoDate {
  let candidate = makeIsoDate(year, 11, 22);
  while (dayOfWeek(candidate) !== 3) {
    candidate = addDays(candidate, -1);
  }
  return candidate;
}

const ALL: readonly FederalState[] = FEDERAL_STATES;

interface HolidayRule {
  name: string;
  states: readonly FederalState[];
  /** Nur in überwiegend katholischen Gemeinden der genannten Länder. */
  catholicOnly?: boolean;
  resolve: (year: number, easter: IsoDate) => IsoDate;
}

const RULES: readonly HolidayRule[] = [
  { name: 'Neujahr', states: ALL, resolve: (y) => makeIsoDate(y, 1, 1) },
  {
    name: 'Heilige Drei Könige',
    states: ['BW', 'BY', 'ST'],
    resolve: (y) => makeIsoDate(y, 1, 6),
  },
  {
    name: 'Internationaler Frauentag',
    states: ['BE', 'MV'],
    resolve: (y) => makeIsoDate(y, 3, 8),
  },
  { name: 'Karfreitag', states: ALL, resolve: (_y, easter) => addDays(easter, -2) },
  { name: 'Ostersonntag', states: ['BB'], resolve: (_y, easter) => easter },
  { name: 'Ostermontag', states: ALL, resolve: (_y, easter) => addDays(easter, 1) },
  { name: 'Tag der Arbeit', states: ALL, resolve: (y) => makeIsoDate(y, 5, 1) },
  { name: 'Christi Himmelfahrt', states: ALL, resolve: (_y, easter) => addDays(easter, 39) },
  { name: 'Pfingstsonntag', states: ['BB'], resolve: (_y, easter) => addDays(easter, 49) },
  { name: 'Pfingstmontag', states: ALL, resolve: (_y, easter) => addDays(easter, 50) },
  {
    name: 'Fronleichnam',
    states: ['BW', 'BY', 'HE', 'NW', 'RP', 'SL'],
    resolve: (_y, easter) => addDays(easter, 60),
  },
  {
    name: 'Fronleichnam',
    states: ['SN', 'TH'],
    catholicOnly: true,
    resolve: (_y, easter) => addDays(easter, 60),
  },
  { name: 'Mariä Himmelfahrt', states: ['SL'], resolve: (y) => makeIsoDate(y, 8, 15) },
  {
    name: 'Mariä Himmelfahrt',
    states: ['BY'],
    catholicOnly: true,
    resolve: (y) => makeIsoDate(y, 8, 15),
  },
  { name: 'Weltkindertag', states: ['TH'], resolve: (y) => makeIsoDate(y, 9, 20) },
  { name: 'Tag der Deutschen Einheit', states: ALL, resolve: (y) => makeIsoDate(y, 10, 3) },
  {
    name: 'Reformationstag',
    states: ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'],
    resolve: (y) => makeIsoDate(y, 10, 31),
  },
  {
    name: 'Allerheiligen',
    states: ['BW', 'BY', 'NW', 'RP', 'SL'],
    resolve: (y) => makeIsoDate(y, 11, 1),
  },
  { name: 'Buß- und Bettag', states: ['SN'], resolve: (y) => pentitenceDay(y) },
  { name: 'Erster Weihnachtstag', states: ALL, resolve: (y) => makeIsoDate(y, 12, 25) },
  { name: 'Zweiter Weihnachtstag', states: ALL, resolve: (y) => makeIsoDate(y, 12, 26) },
];

const cache = new Map<string, ReadonlyMap<IsoDate, string>>();

/**
 * Alle gesetzlichen Feiertage eines Jahres in einem Bundesland, als Zuordnung
 * von Datum auf Bezeichnung. Das Ergebnis wird zwischengespeichert; ein
 * Terminplan fragt dieselben Jahre sehr oft ab.
 */
export function holidaysForYear(
  year: number,
  state: FederalState,
  options: HolidayOptions = {},
): ReadonlyMap<IsoDate, string> {
  const catholic = options.catholicMunicipality === true;
  const key = `${year}|${state}|${catholic ? 'k' : '-'}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const easter = easterSunday(year);
  const holidays = new Map<IsoDate, string>();
  for (const rule of RULES) {
    if (!rule.states.includes(state)) continue;
    if (rule.catholicOnly === true && !catholic) continue;
    holidays.set(rule.resolve(year, easter), rule.name);
  }

  const frozen: ReadonlyMap<IsoDate, string> = holidays;
  cache.set(key, frozen);
  return frozen;
}

/** Feiertage eines Zeitraums, chronologisch sortiert. */
export function holidaysBetween(
  fromYear: number,
  toYear: number,
  state: FederalState,
  options: HolidayOptions = {},
): readonly Holiday[] {
  const result: Holiday[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    for (const [date, name] of holidaysForYear(year, state, options)) {
      result.push({ date, name });
    }
  }
  return result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function holidayName(
  date: IsoDate,
  state: FederalState,
  options: HolidayOptions = {},
): string | undefined {
  const year = Number(date.slice(0, date.indexOf('-', 1)));
  return holidaysForYear(year, state, options).get(date);
}

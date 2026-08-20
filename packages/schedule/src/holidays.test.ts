import { describe, expect, it } from 'vitest';
import {
  easterSunday,
  FEDERAL_STATES,
  holidayName,
  holidaysBetween,
  holidaysForYear,
  isFederalState,
  pentitenceDay,
} from './holidays.js';
import { addDays, dayOfWeek } from './civil-date.js';

describe('easterSunday', () => {
  // Amtliche Werte, gegen die sich jede Implementierung messen lassen muss.
  it.each([
    [2020, '2020-04-12'],
    [2021, '2021-04-04'],
    [2022, '2022-04-17'],
    [2023, '2023-04-09'],
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16'],
    [2029, '2029-04-01'],
    [2030, '2030-04-21'],
    [2031, '2031-04-13'],
    [2032, '2032-03-28'],
    [2033, '2033-04-17'],
    [2034, '2034-04-09'],
    [2035, '2035-03-25'],
  ])('Ostersonntag %i ist %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });

  it('fällt immer auf einen Sonntag', () => {
    for (let year = 1990; year <= 2100; year += 1) {
      expect(dayOfWeek(easterSunday(year))).toBe(7);
    }
  });
});

describe('pentitenceDay', () => {
  it('ist stets der letzte Mittwoch vor dem 23. November', () => {
    for (let year = 2020; year <= 2040; year += 1) {
      const day = pentitenceDay(year);
      expect(dayOfWeek(day)).toBe(3);
      expect(day < `${year}-11-23`).toBe(true);
      expect(addDays(day, 7) >= `${year}-11-23`).toBe(true);
    }
  });

  it.each([
    [2025, '2025-11-19'],
    [2026, '2026-11-18'],
    [2027, '2027-11-17'],
  ])('Buß- und Bettag %i ist %s', (year, expected) => {
    expect(pentitenceDay(year)).toBe(expected);
  });
});

describe('holidaysForYear', () => {
  it('kennt die bundesweiten Feiertage in jedem Land', () => {
    for (const state of FEDERAL_STATES) {
      const holidays = holidaysForYear(2026, state);
      expect(holidays.get('2026-01-01')).toBe('Neujahr');
      expect(holidays.get('2026-04-03')).toBe('Karfreitag'); // Ostern 05.04.2026
      expect(holidays.get('2026-04-06')).toBe('Ostermontag');
      expect(holidays.get('2026-05-01')).toBe('Tag der Arbeit');
      expect(holidays.get('2026-05-14')).toBe('Christi Himmelfahrt');
      expect(holidays.get('2026-05-25')).toBe('Pfingstmontag');
      expect(holidays.get('2026-10-03')).toBe('Tag der Deutschen Einheit');
      expect(holidays.get('2026-12-25')).toBe('Erster Weihnachtstag');
      expect(holidays.get('2026-12-26')).toBe('Zweiter Weihnachtstag');
    }
  });

  it('unterscheidet Fronleichnam zwischen Bayern und Niedersachsen', () => {
    // Ostern 2026: 05.04. — Fronleichnam liegt 60 Tage später, am 04.06.2026.
    expect(holidaysForYear(2026, 'BY').get('2026-06-04')).toBe('Fronleichnam');
    expect(holidaysForYear(2026, 'NI').has('2026-06-04')).toBe(false);
    expect(holidaysForYear(2026, 'NW').get('2026-06-04')).toBe('Fronleichnam');
    expect(holidaysForYear(2026, 'BE').has('2026-06-04')).toBe(false);
  });

  it('führt Fronleichnam in Sachsen nur in katholischen Gemeinden', () => {
    expect(holidaysForYear(2026, 'SN').has('2026-06-04')).toBe(false);
    expect(
      holidaysForYear(2026, 'SN', { catholicMunicipality: true }).get('2026-06-04'),
    ).toBe('Fronleichnam');
  });

  it('führt Mariä Himmelfahrt im Saarland immer, in Bayern nur katholisch', () => {
    expect(holidaysForYear(2026, 'SL').get('2026-08-15')).toBe('Mariä Himmelfahrt');
    expect(holidaysForYear(2026, 'BY').has('2026-08-15')).toBe(false);
    expect(
      holidaysForYear(2026, 'BY', { catholicMunicipality: true }).get('2026-08-15'),
    ).toBe('Mariä Himmelfahrt');
  });

  it('kennt den Buß- und Bettag nur in Sachsen', () => {
    expect(holidaysForYear(2026, 'SN').get('2026-11-18')).toBe('Buß- und Bettag');
    expect(holidaysForYear(2026, 'BY').has('2026-11-18')).toBe(false);
    expect(holidaysForYear(2026, 'TH').has('2026-11-18')).toBe(false);
  });

  it('kennt den Reformationstag in den neun Ländern, in denen er gilt', () => {
    const withReformation = ['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'];
    for (const state of FEDERAL_STATES) {
      const expected = withReformation.includes(state);
      expect(holidaysForYear(2026, state).has('2026-10-31')).toBe(expected);
    }
  });

  it('kennt den Internationalen Frauentag in Berlin und Mecklenburg-Vorpommern', () => {
    expect(holidaysForYear(2026, 'BE').get('2026-03-08')).toBe('Internationaler Frauentag');
    expect(holidaysForYear(2026, 'MV').get('2026-03-08')).toBe('Internationaler Frauentag');
    expect(holidaysForYear(2026, 'HH').has('2026-03-08')).toBe(false);
  });

  it('kennt Oster- und Pfingstsonntag nur in Brandenburg', () => {
    expect(holidaysForYear(2026, 'BB').get('2026-04-05')).toBe('Ostersonntag');
    expect(holidaysForYear(2026, 'BB').get('2026-05-24')).toBe('Pfingstsonntag');
    expect(holidaysForYear(2026, 'BY').has('2026-04-05')).toBe(false);
  });

  it('kennt den Weltkindertag nur in Thüringen', () => {
    expect(holidaysForYear(2026, 'TH').get('2026-09-20')).toBe('Weltkindertag');
    expect(holidaysForYear(2026, 'SN').has('2026-09-20')).toBe(false);
  });

  it('liefert bei wiederholtem Aufruf dieselbe Instanz', () => {
    expect(holidaysForYear(2026, 'BY')).toBe(holidaysForYear(2026, 'BY'));
    expect(holidaysForYear(2026, 'BY')).not.toBe(
      holidaysForYear(2026, 'BY', { catholicMunicipality: true }),
    );
  });
});

describe('holidaysBetween und holidayName', () => {
  it('liefert die Feiertage mehrerer Jahre chronologisch', () => {
    const holidays = holidaysBetween(2026, 2027, 'HH');
    const dates = holidays.map((holiday) => holiday.date);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe('2026-01-01');
    expect(dates.at(-1)).toBe('2027-12-26');
  });

  it('benennt einen einzelnen Tag', () => {
    expect(holidayName('2026-12-25', 'BW')).toBe('Erster Weihnachtstag');
    expect(holidayName('2026-12-27', 'BW')).toBeUndefined();
  });

  it('erkennt gültige Länderkürzel', () => {
    expect(isFederalState('BY')).toBe(true);
    expect(isFederalState('XX')).toBe(false);
    expect(isFederalState(undefined)).toBe(false);
  });
});

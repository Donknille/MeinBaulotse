import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareDates,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  formatIsoDate,
  fromEpochDay,
  InvalidDateError,
  isValidIsoDate,
  isWeekend,
  makeIsoDate,
  maxDate,
  minDate,
  parseIsoDate,
  toEpochDay,
} from './civil-date.js';

describe('toEpochDay / fromEpochDay', () => {
  it('verankert die Epoche korrekt', () => {
    expect(toEpochDay('1970-01-01')).toBe(0);
    expect(fromEpochDay(0)).toBe('1970-01-01');
  });

  it.each([
    ['1969-12-31', -1],
    ['1970-01-02', 1],
    ['2000-03-01', 11017],
    ['2026-04-01', 20544],
    ['1900-01-01', -25567],
  ])('rechnet %s auf %i', (date, epochDay) => {
    expect(toEpochDay(date)).toBe(epochDay);
    expect(fromEpochDay(epochDay)).toBe(date);
  });

  it('ist über einen langen Zeitraum in sich umkehrbar', () => {
    for (let day = -30000; day <= 30000; day += 137) {
      expect(toEpochDay(fromEpochDay(day))).toBe(day);
    }
  });
});

describe('Schaltjahre', () => {
  it('kennt den 29. Februar in Schaltjahren', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(isValidIsoDate('2024-02-29')).toBe(true);
  });

  it('lehnt den 29. Februar in Nichtschaltjahren ab', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(() => parseIsoDate('2026-02-29')).toThrow(InvalidDateError);
  });

  it('behandelt die Jahrhundertregel', () => {
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });

  it('rechnet über den 29. Februar hinweg', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
    expect(daysBetween('2025-01-01', '2026-01-01')).toBe(365);
  });
});

describe('Jahreswechsel', () => {
  it('rechnet über Silvester', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2025-12-28', '2026-01-04')).toBe(7);
  });

  it('behält den Wochentag über den Jahreswechsel bei', () => {
    // 31.12.2025 ist ein Mittwoch, 01.01.2026 ein Donnerstag.
    expect(dayOfWeek('2025-12-31')).toBe(3);
    expect(dayOfWeek('2026-01-01')).toBe(4);
  });
});

describe('dayOfWeek', () => {
  it.each([
    ['2026-04-06', 1],
    ['2026-04-07', 2],
    ['2026-04-08', 3],
    ['2026-04-09', 4],
    ['2026-04-10', 5],
    ['2026-04-11', 6],
    ['2026-04-12', 7],
  ])('%s ist Wochentag %i', (date, weekday) => {
    expect(dayOfWeek(date)).toBe(weekday);
  });

  it('erkennt Wochenenden', () => {
    expect(isWeekend('2026-04-11')).toBe(true);
    expect(isWeekend('2026-04-12')).toBe(true);
    expect(isWeekend('2026-04-13')).toBe(false);
  });
});

describe('Vergleich und Formatierung', () => {
  it('sortiert', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-01')).toBe(1);
    expect(compareDates('2026-01-01', '2026-01-01')).toBe(0);
    expect(['2026-05-01', '2026-01-01', '2026-03-01'].sort(compareDates)).toEqual([
      '2026-01-01',
      '2026-03-01',
      '2026-05-01',
    ]);
  });

  it('bildet Höchst- und Kleinstwerte', () => {
    expect(maxDate('2026-01-01', '2026-07-01', '2026-03-01')).toBe('2026-07-01');
    expect(minDate('2026-01-01', '2026-07-01', '2026-03-01')).toBe('2026-01-01');
    expect(() => maxDate()).toThrow(RangeError);
  });

  it('formatiert mit führenden Nullen', () => {
    expect(formatIsoDate({ year: 2026, month: 4, day: 5 })).toBe('2026-04-05');
    expect(makeIsoDate(2026, 12, 31)).toBe('2026-12-31');
  });

  it('weist unsinnige Eingaben zurück', () => {
    expect(isValidIsoDate('05.04.2026')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-04-31')).toBe(false);
    expect(isValidIsoDate(20260405)).toBe(false);
    expect(isValidIsoDate(null)).toBe(false);
  });
});

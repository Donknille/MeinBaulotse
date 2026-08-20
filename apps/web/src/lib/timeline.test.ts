import { describe, expect, it } from 'vitest';
import { barWidth, buildAxis, startOfMonth } from './timeline';
import { epochDay, fromEpochDay, isWeekendIso, monthLabel } from './format';

describe('Epochentage', () => {
  it('rechnet hin und zurück, auch über den Jahreswechsel', () => {
    for (const date of ['2026-01-01', '2026-12-31', '2027-01-01', '2028-02-29']) {
      expect(fromEpochDay(epochDay(date))).toBe(date);
    }
  });

  it('kennt das Wochenende', () => {
    // Der 1. Januar 2026 ist ein Donnerstag.
    expect(isWeekendIso('2026-01-01')).toBe(false);
    expect(isWeekendIso('2026-01-03')).toBe(true);
    expect(isWeekendIso('2026-01-04')).toBe(true);
    expect(isWeekendIso('2026-01-05')).toBe(false);
  });

  it('schreibt den Monat aus', () => {
    expect(monthLabel('2026-03-17')).toBe('März 26');
  });
});

describe('Achse', () => {
  it('legt Luft an beide Enden', () => {
    const axis = buildAxis({ dates: ['2026-04-01', '2026-04-30'], padDays: 7 });
    expect(fromEpochDay(axis.from)).toBe('2026-03-25');
    expect(fromEpochDay(axis.to)).toBe('2026-05-07');
    expect(axis.days).toBe(44);
  });

  it('übergeht fehlende Termine, statt auf ihnen zu rechnen', () => {
    const axis = buildAxis({ dates: [null, '2026-04-01', null], padDays: 0 });
    expect(axis.days).toBe(1);
    expect(axis.contains('2026-04-01')).toBe(true);
    expect(axis.contains('2026-04-02')).toBe(false);
  });

  it('bleibt ohne einen einzigen Termin leer, statt zu raten', () => {
    const axis = buildAxis({ dates: [null, null] });
    expect(axis.days).toBe(0);
    expect(axis.months).toEqual([]);
    expect(axis.contains('2026-04-01')).toBe(false);
  });

  it('teilt die Achse lückenlos in Monate', () => {
    const axis = buildAxis({ dates: ['2026-04-01', '2026-10-19'] });
    // Vom 25. März bis zum 26. Oktober: acht Monate, ohne Loch dazwischen.
    expect(axis.months.map((month) => month.iso.slice(0, 7))).toEqual([
      '2026-03', '2026-04', '2026-05', '2026-06',
      '2026-07', '2026-08', '2026-09', '2026-10',
    ]);
    for (let index = 1; index < axis.months.length; index += 1) {
      const previous = axis.months[index - 1]!;
      expect(axis.months[index]!.offsetDays).toBe(previous.offsetDays + previous.days);
    }
  });

  it('trifft den Jahreswechsel', () => {
    const axis = buildAxis({ dates: ['2026-12-20', '2027-01-10'] });
    expect(axis.months.map((month) => month.iso)).toEqual(['2026-12-01', '2027-01-01']);
    expect(axis.months[0]!.days).toBe(31);
  });

  it('rechnet den Abstand vom linken Rand in Tagen', () => {
    const axis = buildAxis({ dates: ['2026-04-01', '2026-04-30'], padDays: 0 });
    expect(axis.offsetOf('2026-04-01')).toBe(0);
    expect(axis.offsetOf('2026-04-15')).toBe(14);
  });

  it('findet den Monatsanfang', () => {
    expect(fromEpochDay(startOfMonth(epochDay('2026-07-31')))).toBe('2026-07-01');
    expect(fromEpochDay(startOfMonth(epochDay('2026-01-01')))).toBe('2026-01-01');
  });
});

describe('Balkenbreite', () => {
  it('zählt einschließend: ein Tag ist ein Tag breit, nicht null', () => {
    expect(barWidth('2026-04-01', '2026-04-01', 10)).toBe(10);
    expect(barWidth('2026-04-01', '2026-04-04', 10)).toBe(40);
  });

  it('lässt auch im gröbsten Maßstab keinen Balken verschwinden', () => {
    expect(barWidth('2026-04-01', '2026-04-01', 2.6)).toBeGreaterThan(0);
  });
});

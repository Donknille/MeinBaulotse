import { describe, expect, it } from 'vitest';
import {
  countWorkdays,
  isWorkday,
  nextWorkday,
  previousWorkday,
  workdayDifference,
  workdayEnd,
  workdayOffset,
  type Calendar,
} from './calendar.js';

const BY: Calendar = { federalState: 'BY' };
const NI: Calendar = { federalState: 'NI' };

describe('isWorkday', () => {
  it('schließt Wochenenden aus', () => {
    expect(isWorkday('2026-04-10', BY)).toBe(true); // Freitag
    expect(isWorkday('2026-04-11', BY)).toBe(false); // Samstag
    expect(isWorkday('2026-04-12', BY)).toBe(false); // Sonntag
    expect(isWorkday('2026-04-13', BY)).toBe(true); // Montag
  });

  it('schließt Feiertage des jeweiligen Landes aus', () => {
    expect(isWorkday('2026-06-04', BY)).toBe(false); // Fronleichnam
    expect(isWorkday('2026-06-04', NI)).toBe(true);
  });

  it('berücksichtigt projektweite arbeitsfreie Tage', () => {
    const withShutdown: Calendar = {
      federalState: 'BY',
      additionalNonWorkingDays: ['2026-04-13', '2026-04-14'],
    };
    expect(isWorkday('2026-04-13', withShutdown)).toBe(false);
    expect(isWorkday('2026-04-15', withShutdown)).toBe(true);
  });

  it('berücksichtigt Betriebsferien je Gewerk', () => {
    const calendar: Calendar = {
      federalState: 'BY',
      nonWorkingByTrade: { fliesen: ['2026-04-13'] },
    };
    expect(isWorkday('2026-04-13', calendar, 'fliesen')).toBe(false);
    expect(isWorkday('2026-04-13', calendar, 'maler')).toBe(true);
    expect(isWorkday('2026-04-13', calendar)).toBe(true);
  });

  it('lässt ausdrücklich angesetzte Arbeitstage zu', () => {
    const calendar: Calendar = { federalState: 'BY', additionalWorkingDays: ['2026-04-11'] };
    expect(isWorkday('2026-04-11', calendar)).toBe(true);
  });

  it('folgt einer abweichenden Arbeitswoche', () => {
    const sixDays: Calendar = { federalState: 'BY', workweek: [1, 2, 3, 4, 5, 6] };
    expect(isWorkday('2026-04-11', sixDays)).toBe(true);
    expect(isWorkday('2026-04-12', sixDays)).toBe(false);
  });
});

describe('nextWorkday / previousWorkday', () => {
  it('gibt Arbeitstage unverändert zurück', () => {
    expect(nextWorkday('2026-04-10', BY)).toBe('2026-04-10');
    expect(previousWorkday('2026-04-10', BY)).toBe('2026-04-10');
  });

  it('überspringt das Wochenende', () => {
    expect(nextWorkday('2026-04-11', BY)).toBe('2026-04-13');
    expect(previousWorkday('2026-04-11', BY)).toBe('2026-04-10');
  });

  it('überspringt zusammenhängende Feiertage', () => {
    // Karfreitag 03.04., Wochenende, Ostermontag 06.04.2026.
    expect(nextWorkday('2026-04-03', BY)).toBe('2026-04-07');
    expect(previousWorkday('2026-04-06', BY)).toBe('2026-04-02');
  });
});

describe('workdayOffset', () => {
  it('zählt vorwärts über das Wochenende', () => {
    expect(workdayOffset('2026-04-10', 1, BY)).toBe('2026-04-13');
    expect(workdayOffset('2026-04-13', 4, BY)).toBe('2026-04-17');
    expect(workdayOffset('2026-04-13', 5, BY)).toBe('2026-04-20');
  });

  it('normalisiert den Anker entgegen der Laufrichtung', () => {
    // Eine Wartezeit endet am Sonntag: der Nachfolger beginnt am Montag,
    // nicht am Dienstag.
    expect(workdayOffset('2026-04-12', 1, BY)).toBe('2026-04-13');
    expect(workdayOffset('2026-04-11', 1, BY)).toBe('2026-04-13');
    // Rückwärts spiegelverkehrt.
    expect(workdayOffset('2026-04-11', -1, BY)).toBe('2026-04-10');
  });

  it('liefert bei 0 den letzten Arbeitstag am oder vor dem Datum', () => {
    expect(workdayOffset('2026-04-10', 0, BY)).toBe('2026-04-10');
    expect(workdayOffset('2026-04-12', 0, BY)).toBe('2026-04-10');
  });

  it('zählt rückwärts', () => {
    expect(workdayOffset('2026-04-13', -1, BY)).toBe('2026-04-10');
    expect(workdayOffset('2026-04-17', -4, BY)).toBe('2026-04-13');
  });

  it('rechnet über den Jahreswechsel', () => {
    // 25./26.12.2026 sind Freitag und Samstag, Neujahr 2027 fällt auf einen
    // Freitag. Ab Montag 28.12. sind Di/Mi/Do Werktage, der vierte Schritt
    // landet daher erst am Montag 04.01.2027.
    expect(workdayOffset('2026-12-24', 1, BY)).toBe('2026-12-28');
    expect(workdayOffset('2026-12-28', 3, BY)).toBe('2026-12-31');
    expect(workdayOffset('2026-12-28', 4, BY)).toBe('2027-01-04');
    expect(workdayOffset('2026-12-31', 1, BY)).toBe('2027-01-04');
    expect(workdayOffset('2027-01-04', -4, BY)).toBe('2026-12-28');
    expect(countWorkdays('2026-12-28', '2027-01-04', BY)).toBe(5);
  });

  it('rechnet über den 29. Februar', () => {
    // 28.02.2024 ist ein Mittwoch, der 29. ein Donnerstag.
    expect(workdayOffset('2024-02-28', 1, BY)).toBe('2024-02-29');
    expect(workdayOffset('2024-02-29', 1, BY)).toBe('2024-03-01');
    expect(workdayOffset('2023-02-28', 1, BY)).toBe('2023-03-01');
  });

  it('unterscheidet die Bundesländer', () => {
    // 04.06.2026 ist Fronleichnam: in Bayern frei, in Niedersachsen nicht.
    expect(workdayOffset('2026-06-03', 1, BY)).toBe('2026-06-05');
    expect(workdayOffset('2026-06-03', 1, NI)).toBe('2026-06-04');
  });

  it('verlangt ganze Tage', () => {
    expect(() => workdayOffset('2026-04-13', 1.5, BY)).toThrow(RangeError);
  });
});

describe('workdayEnd', () => {
  it('zählt die Dauer einschließlich des Starttags', () => {
    expect(workdayEnd('2026-04-13', 1, BY)).toBe('2026-04-13');
    expect(workdayEnd('2026-04-13', 4, BY)).toBe('2026-04-16');
    expect(workdayEnd('2026-04-13', 5, BY)).toBe('2026-04-17');
    expect(workdayEnd('2026-04-13', 10, BY)).toBe('2026-04-24');
  });

  it('lehnt eine Dauer unter einem Tag ab', () => {
    expect(() => workdayEnd('2026-04-13', 0, BY)).toThrow(RangeError);
  });
});

describe('countWorkdays / workdayDifference', () => {
  it('zählt geschlossene Intervalle', () => {
    expect(countWorkdays('2026-04-13', '2026-04-17', BY)).toBe(5);
    expect(countWorkdays('2026-04-13', '2026-04-19', BY)).toBe(5);
    expect(countWorkdays('2026-04-13', '2026-04-13', BY)).toBe(1);
    expect(countWorkdays('2026-04-17', '2026-04-13', BY)).toBe(0);
  });

  it('zählt eine volle Kalenderwoche ohne Feiertage als fünf Werktage', () => {
    expect(countWorkdays('2026-04-06', '2026-04-10', BY)).toBe(4); // Ostermontag
    expect(countWorkdays('2026-04-13', '2026-04-17', BY)).toBe(5);
  });

  it('ist die Umkehrung von workdayOffset', () => {
    const from = '2026-04-13';
    for (const steps of [0, 1, 5, 12, 40]) {
      const to = workdayOffset(from, steps, BY);
      expect(workdayDifference(from, to, BY)).toBe(steps);
    }
  });

  it('hat ein Vorzeichen', () => {
    expect(workdayDifference('2026-04-13', '2026-04-10', BY)).toBe(-1);
    expect(workdayDifference('2026-04-13', '2026-04-13', BY)).toBe(0);
  });
});

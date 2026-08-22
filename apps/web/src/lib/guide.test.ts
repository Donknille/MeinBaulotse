import { describe, expect, it } from 'vitest';
import type { ScheduledTaskDto } from '@meinbaulotse/shared';
import { istImBlick, karteJetztLesen, plusTage } from './guide';

const HEUTE = '2026-05-12';

function task(overrides: Partial<ScheduledTaskDto> = {}): ScheduledTaskDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Estrich',
    phaseKey: 'ausbau',
    tradeCode: 'estrich',
    tradeName: 'Estrich',
    sortOrder: 26,
    isMilestone: false,
    isWait: false,
    durationDays: 3,
    durationUnit: 'werktage',
    currentStart: '2026-05-18',
    currentEnd: '2026-05-20',
    baselineStart: '2026-05-18',
    baselineEnd: '2026-05-20',
    earliestStart: null,
    actualStart: null,
    actualEnd: null,
    status: 'terminiert',
    confirmation: 'self_stated',
    totalFloatDays: 4,
    isCritical: false,
    guideCardKey: 'estrich',
    guideCardRead: false,
    ...overrides,
  };
}

describe('Kalenderrechnung', () => {
  it('rechnet über den Monatswechsel', () => {
    expect(plusTage('2026-05-28', 7)).toBe('2026-06-04');
  });

  it('rechnet über den Jahreswechsel', () => {
    expect(plusTage('2026-12-29', 7)).toBe('2027-01-05');
  });
});

describe('Wann eine Karte in den Blick rückt', () => {
  it('sieben Tage vor Beginn, nicht früher', () => {
    // Beginn am 18.05., heute der 12.05. — das sind sechs Tage, also drin.
    expect(istImBlick(task(), HEUTE)).toBe(true);
    // Beginn am 20.05. wären acht Tage — noch nicht.
    expect(istImBlick(task({ currentStart: '2026-05-20' }), HEUTE)).toBe(false);
    // Genau sieben Tage: die Grenze gehört dazu.
    expect(istImBlick(task({ currentStart: '2026-05-19' }), HEUTE)).toBe(true);
  });

  it('während der Ausführung', () => {
    expect(
      istImBlick(task({ currentStart: '2026-05-08', status: 'laeuft' }), HEUTE),
    ).toBe(true);
  });

  it('nicht mehr, wenn der Vorgang fertig ist', () => {
    // Zu einem erledigten Vorgang vorher zu lesen, was zu beachten gewesen
    // wäre, ist kein Hinweis mehr, sondern ein Vorwurf.
    expect(istImBlick(task({ status: 'fertig' }), HEUTE)).toBe(false);
    expect(istImBlick(task({ actualEnd: '2026-05-11' }), HEUTE)).toBe(false);
  });

  it('nicht bei einem entfallenen Vorgang', () => {
    expect(istImBlick(task({ status: 'entfallen' }), HEUTE)).toBe(false);
  });

  it('gar nicht, wenn es zu dem Vorgang keine Karte gibt', () => {
    expect(istImBlick(task({ guideCardKey: null }), HEUTE)).toBe(false);
  });

  it('nicht ohne Termin', () => {
    expect(istImBlick(task({ currentStart: null }), HEUTE)).toBe(false);
  });
});

describe('Was jetzt zu lesen ist', () => {
  it('lässt Gelesenes weg', () => {
    const offen = task({ id: '00000000-0000-4000-8000-000000000002' });
    const gelesen = task({
      id: '00000000-0000-4000-8000-000000000003',
      guideCardRead: true,
    });
    expect(karteJetztLesen([offen, gelesen], HEUTE).map((t) => t.id)).toEqual([offen.id]);
  });

  it('sortiert nach Beginn — was zuerst kommt, steht oben', () => {
    const spaeter = task({ id: '00000000-0000-4000-8000-000000000004', currentStart: '2026-05-18' });
    const frueher = task({ id: '00000000-0000-4000-8000-000000000005', currentStart: '2026-05-14' });
    expect(karteJetztLesen([spaeter, frueher], HEUTE).map((t) => t.currentStart)).toEqual([
      '2026-05-14',
      '2026-05-18',
    ]);
  });

  it('ist leer, wenn nichts ansteht', () => {
    expect(karteJetztLesen([task({ currentStart: '2026-08-01' })], HEUTE)).toEqual([]);
  });
});

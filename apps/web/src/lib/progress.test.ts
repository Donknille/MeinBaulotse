/**
 * Die Regeln aus `progress.ts` — als Gegenprobe, nicht als Zeremonie.
 *
 * Zwei davon habe ich beim Bauen falsch gehabt: „seit 1 Tagen überfällig" hat
 * so auf dem Bildschirm gestanden, und ein Vorgang mit gemeldetem Ist-Ende,
 * dessen Status noch auf „läuft" stand, galt als laufend. Beides fällt hier
 * auf, bevor es jemand sieht.
 */

import { describe, expect, it } from 'vitest';
import type { ScheduledTaskDto } from '@meinbaulotse/shared';
import { inTagen, istHeute, meldungOffen, progressOf, zaehle } from './progress';

function vorgang(overrides: Partial<ScheduledTaskDto> = {}): ScheduledTaskDto {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    name: 'Estrich',
    phaseKey: 'ausbau',
    tradeCode: 'estrich',
    tradeName: 'Estrich',
    sortOrder: 10,
    isMilestone: false,
    isWait: false,
    durationDays: 3,
    durationUnit: 'werktage',
    currentStart: '2026-08-10',
    currentEnd: '2026-08-12',
    earliestStart: null,
    baselineStart: '2026-08-10',
    baselineEnd: '2026-08-12',
    actualStart: null,
    actualEnd: null,
    status: 'terminiert',
    confirmation: 'self_stated',
    totalFloatDays: 0,
    isCritical: true,
    ...overrides,
  };
}

describe('Fortschritt eines Vorgangs', () => {
  it('nimmt ein gemeldetes Ist-Ende als fertig, auch wenn der Status hinterherhinkt', () => {
    expect(progressOf(vorgang({ status: 'laeuft', actualEnd: '2026-08-12' }))).toBe('fertig');
  });

  it('zählt „abgenommen" als fertig', () => {
    expect(progressOf(vorgang({ status: 'abgenommen' }))).toBe('fertig');
  });

  it('lässt „entfallen" alles andere überstimmen', () => {
    expect(progressOf(vorgang({ status: 'entfallen', actualEnd: '2026-08-12' }))).toBe('entfallen');
  });

  it('macht aus einem verstrichenen Termin keinen erledigten Vorgang', () => {
    // Der Kern dieser Datei: Auf einer Baustelle ist ein vorbeigezogenes
    // Enddatum oft das Gegenteil von „fertig".
    expect(progressOf(vorgang({ currentEnd: '2020-01-01' }))).toBe('geplant');
  });

  it('zählt einen Vorgang genau einmal', () => {
    const zahlen = zaehle([
      vorgang({ status: 'fertig' }),
      vorgang({ status: 'laeuft' }),
      vorgang({ status: 'entfallen' }),
      vorgang(),
    ]);
    expect(zahlen).toEqual({ gesamt: 4, fertig: 1, laeuft: 1, geplant: 1, entfallen: 1 });
  });
});

describe('Was heute läuft', () => {
  it('nimmt den Plan mit, nicht nur die Meldung', () => {
    expect(istHeute(vorgang(), '2026-08-11')).toBe(true);
  });

  it('lässt Fertiges und Entfallenes weg', () => {
    expect(istHeute(vorgang({ status: 'fertig' }), '2026-08-11')).toBe(false);
    expect(istHeute(vorgang({ status: 'entfallen' }), '2026-08-11')).toBe(false);
  });

  it('hält einen gemeldet laufenden Vorgang auch nach seinem Endtermin für heute', () => {
    // Er steht ja auf der Baustelle. Dass sein Termin vorbei ist, sagt der
    // andere Kasten.
    expect(istHeute(vorgang({ status: 'laeuft' }), '2026-08-20')).toBe(true);
  });
});

describe('Offene Meldung', () => {
  it('meldet einen Vorgang, dessen Termin vorbei ist und der nicht fertig ist', () => {
    expect(meldungOffen(vorgang(), '2026-08-13')).toBe(true);
  });

  it('schweigt am Endtermin selbst', () => {
    expect(meldungOffen(vorgang(), '2026-08-12')).toBe(false);
  });

  it('schweigt zu Fertigem', () => {
    expect(meldungOffen(vorgang({ status: 'fertig' }), '2026-08-13')).toBe(false);
  });
});

describe('Zeitangaben im Klartext', () => {
  it('sagt heute, morgen, übermorgen', () => {
    expect(inTagen('2026-08-11', '2026-08-11')).toBe('heute');
    expect(inTagen('2026-08-12', '2026-08-11')).toBe('morgen');
    expect(inTagen('2026-08-13', '2026-08-11')).toBe('übermorgen');
  });

  it('schreibt „seit gestern", nicht „seit 1 Tagen"', () => {
    expect(inTagen('2026-08-10', '2026-08-11')).toBe('seit gestern überfällig');
    expect(inTagen('2026-08-09', '2026-08-11')).toBe('seit 2 Tagen überfällig');
  });

  it('wird gröber, je weiter es weg ist', () => {
    expect(inTagen('2026-08-21', '2026-08-11')).toBe('in 10 Tagen');
    expect(inTagen('2026-08-28', '2026-08-11')).toBe('in zwei Wochen');
    expect(inTagen('2026-09-10', '2026-08-11')).toBe('in 4 Wochen');
    expect(inTagen('2026-11-11', '2026-08-11')).toBe('in 3 Monaten');
  });
});

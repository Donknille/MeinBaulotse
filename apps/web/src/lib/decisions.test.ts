/**
 * Die Regeln aus `decisions.ts` — als Gegenprobe, nicht als Zeremonie.
 *
 * Zwei davon sind leicht falsch zu bauen und schwer zu bemerken: Die
 * Restlaufzeit zählt **Werktage**, nicht Kalendertage — über ein Wochenende
 * hinweg ist das der Unterschied zwischen „noch 1" und „noch 3". Und eine
 * getroffene Entscheidung darf nicht mehr auftauchen, auch wenn ihre Frist
 * längst verstrichen ist.
 */

import { describe, expect, it } from 'vitest';
import type { Calendar } from '@meinbaulotse/schedule';
import type { DecisionDto } from '@meinbaulotse/shared';
import { overdueDecisionFor, pendingDecisions, remainingWorkdays, urgencyOf } from './decisions';

const kalender: Calendar = { federalState: 'BY', catholicMunicipality: false };

function entscheidung(overrides: Partial<DecisionDto> = {}): DecisionDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    templateKey: 'fliesen',
    title: 'Fliesen: Auswahl und Verlegemuster',
    description: null,
    reason: 'Lieferzeit. Der häufigste Grund für Verzug im Innenausbau.',
    help: {},
    blocksTaskId: '00000000-0000-4000-8000-000000000100',
    blocksTaskName: 'Fliesenarbeiten',
    blocksTaskStart: '2026-08-17',
    leadTimeDays: 40,
    leadTimeUnit: 'werktage',
    dueDate: '2026-06-22',
    status: 'offen',
    decidedAt: null,
    decidedNote: null,
    estimatedCostCents: null,
    ...overrides,
  };
}

describe('Restlaufzeit', () => {
  it('zählt Werktage, nicht Kalendertage', () => {
    // Freitag bis Montag sind drei Kalendertage und ein Werktag.
    expect(remainingWorkdays(entscheidung({ dueDate: '2026-06-22' }), kalender, '2026-06-19')).toBe(
      1,
    );
    // Mittwoch bis Montag: drei Werktage, fünf Kalendertage.
    expect(remainingWorkdays(entscheidung({ dueDate: '2026-06-15' }), kalender, '2026-06-10')).toBe(
      3,
    );
  });

  it('wird negativ, wenn die Frist verstrichen ist', () => {
    expect(remainingWorkdays(entscheidung({ dueDate: '2026-06-15' }), kalender, '2026-06-19')).toBe(
      -4,
    );
  });

  it('bleibt offen, solange der Vorgang keinen Termin hat', () => {
    expect(remainingWorkdays(entscheidung({ dueDate: null }), kalender, '2026-06-19')).toBeNull();
  });
});

describe('Dringlichkeit', () => {
  it('ist knapp ab fünf Werktagen vor der Frist', () => {
    // Montag der Vorwoche → fünf Werktage bis Montag.
    expect(urgencyOf(entscheidung({ dueDate: '2026-06-22' }), kalender, '2026-06-15')).toBe('knapp');
    // Ein Werktag früher ist es noch nicht knapp.
    expect(urgencyOf(entscheidung({ dueDate: '2026-06-22' }), kalender, '2026-06-12')).toBe('offen');
  });

  it('ist verstrichen, sobald die Frist vorbei ist', () => {
    expect(urgencyOf(entscheidung({ dueDate: '2026-06-15' }), kalender, '2026-06-16')).toBe(
      'verstrichen',
    );
  });

  it('gilt am Tag der Frist selbst noch als knapp, nicht als verstrichen', () => {
    expect(urgencyOf(entscheidung({ dueDate: '2026-06-15' }), kalender, '2026-06-15')).toBe(
      'knapp',
    );
  });

  it('ist erledigt, sobald entschieden wurde — auch bei verstrichener Frist', () => {
    // Sonst mahnte die Anwendung wegen einer Entscheidung, die längst getroffen
    // ist. Das ist der schnellste Weg, damit sie niemand mehr liest.
    for (const status of ['entschieden', 'beauftragt', 'hinfaellig'] as const) {
      expect(urgencyOf(entscheidung({ status, dueDate: '2026-01-01' }), kalender, '2026-06-15')).toBe(
        'erledigt',
      );
    }
  });
});

describe('Was jetzt ansteht', () => {
  const liste: DecisionDto[] = [
    entscheidung({ id: 'a', title: 'Fliesen', dueDate: '2026-06-22' }),
    entscheidung({ id: 'b', title: 'Fenster', dueDate: '2026-05-04' }),
    entscheidung({ id: 'c', title: 'Treppe', dueDate: '2026-07-01', status: 'beauftragt' }),
    entscheidung({ id: 'd', title: 'Ohne Frist', dueDate: null }),
  ];

  it('nennt die offenen mit Frist, die dringendste zuerst', () => {
    const anstehend = pendingDecisions(liste, kalender, '2026-04-01');
    expect(anstehend.map((entry) => entry.title)).toEqual(['Fenster', 'Fliesen']);
  });

  it('lässt Entscheidungen ohne Frist weg', () => {
    // Sie sind nicht dringend, sondern unbestimmt — und stünden sonst
    // dauerhaft ganz oben oder ganz unten, ohne dass jemand etwas tun kann.
    const anstehend = pendingDecisions(liste, kalender, '2026-04-01');
    expect(anstehend.some((entry) => entry.dueDate === null)).toBe(false);
  });
});

describe('Verzugsgrund', () => {
  const taskId = '00000000-0000-4000-8000-000000000100';

  it('findet die verstrichene Frist zu einem Vorgang', () => {
    const treffer = overdueDecisionFor(
      taskId,
      [entscheidung({ dueDate: '2026-06-01', blocksTaskId: taskId })],
      kalender,
      '2026-06-15',
    );
    expect(treffer?.title).toContain('Fliesen');
  });

  it('meldet nichts, solange die Frist noch läuft', () => {
    const treffer = overdueDecisionFor(
      taskId,
      [entscheidung({ dueDate: '2026-06-22', blocksTaskId: taskId })],
      kalender,
      '2026-06-15',
    );
    expect(treffer).toBeNull();
  });

  it('meldet nichts für einen anderen Vorgang', () => {
    const treffer = overdueDecisionFor(
      'ein-anderer-vorgang',
      [entscheidung({ dueDate: '2026-06-01', blocksTaskId: taskId })],
      kalender,
      '2026-06-15',
    );
    expect(treffer).toBeNull();
  });
});

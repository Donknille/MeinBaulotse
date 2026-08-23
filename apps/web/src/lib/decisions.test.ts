import { describe, expect, it } from 'vitest';
import type { Calendar } from '@meinbaulotse/schedule';
import type { DecisionDto } from '@meinbaulotse/shared';
import {
  DRINGLICH_AB_WERKTAGEN,
  decisionState,
  offeneEntscheidungen,
  ueberfaelligeEntscheidungenZu,
} from './decisions';

// Ein Dienstag. Der 1. Mai ist ein Feiertag in ganz Deutschland und liegt
// bewusst in Reichweite — die Werktagsrechnung soll ihn abziehen.
const HEUTE = '2026-04-28';
const KALENDER: Calendar = { federalState: 'BY', catholicMunicipality: false };

function entscheidung(overrides: Partial<DecisionDto> = {}): DecisionDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    templateKey: 'fliesen',
    title: 'Fliesen: Auswahl und Verlegemuster',
    description: 'Der häufigste Grund für Verzug im Innenausbau.',
    helpText: 'Entscheide früher, als es sich anfühlt.',
    blocksTaskId: '00000000-0000-4000-8000-000000000099',
    blocksTaskName: 'Fliesenarbeiten',
    blocksTaskStart: '2026-08-03',
    leadTimeDays: 40,
    leadTimeUnit: 'werktage',
    dueDate: '2026-05-29',
    status: 'offen',
    decidedAt: null,
    decidedNote: null,
    estimatedCostCents: null,
    ...overrides,
  };
}

describe('Wie viel Zeit noch bleibt', () => {
  it('zählt Werktage und überspringt Feiertage', () => {
    // 28.04. bis 04.05.: Do 30.04., Fr 01.05. ist Feiertag, Mo 04.05.
    const state = decisionState(entscheidung({ dueDate: '2026-05-04' }), KALENDER, HEUTE);
    expect(state.remainingWorkdays).toBe(3);
    expect(state.isOverdue).toBe(false);
  });

  it('meldet eine verstrichene Frist als offen, nicht als Fehler', () => {
    const state = decisionState(entscheidung({ dueDate: '2026-04-20' }), KALENDER, HEUTE);
    expect(state.isOverdue).toBe(true);
    expect(state.remainingWorkdays).toBeLessThan(0);
    expect(state.isUrgent).toBe(true);
  });

  it('hält eine entschiedene Sache nie für dringend', () => {
    const state = decisionState(
      entscheidung({ dueDate: '2026-04-01', status: 'entschieden' }),
      KALENDER,
      HEUTE,
    );
    expect(state.isSettled).toBe(true);
    expect(state.isOverdue).toBe(false);
    expect(state.isUrgent).toBe(false);
  });

  it('kommt ohne Frist zurecht', () => {
    const state = decisionState(entscheidung({ dueDate: null }), KALENDER, HEUTE);
    expect(state.remainingWorkdays).toBeNull();
    expect(state.isUrgent).toBe(false);
  });

  it('zieht die Grenze zur Dringlichkeit bei zwei Wochen', () => {
    const knapp = decisionState(entscheidung({ dueDate: '2026-05-11' }), KALENDER, HEUTE);
    expect(knapp.remainingWorkdays).toBeLessThanOrEqual(DRINGLICH_AB_WERKTAGEN);
    expect(knapp.isUrgent).toBe(true);

    const entspannt = decisionState(entscheidung({ dueDate: '2026-07-01' }), KALENDER, HEUTE);
    expect(entspannt.isUrgent).toBe(false);
  });
});

describe('Die offene Liste', () => {
  it('sortiert nach Frist und lässt Erledigtes weg', () => {
    const liste = offeneEntscheidungen(
      [
        entscheidung({ id: 'a'.repeat(8) + '-0000-4000-8000-000000000001', dueDate: '2026-06-01' }),
        entscheidung({ id: 'b'.repeat(8) + '-0000-4000-8000-000000000002', dueDate: '2026-05-04' }),
        entscheidung({
          id: 'c'.repeat(8) + '-0000-4000-8000-000000000003',
          dueDate: '2026-05-01',
          status: 'beauftragt',
        }),
      ],
      KALENDER,
      HEUTE,
    );

    expect(liste.map((state) => state.decision.dueDate)).toEqual(['2026-05-04', '2026-06-01']);
  });

  it('stellt Entscheidungen ohne Frist ans Ende', () => {
    const liste = offeneEntscheidungen(
      [
        entscheidung({ id: 'a'.repeat(8) + '-0000-4000-8000-000000000001', dueDate: null }),
        entscheidung({ id: 'b'.repeat(8) + '-0000-4000-8000-000000000002', dueDate: '2026-06-01' }),
      ],
      KALENDER,
      HEUTE,
    );
    expect(liste.map((state) => state.decision.dueDate)).toEqual(['2026-06-01', null]);
  });
});

describe('Verstrichene Frist als möglicher Verzugsgrund', () => {
  it('nennt sie zu dem Vorgang, an dem sie hängt', () => {
    const gefunden = ueberfaelligeEntscheidungenZu(
      '00000000-0000-4000-8000-000000000099',
      [entscheidung({ dueDate: '2026-04-01' })],
      KALENDER,
      HEUTE,
    );
    expect(gefunden).toHaveLength(1);
  });

  it('nennt keine, die rechtzeitig getroffen wurde', () => {
    const gefunden = ueberfaelligeEntscheidungenZu(
      '00000000-0000-4000-8000-000000000099',
      [entscheidung({ dueDate: '2026-04-01', status: 'entschieden' })],
      KALENDER,
      HEUTE,
    );
    expect(gefunden).toHaveLength(0);
  });

  it('nennt keine, die zu einem anderen Vorgang gehört', () => {
    const gefunden = ueberfaelligeEntscheidungenZu(
      '00000000-0000-4000-8000-000000000098',
      [entscheidung({ dueDate: '2026-04-01' })],
      KALENDER,
      HEUTE,
    );
    expect(gefunden).toHaveLength(0);
  });
});

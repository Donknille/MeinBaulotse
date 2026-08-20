import { describe, expect, it } from 'vitest';
import { currentPhaseKey } from './schedule';
import { PLAN_FIXTURE } from '../routes/plan-fixture';

const LEER = { phases: [] };

describe('laufende Phase', () => {
  it('nennt die Phase, deren Zeitraum das Datum enthält', () => {
    // Der 15.06.2026 liegt im Rohbau der Vorschau.
    expect(currentPhaseKey(PLAN_FIXTURE, '2026-06-15')).toBe('dach_huelle');
  });

  it('nimmt vor dem Baubeginn die erste Phase mit Vorgängen', () => {
    expect(currentPhaseKey(PLAN_FIXTURE, '2020-01-01')).toBe('vorbereitung');
  });

  it('nimmt nach dem Bauende die letzte', () => {
    expect(currentPhaseKey(PLAN_FIXTURE, '2099-01-01')).toBe('abnahme');
  });

  it('bleibt ohne Vorgänge ohne Antwort, statt eine zu erfinden', () => {
    expect(currentPhaseKey(LEER, '2026-06-15')).toBeUndefined();
  });
});

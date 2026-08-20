import { describe, expect, it } from 'vitest';
import type { ProjectSchedule, ScheduledTaskDto } from '@meinbaulotse/shared';
import { scheduleForView } from './role-view';
import { PLAN_FIXTURE } from '../routes/plan-fixture';

const OWNER = { role: 'owner', tradeCode: null, isPreview: false } as const;
const ELEKTRO = { role: 'trade', tradeCode: 'elektro', isPreview: true } as const;

function tradeCodes(schedule: ProjectSchedule): Set<string | null> {
  return new Set(schedule.tasks.map((task: ScheduledTaskDto) => task.tradeCode));
}

describe('Rollenansicht', () => {
  it('lässt die eigene Rolle den ganzen Plan sehen', () => {
    const result = scheduleForView(PLAN_FIXTURE, OWNER);
    expect(result.tasks).toBe(PLAN_FIXTURE.tasks);
  });

  it('beschränkt ein Einzelgewerk auf die eigenen Vorgänge', () => {
    const result = scheduleForView(PLAN_FIXTURE, ELEKTRO);

    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.tasks.length).toBeLessThan(PLAN_FIXTURE.tasks.length);
    expect(tradeCodes(result)).toEqual(new Set(['elektro']));
  });

  it('rechnet die Phasenzähler auf den Ausschnitt um', () => {
    const result = scheduleForView(PLAN_FIXTURE, ELEKTRO);

    const summe = result.phases.reduce((total, phase) => total + phase.taskCount, 0);
    expect(summe).toBe(result.tasks.length);

    // Phasen ohne eigenen Vorgang verschwinden nicht, sie werden leer. Sonst
    // sähe ein Gewerk eine Phasenleiste, in der es keine Position mehr gibt.
    expect(result.phases.length).toBe(PLAN_FIXTURE.phases.length);

    for (const phase of result.phases) {
      const eigene = result.tasks.filter((task) => task.phaseKey === phase.key);
      if (eigene.length === 0) {
        expect(phase.firstStart).toBeNull();
        expect(phase.lastEnd).toBeNull();
        continue;
      }
      const starts = eigene.map((task) => task.currentStart!).sort();
      const ends = eigene.map((task) => task.currentEnd!).sort();
      expect(phase.firstStart).toBe(starts[0]);
      expect(phase.lastEnd).toBe(ends.at(-1));
    }
  });

  it('lässt Kopfzahlen des Projekts unangetastet', () => {
    // Errechnetes Ende und Abweichung sind Aussagen über das Bauvorhaben, nicht
    // über den Ausschnitt. Sie umzurechnen hieße, dem Gewerk ein anderes
    // Bauende vorzuspiegeln als dem Bauherrn.
    const result = scheduleForView(PLAN_FIXTURE, ELEKTRO);
    expect(result.computedEnd).toBe(PLAN_FIXTURE.computedEnd);
    expect(result.deviationWorkdays).toBe(PLAN_FIXTURE.deviationWorkdays);
  });

  it('zeigt ohne gewähltes Gewerk lieber alles als das Falsche', () => {
    const result = scheduleForView(PLAN_FIXTURE, {
      role: 'trade',
      tradeCode: null,
      isPreview: true,
    });
    expect(result.tasks).toBe(PLAN_FIXTURE.tasks);
  });
});

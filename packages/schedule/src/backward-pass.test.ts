import { describe, expect, it } from 'vitest';
import { computeSchedule } from './forward-pass.js';
import { criticalPath } from './backward-pass.js';
import type { Calendar } from './calendar.js';
import type { ScheduleDependency, ScheduleTask } from './types.js';

const BY: Calendar = { federalState: 'BY' };
const MONTAG = '2026-04-13';

const task = (id: string, durationDays: number, extra: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id,
  durationDays,
  ...extra,
});
const fs = (predecessorId: string, successorId: string): ScheduleDependency => ({
  predecessorId,
  successorId,
});

function analyse(
  tasks: readonly ScheduleTask[],
  dependencies: readonly ScheduleDependency[],
  contractualEnd?: string,
) {
  const schedule = computeSchedule({ tasks, dependencies, calendar: BY, projectStart: MONTAG });
  const input = { tasks, dependencies, calendar: BY, schedule };
  return {
    schedule,
    result: criticalPath(contractualEnd === undefined ? input : { ...input, contractualEnd }),
  };
}

describe('criticalPath', () => {
  it('führt die einzige Kette vollständig als kritisch', () => {
    const { result } = analyse([task('a', 3), task('b', 2)], [fs('a', 'b')]);
    expect([...result.critical].sort()).toEqual(['a', 'b']);
    expect(result.floats.get('a')?.totalFloatDays).toBe(0);
    expect(result.floats.get('b')?.totalFloatDays).toBe(0);
  });

  it('gibt dem kürzeren Parallelzweig Puffer', () => {
    //      ┌ lang (8 WT) ┐
    // start┤             ├ ende
    //      └ kurz (3 WT) ┘
    const tasks = [task('start', 1), task('lang', 8), task('kurz', 3), task('ende', 1)];
    const dependencies = [
      fs('start', 'lang'),
      fs('start', 'kurz'),
      fs('lang', 'ende'),
      fs('kurz', 'ende'),
    ];
    const { result } = analyse(tasks, dependencies);

    expect(result.floats.get('lang')?.totalFloatDays).toBe(0);
    expect(result.floats.get('kurz')?.totalFloatDays).toBe(5);
    expect(result.floats.get('kurz')?.isCritical).toBe(false);
    expect([...result.critical].sort()).toEqual(['ende', 'lang', 'start']);
  });

  it('verteilt Puffer über eine ganze Nebenkette', () => {
    const tasks = [task('start', 1), task('lang', 10), task('n1', 2), task('n2', 2), task('ende', 1)];
    const dependencies = [
      fs('start', 'lang'),
      fs('start', 'n1'),
      fs('n1', 'n2'),
      fs('lang', 'ende'),
      fs('n2', 'ende'),
    ];
    const { result } = analyse(tasks, dependencies);
    expect(result.floats.get('n1')?.totalFloatDays).toBe(6);
    expect(result.floats.get('n2')?.totalFloatDays).toBe(6);
  });

  it('rechnet gegen einen geschuldeten Endtermin und erzeugt negativen Puffer', () => {
    const { schedule, result } = analyse([task('a', 10)], [], '2026-04-20');
    expect(schedule.projectEnd).toBe('2026-04-24');
    // Vier Werktage später als geschuldet.
    expect(result.deviationWorkdays).toBe(4);
    expect(result.floats.get('a')?.totalFloatDays).toBe(-4);
    expect(result.floats.get('a')?.isCritical).toBe(true);
  });

  it('erzeugt bei einem großzügigen Endtermin Puffer für alle', () => {
    const { result } = analyse([task('a', 5)], [], '2026-05-08');
    // Der Vorgang endet am 17.04., geschuldet ist der 08.05. — dazwischen
    // liegen 14 Werktage, der 01.05. ist Feiertag.
    expect(result.deviationWorkdays).toBe(-14);
    expect(result.floats.get('a')?.totalFloatDays).toBe(14);
  });

  it('gibt Wartezeiten keinen Puffer, wenn sie auf der längsten Kette liegen', () => {
    const tasks = [
      task('a', 2),
      task('w', 10, { isWait: true, durationUnit: 'kalendertage' }),
      task('b', 2),
    ];
    const { result } = analyse(tasks, [fs('a', 'w'), fs('w', 'b')]);
    expect(result.floats.get('w')?.totalFloatDays).toBe(0);
    expect(result.floats.get('w')?.isCritical).toBe(true);
  });

  it('nennt bei fehlendem Vertragstermin keine Abweichung', () => {
    const { result } = analyse([task('a', 3)], []);
    expect(result.deviationWorkdays).toBe(0);
    expect(result.targetEnd).toBe('2026-04-15');
  });
});

import { describe, expect, it } from 'vitest';
import { computeSchedule } from './forward-pass.js';
import { CycleError } from './graph.js';
import type { Calendar } from './calendar.js';
import type { ScheduleDependency, ScheduleTask } from './types.js';

const BY: Calendar = { federalState: 'BY' };
const NI: Calendar = { federalState: 'NI' };

/** 13.04.2026 ist ein Montag. */
const MONTAG = '2026-04-13';

const task = (id: string, durationDays: number, extra: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id,
  durationDays,
  ...extra,
});

const fs = (
  predecessorId: string,
  successorId: string,
  extra: Partial<ScheduleDependency> = {},
): ScheduleDependency => ({ predecessorId, successorId, ...extra });

function run(
  tasks: readonly ScheduleTask[],
  dependencies: readonly ScheduleDependency[],
  calendar: Calendar = BY,
  projectStart = MONTAG,
) {
  return computeSchedule({ tasks, dependencies, calendar, projectStart });
}

describe('computeSchedule — Grundlagen', () => {
  it('legt einen Vorgang ohne Vorgänger auf den Projektstart', () => {
    const result = run([task('a', 5)], []);
    expect(result.tasks.get('a')).toMatchObject({ start: MONTAG, end: '2026-04-17' });
    expect(result.projectEnd).toBe('2026-04-17');
  });

  it('schiebt einen Projektstart am Wochenende auf den nächsten Werktag', () => {
    const result = run([task('a', 1)], [], BY, '2026-04-11');
    expect(result.tasks.get('a')?.start).toBe('2026-04-13');
  });

  it('achtet auf eine Anfangsbeschränkung', () => {
    const result = run([task('a', 1, { earliestStart: '2026-04-20' })], []);
    expect(result.tasks.get('a')?.start).toBe('2026-04-20');
  });

  it('setzt einen Meilenstein auf Start gleich Ende', () => {
    const result = run([task('a', 2), task('m', 0, { isMilestone: true })], [fs('a', 'm')]);
    const milestone = result.tasks.get('m')!;
    expect(milestone.start).toBe(milestone.end);
    expect(milestone.start).toBe('2026-04-15');
  });
});

describe('computeSchedule — Anordnungsbeziehungen', () => {
  it('FS reiht hintereinander', () => {
    const result = run([task('a', 3), task('b', 2)], [fs('a', 'b')]);
    expect(result.tasks.get('a')?.end).toBe('2026-04-15');
    expect(result.tasks.get('b')?.start).toBe('2026-04-16');
    expect(result.tasks.get('b')?.end).toBe('2026-04-17');
  });

  it('FS mit positivem Lag lässt Zeit dazwischen', () => {
    const result = run([task('a', 3), task('b', 2)], [fs('a', 'b', { lagDays: 2 })]);
    expect(result.tasks.get('b')?.start).toBe('2026-04-20');
  });

  it('FS mit negativem Lag zieht den Nachfolger vor', () => {
    const result = run([task('a', 5), task('b', 2)], [fs('a', 'b', { lagDays: -2 })]);
    // a endet Freitag 17.04.; zwei Werktage früher beginnt b am Donnerstag 16.04.
    expect(result.tasks.get('b')?.start).toBe('2026-04-16');
  });

  it('SS startet gemeinsam', () => {
    const result = run([task('a', 5), task('b', 2)], [fs('a', 'b', { type: 'SS' })]);
    expect(result.tasks.get('b')?.start).toBe(MONTAG);
  });

  it('SS mit Lag startet versetzt', () => {
    const result = run([task('a', 5), task('b', 2)], [fs('a', 'b', { type: 'SS', lagDays: 2 })]);
    expect(result.tasks.get('b')?.start).toBe('2026-04-15');
  });

  it('FF endet gemeinsam', () => {
    const result = run([task('a', 5), task('b', 2)], [fs('a', 'b', { type: 'FF' })]);
    expect(result.tasks.get('b')?.end).toBe('2026-04-17');
    expect(result.tasks.get('b')?.start).toBe('2026-04-16');
  });

  it('nimmt bei mehreren Vorgängern den spätesten', () => {
    const result = run(
      [task('a', 2), task('b', 6), task('c', 1)],
      [fs('a', 'c'), fs('b', 'c')],
    );
    expect(result.tasks.get('b')?.end).toBe('2026-04-20');
    expect(result.tasks.get('c')?.start).toBe('2026-04-21');
  });

  it('meldet Zyklen', () => {
    expect(() => run([task('a', 1), task('b', 1)], [fs('a', 'b'), fs('b', 'a')])).toThrow(
      CycleError,
    );
  });
});

describe('computeSchedule — Wartezeiten', () => {
  it('läuft in Kalendertagen und beginnt direkt nach dem Vorgänger', () => {
    // a endet Freitag 17.04. Die Aushärtung beginnt am Samstag.
    const result = run(
      [task('a', 5), task('w', 3, { isWait: true, durationUnit: 'kalendertage' }), task('b', 2)],
      [fs('a', 'w'), fs('w', 'b')],
    );
    expect(result.tasks.get('w')).toMatchObject({ start: '2026-04-18', end: '2026-04-20' });
    // Die Wartezeit endet am Montag, der Nachfolger beginnt am Dienstag.
    expect(result.tasks.get('b')?.start).toBe('2026-04-21');
  });

  it('endet am Sonntag und übergibt an den Montag', () => {
    // a endet Donnerstag 16.04., Wartezeit Fr–So.
    const result = run(
      [task('a', 4), task('w', 3, { isWait: true, durationUnit: 'kalendertage' }), task('b', 1)],
      [fs('a', 'w'), fs('w', 'b')],
    );
    expect(result.tasks.get('w')).toMatchObject({ start: '2026-04-17', end: '2026-04-19' });
    expect(result.tasks.get('b')?.start).toBe('2026-04-20');
  });

  it('läuft über Weihnachten durch', () => {
    const result = run(
      [task('a', 1), task('w', 10, { isWait: true, durationUnit: 'kalendertage' }), task('b', 1)],
      [fs('a', 'w'), fs('w', 'b')],
      BY,
      '2026-12-21',
    );
    expect(result.tasks.get('a')?.end).toBe('2026-12-21');
    expect(result.tasks.get('w')).toMatchObject({ start: '2026-12-22', end: '2026-12-31' });
    // 01.01.2027 ist Neujahr, danach Wochenende.
    expect(result.tasks.get('b')?.start).toBe('2027-01-04');
  });

  it('markiert die Einheit im Ergebnis', () => {
    const result = run([task('w', 5, { isWait: true, durationUnit: 'kalendertage' })], []);
    expect(result.tasks.get('w')).toMatchObject({ isWait: true, durationUnit: 'kalendertage' });
  });
});

describe('computeSchedule — Ist-Termine', () => {
  it('ein gemeldeter Beginn schlägt die Rechnung und pflanzt sich fort', () => {
    const result = run(
      [task('a', 3, { actualStart: '2026-04-20' }), task('b', 2)],
      [fs('a', 'b')],
    );
    expect(result.tasks.get('a')).toMatchObject({ start: '2026-04-20', end: '2026-04-22', pinned: true });
    expect(result.tasks.get('b')?.start).toBe('2026-04-23');
  });

  it('ein gemeldetes Ende rechnet den Beginn zurück', () => {
    const result = run([task('a', 3, { actualEnd: '2026-04-22' })], []);
    expect(result.tasks.get('a')).toMatchObject({ start: '2026-04-20', end: '2026-04-22' });
  });

  it('lässt unberührte Vorgänge ungepinnt', () => {
    const result = run([task('a', 3)], []);
    expect(result.tasks.get('a')?.pinned).toBe(false);
  });
});

describe('computeSchedule — Kalender', () => {
  it('berücksichtigt Feiertage des Bundeslands', () => {
    // Fronleichnam 04.06.2026 ist in Bayern frei, in Niedersachsen nicht.
    const tasks = [task('a', 5)];
    const bavarian = run(tasks, [], BY, '2026-06-01');
    const lowerSaxon = run(tasks, [], NI, '2026-06-01');
    expect(bavarian.tasks.get('a')?.end).toBe('2026-06-08');
    expect(lowerSaxon.tasks.get('a')?.end).toBe('2026-06-05');
  });

  it('berücksichtigt Betriebsferien eines Gewerks', () => {
    const calendar: Calendar = {
      federalState: 'BY',
      nonWorkingByTrade: { fliesen: ['2026-04-14', '2026-04-15'] },
    };
    const result = run([task('a', 3, { tradeCode: 'fliesen' })], [], calendar);
    expect(result.tasks.get('a')?.end).toBe('2026-04-17');
  });
});

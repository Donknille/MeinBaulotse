import { describe, expect, it } from 'vitest';
import { decisionDueDate, decisionDueDates, type ScheduleDecision } from './decisions.js';
import type { Calendar } from './calendar.js';

const BY: Calendar = { federalState: 'BY' };

const fliesen: ScheduleDecision = {
  id: 'd-fliesen',
  blocksTaskId: 't28',
  leadTimeDays: 40,
};

describe('decisionDueDate', () => {
  it('rechnet die Vorlaufzeit in Werktagen zurück', () => {
    // 40 Werktage vor Montag 13.07.2026. Bayern hat dazwischen vier
    // Feiertage: 01.05., Christi Himmelfahrt, Pfingstmontag, Fronleichnam.
    expect(decisionDueDate(fliesen, '2026-07-13', BY)).toBe('2026-05-13');
  });

  it('rechnet auf Wunsch in Kalendertagen', () => {
    expect(
      decisionDueDate({ ...fliesen, leadTimeUnit: 'kalendertage' }, '2026-07-13', BY),
    ).toBe('2026-06-03');
  });

  it('berücksichtigt Feiertage des Bundeslands', () => {
    const withoutHolidays = decisionDueDate(fliesen, '2026-07-13', { federalState: 'HH' });
    const withHolidays = decisionDueDate(fliesen, '2026-07-13', BY);
    // Bayern hat in diesem Zeitraum mehr Feiertage, die Frist rückt weiter nach vorn.
    expect(withHolidays < withoutHolidays).toBe(true);
  });
});

describe('decisionDueDates', () => {
  const starts = new Map([
    ['t28', '2026-07-13'],
    ['t18', '2026-05-04'],
  ]);

  it('rechnet alle Fristen', () => {
    const decisions: ScheduleDecision[] = [
      fliesen,
      { id: 'd-fenster', blocksTaskId: 't18', leadTimeDays: 60 },
    ];
    const result = decisionDueDates(decisions, starts, BY);
    expect(result.get('d-fliesen')?.dueDate).toBe('2026-05-13');
    expect(result.get('d-fenster')?.dueDate).toBe('2026-02-04');
  });

  it('verschiebt die Frist mit dem Vorgang', () => {
    const spaeter = new Map([['t28', '2026-07-27']]);
    const original = decisionDueDates([fliesen], starts, BY).get('d-fliesen')!.dueDate;
    const verschoben = decisionDueDates([fliesen], spaeter, BY).get('d-fliesen')!.dueDate;
    expect(verschoben > original).toBe(true);
  });

  it('zieht die Frist mit, wenn der Vorgang vorgezogen wird', () => {
    // Der Fliesenvorgang rückt um zehn Werktage nach vorn.
    const vorgezogen = new Map([['t28', '2026-06-29']]);
    const original = decisionDueDates([fliesen], starts, BY, '2026-05-04').get('d-fliesen')!;
    const enger = decisionDueDates([fliesen], vorgezogen, BY, '2026-05-04').get('d-fliesen')!;
    expect(enger.dueDate < original.dueDate).toBe(true);
    expect(enger.remainingWorkdays).toBeLessThan(original.remainingWorkdays);
  });

  it('führt eine Frist in der Vergangenheit als überfällig', () => {
    const result = decisionDueDates([fliesen], starts, BY, '2026-06-01');
    expect(result.get('d-fliesen')?.isOverdue).toBe(true);
    expect(result.get('d-fliesen')?.remainingWorkdays).toBeLessThan(0);
  });

  it('führt eine künftige Frist nicht als überfällig', () => {
    const result = decisionDueDates([fliesen], starts, BY, '2026-05-04');
    expect(result.get('d-fliesen')?.isOverdue).toBe(false);
    expect(result.get('d-fliesen')?.remainingWorkdays).toBeGreaterThan(0);
  });

  it('übergeht Entscheidungen ohne zugehörigen Vorgang', () => {
    const result = decisionDueDates([{ ...fliesen, blocksTaskId: 'weg' }], starts, BY);
    expect(result.size).toBe(0);
  });
});

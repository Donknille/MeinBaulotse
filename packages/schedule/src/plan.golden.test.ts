import { describe, expect, it } from 'vitest';
import { computeSchedule } from './forward-pass.js';
import { criticalPath } from './backward-pass.js';
import { instantiateTemplate } from './instantiate.js';
import { EFH_MASSIV_UNTERKELLERT } from './templates/efh-massiv-unterkellert.js';
import { countWorkdays, type Calendar } from './calendar.js';

/**
 * Golden-Test der vollständigen Ablaufvorlage.
 *
 * Fester Baustart, festes Bundesland, feste Vorlage — jede Änderung an der
 * Terminlogik schlägt hier sichtbar durch. Das ist Absicht: Ein stiller
 * Versatz um einen Tag ist genau der Fehler, den man sonst erst auf der
 * Baustelle bemerkt.
 */

const BAUSTART = '2026-04-01';
const BY: Calendar = { federalState: 'BY' };

function plan(hasBasement: boolean, calendar: Calendar = BY) {
  const instantiated = instantiateTemplate(EFH_MASSIV_UNTERKELLERT, { hasBasement });
  const schedule = computeSchedule({
    tasks: instantiated.tasks,
    dependencies: instantiated.dependencies,
    calendar,
    projectStart: BAUSTART,
  });
  const floats = criticalPath({
    tasks: instantiated.tasks,
    dependencies: instantiated.dependencies,
    calendar,
    schedule,
  });
  return { instantiated, schedule, floats };
}

function table(hasBasement: boolean): string {
  const { instantiated, schedule } = plan(hasBasement);
  return instantiated.tasks
    .map((task) => {
      const scheduled = schedule.tasks.get(task.id)!;
      return `${task.code} ${scheduled.start} ${scheduled.end}`;
    })
    .join('\n');
}

describe('Vollständiger Plan mit Keller, Baustart 01.04.2026, Bayern', () => {
  it('erzeugt 38 Vorgänge', () => {
    expect(plan(true).instantiated.tasks).toHaveLength(38);
  });

  it('liegt bei einer plausiblen Bauzeit', () => {
    const { schedule } = plan(true);
    expect(schedule.projectEnd).toBe('2026-10-19');
    // Gut sechseinhalb Monate für ein unterkellertes Einfamilienhaus.
    const workdays = countWorkdays(BAUSTART, schedule.projectEnd, BY);
    expect(workdays).toBeGreaterThan(120);
    expect(workdays).toBeLessThan(160);
  });

  it('hält die tragenden Termine ein', () => {
    const { schedule } = plan(true);
    const at = (code: string) => schedule.tasks.get(code)!;

    // Ostern 2026: Karfreitag 03.04., Ostermontag 06.04.
    expect(at('t01')).toMatchObject({ start: '2026-04-01', end: '2026-04-16' });
    // Aushärtung der Bodenplatte läuft in Kalendertagen und beginnt sofort.
    expect(at('t06').end).toBe('2026-04-20');
    expect(at('t07')).toMatchObject({ start: '2026-04-21', end: '2026-04-23' });
    expect(at('t08').start).toBe('2026-04-24');
    // Meilensteine
    expect(at('t15')).toMatchObject({ start: '2026-06-12', end: '2026-06-12' });
    expect(at('t19')).toMatchObject({ start: '2026-06-29', end: '2026-06-29' });
    expect(at('t37')).toMatchObject({ start: '2026-10-16', end: '2026-10-16' });
    // 35 Kalendertage Trocknung, danach die Fliesen am nächsten Werktag.
    expect(at('t26').end).toBe('2026-08-04');
    expect(at('t27')).toMatchObject({ start: '2026-08-05', end: '2026-09-08' });
    expect(at('t28').start).toBe('2026-09-09');
  });

  it('führt den kritischen Pfad über Rohbau, Estrich und Trocknung', () => {
    const { floats } = plan(true);
    for (const code of ['t06', 't07', 't08', 't12', 't15', 't19', 't26', 't27', 't28', 't37']) {
      expect(floats.floats.get(code)?.isCritical, `${code} sollte kritisch sein`).toBe(true);
    }
    // Nebenzweige haben Puffer.
    expect(floats.floats.get('t18')?.totalFloatDays).toBe(3);
    expect(floats.floats.get('t29')?.totalFloatDays).toBe(35);
    expect(floats.floats.get('t35')?.totalFloatDays).toBe(70);
  });

  it('bleibt bei jedem Termin auf einem zulässigen Tag', () => {
    const { instantiated, schedule } = plan(true);
    for (const task of instantiated.tasks) {
      const scheduled = schedule.tasks.get(task.id)!;
      if (task.isWait) continue; // Wartezeiten dürfen auf Wochenenden liegen.
      expect(countWorkdays(scheduled.start, scheduled.start, BY), task.code).toBe(1);
      expect(countWorkdays(scheduled.end, scheduled.end, BY), task.code).toBe(1);
    }
  });

  it('entspricht der festgehaltenen Terminlage', () => {
    expect(table(true)).toMatchInlineSnapshot(`
      "t01 2026-04-01 2026-04-16
      t02 2026-04-01 2026-04-01
      t03 2026-04-02 2026-04-07
      t04 2026-04-08 2026-04-10
      t05 2026-04-13 2026-04-14
      t06 2026-04-15 2026-04-20
      t07 2026-04-21 2026-04-23
      t08 2026-04-24 2026-05-06
      t09 2026-05-07 2026-05-12
      t10 2026-05-13 2026-05-18
      t11 2026-05-19 2026-05-20
      t12 2026-05-13 2026-05-26
      t13 2026-05-27 2026-06-01
      t14 2026-06-02 2026-06-11
      t15 2026-06-12 2026-06-12
      t16 2026-06-15 2026-06-18
      t17 2026-06-19 2026-06-26
      t18 2026-06-19 2026-06-23
      t19 2026-06-29 2026-06-29
      t20 2026-06-30 2026-07-09
      t21 2026-06-30 2026-07-09
      t22 2026-07-10 2026-07-15
      t23 2026-07-16 2026-07-16
      t24 2026-07-17 2026-07-28
      t25 2026-07-17 2026-07-30
      t26 2026-07-31 2026-08-04
      t27 2026-08-05 2026-09-08
      t28 2026-09-09 2026-09-18
      t29 2026-07-29 2026-07-31
      t30 2026-09-21 2026-09-30
      t31 2026-10-01 2026-10-07
      t32 2026-10-01 2026-10-02
      t33 2026-10-08 2026-10-13
      t34 2026-10-08 2026-10-13
      t35 2026-06-30 2026-07-13
      t36 2026-10-14 2026-10-15
      t37 2026-10-16 2026-10-16
      t38 2026-10-19 2026-10-19"
    `);
  });
});

describe('Vollständiger Plan ohne Keller', () => {
  it('erzeugt 34 Vorgänge und wird früher fertig', () => {
    const { instantiated, schedule } = plan(false);
    expect(instantiated.tasks).toHaveLength(34);
    expect(schedule.projectEnd).toBe('2026-10-01');
  });

  it('hängt das Erdgeschoss direkt an die Aushärtung der Bodenplatte', () => {
    const { schedule } = plan(false);
    expect(schedule.tasks.get('t07')?.end).toBe('2026-04-23');
    expect(schedule.tasks.get('t12')?.start).toBe('2026-04-24');
    expect(schedule.tasks.has('t08')).toBe(false);
  });

  it('entspricht der festgehaltenen Terminlage', () => {
    expect(table(false)).toMatchInlineSnapshot(`
      "t01 2026-04-01 2026-04-16
      t02 2026-04-01 2026-04-01
      t03 2026-04-02 2026-04-07
      t04 2026-04-08 2026-04-10
      t05 2026-04-13 2026-04-14
      t06 2026-04-15 2026-04-20
      t07 2026-04-21 2026-04-23
      t12 2026-04-24 2026-05-06
      t13 2026-05-07 2026-05-12
      t14 2026-05-13 2026-05-22
      t15 2026-05-26 2026-05-26
      t16 2026-05-27 2026-06-01
      t17 2026-06-02 2026-06-10
      t18 2026-06-02 2026-06-05
      t19 2026-06-11 2026-06-11
      t20 2026-06-12 2026-06-23
      t21 2026-06-12 2026-06-23
      t22 2026-06-24 2026-06-29
      t23 2026-06-30 2026-06-30
      t24 2026-07-01 2026-07-10
      t25 2026-07-01 2026-07-14
      t26 2026-07-15 2026-07-17
      t27 2026-07-18 2026-08-21
      t28 2026-08-24 2026-09-02
      t29 2026-07-13 2026-07-15
      t30 2026-09-03 2026-09-14
      t31 2026-09-15 2026-09-21
      t32 2026-09-15 2026-09-16
      t33 2026-09-22 2026-09-25
      t34 2026-09-22 2026-09-25
      t35 2026-06-12 2026-06-25
      t36 2026-09-28 2026-09-29
      t37 2026-09-30 2026-09-30
      t38 2026-10-01 2026-10-01"
    `);
  });
});

describe('Das Bundesland verändert den Plan', () => {
  it('bringt Niedersachsen früher ans Ziel als Bayern', () => {
    const bayern = plan(true, { federalState: 'BY' }).schedule;
    const niedersachsen = plan(true, { federalState: 'NI' }).schedule;
    // Bayern hat zwischen April und Oktober mehr gesetzliche Feiertage.
    expect(niedersachsen.projectEnd < bayern.projectEnd).toBe(true);
  });

  it('rechnet auch mit einem katholischen Gemeindekalender', () => {
    const ohne = plan(true, { federalState: 'SN' }).schedule;
    const mit = plan(true, { federalState: 'SN', catholicMunicipality: true }).schedule;
    expect(mit.projectEnd >= ohne.projectEnd).toBe(true);
  });
});

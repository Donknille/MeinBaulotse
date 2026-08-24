import { describe, expect, it } from 'vitest';
import { proposeShift } from './propagate.js';
import { computeSchedule } from './forward-pass.js';
import { workdayOffset, type Calendar } from './calendar.js';
import { instantiateTemplate } from './instantiate.js';
import { EFH_MASSIV_UNTERKELLERT } from './templates/efh-massiv-unterkellert.js';
import type { ScheduleDependency, ScheduleTask } from './types.js';

const calendar: Calendar = { federalState: 'BY' };
const PROJECT_START = '2026-04-01';

/** Eine Kette A → B → C, drei Werktage je Vorgang. */
const KETTE: ScheduleTask[] = [
  { id: 'a', durationDays: 3 },
  { id: 'b', durationDays: 3 },
  { id: 'c', durationDays: 3 },
];
const KANTEN: ScheduleDependency[] = [
  { predecessorId: 'a', successorId: 'b' },
  { predecessorId: 'b', successorId: 'c' },
];

function mitBeschraenkung(
  tasks: readonly ScheduleTask[],
  id: string,
  earliestStart: string,
): ScheduleTask[] {
  return tasks.map((task) => (task.id === id ? { ...task, earliestStart } : task));
}

describe('Was zieht mit', () => {
  it('nennt die Folgevorgänge und lässt den Auslöser nicht doppelt auftauchen', () => {
    const vorschlag = proposeShift({
      tasks: KETTE,
      changed: mitBeschraenkung(KETTE, 'a', '2026-04-08'),
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: 'a',
    });

    expect(vorschlag.trigger?.taskId).toBe('a');
    expect(vorschlag.affected.map((eintrag) => eintrag.taskId)).toEqual(['b', 'c']);
  });

  it('sagt für jeden Vorgang, woher wohin und um wie viele Werktage', () => {
    const vorschlag = proposeShift({
      tasks: KETTE,
      changed: mitBeschraenkung(KETTE, 'a', '2026-04-08'),
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: 'a',
    });

    // Die Woche nach dem 1. April 2026 hat in Bayern zwei Feiertage:
    // Karfreitag am 3. und Ostermontag am 6. Dass `b` deshalb erst am 8.
    // beginnt und die Verschiebung drei Werktage zählt und nicht fünf
    // Kalendertage, ist keine Nebensache — es ist der Grund, warum diese
    // Rechnung im Kern steht und nicht in der Oberfläche.
    const b = vorschlag.affected.find((eintrag) => eintrag.taskId === 'b')!;
    expect(b.fromStart).toBe('2026-04-08');
    expect(b.toStart).toBe('2026-04-13');
    expect(b.shiftWorkdays).toBe(3);
  });

  it('meldet nichts, wenn sich nichts bewegt', () => {
    const vorschlag = proposeShift({
      tasks: KETTE,
      changed: KETTE,
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: 'a',
    });

    expect(vorschlag.trigger).toBeNull();
    expect(vorschlag.affected).toEqual([]);
    expect(vorschlag.effectWorkdays).toBe(0);
  });

  it('rechnet die Auswirkung auf den Endtermin in Werktagen', () => {
    const vorschlag = proposeShift({
      tasks: KETTE,
      changed: mitBeschraenkung(KETTE, 'a', '2026-04-08'),
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: 'a',
    });

    expect(vorschlag.effectWorkdays).toBe(3);
    expect(vorschlag.projectEndAfter > vorschlag.projectEndBefore).toBe(true);
  });

  it('bewegt einen Vorgang mit Puffer nicht mit', () => {
    // `d` hängt an nichts und liegt am Anfang. Eine Verschiebung von `a` geht
    // an ihm vorbei — sonst schlüge der Vorschlag den halben Plan vor.
    const tasks: ScheduleTask[] = [...KETTE, { id: 'd', durationDays: 2 }];
    const vorschlag = proposeShift({
      tasks,
      changed: mitBeschraenkung(tasks, 'a', '2026-04-08'),
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: 'a',
    });

    expect(vorschlag.affected.map((eintrag) => eintrag.taskId)).not.toContain('d');
  });
});

describe('Einzelentkopplung', () => {
  it('lässt den entkoppelten Vorgang stehen', () => {
    const vorher = computeSchedule({
      tasks: KETTE,
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
    });

    const vorschlag = proposeShift({
      tasks: KETTE,
      changed: mitBeschraenkung(KETTE, 'a', '2026-04-08'),
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: 'a',
      decouple: ['b'],
    });

    expect(vorschlag.after.tasks.get('b')!.start).toBe(vorher.tasks.get('b')!.start);
    expect(vorschlag.affected.map((eintrag) => eintrag.taskId)).not.toContain('b');
  });

  it('schirmt damit alles ab, was dahinter liegt', () => {
    // Der Nachfolger des entkoppelten Vorgangs sieht einen Vorgänger, der sich
    // nicht bewegt hat. Er bleibt deshalb ebenfalls stehen, ohne dass ihn
    // jemand einzeln entkoppeln müsste.
    const vorher = computeSchedule({
      tasks: KETTE,
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
    });

    const vorschlag = proposeShift({
      tasks: KETTE,
      changed: mitBeschraenkung(KETTE, 'a', '2026-04-08'),
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: 'a',
      decouple: ['b'],
    });

    expect(vorschlag.after.tasks.get('c')!.start).toBe(vorher.tasks.get('c')!.start);
    expect(vorschlag.affected).toEqual([]);
    expect(vorschlag.effectWorkdays).toBe(0);
  });

  it('schreibt die Überlappung als negativen Vorlauf fest', () => {
    const vorschlag = proposeShift({
      tasks: KETTE,
      changed: mitBeschraenkung(KETTE, 'a', '2026-04-08'),
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: 'a',
      decouple: ['b'],
    });

    // Nicht „Beziehung gelöscht", sondern „die beiden überlappen jetzt". Die
    // Aussage bleibt in den Daten und ist später wiederzufinden.
    expect(vorschlag.lagAdjustments).toHaveLength(1);
    const angepasst = vorschlag.lagAdjustments[0]!;
    expect(angepasst.predecessorId).toBe('a');
    expect(angepasst.successorId).toBe('b');
    expect(angepasst.toLagDays).toBeLessThan(0);
  });

  it('hält den Vorgang auch gegen ein Vorziehen fest', () => {
    // Ohne die Anfangsbeschränkung rutschte der entkoppelte Vorgang nach vorn,
    // sobald der gesenkte Vorlauf ihn nicht mehr hält.
    const vorschlag = proposeShift({
      tasks: KETTE,
      changed: mitBeschraenkung(KETTE, 'a', '2026-04-08'),
      dependencies: KANTEN,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: 'a',
      decouple: ['b'],
    });

    const festgehalten = vorschlag.pinnedStarts.find((eintrag) => eintrag.taskId === 'b');
    expect(festgehalten?.earliestStart).toBe('2026-04-08');
  });

  it('hält einen Vorgang mit zwei Vorgängern an beiden fest', () => {
    // Ein gesenkter Vorlauf allein genügt nicht, wenn der zweite Vorgänger
    // ebenfalls schiebt. Beide müssen nachgeben, sonst steht der Vorgang
    // trotzdem später.
    const tasks: ScheduleTask[] = [
      { id: 'p1', durationDays: 3 },
      { id: 'p2', durationDays: 3 },
      { id: 's', durationDays: 2 },
    ];
    const kanten: ScheduleDependency[] = [
      { predecessorId: 'p1', successorId: 's' },
      { predecessorId: 'p2', successorId: 's' },
    ];
    const vorher = computeSchedule({
      tasks,
      dependencies: kanten,
      calendar,
      projectStart: PROJECT_START,
    });

    const vorschlag = proposeShift({
      tasks,
      changed: tasks.map((task) =>
        task.id === 'p1'
          ? { ...task, earliestStart: '2026-04-15' }
          : task.id === 'p2'
            ? { ...task, earliestStart: '2026-04-20' }
            : task,
      ),
      dependencies: kanten,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: 'p1',
      decouple: ['s'],
    });

    expect(vorschlag.after.tasks.get('s')!.start).toBe(vorher.tasks.get('s')!.start);
    expect(vorschlag.lagAdjustments).toHaveLength(2);
  });
});

describe('An der echten Ablaufvorlage', () => {
  const plan = instantiateTemplate(EFH_MASSIV_UNTERKELLERT, { hasBasement: true });
  const idOf = (code: string): string => plan.tasks.find((task) => task.code === code)!.id;

  function verschiebe(code: string, werktage: number, decouple: string[] = []) {
    const ziel = idOf(code);
    const basis = computeSchedule({
      tasks: plan.tasks,
      dependencies: plan.dependencies,
      calendar,
      projectStart: PROJECT_START,
    });
    const neu = workdayOffset(basis.tasks.get(ziel)!.start, werktage, calendar);
    return proposeShift({
      tasks: plan.tasks,
      changed: plan.tasks.map((task) =>
        task.id === ziel ? { ...task, earliestStart: neu } : task,
      ),
      dependencies: plan.dependencies,
      calendar,
      projectStart: PROJECT_START,
      triggerTaskId: ziel,
      decouple: decouple.map(idOf),
    });
  }

  it('schlägt für die Malerarbeiten genau sieben Folgevorgänge vor', () => {
    // Die Abnahmebedingung von AP 4, wörtlich: „Ein verschobener Vorgang
    // schlägt korrekt sieben Folgevorgänge vor."
    const vorschlag = verschiebe('t30', 10);
    expect(vorschlag.affected).toHaveLength(7);
  });

  it('verschiebt den Endtermin um den erwarteten Wert', () => {
    // Die Malerarbeiten liegen auf dem kritischen Pfad. Zehn Werktage später
    // heißt zehn Werktage später fertig — nicht mehr und nicht weniger.
    const vorschlag = verschiebe('t30', 10);
    expect(vorschlag.effectWorkdays).toBe(10);
  });

  it('nimmt einen entkoppelten Folgevorgang aus dem Vorschlag heraus', () => {
    const ohne = verschiebe('t30', 10);
    const mit = verschiebe('t30', 10, ['t32']);

    expect(ohne.affected.map((eintrag) => eintrag.taskId)).toContain(idOf('t32'));
    expect(mit.affected.map((eintrag) => eintrag.taskId)).not.toContain(idOf('t32'));
    expect(mit.affected.length).toBe(ohne.affected.length - 1);
  });

  it('lässt eine Wartezeit nicht kürzer werden', () => {
    // Die Trocknung bis Belegreife ist nicht verhandelbar (Abschnitt 3.5,
    // Punkt 4). Verschiebt sich der Estrich, verschiebt sie sich mit — sie
    // schrumpft nicht, damit der Endtermin hält.
    const vorschlag = verschiebe('t26', 10);
    const trocknung = vorschlag.after.tasks.get(idOf('t27'))!;
    expect(trocknung.durationDays).toBe(35);
    expect(trocknung.durationUnit).toBe('kalendertage');
  });
});

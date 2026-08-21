/**
 * Instanziierung einer Ablaufvorlage.
 *
 * Die Vorlage aus Abschnitt 7.2 der Spezifikation beschreibt ein
 * unterkellertes Haus. Ohne Keller entfallen vier Vorgänge mitten aus der
 * Kette. Statt den Sonderfall in den Code zu schreiben, wird der Graph
 * **kontrahiert**: Für jeden entfallenden Vorgang werden seine Vorgänger direkt
 * mit seinen Nachfolgern verbunden. Das bleibt richtig, wenn später weitere
 * Varianten dazukommen — Fertighaus ohne Rohbau, Sanierung ohne Gründung.
 */

import type {
  DependencyType,
  DurationUnit,
  ScheduleDependency,
  ScheduleTask,
} from './types.js';

export type IncludeWhen = 'always' | 'with_basement' | 'without_basement';

export interface PlanTemplateTask {
  /** Stabiler Schlüssel innerhalb der Vorlage, etwa `t12`. */
  code: string;
  name: string;
  tradeCode?: string;
  phaseKey: string;
  durationDays: number;
  durationUnit: DurationUnit;
  isMilestone: boolean;
  isWait: boolean;
  includeWhen: IncludeWhen;
  sortOrder: number;
}

export interface PlanTemplateDependency {
  predecessorCode: string;
  successorCode: string;
  type: DependencyType;
  lagDays: number;
  lagUnit: DurationUnit;
}

export interface PlanTemplate {
  key: string;
  name: string;
  tasks: readonly PlanTemplateTask[];
  dependencies: readonly PlanTemplateDependency[];
}

export interface InstantiateOptions {
  hasBasement: boolean;
}

export interface InstantiatedTask extends ScheduleTask {
  code: string;
  name: string;
  phaseKey: string;
  sortOrder: number;
}

export interface InstantiatedPlan {
  tasks: readonly InstantiatedTask[];
  dependencies: readonly ScheduleDependency[];
}

function isIncluded(task: PlanTemplateTask, options: InstantiateOptions): boolean {
  switch (task.includeWhen) {
    case 'always':
      return true;
    case 'with_basement':
      return options.hasBasement;
    case 'without_basement':
      return !options.hasBasement;
  }
}

interface Edge {
  predecessorCode: string;
  successorCode: string;
  type: DependencyType;
  lagDays: number;
  lagUnit: DurationUnit;
}

function edgeKey(edge: Edge): string {
  return `${edge.predecessorCode}→${edge.successorCode}|${edge.type}`;
}

/**
 * Entfernt einen Vorgang aus der Kantenmenge und überbrückt ihn.
 *
 * Der entfallende Vorgang hat im instanziierten Plan keine Dauer mehr, deshalb
 * addieren sich lediglich die Wartezeiten der beiden Kanten. Der Typ der
 * Ersatzkante ist immer `FS`: Wenn ein Zwischenschritt wegfällt, ist die einzig
 * sinnvolle Aussage „erst der eine, dann der andere".
 */
function contract(edges: readonly Edge[], removedCode: string): readonly Edge[] {
  const incoming = edges.filter((edge) => edge.successorCode === removedCode);
  const outgoing = edges.filter((edge) => edge.predecessorCode === removedCode);
  const remaining = edges.filter(
    (edge) => edge.predecessorCode !== removedCode && edge.successorCode !== removedCode,
  );

  const bridged: Edge[] = [];
  for (const before of incoming) {
    for (const after of outgoing) {
      if (before.predecessorCode === after.successorCode) continue;
      bridged.push({
        predecessorCode: before.predecessorCode,
        successorCode: after.successorCode,
        type: 'FS',
        lagDays: before.lagDays + after.lagDays,
        lagUnit:
          before.lagUnit === 'kalendertage' || after.lagUnit === 'kalendertage'
            ? 'kalendertage'
            : 'werktage',
      });
    }
  }

  return dedupe([...remaining, ...bridged]);
}

/** Doppelte Kanten zusammenfassen; die längere Wartezeit gewinnt. */
function dedupe(edges: readonly Edge[]): readonly Edge[] {
  const merged = new Map<string, Edge>();
  for (const edge of edges) {
    const key = edgeKey(edge);
    const existing = merged.get(key);
    if (existing === undefined || edge.lagDays > existing.lagDays) {
      merged.set(key, edge);
    }
  }
  return [...merged.values()];
}

/**
 * Baut aus einer Vorlage die konkreten Vorgänge und Abhängigkeiten eines
 * Projekts. Reine Funktion: keine Kennungen, keine Datenbank, keine Termine —
 * die Terminlage berechnet anschließend `computeSchedule`.
 */
export function instantiateTemplate(
  template: PlanTemplate,
  options: InstantiateOptions,
): InstantiatedPlan {
  const included = template.tasks.filter((task) => isIncluded(task, options));
  const includedCodes = new Set(included.map((task) => task.code));

  let edges: readonly Edge[] = dedupe(
    template.dependencies.map((dependency) => ({
      predecessorCode: dependency.predecessorCode,
      successorCode: dependency.successorCode,
      type: dependency.type,
      lagDays: dependency.lagDays,
      lagUnit: dependency.lagUnit,
    })),
  );

  // Entfallende Vorgänge in Vorlagenreihenfolge herauskontrahieren. Die
  // Reihenfolge sorgt dafür, dass Ketten entfallender Vorgänge korrekt
  // zusammenlaufen; die Schleife bis zum Fixpunkt fängt jede andere ab.
  const removed = template.tasks
    .filter((task) => !includedCodes.has(task.code))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((task) => task.code);

  for (const code of removed) {
    edges = contract(edges, code);
  }

  const tasks: InstantiatedTask[] = included
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((task) => ({
      id: task.code,
      code: task.code,
      name: task.name,
      phaseKey: task.phaseKey,
      sortOrder: task.sortOrder,
      durationDays: task.durationDays,
      durationUnit: task.durationUnit,
      isMilestone: task.isMilestone,
      isWait: task.isWait,
      ...(task.tradeCode === undefined ? {} : { tradeCode: task.tradeCode }),
    }));

  const dependencies: ScheduleDependency[] = edges
    .filter(
      (edge) => includedCodes.has(edge.predecessorCode) && includedCodes.has(edge.successorCode),
    )
    .map((edge) => ({
      predecessorId: edge.predecessorCode,
      successorId: edge.successorCode,
      type: edge.type,
      lagDays: edge.lagDays,
      lagUnit: edge.lagUnit,
    }))
    .sort((a, b) =>
      a.successorId === b.successorId
        ? a.predecessorId.localeCompare(b.predecessorId)
        : a.successorId.localeCompare(b.successorId),
    );

  return { tasks, dependencies };
}

/** Abhängigkeitsgraph: topologische Sortierung und Zyklusprüfung. */

import type { ScheduleDependency, TaskId } from './types.js';

export class CycleError extends Error {
  /** Der gefundene Zyklus, beginnend und endend beim selben Vorgang. */
  readonly cycle: readonly TaskId[];

  constructor(cycle: readonly TaskId[]) {
    super(`Die Abhängigkeiten enthalten einen Zyklus: ${cycle.join(' → ')}`);
    this.name = 'CycleError';
    this.cycle = cycle;
  }
}

export class UnknownTaskError extends Error {
  constructor(taskId: TaskId, context: string) {
    super(`Unbekannter Vorgang ${JSON.stringify(taskId)} in ${context}`);
    this.name = 'UnknownTaskError';
  }
}

export interface DependencyGraph {
  readonly ids: readonly TaskId[];
  /** Nachfolger je Vorgang. */
  readonly successors: ReadonlyMap<TaskId, readonly ScheduleDependency[]>;
  /** Vorgänger je Vorgang. */
  readonly predecessors: ReadonlyMap<TaskId, readonly ScheduleDependency[]>;
}

export function buildGraph(
  taskIds: readonly TaskId[],
  dependencies: readonly ScheduleDependency[],
): DependencyGraph {
  const known = new Set(taskIds);
  const successors = new Map<TaskId, ScheduleDependency[]>();
  const predecessors = new Map<TaskId, ScheduleDependency[]>();
  for (const id of taskIds) {
    successors.set(id, []);
    predecessors.set(id, []);
  }

  for (const dependency of dependencies) {
    if (!known.has(dependency.predecessorId)) {
      throw new UnknownTaskError(dependency.predecessorId, 'einer Abhängigkeit (Vorgänger)');
    }
    if (!known.has(dependency.successorId)) {
      throw new UnknownTaskError(dependency.successorId, 'einer Abhängigkeit (Nachfolger)');
    }
    if (dependency.predecessorId === dependency.successorId) {
      throw new CycleError([dependency.predecessorId, dependency.successorId]);
    }
    successors.get(dependency.predecessorId)!.push(dependency);
    predecessors.get(dependency.successorId)!.push(dependency);
  }

  return { ids: taskIds, successors, predecessors };
}

/**
 * Topologische Sortierung nach Kahn. Bleiben Vorgänge übrig, gibt es einen
 * Zyklus; der wird per Tiefensuche gesucht und im Fehler benannt, damit der
 * Nutzer die Stelle findet statt einer nackten Meldung gegenüberzustehen.
 */
export function topologicalSort(graph: DependencyGraph): readonly TaskId[] {
  const indegree = new Map<TaskId, number>();
  for (const id of graph.ids) {
    indegree.set(id, graph.predecessors.get(id)?.length ?? 0);
  }

  const ready = graph.ids.filter((id) => indegree.get(id) === 0);
  const order: TaskId[] = [];

  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependency of graph.successors.get(id) ?? []) {
      const next = indegree.get(dependency.successorId)! - 1;
      indegree.set(dependency.successorId, next);
      if (next === 0) ready.push(dependency.successorId);
    }
  }

  if (order.length !== graph.ids.length) {
    const remaining = new Set(graph.ids.filter((id) => (indegree.get(id) ?? 0) > 0));
    throw new CycleError(findCycle(graph, remaining));
  }

  return order;
}

function findCycle(graph: DependencyGraph, candidates: ReadonlySet<TaskId>): readonly TaskId[] {
  const state = new Map<TaskId, 'open' | 'done'>();
  const stack: TaskId[] = [];

  const visit = (id: TaskId): readonly TaskId[] | undefined => {
    const current = state.get(id);
    if (current === 'done') return undefined;
    if (current === 'open') {
      const from = stack.indexOf(id);
      return [...stack.slice(from), id];
    }
    state.set(id, 'open');
    stack.push(id);
    for (const dependency of graph.successors.get(id) ?? []) {
      if (!candidates.has(dependency.successorId)) continue;
      const found = visit(dependency.successorId);
      if (found) return found;
    }
    stack.pop();
    state.set(id, 'done');
    return undefined;
  };

  for (const id of candidates) {
    const found = visit(id);
    if (found) return found;
  }
  return [...candidates];
}

/**
 * Würde die zusätzliche Kante einen Zyklus schließen? Entspricht der Prüfung,
 * die vor jedem `INSERT` auf `dependency` in der Datenbank läuft.
 */
export function wouldCreateCycle(
  graph: DependencyGraph,
  predecessorId: TaskId,
  successorId: TaskId,
): boolean {
  if (predecessorId === successorId) return true;
  const seen = new Set<TaskId>([successorId]);
  const queue: TaskId[] = [successorId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === predecessorId) return true;
    for (const dependency of graph.successors.get(current) ?? []) {
      if (seen.has(dependency.successorId)) continue;
      seen.add(dependency.successorId);
      queue.push(dependency.successorId);
    }
  }
  return false;
}

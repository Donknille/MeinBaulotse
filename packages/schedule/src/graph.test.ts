import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  CycleError,
  topologicalSort,
  UnknownTaskError,
  wouldCreateCycle,
} from './graph.js';
import type { ScheduleDependency } from './types.js';

const edge = (predecessorId: string, successorId: string): ScheduleDependency => ({
  predecessorId,
  successorId,
});

describe('buildGraph', () => {
  it('lehnt Abhängigkeiten auf unbekannte Vorgänge ab', () => {
    expect(() => buildGraph(['a'], [edge('a', 'b')])).toThrow(UnknownTaskError);
    expect(() => buildGraph(['b'], [edge('a', 'b')])).toThrow(UnknownTaskError);
  });

  it('lehnt Selbstbezug ab', () => {
    expect(() => buildGraph(['a'], [edge('a', 'a')])).toThrow(CycleError);
  });
});

describe('topologicalSort', () => {
  it('sortiert eine Kette', () => {
    const graph = buildGraph(['c', 'a', 'b'], [edge('a', 'b'), edge('b', 'c')]);
    expect(topologicalSort(graph)).toEqual(['a', 'b', 'c']);
  });

  it('setzt jeden Vorgänger vor seinen Nachfolger', () => {
    const dependencies = [edge('a', 'c'), edge('b', 'c'), edge('c', 'd'), edge('a', 'd')];
    const order = topologicalSort(buildGraph(['a', 'b', 'c', 'd'], dependencies));
    for (const dependency of dependencies) {
      expect(order.indexOf(dependency.predecessorId)).toBeLessThan(
        order.indexOf(dependency.successorId),
      );
    }
  });

  it('erkennt einen Zweierzyklus und benennt den Pfad', () => {
    const graph = buildGraph(['a', 'b'], [edge('a', 'b'), edge('b', 'a')]);
    try {
      topologicalSort(graph);
      expect.unreachable('hätte werfen müssen');
    } catch (error) {
      expect(error).toBeInstanceOf(CycleError);
      const cycle = (error as CycleError).cycle;
      expect(cycle.at(0)).toBe(cycle.at(-1));
      expect(new Set(cycle)).toEqual(new Set(['a', 'b']));
    }
  });

  it('erkennt einen Dreierzyklus', () => {
    const graph = buildGraph(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]);
    expect(() => topologicalSort(graph)).toThrow(CycleError);
  });

  it('erkennt einen Zyklus hinter einer gesunden Vorkette', () => {
    const graph = buildGraph(
      ['start', 'a', 'b', 'c'],
      [edge('start', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
    );
    try {
      topologicalSort(graph);
      expect.unreachable('hätte werfen müssen');
    } catch (error) {
      expect((error as CycleError).cycle).not.toContain('start');
    }
  });

  it('kommt mit einem leeren Graphen zurecht', () => {
    expect(topologicalSort(buildGraph([], []))).toEqual([]);
  });
});

describe('wouldCreateCycle', () => {
  const graph = buildGraph(['a', 'b', 'c'], [edge('a', 'b'), edge('b', 'c')]);

  it('erkennt die Rückkante', () => {
    expect(wouldCreateCycle(graph, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(graph, 'b', 'a')).toBe(true);
    expect(wouldCreateCycle(graph, 'a', 'a')).toBe(true);
  });

  it('lässt zulässige Kanten zu', () => {
    expect(wouldCreateCycle(graph, 'a', 'c')).toBe(false);
  });
});

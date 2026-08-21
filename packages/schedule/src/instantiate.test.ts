import { describe, expect, it } from 'vitest';
import { instantiateTemplate, type PlanTemplate } from './instantiate.js';
import { EFH_MASSIV_UNTERKELLERT, PHASES, TRADES } from './templates/efh-massiv-unterkellert.js';
import { buildGraph, topologicalSort } from './graph.js';

describe('Vorlage „Einfamilienhaus massiv, unterkellert"', () => {
  it('umfasst 38 Vorgänge', () => {
    expect(EFH_MASSIV_UNTERKELLERT.tasks).toHaveLength(38);
  });

  it('verweist nur auf bekannte Phasen und Gewerke', () => {
    const phaseKeys = new Set(PHASES.map((phase) => phase.key));
    const tradeCodes = new Set(TRADES.map((trade) => trade.code));
    for (const task of EFH_MASSIV_UNTERKELLERT.tasks) {
      expect(phaseKeys.has(task.phaseKey)).toBe(true);
      if (task.tradeCode !== undefined) expect(tradeCodes.has(task.tradeCode)).toBe(true);
    }
  });

  it('führt genau zwei Wartezeiten in Kalendertagen', () => {
    const waits = EFH_MASSIV_UNTERKELLERT.tasks.filter((task) => task.isWait);
    expect(waits.map((task) => task.code)).toEqual(['t07', 't27']);
    for (const wait of waits) expect(wait.durationUnit).toBe('kalendertage');
  });

  it('führt vier Meilensteine ohne Dauer', () => {
    const milestones = EFH_MASSIV_UNTERKELLERT.tasks.filter((task) => task.isMilestone);
    expect(milestones.map((task) => task.code)).toEqual(['t15', 't19', 't37', 't38']);
    for (const milestone of milestones) expect(milestone.durationDays).toBe(0);
  });

  it('verweist in Abhängigkeiten nur auf vorhandene Vorgänge', () => {
    const codes = new Set(EFH_MASSIV_UNTERKELLERT.tasks.map((task) => task.code));
    for (const dependency of EFH_MASSIV_UNTERKELLERT.dependencies) {
      expect(codes.has(dependency.predecessorCode)).toBe(true);
      expect(codes.has(dependency.successorCode)).toBe(true);
    }
  });
});

describe('instantiateTemplate — mit Keller', () => {
  const plan = instantiateTemplate(EFH_MASSIV_UNTERKELLERT, { hasBasement: true });

  it('erzeugt alle 38 Vorgänge', () => {
    expect(plan.tasks).toHaveLength(38);
  });

  it('behält die Kellervorgänge und ihre Kette', () => {
    const codes = plan.tasks.map((task) => task.code);
    expect(codes).toContain('t08');
    expect(codes).toContain('t11');
    expect(predecessorsOf(plan.dependencies, 't12')).toEqual(['t09']);
    expect(predecessorsOf(plan.dependencies, 't08')).toEqual(['t07']);
  });

  it('ist zyklenfrei', () => {
    const graph = buildGraph(
      plan.tasks.map((task) => task.id),
      plan.dependencies,
    );
    expect(() => topologicalSort(graph)).not.toThrow();
  });
});

describe('instantiateTemplate — ohne Keller', () => {
  const plan = instantiateTemplate(EFH_MASSIV_UNTERKELLERT, { hasBasement: false });

  it('lässt die vier Kellervorgänge weg', () => {
    const codes = plan.tasks.map((task) => task.code);
    expect(plan.tasks).toHaveLength(34);
    for (const removed of ['t08', 't09', 't10', 't11']) {
      expect(codes).not.toContain(removed);
    }
  });

  it('hängt das Erdgeschoss-Mauerwerk an die Aushärtung der Bodenplatte', () => {
    expect(predecessorsOf(plan.dependencies, 't12')).toEqual(['t07']);
  });

  it('lässt keine Abhängigkeit auf entfallene Vorgänge zurück', () => {
    const codes = new Set(plan.tasks.map((task) => task.code));
    for (const dependency of plan.dependencies) {
      expect(codes.has(dependency.predecessorId)).toBe(true);
      expect(codes.has(dependency.successorId)).toBe(true);
    }
  });

  it('bleibt zusammenhängend: jeder Vorgang außer den Startvorgängen hat einen Vorgänger', () => {
    const withPredecessor = new Set(plan.dependencies.map((d) => d.successorId));
    const roots = plan.tasks.filter((task) => !withPredecessor.has(task.id)).map((t) => t.code);
    expect(roots).toEqual(['t01', 't02']);
  });

  it('ist zyklenfrei', () => {
    const graph = buildGraph(
      plan.tasks.map((task) => task.id),
      plan.dependencies,
    );
    expect(() => topologicalSort(graph)).not.toThrow();
  });
});

describe('Kontraktion im Einzelnen', () => {
  const template: PlanTemplate = {
    key: 'test',
    name: 'Test',
    tasks: [
      row('a', 'always', 1),
      row('x', 'with_basement', 2),
      row('y', 'with_basement', 3),
      row('b', 'always', 4),
      row('c', 'always', 5),
    ],
    dependencies: [
      link('a', 'x'),
      link('x', 'y'),
      link('y', 'b'),
      link('y', 'c'),
    ],
  };

  it('überbrückt eine Kette entfallender Vorgänge', () => {
    const plan = instantiateTemplate(template, { hasBasement: false });
    expect(plan.tasks.map((task) => task.code)).toEqual(['a', 'b', 'c']);
    expect(predecessorsOf(plan.dependencies, 'b')).toEqual(['a']);
    expect(predecessorsOf(plan.dependencies, 'c')).toEqual(['a']);
  });

  it('addiert die Wartezeiten der überbrückten Kanten', () => {
    const withLags: PlanTemplate = {
      ...template,
      dependencies: [
        { ...link('a', 'x'), lagDays: 2 },
        { ...link('x', 'b'), lagDays: 3 },
      ],
      tasks: template.tasks.filter((task) => task.code !== 'y'),
    };
    const plan = instantiateTemplate(withLags, { hasBasement: false });
    const bridged = plan.dependencies.find((d) => d.successorId === 'b');
    expect(bridged?.predecessorId).toBe('a');
    expect(bridged?.lagDays).toBe(5);
  });

  it('lässt bei vorhandenem Keller alles unverändert', () => {
    const plan = instantiateTemplate(template, { hasBasement: true });
    expect(plan.tasks).toHaveLength(5);
    expect(predecessorsOf(plan.dependencies, 'b')).toEqual(['y']);
  });
});

function predecessorsOf(
  dependencies: readonly { predecessorId: string; successorId: string }[],
  successorId: string,
): string[] {
  return dependencies
    .filter((dependency) => dependency.successorId === successorId)
    .map((dependency) => dependency.predecessorId)
    .sort();
}

function row(code: string, includeWhen: 'always' | 'with_basement', sortOrder: number) {
  return {
    code,
    name: code,
    phaseKey: 'rohbau',
    durationDays: 1,
    durationUnit: 'werktage' as const,
    isMilestone: false,
    isWait: false,
    includeWhen,
    sortOrder,
  };
}

function link(predecessorCode: string, successorCode: string) {
  return {
    predecessorCode,
    successorCode,
    type: 'FS' as const,
    lagDays: 0,
    lagUnit: 'werktage' as const,
  };
}

/*
 * Die Kettenrechnung ist die eine Stelle, an der ein Fehler still bleibt und
 * trotzdem teuer wird: ein Plan, der um eine Woche danebenliegt, sieht genauso
 * plausibel aus wie ein richtiger. Deshalb steht dieser Test vor jeder
 * Oberfläche.
 */

import { describe, expect, it } from 'vitest';
import { kalendertageZwischen } from './datum';
import {
  berechneBasisplan,
  berechneNeuenPlan,
  nachfolgerHuelle,
  planEnde,
  topologischeReihenfolge,
} from './planung';
import type { Gewerk, Status } from './types';

interface Entwurf {
  id: string;
  nummer: number;
  start: string;
  ende: string;
  vorgaenger?: string[];
  wartezeitTage?: number;
  status?: Status;
}

function g(entwurf: Entwurf): Gewerk {
  return {
    id: entwurf.id,
    nummer: entwurf.nummer,
    name: entwurf.id.toUpperCase(),
    beschreibung: '',
    start: entwurf.start,
    ende: entwurf.ende,
    status: entwurf.status ?? 'geplant',
    herkunft: 'geplant',
    vorgaenger: entwurf.vorgaenger ?? [],
    fortschrittProzent: 0,
    ...(entwurf.wartezeitTage !== undefined ? { wartezeitTage: entwurf.wartezeitTage } : {}),
  };
}

function termine(gewerke: Gewerk[], id: string): [string, string] {
  const treffer = gewerke.find((x) => x.id === id) as Gewerk;
  return [treffer.start, treffer.ende];
}

describe('einfache Verschiebung', () => {
  // a: Mo 04.05. bis Fr 08.05. (5 AT) -> b: Mo 11.05. bis Mi 13.05. (3 AT)
  const plan = [
    g({ id: 'a', nummer: 1, start: '2026-05-04', ende: '2026-05-08' }),
    g({ id: 'b', nummer: 2, start: '2026-05-11', ende: '2026-05-13', vorgaenger: ['a'] }),
  ];

  it('schiebt den Nachfolger um dieselbe Woche mit', () => {
    const ergebnis = berechneNeuenPlan(plan, 'a', '2026-05-11');

    expect(termine(ergebnis.gewerke, 'a')).toEqual(['2026-05-11', '2026-05-15']);
    expect(termine(ergebnis.gewerke, 'b')).toEqual(['2026-05-18', '2026-05-20']);
    expect(ergebnis.betroffene).toEqual(['b']);
    expect(ergebnis.verschiebungTage).toBe(7);
  });

  it('behält die Dauer des verschobenen Gewerks bei', () => {
    const ergebnis = berechneNeuenPlan(plan, 'a', '2026-05-11');
    const [start, ende] = termine(ergebnis.gewerke, 'a');
    expect(kalendertageZwischen(start, ende)).toBe(4); // Mo bis Fr
  });

  it('rückt einen Wunschtermin am Wochenende auf den Montag', () => {
    // Sa 09.05. ist kein Arbeitstag.
    const ergebnis = berechneNeuenPlan(plan, 'a', '2026-05-09');
    expect(termine(ergebnis.gewerke, 'a')[0]).toBe('2026-05-11');
  });

  it('lässt die Eingabe unberührt', () => {
    berechneNeuenPlan(plan, 'a', '2026-05-11');
    expect(termine(plan, 'a')).toEqual(['2026-05-04', '2026-05-08']);
  });
});

describe('Verschiebung über eine Wartezeit hinweg', () => {
  // estrich: Mo 04.05. bis Do 07.05. (4 AT), danach 28 Kalendertage Trocknung.
  // fliesen: frühestens Fr 05.06. (erster Arbeitstag nach 04.06.)
  const plan = [
    g({
      id: 'estrich',
      nummer: 1,
      start: '2026-05-04',
      ende: '2026-05-07',
      wartezeitTage: 28,
    }),
    g({
      id: 'fliesen',
      nummer: 2,
      start: '2026-06-05',
      ende: '2026-06-16',
      vorgaenger: ['estrich'],
    }),
  ];

  it('rechnet die Wartezeit in Kalendertagen, nicht in Arbeitstagen', () => {
    expect(termine(plan, 'fliesen')[0]).toBe('2026-06-05');
    const ergebnis = berechneNeuenPlan(plan, 'estrich', '2026-05-18');

    expect(termine(ergebnis.gewerke, 'estrich')).toEqual(['2026-05-18', '2026-05-21']);
    // 21.05. + 28 Kalendertage = Do 18.06., der erste Arbeitstag danach ist Fr 19.06.
    expect(termine(ergebnis.gewerke, 'fliesen')).toEqual(['2026-06-19', '2026-06-30']);
  });

  it('verkürzt und überlappt die Wartezeit nicht', () => {
    const ergebnis = berechneNeuenPlan(plan, 'estrich', '2026-05-18');
    const [, estrichEnde] = termine(ergebnis.gewerke, 'estrich');
    const [fliesenStart] = termine(ergebnis.gewerke, 'fliesen');
    expect(kalendertageZwischen(estrichEnde, fliesenStart)).toBeGreaterThan(28);
  });
});

describe('Verschiebung mit zwei parallelen Vorgängern', () => {
  // v1: 5 AT, v2: 10 AT, beide ab Mo 04.05. n braucht beide.
  // v2 endet Fr 15.05. und ist damit die bindende Bedingung.
  const plan = [
    g({ id: 'v1', nummer: 1, start: '2026-05-04', ende: '2026-05-08' }),
    g({ id: 'v2', nummer: 2, start: '2026-05-04', ende: '2026-05-15' }),
    g({ id: 'n', nummer: 3, start: '2026-05-18', ende: '2026-05-22', vorgaenger: ['v1', 'v2'] }),
  ];

  it('lässt den Nachfolger stehen, solange der andere Vorgänger bindet', () => {
    // v1 einen Tag später: endet Mo 11.05., v2 bleibt bindend.
    const ergebnis = berechneNeuenPlan(plan, 'v1', '2026-05-05');

    expect(termine(ergebnis.gewerke, 'v1')).toEqual(['2026-05-05', '2026-05-11']);
    expect(termine(ergebnis.gewerke, 'n')).toEqual(['2026-05-18', '2026-05-22']);
    expect(ergebnis.betroffene).toEqual([]);
    expect(ergebnis.neuesPlanende).toBe(ergebnis.altesPlanende);
  });

  it('schiebt den Nachfolger, sobald der bewegte Vorgänger der spätere ist', () => {
    const ergebnis = berechneNeuenPlan(plan, 'v1', '2026-06-01');

    expect(termine(ergebnis.gewerke, 'v1')).toEqual(['2026-06-01', '2026-06-05']);
    expect(termine(ergebnis.gewerke, 'n')).toEqual(['2026-06-08', '2026-06-12']);
    expect(ergebnis.betroffene).toEqual(['n']);
  });
});

describe('Rückwärtsverschiebung', () => {
  it('zieht den Nachfolger mit nach vorn', () => {
    const plan = [
      g({ id: 'a', nummer: 1, start: '2026-05-11', ende: '2026-05-15' }),
      g({ id: 'b', nummer: 2, start: '2026-05-18', ende: '2026-05-20', vorgaenger: ['a'] }),
    ];

    const ergebnis = berechneNeuenPlan(plan, 'a', '2026-05-04');

    expect(termine(ergebnis.gewerke, 'a')).toEqual(['2026-05-04', '2026-05-08']);
    expect(termine(ergebnis.gewerke, 'b')).toEqual(['2026-05-11', '2026-05-13']);
    expect(ergebnis.verschiebungTage).toBe(-7);
  });

  it('zieht nur so weit vor, wie der zweite Vorgänger es zulässt', () => {
    const plan = [
      g({ id: 'a', nummer: 1, start: '2026-05-11', ende: '2026-05-15' }),
      g({ id: 'c', nummer: 2, start: '2026-05-04', ende: '2026-05-15' }),
      g({ id: 'b', nummer: 3, start: '2026-05-18', ende: '2026-05-20', vorgaenger: ['a', 'c'] }),
    ];

    const ergebnis = berechneNeuenPlan(plan, 'a', '2026-05-04');

    expect(termine(ergebnis.gewerke, 'b')).toEqual(['2026-05-18', '2026-05-20']);
    expect(ergebnis.betroffene).toEqual([]);
  });

  it('lässt sich nicht vor den eigenen Vorgänger ziehen', () => {
    const plan = [
      g({ id: 'a', nummer: 1, start: '2026-05-04', ende: '2026-05-15' }),
      g({ id: 'b', nummer: 2, start: '2026-05-18', ende: '2026-05-20', vorgaenger: ['a'] }),
    ];

    const ergebnis = berechneNeuenPlan(plan, 'b', '2026-05-04');

    expect(termine(ergebnis.gewerke, 'b')).toEqual(['2026-05-18', '2026-05-20']);
    expect(ergebnis.begrenztDurch).toBe('a');
  });
});

describe('Verschiebung eines Gewerks ohne Nachfolger', () => {
  const plan = [
    g({ id: 'a', nummer: 1, start: '2026-05-04', ende: '2026-05-08' }),
    g({ id: 'abnahme', nummer: 2, start: '2026-05-11', ende: '2026-05-11', vorgaenger: ['a'] }),
  ];

  it('bewegt nichts weiter und verschiebt das Planende', () => {
    const ergebnis = berechneNeuenPlan(plan, 'abnahme', '2026-05-18');

    expect(ergebnis.betroffene).toEqual([]);
    expect(termine(ergebnis.gewerke, 'a')).toEqual(['2026-05-04', '2026-05-08']);
    expect(ergebnis.altesPlanende).toBe('2026-05-11');
    expect(ergebnis.neuesPlanende).toBe('2026-05-18');
  });
});

describe('fertige Gewerke', () => {
  it('werden selbst nicht verschoben', () => {
    const plan = [
      g({ id: 'a', nummer: 1, start: '2026-05-04', ende: '2026-05-08', status: 'fertig' }),
      g({ id: 'b', nummer: 2, start: '2026-05-11', ende: '2026-05-13', vorgaenger: ['a'] }),
    ];

    const ergebnis = berechneNeuenPlan(plan, 'a', '2026-06-01');

    expect(termine(ergebnis.gewerke, 'a')).toEqual(['2026-05-04', '2026-05-08']);
    expect(ergebnis.verschiebungTage).toBe(0);
    expect(ergebnis.betroffene).toEqual([]);
  });

  it('werden auch von einer Verschiebung davor nicht mitgezogen', () => {
    const plan = [
      g({ id: 'a', nummer: 1, start: '2026-05-04', ende: '2026-05-08' }),
      g({
        id: 'b',
        nummer: 2,
        start: '2026-05-11',
        ende: '2026-05-13',
        vorgaenger: ['a'],
        status: 'fertig',
      }),
      g({ id: 'c', nummer: 3, start: '2026-05-14', ende: '2026-05-15', vorgaenger: ['b'] }),
    ];

    const ergebnis = berechneNeuenPlan(plan, 'a', '2026-06-01');

    expect(termine(ergebnis.gewerke, 'b')).toEqual(['2026-05-11', '2026-05-13']);
    expect(termine(ergebnis.gewerke, 'c')).toEqual(['2026-05-14', '2026-05-15']);
  });
});

describe('Kette über mehrere Stufen', () => {
  const plan = [
    g({ id: '1', nummer: 1, start: '2026-05-04', ende: '2026-05-08' }),
    g({ id: '2', nummer: 2, start: '2026-05-11', ende: '2026-05-13', vorgaenger: ['1'] }),
    g({ id: '3', nummer: 3, start: '2026-05-14', ende: '2026-05-15', vorgaenger: ['2'] }),
    g({ id: '4', nummer: 4, start: '2026-05-18', ende: '2026-05-19', vorgaenger: ['3'] }),
    g({ id: 'abseits', nummer: 5, start: '2026-05-04', ende: '2026-05-05' }),
  ];

  it('nennt alle mittelbar betroffenen Gewerke, aber nur diese', () => {
    const ergebnis = berechneNeuenPlan(plan, '1', '2026-05-11');

    expect(ergebnis.betroffene).toEqual(['2', '3', '4']);
    expect(termine(ergebnis.gewerke, 'abseits')).toEqual(['2026-05-04', '2026-05-05']);
  });

  it('schiebt das Planende um dieselbe Zahl Arbeitstage', () => {
    const ergebnis = berechneNeuenPlan(plan, '1', '2026-05-11');
    expect(ergebnis.altesPlanende).toBe('2026-05-19');
    expect(ergebnis.neuesPlanende).toBe('2026-05-26');
  });
});

describe('Hilfsmittel', () => {
  const plan = [
    g({ id: 'a', nummer: 1, start: '2026-05-04', ende: '2026-05-08' }),
    g({ id: 'b', nummer: 2, start: '2026-05-11', ende: '2026-05-13', vorgaenger: ['a'] }),
    g({ id: 'c', nummer: 3, start: '2026-05-14', ende: '2026-05-15', vorgaenger: ['b'] }),
  ];

  it('findet die Nachfolgerhülle', () => {
    expect([...nachfolgerHuelle(plan, 'a')].sort()).toEqual(['b', 'c']);
    expect([...nachfolgerHuelle(plan, 'c')]).toEqual([]);
  });

  it('sortiert Vorgänger vor Nachfolger', () => {
    expect(topologischeReihenfolge(plan).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('meldet einen Kreis, statt eine falsche Reihenfolge zu liefern', () => {
    const kreis = [
      g({ id: 'a', nummer: 1, start: '2026-05-04', ende: '2026-05-08', vorgaenger: ['b'] }),
      g({ id: 'b', nummer: 2, start: '2026-05-11', ende: '2026-05-13', vorgaenger: ['a'] }),
    ];
    expect(() => topologischeReihenfolge(kreis)).toThrow(/Kreis/);
  });

  it('kennt das Planende', () => {
    expect(planEnde(plan)).toBe('2026-05-15');
  });
});

describe('Basisplan', () => {
  it('legt jedes Gewerk so früh, wie die Vorgänger es zulassen', () => {
    const roh = [
      g({ id: 'a', nummer: 1, start: '2026-09-01', ende: '2026-09-07', wartezeitTage: 14 }),
      g({ id: 'b', nummer: 2, start: '2026-12-01', ende: '2026-12-03', vorgaenger: ['a'] }),
    ];

    const basis = berechneBasisplan(roh, '2026-05-04');

    // a: 5 Arbeitstage ab Mo 04.05., danach 14 Kalendertage Wartezeit.
    expect(termine(basis, 'a')).toEqual(['2026-05-04', '2026-05-08']);
    // 08.05. + 14 Kalendertage = Fr 22.05., erster Arbeitstag danach ist Mo 25.05.
    expect(termine(basis, 'b')).toEqual(['2026-05-25', '2026-05-27']);
  });
});

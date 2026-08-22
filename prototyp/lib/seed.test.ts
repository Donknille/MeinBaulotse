/*
 * Die Demo-Daten werden aus dem heutigen Tag gerechnet. Damit sie in einem
 * Jahr noch dieselbe Geschichte erzählen, wird die Geschichte hier geprüft und
 * nicht in der Oberfläche entdeckt.
 */

import { describe, expect, it } from 'vitest';
import { kalendertageZwischen } from './datum';
import { planEnde } from './planung';
import { erzeugeProjektdaten } from './seed';
import type { Gewerk } from './types';

// Ein Dienstag, ein Freitag und ein Sonntag — die Randfälle der Wochenlogik.
const TESTTAGE = ['2026-03-03', '2026-08-21', '2026-11-15', '2027-01-04'];

describe.each(TESTTAGE)('Demoprojekt am %s', (heute) => {
  const daten = erzeugeProjektdaten('selbst', heute);
  const nach = (nummer: number) => daten.gewerke.find((g) => g.nummer === nummer) as Gewerk;

  it('hat alle 23 Gewerke', () => {
    expect(daten.gewerke).toHaveLength(23);
  });

  it('setzt Gewerk 1 bis 9 auf fertig', () => {
    for (let nummer = 1; nummer <= 9; nummer += 1) {
      expect(nach(nummer).status).toBe('fertig');
      expect(nach(nummer).ende < heute).toBe(true);
    }
  });

  it('lässt den heutigen Tag mitten in Gewerk 10 liegen', () => {
    const gewerk10 = nach(10);
    expect(gewerk10.status).toBe('verzoegert');
    expect(gewerk10.start <= heute).toBe(true);
    expect(gewerk10.ende >= heute).toBe(true);
  });

  it('markiert Gewerk 11 als blockiert und den Rest als geplant', () => {
    expect(nach(11).status).toBe('blockiert');
    for (let nummer = 12; nummer <= 23; nummer += 1) {
      expect(nach(nummer).status).toBe('geplant');
      expect(nach(nummer).start > heute).toBe(true);
    }
  });

  it('liegt hinter der vereinbarten Fertigstellung', () => {
    const verzug = kalendertageZwischen(daten.projekt.zielFertigstellung, planEnde(daten.gewerke));
    expect(verzug).toBeGreaterThan(0);
    expect(verzug).toBeLessThanOrEqual(14);
  });

  it('beginnt rund vier Monate vor heute und dauert gut sieben Monate', () => {
    const seitBaubeginn = kalendertageZwischen(daten.projekt.baubeginn, heute);
    expect(seitBaubeginn).toBeGreaterThan(95);
    expect(seitBaubeginn).toBeLessThan(145);

    const gesamt = kalendertageZwischen(daten.projekt.baubeginn, planEnde(daten.gewerke));
    expect(gesamt).toBeGreaterThan(200);
    expect(gesamt).toBeLessThan(250);
  });

  it('hält die Estrichtrocknung von 28 Kalendertagen ein', () => {
    const estrich = nach(13);
    const fliesen = nach(15);
    expect(estrich.wartezeitTage).toBe(28);
    expect(kalendertageZwischen(estrich.ende, fliesen.start)).toBeGreaterThan(28);
  });

  it('hat zwei offene Entscheidungen mit Frist in der Zukunft', () => {
    const offen = daten.entscheidungen.filter((e) => !e.erledigt);
    expect(offen).toHaveLength(2);
    for (const entscheidung of offen) {
      expect(entscheidung.fristBis > heute).toBe(true);
    }
    expect(offen.map((e) => e.titel)).toContain('Fliesen bemustern');
  });

  it('hat Fotos und ein Protokoll, beide absteigend nach Zeit', () => {
    expect(daten.fotos.length).toBeGreaterThanOrEqual(6);
    expect(daten.fotos.length).toBeLessThanOrEqual(8);
    expect(daten.ereignisse.length).toBeGreaterThanOrEqual(15);

    const fotoDaten = daten.fotos.map((f) => f.datum);
    expect([...fotoDaten].sort().reverse()).toEqual(fotoDaten);

    const zeiten = daten.ereignisse.map((e) => e.zeitpunkt);
    expect([...zeiten].sort().reverse()).toEqual(zeiten);
  });

  it('zeigt gemischte Herkunft, nicht nur Planwerte', () => {
    const herkuenfte = new Set(daten.gewerke.filter((g) => g.nummer <= 10).map((g) => g.herkunft));
    expect(herkuenfte.size).toBeGreaterThanOrEqual(3);
  });
});

describe('Betriebsmodus', () => {
  it('nennt den Generalunternehmer nur im begleiteten Modus', () => {
    expect(erzeugeProjektdaten('begleitet', '2026-08-21').projekt.gu).toBeTruthy();
    expect(erzeugeProjektdaten('selbst', '2026-08-21').projekt.gu).toBeUndefined();
    expect(erzeugeProjektdaten('stellvertretend', '2026-08-21').projekt.gu).toBeUndefined();
  });

  it('liefert bei gleichem Tag denselben Plan', () => {
    const a = erzeugeProjektdaten('selbst', '2026-08-21');
    const b = erzeugeProjektdaten('selbst', '2026-08-21');
    expect(a).toEqual(b);
  });
});

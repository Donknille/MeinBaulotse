/*
 * Die Rechtematrix ist die Stelle, an der ein Fehler nicht auffällt: eine
 * Schaltfläche zu viel sieht aus wie eine Schaltfläche. Deshalb steht hier
 * jede Zeile der Vorgabe noch einmal, unabhängig von der Tabelle im Quelltext.
 */

import { describe, expect, it } from 'vitest';
import { akteurAus, darf, darfEinfach, sichtbareGewerke, type Recht } from './rechte';
import { erzeugeProjektdaten } from './seed';
import type { Betriebsmodus, Rolle } from './types';

interface Fall {
  rolle: Rolle;
  modus: Betriebsmodus;
}

const GU: Fall = { rolle: 'gu', modus: 'begleitet' };
const BAUHERR_BEGLEITET: Fall = { rolle: 'bauherr', modus: 'begleitet' };
const BAUHERR_SELBST: Fall = { rolle: 'bauherr', modus: 'selbst' };
const BAUHERR_STELLVERTRETEND: Fall = { rolle: 'bauherr', modus: 'stellvertretend' };
const GEWERK: Fall = { rolle: 'gewerk', modus: 'selbst' };

/**
 * Die Tabelle aus der Vorgabe, Zeile für Zeile. Die Spalte „Gewerk" ist
 * aufgeteilt, weil zwei Zeilen dort „ja, eigenes Gewerk" lauten — und der
 * Unterschied zwischen dem eigenen und einem fremden ist genau der Punkt.
 *
 * Die Zeile `alle_gewerke_sehen` steht in der Vorgabe als „nein, nur eigenes
 * plus Vorgänger und Nachfolger". Was ein Betrieb tatsächlich zu sehen bekommt,
 * prüft weiter unten `sichtbareGewerke`.
 */
const VORGABE: Array<{
  recht: Recht;
  gu: boolean;
  bauherrBegleitet: boolean;
  bauherrFuehrend: boolean;
  gewerkEigenes: boolean;
  gewerkFremdes: boolean;
}> = [
  { recht: 'plan_verschieben', gu: true, bauherrBegleitet: false, bauherrFuehrend: true, gewerkEigenes: false, gewerkFremdes: false },
  { recht: 'status_melden', gu: true, bauherrBegleitet: false, bauherrFuehrend: true, gewerkEigenes: true, gewerkFremdes: false },
  { recht: 'status_stellvertretend_melden', gu: true, bauherrBegleitet: false, bauherrFuehrend: true, gewerkEigenes: false, gewerkFremdes: false },
  { recht: 'entscheidung_treffen', gu: false, bauherrBegleitet: true, bauherrFuehrend: true, gewerkEigenes: false, gewerkFremdes: false },
  { recht: 'foto_hochladen', gu: true, bauherrBegleitet: true, bauherrFuehrend: true, gewerkEigenes: true, gewerkFremdes: false },
  { recht: 'gewerk_bearbeiten', gu: true, bauherrBegleitet: false, bauherrFuehrend: true, gewerkEigenes: false, gewerkFremdes: false },
  { recht: 'alle_gewerke_sehen', gu: true, bauherrBegleitet: true, bauherrFuehrend: true, gewerkEigenes: true, gewerkFremdes: false },
];

describe('Rechtematrix', () => {
  it.each(VORGABE)('$recht', (zeile) => {
    expect(darfEinfach(zeile.recht, GU)).toBe(zeile.gu);
    expect(darfEinfach(zeile.recht, BAUHERR_BEGLEITET)).toBe(zeile.bauherrBegleitet);
    expect(darfEinfach(zeile.recht, BAUHERR_SELBST)).toBe(zeile.bauherrFuehrend);
    expect(darfEinfach(zeile.recht, BAUHERR_STELLVERTRETEND)).toBe(zeile.bauherrFuehrend);

    expect(
      darfEinfach(zeile.recht, { ...GEWERK, zielGewerkId: 'gw-10', eigenesGewerkId: 'gw-10' }),
    ).toBe(zeile.gewerkEigenes);
    expect(
      darfEinfach(zeile.recht, { ...GEWERK, zielGewerkId: 'gw-05', eigenesGewerkId: 'gw-10' }),
    ).toBe(zeile.gewerkFremdes);
  });

  it('ordnet Rolle und Betriebsart dem richtigen Akteur zu', () => {
    expect(akteurAus('bauherr', 'begleitet')).toBe('bauherr_begleitet');
    expect(akteurAus('bauherr', 'selbst')).toBe('bauherr_fuehrend');
    expect(akteurAus('bauherr', 'stellvertretend')).toBe('bauherr_fuehrend');
    expect(akteurAus('gu', 'selbst')).toBe('gu');
    expect(akteurAus('gewerk', 'selbst')).toBe('gewerk');
  });
});

describe('Erklärungen', () => {
  it('nennt bei jeder Sperre, wer stattdessen zuständig ist', () => {
    for (const { recht } of VORGABE) {
      for (const fall of [GU, BAUHERR_BEGLEITET, BAUHERR_SELBST, GEWERK]) {
        const pruefung = darf(recht, { ...fall, zielGewerkId: 'gw-05', eigenesGewerkId: 'gw-10' });
        if (pruefung.erlaubt) continue;
        expect(pruefung.erklaerung.length).toBeGreaterThan(20);
        expect(pruefung.erklaerung.endsWith('.')).toBe(true);
      }
    }
  });
});

describe('Sichtbare Gewerke', () => {
  const daten = erzeugeProjektdaten('selbst', '2026-08-21');

  it('zeigt Bauherr und Bauleiter alle', () => {
    expect(sichtbareGewerke(daten, BAUHERR_SELBST)).toHaveLength(23);
    expect(sichtbareGewerke(daten, GU)).toHaveLength(23);
  });

  it('zeigt dem Betrieb sein eigenes Gewerk, die Vorgänger und die Nachfolger', () => {
    // Gewerk 11 (Lüftung) hat 9 und 10 als Vorgänger und 12 als Nachfolger.
    const sichtbar = sichtbareGewerke(daten, { ...GEWERK, eigenesGewerkId: 'gw-11' });
    expect(sichtbar.map((g) => g.nummer).sort((a, b) => a - b)).toEqual([9, 10, 11, 12]);
  });

  it('zeigt nichts, wenn dem Betrieb kein Gewerk zugeordnet ist', () => {
    expect(sichtbareGewerke(daten, { ...GEWERK, eigenesGewerkId: null })).toEqual([]);
  });
});

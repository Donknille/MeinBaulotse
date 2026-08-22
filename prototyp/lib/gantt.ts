/*
 * Geometrie der Balkendarstellung.
 *
 * Reine Rechnung, keine Bauteile: aus Terminen werden Pixel. Getrennt gehalten,
 * damit sich das Ziehen eines Balkens später zurückrechnen lässt — aus einer
 * Mausbewegung in Pixeln muss wieder ein Datum werden, und zwar dasselbe, das
 * hier hineingegangen ist.
 */

import {
  kalendertageZwischen,
  plusKalendertage,
  alsKalenderwoche,
  type IsoDatum,
} from './datum';
import type { Gewerk } from './types';

export interface Gantteinstellungen {
  /** Breite eines Kalendertags in Pixeln. */
  tagBreite: number;
  /** Höhe einer Gewerkzeile in Pixeln. */
  zeilenHoehe: number;
  /** Kalendertage Luft vor dem ersten und nach dem letzten Termin. */
  rand: number;
}

export const GANTT_STANDARD: Gantteinstellungen = {
  tagBreite: 9,
  zeilenHoehe: 34,
  rand: 7,
};

export interface Ganttzeile {
  gewerk: Gewerk;
  y: number;
  /** Der Arbeitsbalken. */
  x: number;
  breite: number;
  /** Der schraffierte Wartezeitbalken, falls es eine Wartezeit gibt. */
  wartezeit: { x: number; breite: number; tage: number } | null;
}

export interface Ganttverbindung {
  vonId: string;
  nachId: string;
  vonX: number;
  vonY: number;
  nachX: number;
  nachY: number;
}

export interface Ganttbild {
  von: IsoDatum;
  bis: IsoDatum;
  breite: number;
  hoehe: number;
  zeilen: Ganttzeile[];
  wochen: Array<{ x: number; beschriftung: string; datum: IsoDatum }>;
  verbindungen: Ganttverbindung[];
}

/** Pixelabstand eines Datums vom linken Rand. */
export function xVon(datum: IsoDatum, von: IsoDatum, einstellungen: Gantteinstellungen): number {
  return kalendertageZwischen(von, datum) * einstellungen.tagBreite;
}

/** Die Umkehrung: an welchem Tag liegt ein Pixelabstand. */
export function datumAn(x: number, von: IsoDatum, einstellungen: Gantteinstellungen): IsoDatum {
  return plusKalendertage(von, Math.round(x / einstellungen.tagBreite));
}

export function berechneGanttbild(
  gewerke: readonly Gewerk[],
  einstellungen: Gantteinstellungen = GANTT_STANDARD,
): Ganttbild {
  const leer: Ganttbild = {
    von: '',
    bis: '',
    breite: 0,
    hoehe: 0,
    zeilen: [],
    wochen: [],
    verbindungen: [],
  };
  if (gewerke.length === 0) return leer;

  const ersterStart = gewerke.reduce((frueh, g) => (g.start < frueh ? g.start : frueh), gewerke[0]!.start);
  const letztesEnde = gewerke.reduce((spaet, g) => {
    const ende = plusKalendertage(g.ende, g.wartezeitTage ?? 0);
    return ende > spaet ? ende : spaet;
  }, gewerke[0]!.ende);

  const von = plusKalendertage(ersterStart, -einstellungen.rand);
  const bis = plusKalendertage(letztesEnde, einstellungen.rand);
  const tage = kalendertageZwischen(von, bis) + 1;

  const sortiert = [...gewerke].sort((a, b) => a.nummer - b.nummer);
  const zeilen: Ganttzeile[] = sortiert.map((gewerk, index) => {
    const x = xVon(gewerk.start, von, einstellungen);
    const breite = Math.max(
      einstellungen.tagBreite,
      (kalendertageZwischen(gewerk.start, gewerk.ende) + 1) * einstellungen.tagBreite,
    );
    const warteTage = gewerk.wartezeitTage ?? 0;

    return {
      gewerk,
      y: index * einstellungen.zeilenHoehe,
      x,
      breite,
      wartezeit:
        warteTage > 0
          ? { x: x + breite, breite: warteTage * einstellungen.tagBreite, tage: warteTage }
          : null,
    };
  });

  // Kalenderwochen: die Achse beginnt am ersten Montag im Bild.
  const wochen: Ganttbild['wochen'] = [];
  let lauf = von;
  while (new Date(`${lauf}T12:00:00`).getDay() !== 1) lauf = plusKalendertage(lauf, 1);
  while (lauf <= bis) {
    wochen.push({ x: xVon(lauf, von, einstellungen), beschriftung: alsKalenderwoche(lauf), datum: lauf });
    lauf = plusKalendertage(lauf, 7);
  }

  const nachId = new Map(zeilen.map((z) => [z.gewerk.id, z]));
  const verbindungen: Ganttverbindung[] = [];
  for (const zeile of zeilen) {
    for (const vorgaengerId of zeile.gewerk.vorgaenger) {
      const vorher = nachId.get(vorgaengerId);
      if (!vorher) continue;
      verbindungen.push({
        vonId: vorgaengerId,
        nachId: zeile.gewerk.id,
        vonX: vorher.x + vorher.breite + (vorher.wartezeit?.breite ?? 0),
        vonY: vorher.y + einstellungen.zeilenHoehe / 2,
        nachX: zeile.x,
        nachY: zeile.y + einstellungen.zeilenHoehe / 2,
      });
    }
  }

  return {
    von,
    bis,
    breite: tage * einstellungen.tagBreite,
    hoehe: zeilen.length * einstellungen.zeilenHoehe,
    zeilen,
    wochen,
    verbindungen,
  };
}

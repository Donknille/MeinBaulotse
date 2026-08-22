/*
 * Lesezugriffe auf ein Projekt.
 *
 * Alles hier sind reine Funktionen über `Projektdaten`. Keine Komponente
 * rechnet selbst — sie fragt. Wenn später eine Datenbank dahinterliegt, ändert
 * sich diese Datei und sonst nichts.
 */

import {
  heute as heuteJetzt,
  kalendertageZwischen,
  plusKalendertage,
  type IsoDatum,
} from '../datum';
import { dauerInArbeitstagen, planEnde } from '../planung';
import { BAUPHASEN, phaseVonGewerk } from '../stammdaten';
import type { Bauphase, Entscheidung, Ereignis, Fotoeintrag, Gewerk, Projektdaten } from '../types';

export function gewerkNachId(daten: Projektdaten, id: string): Gewerk | undefined {
  return daten.gewerke.find((g) => g.id === id);
}

export function vorgaengerVon(daten: Projektdaten, id: string): Gewerk[] {
  const gewerk = gewerkNachId(daten, id);
  if (!gewerk) return [];
  return gewerk.vorgaenger
    .map((vorgaengerId) => gewerkNachId(daten, vorgaengerId))
    .filter((g): g is Gewerk => g !== undefined);
}

export function nachfolgerVon(daten: Projektdaten, id: string): Gewerk[] {
  return daten.gewerke.filter((g) => g.vorgaenger.includes(id));
}

/** Was heute auf der Baustelle passiert. */
export function laufendeGewerke(daten: Projektdaten, heute: IsoDatum = heuteJetzt()): Gewerk[] {
  return daten.gewerke.filter(
    (g) => g.status !== 'fertig' && g.start <= heute && g.ende >= heute && g.status !== 'blockiert',
  );
}

/** Das nächste Gewerk, das noch nicht begonnen hat. */
export function naechstesGewerk(
  daten: Projektdaten,
  heute: IsoDatum = heuteJetzt(),
): Gewerk | undefined {
  return [...daten.gewerke]
    .filter((g) => g.status !== 'fertig' && g.start > heute)
    .sort((a, b) => a.start.localeCompare(b.start) || a.nummer - b.nummer)[0];
}

/** Offene Entscheidungen, die dringendste zuerst. */
export function offeneEntscheidungen(daten: Projektdaten): Entscheidung[] {
  return daten.entscheidungen
    .filter((e) => !e.erledigt)
    .sort((a, b) => a.fristBis.localeCompare(b.fristBis));
}

export function erledigteEntscheidungen(daten: Projektdaten): Entscheidung[] {
  return daten.entscheidungen
    .filter((e) => e.erledigt)
    .sort((a, b) => (b.erledigtAm ?? '').localeCompare(a.erledigtAm ?? ''));
}

/** Verbleibende Kalendertage bis zur Frist. Negativ heißt: Frist ist vorbei. */
export function tageBisFrist(entscheidung: Entscheidung, heute: IsoDatum = heuteJetzt()): number {
  return kalendertageZwischen(heute, entscheidung.fristBis);
}

/**
 * Baufortschritt in Prozent, gewichtet nach Arbeitstagen. Ein Gewerk von
 * 25 Tagen zählt mehr als eines von zweien — sonst wäre der Gerüstbau
 * genauso viel wert wie der ganze Rohbau.
 */
export function fortschrittProzent(daten: Projektdaten): number {
  const gesamt = daten.gewerke.reduce((summe, g) => summe + dauerInArbeitstagen(g), 0);
  if (gesamt === 0) return 0;
  const erledigt = daten.gewerke.reduce(
    (summe, g) => summe + (dauerInArbeitstagen(g) * g.fortschrittProzent) / 100,
    0,
  );
  return Math.round((erledigt / gesamt) * 100);
}

export function voraussichtlicheFertigstellung(daten: Projektdaten): IsoDatum {
  return planEnde(daten.gewerke);
}

/**
 * Kalendertage, die das Projekt hinter der vereinbarten Fertigstellung liegt.
 * Null oder negativ heißt: im Plan.
 */
export function verzugTage(daten: Projektdaten): number {
  return kalendertageZwischen(daten.projekt.zielFertigstellung, voraussichtlicheFertigstellung(daten));
}

export function fotosZuGewerk(daten: Projektdaten, id: string): Fotoeintrag[] {
  return daten.fotos.filter((f) => f.gewerkId === id);
}

export function ereignisseZuGewerk(daten: Projektdaten, id: string): Ereignis[] {
  return daten.ereignisse.filter((e) => e.gewerkId === id);
}

// --- Zeitleiste ------------------------------------------------------------

export type Zeitleisteneintrag =
  | { art: 'gewerk'; schluessel: string; datum: IsoDatum; gewerk: Gewerk }
  | {
      art: 'wartezeit';
      schluessel: string;
      datum: IsoDatum;
      nachGewerk: Gewerk;
      von: IsoDatum;
      bis: IsoDatum;
      tage: number;
      grund: string;
    }
  | { art: 'heute'; schluessel: string; datum: IsoDatum };

export interface Zeitleistenabschnitt {
  phase: Bauphase;
  eintraege: Zeitleisteneintrag[];
}

/**
 * Die Zeitleiste: alle Gewerke und alle Wartezeiten in zeitlicher Folge, nach
 * Bauphasen gruppiert, mit der Marke „Heute" an ihrer Stelle.
 *
 * Wartezeiten sind eigene Einträge. Ein Bauherr, der nur die Gewerke sieht,
 * hält vier Wochen Stillstand für ein Versäumnis.
 */
export function zeitleiste(
  daten: Projektdaten,
  heute: IsoDatum = heuteJetzt(),
): Zeitleistenabschnitt[] {
  const alle: Array<Zeitleisteneintrag & { phase: Bauphase }> = [];

  for (const gewerk of daten.gewerke) {
    const phase = phaseVonGewerk(gewerk.id);
    alle.push({ art: 'gewerk', schluessel: gewerk.id, datum: gewerk.start, gewerk, phase });

    if (gewerk.wartezeitTage && gewerk.wartezeitTage > 0) {
      alle.push({
        art: 'wartezeit',
        schluessel: `${gewerk.id}-wartezeit`,
        datum: plusKalendertage(gewerk.ende, 1),
        nachGewerk: gewerk,
        von: plusKalendertage(gewerk.ende, 1),
        bis: plusKalendertage(gewerk.ende, gewerk.wartezeitTage),
        tage: gewerk.wartezeitTage,
        grund: gewerk.wartezeitGrund ?? 'Technisch notwendige Wartezeit.',
        phase,
      });
    }
  }

  alle.sort((a, b) => a.datum.localeCompare(b.datum));

  // Die Heute-Marke gehört vor den ersten Eintrag, der noch bevorsteht.
  const stelle = alle.findIndex((eintrag) => eintrag.datum > heute);
  const letzte = BAUPHASEN[BAUPHASEN.length - 1] as Bauphase;
  const marke: Zeitleisteneintrag & { phase: Bauphase } = {
    art: 'heute',
    schluessel: 'heute',
    datum: heute,
    phase: stelle === -1 ? letzte : (alle[stelle] as { phase: Bauphase }).phase,
  };
  if (stelle === -1) alle.push(marke);
  else alle.splice(stelle, 0, marke);

  return BAUPHASEN.map((phase) => ({
    phase,
    eintraege: alle.filter((e) => e.phase === phase).map(({ phase: _phase, ...rest }) => rest),
  })).filter((abschnitt) => abschnitt.eintraege.length > 0);
}

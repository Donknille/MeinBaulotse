/*
 * Die Kettenrechnung: was passiert, wenn sich ein Termin verschiebt.
 *
 * Diese Datei ist bewusst frei von Zustand, Netzwerk und Uhrzeit. Alles, was
 * gerechnet wird, kommt als Parameter herein und geht als neues Feld heraus.
 * Nur so lässt sich die Vorschau im Dialog rechnen, ohne den Plan vorher zu
 * verändern.
 *
 * Die Regeln, in der Reihenfolge ihrer Wichtigkeit:
 *
 * 1. Ein Gewerk kann frühestens starten, wenn alle Vorgänger fertig sind —
 *    einschließlich der Wartezeiten, die diesen Vorgängern folgen.
 * 2. Wartezeiten sind nicht verkürzbar und werden nie überlappt. Sie zählen in
 *    Kalendertagen, Arbeitsdauern in Arbeitstagen.
 * 3. Ein Gewerk mit Status `fertig` wird nie verschoben. Was gebaut ist, ist
 *    gebaut.
 * 4. Eine Verschiebung nach hinten schlägt voll durch. Eine Verschiebung nach
 *    vorn zieht Nachfolger nur so weit vor, wie ihre Vorgänger es zulassen.
 * 5. Es gibt keinen Puffer. Das ist unbequem und entspricht der Wirklichkeit.
 */

import {
  arbeitstageZwischen,
  endeNachDauer,
  kalendertageZwischen,
  naechsterArbeitstag,
  naechsterArbeitstagNach,
  plusKalendertage,
  spaeteres,
  type IsoDatum,
} from './datum';
import type { Gewerk } from './types';

export interface Planaenderung {
  /** Der vollständige Plan nach der Änderung. Die Eingabe bleibt unberührt. */
  gewerke: Gewerk[];
  /** IDs der Gewerke, die sich mitbewegen — ohne das gezogene selbst. */
  betroffene: string[];
  /** Kalendertage, um die das gezogene Gewerk wandert. Negativ heißt früher. */
  verschiebungTage: number;
  /** Das späteste Ende vor der Änderung. */
  altesPlanende: IsoDatum;
  /** Das späteste Ende nach der Änderung. */
  neuesPlanende: IsoDatum;
  /**
   * Gesetzt, wenn der Wunschtermin früher lag, als die Vorgänger es erlauben.
   * Enthält dann die ID des Vorgängers, an dem es scheitert.
   */
  begrenztDurch: string | null;
}

/** Die Dauer eines Gewerks in Arbeitstagen, aus seinen Terminen abgeleitet. */
export function dauerInArbeitstagen(gewerk: Gewerk): number {
  return arbeitstageZwischen(gewerk.start, gewerk.ende);
}

/**
 * Der Tag, an dem `vorgaenger` seinen Nachfolger freigibt: der erste
 * Arbeitstag nach dem Ende plus einer etwaigen Wartezeit in Kalendertagen.
 */
export function freigabeTag(vorgaenger: Gewerk): IsoDatum {
  const warte = vorgaenger.wartezeitTage ?? 0;
  return naechsterArbeitstagNach(plusKalendertage(vorgaenger.ende, warte));
}

/**
 * Der früheste Starttermin eines Gewerks nach seinen Vorgängern.
 * Ohne Vorgänger gibt es keine Bedingung — dann `null`.
 */
export function fruehesterStart(
  gewerk: Gewerk,
  nachId: ReadonlyMap<string, Gewerk>,
): { datum: IsoDatum; begrenztDurch: string } | null {
  let ergebnis: { datum: IsoDatum; begrenztDurch: string } | null = null;

  for (const vorgaengerId of gewerk.vorgaenger) {
    const vorgaenger = nachId.get(vorgaengerId);
    if (!vorgaenger) continue; // unbekannte ID: keine Bedingung, kein Absturz
    const datum = freigabeTag(vorgaenger);
    if (ergebnis === null || datum > ergebnis.datum) {
      ergebnis = { datum, begrenztDurch: vorgaengerId };
    }
  }

  return ergebnis;
}

/** Die direkten Nachfolger eines Gewerks. */
export function nachfolger(gewerke: readonly Gewerk[], gewerkId: string): Gewerk[] {
  return gewerke.filter((g) => g.vorgaenger.includes(gewerkId));
}

/** Alle Gewerke, die mittelbar oder unmittelbar auf `gewerkId` aufbauen. */
export function nachfolgerHuelle(gewerke: readonly Gewerk[], gewerkId: string): Set<string> {
  const huelle = new Set<string>();
  const offen = [gewerkId];

  while (offen.length > 0) {
    const aktuell = offen.pop() as string;
    for (const kandidat of gewerke) {
      if (kandidat.vorgaenger.includes(aktuell) && !huelle.has(kandidat.id)) {
        huelle.add(kandidat.id);
        offen.push(kandidat.id);
      }
    }
  }

  return huelle;
}

/**
 * Reihenfolge, in der sich die Gewerke rechnen lassen: kein Gewerk steht vor
 * einem seiner Vorgänger. Ein Kreis im Ablauf ist ein Fehler in den Daten und
 * wird als solcher gemeldet, statt still eine falsche Reihenfolge zu liefern.
 */
export function topologischeReihenfolge(gewerke: readonly Gewerk[]): Gewerk[] {
  const vorhanden = new Set(gewerke.map((g) => g.id));
  const offeneVorgaenger = new Map<string, number>();
  const nachfolgerVon = new Map<string, string[]>();

  for (const gewerk of gewerke) {
    const relevante = gewerk.vorgaenger.filter((id) => vorhanden.has(id));
    offeneVorgaenger.set(gewerk.id, relevante.length);
    for (const vorgaengerId of relevante) {
      const liste = nachfolgerVon.get(vorgaengerId) ?? [];
      liste.push(gewerk.id);
      nachfolgerVon.set(vorgaengerId, liste);
    }
  }

  // Stabile Ausgangsmenge: nach Nummer, damit die Ausgabe reproduzierbar ist.
  const bereit = gewerke
    .filter((g) => offeneVorgaenger.get(g.id) === 0)
    .sort((a, b) => a.nummer - b.nummer)
    .map((g) => g.id);

  const nachId = new Map(gewerke.map((g) => [g.id, g]));
  const sortiert: Gewerk[] = [];

  while (bereit.length > 0) {
    const id = bereit.shift() as string;
    sortiert.push(nachId.get(id) as Gewerk);
    for (const nachfolgerId of nachfolgerVon.get(id) ?? []) {
      const rest = (offeneVorgaenger.get(nachfolgerId) as number) - 1;
      offeneVorgaenger.set(nachfolgerId, rest);
      if (rest === 0) bereit.push(nachfolgerId);
    }
  }

  if (sortiert.length !== gewerke.length) {
    const kreis = gewerke.filter((g) => !sortiert.includes(g)).map((g) => g.name);
    throw new Error(`Der Bauablauf enthält einen Kreis: ${kreis.join(', ')}`);
  }

  return sortiert;
}

/** Das späteste Ende im Plan — die voraussichtliche Fertigstellung. */
export function planEnde(gewerke: readonly Gewerk[]): IsoDatum {
  return gewerke.reduce((spaetestes, g) => spaeteres(spaetestes, g.ende), gewerke[0]?.ende ?? '');
}

/**
 * Legt den Plan von vorn: jedes Gewerk startet so früh, wie seine Vorgänger es
 * zulassen, Gewerke ohne Vorgänger am Baubeginn. Die Dauern bleiben erhalten.
 *
 * Das ist der Basisplan — der Plan, wie er ohne jede Störung aussähe. Aus ihm
 * stammt die vereinbarte Fertigstellung, gegen die später gemessen wird.
 */
export function berechneBasisplan(gewerke: readonly Gewerk[], baubeginn: IsoDatum): Gewerk[] {
  const nachId = new Map<string, Gewerk>();
  const ergebnis: Gewerk[] = [];

  for (const gewerk of topologischeReihenfolge(gewerke)) {
    const dauer = dauerInArbeitstagen(gewerk);
    const grenze = fruehesterStart(gewerk, nachId);
    const start = grenze ? grenze.datum : naechsterArbeitstag(baubeginn);
    const neu: Gewerk = { ...gewerk, start, ende: endeNachDauer(start, dauer) };
    nachId.set(neu.id, neu);
    ergebnis.push(neu);
  }

  return sortiereWieEingabe(gewerke, ergebnis);
}

/**
 * Was passiert, wenn `gewerkId` auf `neuerStart` gezogen wird.
 *
 * Reine Funktion: sie verändert nichts, sondern liefert den Plan, wie er nach
 * der Übernahme aussähe. Erst damit lässt sich die Vorschau zeigen, bevor
 * irgendetwas übernommen ist.
 */
export function berechneNeuenPlan(
  gewerke: readonly Gewerk[],
  gewerkId: string,
  neuerStart: IsoDatum,
): Planaenderung {
  const original = new Map(gewerke.map((g) => [g.id, g]));
  const ziel = original.get(gewerkId);

  if (!ziel) {
    throw new Error(`Unbekanntes Gewerk: ${gewerkId}`);
  }

  const altesPlanende = planEnde(gewerke);
  const unveraendert: Planaenderung = {
    gewerke: gewerke.map((g) => ({ ...g })),
    betroffene: [],
    verschiebungTage: 0,
    altesPlanende,
    neuesPlanende: altesPlanende,
    begrenztDurch: null,
  };

  // Regel 3: Was fertig ist, wird nicht verschoben.
  if (ziel.status === 'fertig') return unveraendert;

  // Regel 1 gilt auch für den gezogenen Balken selbst: früher als die
  // Vorgänger erlauben, geht nicht.
  const grenze = fruehesterStart(ziel, original);
  const gewuenscht = naechsterArbeitstag(neuerStart);
  const begrenzt = grenze !== null && gewuenscht < grenze.datum;
  const start = begrenzt ? (grenze as { datum: IsoDatum }).datum : gewuenscht;

  const gerechnet = new Map<string, Gewerk>();
  const huelle = nachfolgerHuelle(gewerke, gewerkId);

  for (const gewerk of topologischeReihenfolge(gewerke)) {
    if (gewerk.id === gewerkId) {
      gerechnet.set(gewerk.id, {
        ...gewerk,
        start,
        ende: endeNachDauer(start, dauerInArbeitstagen(gewerk)),
      });
      continue;
    }

    // Außerhalb der Nachfolgerhülle wird nichts angefasst, ebenso wenig an
    // fertigen Gewerken.
    if (!huelle.has(gewerk.id) || gewerk.status === 'fertig') {
      gerechnet.set(gewerk.id, { ...gewerk });
      continue;
    }

    const neueGrenze = fruehesterStart(gewerk, gerechnet);
    const neuerStartDesNachfolgers = neueGrenze ? neueGrenze.datum : gewerk.start;
    gerechnet.set(gewerk.id, {
      ...gewerk,
      start: neuerStartDesNachfolgers,
      ende: endeNachDauer(neuerStartDesNachfolgers, dauerInArbeitstagen(gewerk)),
    });
  }

  const neu = sortiereWieEingabe(
    gewerke,
    gewerke.map((g) => gerechnet.get(g.id) as Gewerk),
  );

  const betroffene = neu
    .filter((g) => {
      if (g.id === gewerkId) return false;
      const alt = original.get(g.id) as Gewerk;
      return alt.start !== g.start || alt.ende !== g.ende;
    })
    .map((g) => g.id);

  return {
    gewerke: neu,
    betroffene,
    verschiebungTage: kalendertageZwischen(ziel.start, start),
    altesPlanende,
    neuesPlanende: planEnde(neu),
    begrenztDurch: begrenzt ? ((grenze as { begrenztDurch: string }).begrenztDurch ?? null) : null,
  };
}

/** Stellt die Reihenfolge der Eingabe wieder her, damit Listen nicht springen. */
function sortiereWieEingabe(vorlage: readonly Gewerk[], gerechnet: readonly Gewerk[]): Gewerk[] {
  const nachId = new Map(gerechnet.map((g) => [g.id, g]));
  return vorlage.map((g) => nachId.get(g.id) as Gewerk);
}

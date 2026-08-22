/*
 * Schreibzugriffe auf ein Projekt.
 *
 * Jede Funktion nimmt den Stand entgegen und gibt einen neuen zurück. Nichts
 * wird an Ort und Stelle verändert, und jede Änderung schreibt sich selbst ins
 * Protokoll — der Verlauf entsteht nicht nebenbei in der Oberfläche, sondern
 * hier, wo die Änderung tatsächlich passiert.
 */

import { alsDatum, alsTagUndMonat, alsVerschiebung, heute as heuteJetzt, type IsoDatum } from '../datum';
import { berechneNeuenPlan, type Planaenderung } from '../planung';
import type { Fotoeintrag, Gewerk, Herkunft, Projektdaten, Rolle, Status } from '../types';

let laufendeNummer = 0;

function neueId(prefix: string): string {
  laufendeNummer += 1;
  return `${prefix}-${Date.now().toString(36)}-${laufendeNummer}`;
}

/** Hängt einen Protokolleintrag an. Einträge werden nie ersetzt. */
function protokolliere(
  daten: Projektdaten,
  akteur: Rolle,
  text: string,
  gewerkId?: string,
): Projektdaten {
  return {
    ...daten,
    ereignisse: [
      {
        id: neueId('ev'),
        zeitpunkt: new Date().toISOString(),
        akteur,
        text,
        ...(gewerkId ? { gewerkId } : {}),
      },
      ...daten.ereignisse,
    ],
  };
}

export function herkunftsText(herkunft: Herkunft): string {
  switch (herkunft) {
    case 'gewerk_bestaetigt':
      return 'Vom Betrieb bestätigt';
    case 'bauherr_eingetragen':
      return 'Von Ihnen eingetragen';
    case 'gu_gemeldet':
      return 'Vom Bauleiter gemeldet';
    case 'geplant':
      return 'Noch keine Rückmeldung';
  }
}

export const STATUSTEXT: Record<Status, string> = {
  geplant: 'Geplant',
  bestaetigt: 'Termin bestätigt',
  laeuft: 'Läuft gerade',
  fertig: 'Fertig',
  verzoegert: 'Später als geplant',
  blockiert: 'Wartet auf Vorleistung',
};

/**
 * Rechnet die Vorschau für eine Verschiebung. Ändert nichts — das Ergebnis
 * geht in den Vorschaudialog und erst dessen Bestätigung nach
 * `planUebernehmen`.
 */
export function planVorschau(
  daten: Projektdaten,
  gewerkId: string,
  neuerStart: IsoDatum,
): Planaenderung {
  return berechneNeuenPlan(daten.gewerke, gewerkId, neuerStart);
}

/** Übernimmt eine zuvor gerechnete Verschiebung. */
export function planUebernehmen(
  daten: Projektdaten,
  gewerkId: string,
  aenderung: Planaenderung,
  akteur: Rolle,
): Projektdaten {
  const alt = daten.gewerke.find((g) => g.id === gewerkId);
  const neu = aenderung.gewerke.find((g) => g.id === gewerkId);
  if (!alt || !neu || alt.start === neu.start) return daten;

  const mitPlan: Projektdaten = { ...daten, gewerke: aenderung.gewerke };
  const mitEintrag = protokolliere(
    mitPlan,
    akteur,
    `${alt.name} von ${alsTagUndMonat(alt.start)} auf ${alsTagUndMonat(neu.start)} verschoben`,
    gewerkId,
  );

  if (aenderung.betroffene.length === 0) return mitEintrag;

  const verschiebung = alsVerschiebung(
    aenderung.neuesPlanende === aenderung.altesPlanende
      ? 0
      : Math.round(
          (Date.parse(aenderung.neuesPlanende) - Date.parse(aenderung.altesPlanende)) / 86400000,
        ),
  );

  return protokolliere(
    mitEintrag,
    akteur,
    `${aenderung.betroffene.length} nachgelagerte Gewerke mitverschoben, Fertigstellung ${alsDatum(aenderung.neuesPlanende)} (${verschiebung})`,
  );
}

export interface Statusmeldung {
  gewerkId: string;
  status: Status;
  fortschrittProzent?: number;
  herkunft: Herkunft;
  /** Quellenangabe beim stellvertretenden Eintragen, etwa „Telefonat am 12.03.". */
  notiz?: string;
  akteur: Rolle;
}

export function statusMelden(daten: Projektdaten, meldung: Statusmeldung): Projektdaten {
  const gewerk = daten.gewerke.find((g) => g.id === meldung.gewerkId);
  if (!gewerk) return daten;

  const fortschritt =
    meldung.fortschrittProzent ??
    (meldung.status === 'fertig' ? 100 : meldung.status === 'geplant' ? 0 : gewerk.fortschrittProzent);

  const aktualisiert: Gewerk = {
    ...gewerk,
    status: meldung.status,
    fortschrittProzent: Math.max(0, Math.min(100, Math.round(fortschritt))),
    herkunft: meldung.herkunft,
    letzteMeldung: new Date().toISOString(),
    ...(meldung.notiz ? { herkunftNotiz: meldung.notiz } : {}),
  };

  const mitGewerk: Projektdaten = {
    ...daten,
    gewerke: daten.gewerke.map((g) => (g.id === gewerk.id ? aktualisiert : g)),
  };

  const quelle = meldung.notiz ? `, Quelle: ${meldung.notiz}` : '';
  return protokolliere(
    mitGewerk,
    meldung.akteur,
    `${gewerk.name}: ${STATUSTEXT[meldung.status]}${quelle}`,
    gewerk.id,
  );
}

/** Ein Betrieb sagt seinen Termin zu. */
export function terminBestaetigen(daten: Projektdaten, gewerkId: string): Projektdaten {
  return statusMelden(daten, {
    gewerkId,
    status: 'bestaetigt',
    herkunft: 'gewerk_bestaetigt',
    akteur: 'gewerk',
  });
}

/** Ein Betrieb sagt ab. Der Termin bleibt stehen, bis er neu abgestimmt ist. */
export function terminAbsagen(daten: Projektdaten, gewerkId: string, grund: string): Projektdaten {
  const gewerk = daten.gewerke.find((g) => g.id === gewerkId);
  if (!gewerk) return daten;

  const mitStatus = statusMelden(daten, {
    gewerkId,
    status: 'verzoegert',
    herkunft: 'gewerk_bestaetigt',
    notiz: grund,
    akteur: 'gewerk',
  });

  return protokolliere(
    mitStatus,
    'gewerk',
    `${gewerk.name}: Termin abgesagt. Der Termin bleibt im Plan stehen, bis ein neuer abgestimmt ist.`,
    gewerkId,
  );
}

export function entscheidungAbschliessen(
  daten: Projektdaten,
  entscheidungId: string,
  akteur: Rolle,
  heute: IsoDatum = heuteJetzt(),
): Projektdaten {
  const entscheidung = daten.entscheidungen.find((e) => e.id === entscheidungId);
  if (!entscheidung || entscheidung.erledigt) return daten;

  const mitEntscheidung: Projektdaten = {
    ...daten,
    entscheidungen: daten.entscheidungen.map((e) =>
      e.id === entscheidungId ? { ...e, erledigt: true, erledigtAm: heute } : e,
    ),
  };

  return protokolliere(
    mitEntscheidung,
    akteur,
    `Entscheidung getroffen: ${entscheidung.titel}`,
    entscheidung.betrifftGewerkId,
  );
}

/** Nimmt eine Entscheidung zurück — im Prototyp der Weg zurück zum Ausgangsstand. */
export function entscheidungOeffnen(
  daten: Projektdaten,
  entscheidungId: string,
  akteur: Rolle,
): Projektdaten {
  const entscheidung = daten.entscheidungen.find((e) => e.id === entscheidungId);
  if (!entscheidung || !entscheidung.erledigt) return daten;

  const geoeffnet = daten.entscheidungen.map((e) => {
    if (e.id !== entscheidungId) return e;
    const { erledigtAm: _erledigtAm, ...rest } = e;
    return { ...rest, erledigt: false };
  });

  return protokolliere(
    { ...daten, entscheidungen: geoeffnet },
    akteur,
    `Entscheidung wieder geöffnet: ${entscheidung.titel}`,
    entscheidung.betrifftGewerkId,
  );
}

export interface Fotomeldung {
  gewerkId?: string;
  titel: string;
  notiz?: string;
  bildUrl: string;
  erfasstVon: Rolle;
  herkunft: Herkunft;
  datum?: IsoDatum;
}

export function fotoAnlegen(daten: Projektdaten, meldung: Fotomeldung): Projektdaten {
  const foto: Fotoeintrag = {
    id: neueId('foto'),
    datum: meldung.datum ?? heuteJetzt(),
    titel: meldung.titel,
    bildUrl: meldung.bildUrl,
    erfasstVon: meldung.erfasstVon,
    herkunft: meldung.herkunft,
    ...(meldung.gewerkId ? { gewerkId: meldung.gewerkId } : {}),
    ...(meldung.notiz ? { notiz: meldung.notiz } : {}),
  };

  const mitFoto: Projektdaten = {
    ...daten,
    fotos: [foto, ...daten.fotos].sort((a, b) => b.datum.localeCompare(a.datum)),
  };

  return protokolliere(mitFoto, meldung.erfasstVon, `Foto hinzugefügt: ${foto.titel}`, foto.gewerkId);
}

export type Gewerkfelder = Partial<Pick<Gewerk, 'betrieb' | 'ansprechpartner' | 'telefon'>>;

export function gewerkBearbeiten(
  daten: Projektdaten,
  gewerkId: string,
  felder: Gewerkfelder,
  akteur: Rolle,
): Projektdaten {
  const gewerk = daten.gewerke.find((g) => g.id === gewerkId);
  if (!gewerk) return daten;

  const mitGewerk: Projektdaten = {
    ...daten,
    gewerke: daten.gewerke.map((g) => (g.id === gewerkId ? { ...g, ...felder } : g)),
  };

  return protokolliere(mitGewerk, akteur, `${gewerk.name}: Angaben zum Betrieb geändert`, gewerkId);
}

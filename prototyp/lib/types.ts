/*
 * Das Datenmodell des Prototyps.
 *
 * Termine sind durchgehend ISO-Datumsangaben `YYYY-MM-DD` ohne Uhrzeit. Ein
 * Bautermin hat keine Zeitzone; sobald ein `Date`-Objekt durch die Datenhaltung
 * wandert, entstehen Verschiebungen um einen Tag. Zeitstempel im Protokoll sind
 * dagegen vollständige ISO-Zeitangaben, weil dort die Uhrzeit zur Aussage
 * gehört.
 */

/** Wie das Projekt geführt wird. Bestimmt Rechte und Standardwege. */
export type Betriebsmodus = 'begleitet' | 'selbst' | 'stellvertretend';
// begleitet       = GU führt den Plan, Bauherr hat Einsicht
// selbst          = Bauherr führt den Plan, Gewerke haben Zugänge
// stellvertretend = Bauherr führt den Plan und trägt alles selbst ein

export type Rolle = 'gu' | 'bauherr' | 'gewerk';

/**
 * Woher eine Angabe stammt. Steht an jeder Statusmeldung und jedem Foto —
 * der Unterschied zwischen „das Gewerk hat zugesagt" und „so habe ich es
 * verstanden" entscheidet später, worauf man sich berufen kann.
 */
export type Herkunft =
  | 'gewerk_bestaetigt' // das Gewerk hat es selbst gemeldet
  | 'bauherr_eingetragen' // Bauherr trägt stellvertretend ein
  | 'gu_gemeldet' // vom GU gemeldet
  | 'geplant'; // reiner Planwert, noch keine Meldung

export type Status =
  | 'geplant'
  | 'bestaetigt' // Termin vom Ausführenden zugesagt
  | 'laeuft'
  | 'fertig'
  | 'verzoegert'
  | 'blockiert'; // wartet auf Vorleistung oder Entscheidung

/** Grobgliederung des Bauablaufs. Nur zur Gruppierung in der Zeitleiste. */
export type Bauphase = 'Vorbereitung' | 'Rohbau' | 'Hülle' | 'Technik' | 'Ausbau' | 'Abschluss';

export interface Projekt {
  id: string;
  name: string; // z. B. "Einfamilienhaus Musterweg 12"
  bauherr: string;
  modus: Betriebsmodus;
  baubeginn: string; // ISO-Datum
  zielFertigstellung: string;
  gu?: string; // Name des GU, nur bei Modus 'begleitet'
}

export interface Gewerk {
  id: string;
  nummer: number; // Reihenfolge im Bauablauf
  name: string; // "Rohbau", "Estrich"
  beschreibung: string; // ein Satz, laienverständlich
  betrieb?: string; // ausführender Betrieb, optional
  ansprechpartner?: string;
  telefon?: string;
  start: string; // ISO
  ende: string; // ISO
  status: Status;
  herkunft: Herkunft;
  herkunftNotiz?: string; // "Telefonat mit Herrn Meier am 12.03."
  letzteMeldung?: string; // ISO-Zeitstempel
  vorgaenger: string[]; // IDs der Gewerke, die vorher fertig sein müssen
  wartezeitTage?: number; // Wartezeit NACH diesem Gewerk, z. B. Estrichtrocknung
  wartezeitGrund?: string; // "Estrichtrocknung, nicht verkürzbar"
  fortschrittProzent: number;
}

export interface Entscheidung {
  id: string;
  titel: string; // "Fliesen bemustern"
  beschreibung: string;
  fristBis: string; // ISO
  betrifftGewerkId: string; // welches Gewerk hängt daran
  erledigt: boolean;
  erledigtAm?: string;
  auswirkung: string; // "Ohne Auswahl kann der Fliesenleger nicht starten"
}

export interface Fotoeintrag {
  id: string;
  gewerkId?: string;
  datum: string; // ISO
  titel: string;
  notiz?: string;
  bildUrl: string; // im Prototyp Platzhalter
  erfasstVon: Rolle;
  herkunft: Herkunft;
}

export interface Ereignis {
  // Verlaufsprotokoll, fälschungssicher gedacht
  id: string;
  zeitpunkt: string;
  akteur: Rolle;
  text: string; // "Estrich von 12.05. auf 19.05. verschoben"
  gewerkId?: string;
}

/** Alles, was ein Projekt im Prototyp ausmacht. Eine Ablage je Projekt. */
export interface Projektdaten {
  projekt: Projekt;
  gewerke: Gewerk[];
  entscheidungen: Entscheidung[];
  fotos: Fotoeintrag[];
  ereignisse: Ereignis[];
}

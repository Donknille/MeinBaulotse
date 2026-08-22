/*
 * Der Bauablauf eines freistehenden Einfamilienhauses, massiv und ohne Keller.
 *
 * Das ist Redaktionsinhalt, keine Programmlogik: Reihenfolge, Dauern,
 * Abhängigkeiten und vor allem die Wartezeiten stehen hier an einer Stelle und
 * werden von `seed.ts` in ein Projekt gegossen.
 *
 * Die Beschreibungen richten sich an jemanden, der zum ersten und einzigen Mal
 * ein Haus baut. Kein Fachbegriff ohne Erklärung.
 */

import type { Bauphase } from './types';

export interface Gewerkvorlage {
  nummer: number;
  name: string;
  beschreibung: string;
  phase: Bauphase;
  /** Dauer in Arbeitstagen. */
  dauer: number;
  /** Nummern der Gewerke, die vorher fertig sein müssen. */
  vorgaenger: number[];
  /** Wartezeit NACH diesem Gewerk, in Kalendertagen. */
  wartezeitTage?: number;
  wartezeitGrund?: string;
  betrieb?: string;
  ansprechpartner?: string;
  telefon?: string;
}

/** Die ID, unter der ein Gewerk mit dieser Nummer im Projekt geführt wird. */
export function gewerkId(nummer: number): string {
  return `gw-${String(nummer).padStart(2, '0')}`;
}

export const BAUPHASEN: Bauphase[] = [
  'Vorbereitung',
  'Rohbau',
  'Hülle',
  'Technik',
  'Ausbau',
  'Abschluss',
];

export const GEWERKVORLAGEN: Gewerkvorlage[] = [
  {
    nummer: 1,
    name: 'Vermessung und Baugrundgutachten',
    beschreibung:
      'Der Vermesser steckt ab, wo genau das Haus auf dem Grundstück steht. Das Gutachten sagt, was der Boden tragen kann.',
    phase: 'Vorbereitung',
    dauer: 5,
    vorgaenger: [],
    betrieb: 'Vermessungsbüro Kern',
    ansprechpartner: 'Frau Kern',
    telefon: '0721 445120',
  },
  {
    nummer: 2,
    name: 'Erdarbeiten und Baugrube',
    beschreibung: 'Der Bagger hebt die Grube aus, der Aushub wird abgefahren.',
    phase: 'Vorbereitung',
    dauer: 5,
    vorgaenger: [1],
    betrieb: 'Erdbau Ostermann',
    ansprechpartner: 'Herr Ostermann',
    telefon: '0721 998301',
  },
  {
    nummer: 3,
    name: 'Bodenplatte',
    beschreibung:
      'Die Betonplatte, auf der das ganze Haus steht. Sie wird bewehrt, geschalt und gegossen.',
    phase: 'Rohbau',
    dauer: 8,
    vorgaenger: [2],
    wartezeitTage: 14,
    wartezeitGrund:
      'Betonaushärtung. Der Beton braucht diese Zeit, um seine Festigkeit zu erreichen. Wird darauf zu früh gemauert, bekommt die Platte Risse.',
    betrieb: 'Bauunternehmung Radke',
    ansprechpartner: 'Herr Radke',
    telefon: '0721 331470',
  },
  {
    nummer: 4,
    name: 'Rohbau Mauerwerk und Decken',
    beschreibung:
      'Außenwände, Innenwände und Geschossdecken werden gemauert und eingezogen. Danach steht das Haus roh.',
    phase: 'Rohbau',
    dauer: 25,
    vorgaenger: [3],
    betrieb: 'Bauunternehmung Radke',
    ansprechpartner: 'Herr Radke',
    telefon: '0721 331470',
  },
  {
    nummer: 5,
    name: 'Gerüstbau',
    beschreibung: 'Das Gerüst wird gestellt, damit Dach und Fassade sicher erreichbar sind.',
    phase: 'Hülle',
    dauer: 2,
    vorgaenger: [4],
    betrieb: 'Gerüstbau Pfeiffer',
    ansprechpartner: 'Herr Pfeiffer',
    telefon: '0721 776012',
  },
  {
    nummer: 6,
    name: 'Zimmerer, Dachstuhl',
    beschreibung:
      'Der Dachstuhl wird aufgesetzt. Ab diesem Tag hat das Haus seine endgültige Form.',
    phase: 'Hülle',
    dauer: 8,
    vorgaenger: [4, 5],
    betrieb: 'Zimmerei Halbmeier',
    ansprechpartner: 'Herr Halbmeier',
    telefon: '07243 51188',
  },
  {
    nummer: 7,
    name: 'Dachdecker und Klempner',
    beschreibung:
      'Ziegel, Dachrinnen und Blechanschlüsse. Danach ist das Haus von oben dicht und Regen schadet nicht mehr.',
    phase: 'Hülle',
    dauer: 10,
    vorgaenger: [6],
    betrieb: 'Dach Sanwald',
    ansprechpartner: 'Herr Sanwald',
    telefon: '07243 20455',
  },
  {
    nummer: 8,
    name: 'Fenster und Außentüren',
    beschreibung:
      'Fenster und Haustür werden eingebaut. Zusammen mit dem Dach ist das Haus damit geschlossen und lässt sich beheizen.',
    phase: 'Hülle',
    dauer: 5,
    vorgaenger: [6],
    betrieb: 'Fensterbau Kropf',
    ansprechpartner: 'Frau Kropf',
    telefon: '0721 640920',
  },
  {
    nummer: 9,
    name: 'Elektro Rohinstallation',
    beschreibung:
      'Leerrohre und Leitungen werden in Wände und Decken gelegt, solange noch nicht verputzt ist. Was jetzt fehlt, kostet später Stemmarbeit.',
    phase: 'Technik',
    dauer: 8,
    vorgaenger: [7, 8],
    betrieb: 'Elektro Bräuer',
    ansprechpartner: 'Herr Bräuer',
    telefon: '0721 512244',
  },
  {
    nummer: 10,
    name: 'Sanitär und Heizung Rohinstallation',
    beschreibung:
      'Leitungen für Wasser, Abwasser und Heizung werden verlegt, die Fußbodenheizung wird vorbereitet.',
    phase: 'Technik',
    dauer: 12,
    vorgaenger: [7, 8],
    betrieb: 'Haustechnik Meier',
    ansprechpartner: 'Herr Meier',
    telefon: '0721 883917',
  },
  {
    nummer: 11,
    name: 'Lüftungsanlage',
    beschreibung: 'Die Lüftungsrohre werden eingebaut, solange die Decken noch offen sind.',
    phase: 'Technik',
    dauer: 5,
    vorgaenger: [9, 10],
    betrieb: 'Haustechnik Meier',
    ansprechpartner: 'Herr Meier',
    telefon: '0721 883917',
  },
  {
    nummer: 12,
    name: 'Innenputz',
    beschreibung: 'Die Wände werden verputzt. Erst danach sind die Oberflächen geschlossen.',
    phase: 'Ausbau',
    dauer: 10,
    vorgaenger: [11],
    wartezeitTage: 7,
    wartezeitGrund:
      'Putztrocknung. Die Feuchtigkeit aus dem Putz muss raus, bevor der Estrich eingebracht wird.',
    betrieb: 'Putz und Stuck Vogel',
    ansprechpartner: 'Herr Vogel',
    telefon: '07243 33108',
  },
  {
    nummer: 13,
    name: 'Estrich',
    beschreibung:
      'Der Estrich wird eingebracht. Er ist der ebene Untergrund für alle späteren Bodenbeläge.',
    phase: 'Ausbau',
    dauer: 4,
    vorgaenger: [12],
    wartezeitTage: 28,
    wartezeitGrund:
      'Estrichtrocknung, nicht verkürzbar. Wird zu früh Boden verlegt, schließt man die Restfeuchte ein und der Belag wirft sich.',
    betrieb: 'Estrichbau Lang',
    ansprechpartner: 'Herr Lang',
    telefon: '0721 447700',
  },
  {
    nummer: 14,
    name: 'Trockenbau',
    beschreibung: 'Leichte Wände und abgehängte Decken, meist im Dachgeschoss.',
    phase: 'Ausbau',
    dauer: 10,
    vorgaenger: [12],
    betrieb: 'Ausbau Simon',
    ansprechpartner: 'Herr Simon',
    telefon: '0721 209466',
  },
  {
    nummer: 15,
    name: 'Fliesenarbeiten',
    beschreibung: 'Bäder, Gäste-WC und Hauswirtschaftsraum werden gefliest.',
    phase: 'Ausbau',
    dauer: 8,
    vorgaenger: [13],
    betrieb: 'Fliesen Dörr',
    ansprechpartner: 'Herr Dörr',
    telefon: '07243 41290',
  },
  {
    nummer: 16,
    name: 'Innentüren',
    beschreibung: 'Zargen und Türblätter werden gesetzt.',
    phase: 'Ausbau',
    dauer: 3,
    vorgaenger: [13, 14],
    betrieb: 'Schreinerei Wenz',
    ansprechpartner: 'Frau Wenz',
    telefon: '0721 660183',
  },
  {
    nummer: 17,
    name: 'Malerarbeiten',
    beschreibung: 'Wände und Decken werden gespachtelt und gestrichen.',
    phase: 'Ausbau',
    dauer: 8,
    vorgaenger: [14, 16],
    betrieb: 'Malerbetrieb Ziegler',
    ansprechpartner: 'Herr Ziegler',
    telefon: '0721 774523',
  },
  {
    nummer: 18,
    name: 'Bodenbeläge',
    beschreibung: 'Parkett, Laminat oder Vinyl werden verlegt und die Sockelleisten gesetzt.',
    phase: 'Ausbau',
    dauer: 6,
    vorgaenger: [15, 17],
    betrieb: 'Raumausstattung Nolte',
    ansprechpartner: 'Herr Nolte',
    telefon: '0721 318844',
  },
  {
    nummer: 19,
    name: 'Elektro Endmontage',
    beschreibung:
      'Schalter, Steckdosen und Leuchten werden gesetzt, der Zählerschrank wird fertiggestellt.',
    phase: 'Ausbau',
    dauer: 5,
    vorgaenger: [17],
    betrieb: 'Elektro Bräuer',
    ansprechpartner: 'Herr Bräuer',
    telefon: '0721 512244',
  },
  {
    nummer: 20,
    name: 'Sanitär Endmontage',
    beschreibung: 'Waschbecken, WCs, Duschen und Armaturen werden montiert.',
    phase: 'Ausbau',
    dauer: 5,
    vorgaenger: [15, 17],
    betrieb: 'Haustechnik Meier',
    ansprechpartner: 'Herr Meier',
    telefon: '0721 883917',
  },
  {
    nummer: 21,
    name: 'Treppe',
    beschreibung:
      'Die fertige Treppe wird eingebaut. Sie kommt bewusst spät, damit sie beim Ausbau nicht beschädigt wird.',
    phase: 'Ausbau',
    dauer: 3,
    vorgaenger: [17],
    betrieb: 'Schreinerei Wenz',
    ansprechpartner: 'Frau Wenz',
    telefon: '0721 660183',
  },
  {
    nummer: 22,
    name: 'Außenanlagen',
    beschreibung: 'Zufahrt, Terrasse, Wege und Bepflanzung rund um das Haus.',
    phase: 'Abschluss',
    dauer: 12,
    vorgaenger: [5],
    betrieb: 'Garten- und Landschaftsbau Frey',
    ansprechpartner: 'Herr Frey',
    telefon: '07243 62190',
  },
  {
    nummer: 23,
    name: 'Bauabnahme',
    beschreibung:
      'Gemeinsamer Rundgang, bei dem alle Mängel schriftlich festgehalten werden. Erst danach gilt das Haus als übergeben.',
    phase: 'Abschluss',
    dauer: 1,
    vorgaenger: [18, 19, 20, 21],
  },
];

/** Nachschlagen, in welche Bauphase ein Gewerk gehört. */
export function phaseVonGewerk(id: string): Bauphase {
  const vorlage = GEWERKVORLAGEN.find((v) => gewerkId(v.nummer) === id);
  return vorlage?.phase ?? 'Ausbau';
}

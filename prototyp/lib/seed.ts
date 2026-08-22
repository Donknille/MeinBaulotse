/*
 * Das Demoprojekt.
 *
 * Die Termine sind nicht fest eingetragen, sondern werden beim ersten Öffnen
 * aus dem heutigen Tag gerechnet. Sonst wäre der Prototyp nach zwei Wochen ein
 * Projekt, dessen Bauabnahme in der Vergangenheit liegt — und die ganze
 * Aussage („hier stehen Sie gerade") wäre dahin.
 *
 * Der heutige Tag fällt dadurch immer mitten in die Sanitär-Rohinstallation:
 * neun Gewerke sind fertig, eines läuft und ist zu spät dran, eines wartet
 * darauf, der Rest ist geplant.
 */

import {
  alsTagUndMonat,
  arbeitstageZwischen,
  heute as heuteJetzt,
  minusArbeitstage,
  naechsterArbeitstag,
  plusArbeitstage,
  plusKalendertage,
  kalendertageZwischen,
  type IsoDatum,
} from './datum';
import { berechneBasisplan, berechneNeuenPlan, planEnde } from './planung';
import { GEWERKVORLAGEN, gewerkId } from './stammdaten';
import type { Betriebsmodus, Ereignis, Gewerk, Projektdaten } from './types';

/** Arbeitstage, um die die Sanitär-Rohinstallation später dran ist. */
const VERZOEGERUNG_ARBEITSTAGE = 8;

/** So viele Arbeitstage läuft das verzögerte Gewerk am heutigen Tag schon. */
const HEUTE_INNERHALB_GEWERK_10 = 5;

const VERZOEGERTES_GEWERK = gewerkId(10);

function rohplan(baubeginn: IsoDatum): Gewerk[] {
  return GEWERKVORLAGEN.map((vorlage) => {
    const start = naechsterArbeitstag(baubeginn);
    const gewerk: Gewerk = {
      id: gewerkId(vorlage.nummer),
      nummer: vorlage.nummer,
      name: vorlage.name,
      beschreibung: vorlage.beschreibung,
      start,
      ende: plusArbeitstage(start, vorlage.dauer - 1),
      status: 'geplant',
      herkunft: 'geplant',
      vorgaenger: vorlage.vorgaenger.map(gewerkId),
      fortschrittProzent: 0,
    };
    if (vorlage.betrieb) gewerk.betrieb = vorlage.betrieb;
    if (vorlage.ansprechpartner) gewerk.ansprechpartner = vorlage.ansprechpartner;
    if (vorlage.telefon) gewerk.telefon = vorlage.telefon;
    if (vorlage.wartezeitTage) gewerk.wartezeitTage = vorlage.wartezeitTage;
    if (vorlage.wartezeitGrund) gewerk.wartezeitGrund = vorlage.wartezeitGrund;
    return gewerk;
  });
}

/**
 * Sucht den Baubeginn, bei dem der heutige Tag mitten in Gewerk 10 liegt.
 * Ein paar Durchläufe genügen: jede Korrektur verschiebt den ganzen Plan, das
 * Ergebnis wandert dabei nur noch um Wochenenden.
 */
function findeBaubeginn(heute: IsoDatum): IsoDatum {
  const zielstart = minusArbeitstage(heute, HEUTE_INNERHALB_GEWERK_10);
  let baubeginn = naechsterArbeitstag(plusKalendertage(heute, -120));

  for (let versuch = 0; versuch < 8; versuch += 1) {
    const basis = berechneBasisplan(rohplan(baubeginn), baubeginn);
    const gewerk10 = basis.find((g) => g.id === VERZOEGERTES_GEWERK) as Gewerk;
    const tatsaechlicherStart = plusArbeitstage(gewerk10.start, VERZOEGERUNG_ARBEITSTAGE);
    const abweichung = kalendertageZwischen(tatsaechlicherStart, zielstart);
    if (abweichung === 0) break;
    baubeginn = naechsterArbeitstag(plusKalendertage(baubeginn, abweichung));
  }

  return baubeginn;
}

function zeitpunkt(datum: IsoDatum, uhrzeit = '07:30'): string {
  return `${datum}T${uhrzeit}:00`;
}

/**
 * Baut das vollständige Demoprojekt für einen Betriebsmodus.
 * Gleicher Tag, gleicher Modus — gleiches Ergebnis.
 */
export function erzeugeProjektdaten(
  modus: Betriebsmodus,
  heute: IsoDatum = heuteJetzt(),
): Projektdaten {
  const baubeginn = findeBaubeginn(heute);
  const basisplan = berechneBasisplan(rohplan(baubeginn), baubeginn);
  const zielFertigstellung = planEnde(basisplan);

  const gewerk10Basis = basisplan.find((g) => g.id === VERZOEGERTES_GEWERK) as Gewerk;
  const verspaeteterStart = plusArbeitstage(gewerk10Basis.start, VERZOEGERUNG_ARBEITSTAGE);
  const verzoegert = berechneNeuenPlan(basisplan, VERZOEGERTES_GEWERK, verspaeteterStart).gewerke;

  const gewerke = aussenanlagenAnsEnde(verzoegert).map((gewerk) => zustandSetzen(gewerk, heute));

  const projekt = {
    id: `demo-${modus}`,
    name: 'Einfamilienhaus Musterweg 12',
    bauherr: 'Familie Brandt',
    modus,
    baubeginn,
    zielFertigstellung,
    ...(modus === 'begleitet' ? { gu: 'Bauunternehmung Radke GmbH' } : {}),
  };

  return {
    projekt,
    gewerke,
    entscheidungen: entscheidungen(heute),
    fotos: fotos(gewerke),
    ereignisse: ereignisse(gewerke, modus, heute),
  };
}


/**
 * Die Außenanlagen haben als einzigen Vorgänger den Gerüstbau. Rein rechnerisch
 * könnten sie deshalb direkt nach dem Rohbau beginnen — gebaut wird der Garten
 * aber zuletzt, wenn keine Betonmischer mehr über das Grundstück fahren.
 *
 * Sie sind das einzige Gewerk mit echtem Spielraum: Nachfolger hat es keine.
 * Deshalb wird es hier bewusst ans Ende gelegt, statt so früh wie möglich.
 */
function aussenanlagenAnsEnde(gewerke: Gewerk[]): Gewerk[] {
  const aussen = gewerke.find((g) => g.nummer === 22);
  const abnahme = gewerke.find((g) => g.nummer === 23);
  if (!aussen || !abnahme) return gewerke;

  const dauer = arbeitstageZwischen(aussen.start, aussen.ende);
  const start = minusArbeitstage(abnahme.start, dauer);
  return berechneNeuenPlan(gewerke, aussen.id, start).gewerke;
}

/**
 * Setzt Status, Herkunft und Fortschritt. Gewerk 1 bis 9 sind fertig, 10 ist
 * später dran als geplant, 11 wartet darauf, alles Weitere ist geplant.
 */
function zustandSetzen(gewerk: Gewerk, heute: IsoDatum): Gewerk {
  if (gewerk.nummer <= 9) {
    // Gemischte Herkunft: nicht jede Fertigmeldung kam vom Betrieb selbst.
    const herkunft =
      gewerk.nummer % 3 === 0
        ? 'bauherr_eingetragen'
        : gewerk.nummer % 3 === 1
          ? 'gewerk_bestaetigt'
          : 'gu_gemeldet';
    return {
      ...gewerk,
      status: 'fertig',
      fortschrittProzent: 100,
      herkunft,
      letzteMeldung: zeitpunkt(gewerk.ende, '16:20'),
      ...(herkunft === 'bauherr_eingetragen'
        ? { herkunftNotiz: `Telefonat am ${alsTagUndMonat(gewerk.ende)}, Fertigmeldung notiert` }
        : {}),
    };
  }

  if (gewerk.id === VERZOEGERTES_GEWERK) {
    const meldung = minusArbeitstage(heute, 4);
    return {
      ...gewerk,
      status: 'verzoegert',
      fortschrittProzent: 35,
      herkunft: 'bauherr_eingetragen',
      herkunftNotiz: `Telefonat ${alsTagUndMonat(meldung)}: Materiallieferung verspätet`,
      letzteMeldung: zeitpunkt(meldung, '09:10'),
    };
  }

  if (gewerk.nummer === 11) {
    return { ...gewerk, status: 'blockiert', herkunft: 'geplant', fortschrittProzent: 0 };
  }

  return { ...gewerk, status: 'geplant', herkunft: 'geplant', fortschrittProzent: 0 };
}

function entscheidungen(heute: IsoDatum) {
  return [
    {
      id: 'ent-steckdosen',
      titel: 'Elektro: Steckdosenplan freigeben',
      beschreibung:
        'Der Elektriker braucht die Freigabe, wo Schalter, Steckdosen und Netzwerkdosen sitzen sollen. Danach ist es nur noch mit Stemmarbeit zu ändern.',
      fristBis: plusKalendertage(heute, 4),
      betrifftGewerkId: gewerkId(19),
      erledigt: false,
      auswirkung:
        'Ohne Freigabe kann die Elektro-Endmontage nicht beginnen. Jeder Tag Verzug schiebt auch Malerarbeiten und Bodenbeläge.',
    },
    {
      id: 'ent-fliesen',
      titel: 'Fliesen bemustern',
      beschreibung:
        'Im Ausstellungsraum werden Format, Farbe und Verlegeart für Bäder und Gäste-WC ausgesucht. Rechnen Sie mit zwei Stunden.',
      fristBis: plusKalendertage(heute, 12),
      betrifftGewerkId: gewerkId(15),
      erledigt: false,
      auswirkung:
        'Ohne Auswahl kann der Fliesenleger nicht starten. Sonderformate haben zusätzlich sechs Wochen Lieferzeit.',
    },
    {
      id: 'ent-haustuer',
      titel: 'Haustür: Farbe und Beschlag festlegen',
      beschreibung: 'Farbton außen, Farbton innen, Griff und Schließsystem.',
      fristBis: minusArbeitstage(heute, 30),
      betrifftGewerkId: gewerkId(8),
      erledigt: true,
      erledigtAm: minusArbeitstage(heute, 34),
      auswirkung: 'War Voraussetzung für die Bestellung der Außentüren.',
    },
    {
      id: 'ent-dachziegel',
      titel: 'Dachziegel auswählen',
      beschreibung: 'Modell und Farbe des Ziegels, abgestimmt mit der Bauvorschrift der Gemeinde.',
      fristBis: minusArbeitstage(heute, 55),
      betrifftGewerkId: gewerkId(7),
      erledigt: true,
      erledigtAm: minusArbeitstage(heute, 58),
      auswirkung: 'War Voraussetzung für die Bestellung beim Dachdecker.',
    },
  ];
}

interface Fotovorlage {
  nummer: number;
  titel: string;
  notiz?: string;
  datei: string;
  erfasstVon: 'gu' | 'bauherr' | 'gewerk';
  herkunft: 'gewerk_bestaetigt' | 'bauherr_eingetragen' | 'gu_gemeldet';
  /** Arbeitstage nach dem Start des Gewerks. */
  versatz: number;
}

const FOTOVORLAGEN: Fotovorlage[] = [
  {
    nummer: 2,
    titel: 'Baugrube ausgehoben',
    notiz: 'Aushub steht auf dem Nachbargrundstück, Abfuhr am Freitag.',
    datei: '/fotos/baugrube.svg',
    erfasstVon: 'bauherr',
    herkunft: 'bauherr_eingetragen',
    versatz: 3,
  },
  {
    nummer: 3,
    titel: 'Bewehrung der Bodenplatte',
    notiz: 'Vor dem Betonieren aufgenommen, für die Bauakte.',
    datei: '/fotos/bodenplatte.svg',
    erfasstVon: 'bauherr',
    herkunft: 'bauherr_eingetragen',
    versatz: 5,
  },
  {
    nummer: 4,
    titel: 'Erdgeschoss steht',
    datei: '/fotos/mauerwerk.svg',
    erfasstVon: 'gewerk',
    herkunft: 'gewerk_bestaetigt',
    versatz: 12,
  },
  {
    nummer: 6,
    titel: 'Richtfest',
    notiz: 'Dachstuhl aufgesetzt.',
    datei: '/fotos/dachstuhl.svg',
    erfasstVon: 'gu',
    herkunft: 'gu_gemeldet',
    versatz: 7,
  },
  {
    nummer: 7,
    titel: 'Dach eingedeckt',
    datei: '/fotos/dach.svg',
    erfasstVon: 'gewerk',
    herkunft: 'gewerk_bestaetigt',
    versatz: 9,
  },
  {
    nummer: 8,
    titel: 'Fenster eingebaut',
    notiz: 'Haus ist geschlossen, Bautrockner können raus.',
    datei: '/fotos/fenster.svg',
    erfasstVon: 'bauherr',
    herkunft: 'bauherr_eingetragen',
    versatz: 4,
  },
  {
    nummer: 9,
    titel: 'Leitungen im Erdgeschoss',
    notiz: 'Für später, falls jemand in die Wand bohren will.',
    datei: '/fotos/elektro.svg',
    erfasstVon: 'bauherr',
    herkunft: 'bauherr_eingetragen',
    versatz: 6,
  },
  {
    nummer: 10,
    titel: 'Verteiler Heizung',
    notiz: 'Stand bei meinem Besuch auf der Baustelle.',
    datei: '/fotos/heizung.svg',
    erfasstVon: 'bauherr',
    herkunft: 'bauherr_eingetragen',
    versatz: 2,
  },
];

function fotos(gewerke: Gewerk[]) {
  return FOTOVORLAGEN.map((vorlage, index) => {
    const gewerk = gewerke.find((g) => g.nummer === vorlage.nummer) as Gewerk;
    return {
      id: `foto-${String(index + 1).padStart(2, '0')}`,
      gewerkId: gewerk.id,
      datum: plusArbeitstage(gewerk.start, vorlage.versatz),
      titel: vorlage.titel,
      ...(vorlage.notiz ? { notiz: vorlage.notiz } : {}),
      bildUrl: vorlage.datei,
      erfasstVon: vorlage.erfasstVon,
      herkunft: vorlage.herkunft,
    };
  }).sort((a, b) => b.datum.localeCompare(a.datum));
}

function ereignisse(gewerke: Gewerk[], modus: Betriebsmodus, heute: IsoDatum): Ereignis[] {
  const nach = (nummer: number) => gewerke.find((g) => g.nummer === nummer) as Gewerk;
  const planer = modus === 'begleitet' ? 'gu' : 'bauherr';
  const eintraege: Array<Omit<Ereignis, 'id'>> = [
    {
      zeitpunkt: zeitpunkt(nach(1).start, '08:00'),
      akteur: planer,
      text: 'Bauzeitenplan angelegt, 23 Gewerke aus der Ablaufvorlage übernommen',
    },
    {
      zeitpunkt: zeitpunkt(nach(1).ende, '16:40'),
      akteur: 'gewerk',
      text: 'Vermessung und Baugrundgutachten als fertig gemeldet',
      gewerkId: nach(1).id,
    },
    {
      zeitpunkt: zeitpunkt(nach(2).ende, '17:05'),
      akteur: 'gu',
      text: 'Erdarbeiten und Baugrube als fertig gemeldet',
      gewerkId: nach(2).id,
    },
    {
      zeitpunkt: zeitpunkt(nach(3).ende, '15:30'),
      akteur: 'bauherr',
      text: 'Bodenplatte als fertig eingetragen, Quelle: Telefonat mit Herrn Radke',
      gewerkId: nach(3).id,
    },
    {
      zeitpunkt: zeitpunkt(plusKalendertage(nach(3).ende, 1), '09:00'),
      akteur: planer,
      text: 'Wartezeit Betonaushärtung, 14 Kalendertage, in den Plan aufgenommen',
      gewerkId: nach(3).id,
    },
    {
      zeitpunkt: zeitpunkt(nach(4).start, '07:15'),
      akteur: 'gewerk',
      text: 'Rohbau Mauerwerk und Decken begonnen',
      gewerkId: nach(4).id,
    },
    {
      zeitpunkt: zeitpunkt(nach(4).ende, '16:00'),
      akteur: 'bauherr',
      text: 'Rohbau Mauerwerk und Decken als fertig eingetragen',
      gewerkId: nach(4).id,
    },
    {
      zeitpunkt: zeitpunkt(nach(6).start, '11:00'),
      akteur: 'gewerk',
      text: 'Zimmerer hat den Termin bestätigt',
      gewerkId: nach(6).id,
    },
    {
      zeitpunkt: zeitpunkt(nach(6).ende, '18:00'),
      akteur: 'gu',
      text: 'Dachstuhl steht, Richtfest',
      gewerkId: nach(6).id,
    },
    {
      zeitpunkt: zeitpunkt(nach(7).ende, '16:10'),
      akteur: 'gewerk',
      text: 'Dachdecker und Klempner als fertig gemeldet',
      gewerkId: nach(7).id,
    },
    {
      zeitpunkt: zeitpunkt(nach(8).ende, '14:25'),
      akteur: 'bauherr',
      text: 'Fenster und Außentüren als fertig eingetragen, Haus ist geschlossen',
      gewerkId: nach(8).id,
    },
    {
      zeitpunkt: zeitpunkt(nach(9).ende, '15:45'),
      akteur: 'gewerk',
      text: 'Elektro Rohinstallation als fertig gemeldet',
      gewerkId: nach(9).id,
    },
    {
      zeitpunkt: zeitpunkt(minusArbeitstage(heute, 9), '10:20'),
      akteur: 'bauherr',
      text: 'Sanitär und Heizung Rohinstallation: Start um 8 Arbeitstage nach hinten eingetragen',
      gewerkId: nach(10).id,
    },
    {
      zeitpunkt: zeitpunkt(minusArbeitstage(heute, 9), '10:22'),
      akteur: 'bauherr',
      text: '11 nachgelagerte Gewerke mitverschoben, Fertigstellung entsprechend später',
    },
    {
      zeitpunkt: zeitpunkt(minusArbeitstage(heute, 9), '10:25'),
      akteur: 'bauherr',
      text: 'Lüftungsanlage wartet auf die Vorleistung und ist als blockiert vermerkt',
      gewerkId: nach(11).id,
    },
    {
      zeitpunkt: zeitpunkt(minusArbeitstage(heute, 4), '09:10'),
      akteur: 'bauherr',
      text: 'Telefonat mit Herrn Meier: Materiallieferung verspätet, Fortschritt bei 35 Prozent',
      gewerkId: nach(10).id,
    },
  ];

  return eintraege
    .map((eintrag, index) => ({ id: `ev-${String(index + 1).padStart(2, '0')}`, ...eintrag }))
    .sort((a, b) => b.zeitpunkt.localeCompare(a.zeitpunkt));
}

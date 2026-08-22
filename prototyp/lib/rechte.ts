/*
 * Wer darf was.
 *
 * Die Rechte stehen hier als Tabelle und nicht als verstreute Bedingungen in
 * den Komponenten. Wer eine Zeile ändert, ändert das Verhalten überall — und
 * kann nachlesen, was gilt, ohne den halben Quelltext zu durchsuchen.
 *
 * Zweiter Grundsatz: Eine Handlung, die nicht erlaubt ist, verschwindet nicht.
 * Sie wird deaktiviert und erklärt sich. Ausgeblendete Funktionen verwirren,
 * erklärte Grenzen schaffen Verständnis.
 */

import type { Betriebsmodus, Gewerk, Projektdaten, Rolle } from './types';

export type Recht =
  | 'plan_verschieben'
  | 'status_melden'
  | 'status_stellvertretend_melden'
  | 'entscheidung_treffen'
  | 'foto_hochladen'
  | 'gewerk_bearbeiten'
  | 'alle_gewerke_sehen';

/**
 * Die vier Akteure der Rechtematrix. Der Bauherr steht zweimal darin, weil
 * seine Rechte davon abhängen, ob er den Plan führt oder ihn nur einsieht.
 */
export type Akteur = 'gu' | 'bauherr_begleitet' | 'bauherr_fuehrend' | 'gewerk';

type Erlaubnis = 'ja' | 'nein' | 'nur_eigenes';

export function akteurAus(rolle: Rolle, modus: Betriebsmodus | null): Akteur {
  if (rolle === 'gu') return 'gu';
  if (rolle === 'gewerk') return 'gewerk';
  return modus === 'begleitet' ? 'bauherr_begleitet' : 'bauherr_fuehrend';
}

const MATRIX: Record<Recht, Record<Akteur, Erlaubnis>> = {
  plan_verschieben: {
    gu: 'ja',
    bauherr_begleitet: 'nein',
    bauherr_fuehrend: 'ja',
    gewerk: 'nein',
  },
  status_melden: {
    gu: 'ja',
    bauherr_begleitet: 'nein',
    bauherr_fuehrend: 'ja',
    gewerk: 'nur_eigenes',
  },
  status_stellvertretend_melden: {
    gu: 'ja',
    bauherr_begleitet: 'nein',
    bauherr_fuehrend: 'ja',
    gewerk: 'nein',
  },
  entscheidung_treffen: {
    gu: 'nein',
    bauherr_begleitet: 'ja',
    bauherr_fuehrend: 'ja',
    gewerk: 'nein',
  },
  foto_hochladen: {
    gu: 'ja',
    bauherr_begleitet: 'ja',
    bauherr_fuehrend: 'ja',
    gewerk: 'nur_eigenes',
  },
  gewerk_bearbeiten: {
    gu: 'ja',
    bauherr_begleitet: 'nein',
    bauherr_fuehrend: 'ja',
    gewerk: 'nein',
  },
  alle_gewerke_sehen: {
    gu: 'ja',
    bauherr_begleitet: 'ja',
    bauherr_fuehrend: 'ja',
    gewerk: 'nur_eigenes',
  },
};

/**
 * Was an der Stelle einer deaktivierten Schaltfläche steht. Der Satz nennt den
 * Grund und wo die Zuständigkeit liegt — nie nur „nicht erlaubt".
 */
const ERKLAERUNG: Partial<Record<Recht, Partial<Record<Akteur, string>>>> = {
  plan_verschieben: {
    bauherr_begleitet: 'Der Bauzeitenplan wird von Ihrem Generalunternehmer geführt.',
    gewerk: 'Den Bauzeitenplan führt der Bauherr. Melden Sie Ihren Termin, er trägt ihn ein.',
  },
  status_melden: {
    bauherr_begleitet: 'Den Baufortschritt meldet Ihr Generalunternehmer.',
    gewerk: 'Sie können nur für Ihr eigenes Gewerk melden.',
  },
  status_stellvertretend_melden: {
    bauherr_begleitet:
      'Solange ein Generalunternehmer den Plan führt, kommen die Meldungen von ihm.',
    gewerk: 'Stellvertretend eintragen kann nur, wer den Plan führt.',
  },
  entscheidung_treffen: {
    gu: 'Diese Entscheidung trifft der Bauherr.',
    gewerk: 'Diese Entscheidung trifft der Bauherr.',
  },
  foto_hochladen: {
    gewerk: 'Sie können nur Fotos zu Ihrem eigenen Gewerk hinzufügen.',
  },
  gewerk_bearbeiten: {
    bauherr_begleitet: 'Die Angaben zu den Betrieben pflegt Ihr Generalunternehmer.',
    gewerk: 'Die Angaben zu den Betrieben pflegt, wer den Plan führt.',
  },
  alle_gewerke_sehen: {
    gewerk: 'Sie sehen Ihr eigenes Gewerk sowie das davor und das danach.',
  },
};

export interface Rechtekontext {
  rolle: Rolle;
  modus: Betriebsmodus | null;
  /** Das Gewerk, um das es geht. Entscheidet bei „nur eigenes". */
  zielGewerkId?: string | null;
  /** Das Gewerk der Rolle „Gewerk". */
  eigenesGewerkId?: string | null;
}

export interface Pruefung {
  erlaubt: boolean;
  /** Warum nicht. Leer, wenn erlaubt. */
  erklaerung: string;
}

const ERLAUBT: Pruefung = { erlaubt: true, erklaerung: '' };

export function darf(recht: Recht, kontext: Rechtekontext): Pruefung {
  const akteur = akteurAus(kontext.rolle, kontext.modus);
  const eintrag = MATRIX[recht][akteur];

  if (eintrag === 'ja') return ERLAUBT;

  if (eintrag === 'nur_eigenes') {
    const eigenes = kontext.eigenesGewerkId ?? null;
    const ziel = kontext.zielGewerkId ?? null;
    if (eigenes !== null && ziel !== null && eigenes === ziel) return ERLAUBT;
    // Ohne konkretes Ziel ist die Frage „grundsätzlich?" — und die Antwort ja.
    if (ziel === null) return ERLAUBT;
  }

  return {
    erlaubt: false,
    erklaerung: ERKLAERUNG[recht]?.[akteur] ?? 'Diese Handlung ist Ihrer Rolle nicht zugeordnet.',
  };
}

/** Kurzform, wenn nur das Ja oder Nein gebraucht wird. */
export function darfEinfach(recht: Recht, kontext: Rechtekontext): boolean {
  return darf(recht, kontext).erlaubt;
}

/**
 * Welche Gewerke jemand sehen darf. Ein Handwerker sieht sein eigenes sowie
 * das, was er vorfindet, und das, was auf ihn wartet — mehr geht ihn nichts an,
 * und weniger würde ihm die einzige Auskunft nehmen, für die er die Seite
 * überhaupt öffnet.
 */
export function sichtbareGewerke(
  daten: Projektdaten,
  kontext: Rechtekontext,
): Gewerk[] {
  if (darfEinfach('alle_gewerke_sehen', { ...kontext, zielGewerkId: null })) {
    if (akteurAus(kontext.rolle, kontext.modus) !== 'gewerk') return daten.gewerke;
  }

  const eigenes = daten.gewerke.find((g) => g.id === kontext.eigenesGewerkId);
  if (!eigenes) return [];

  const erlaubteIds = new Set<string>([eigenes.id, ...eigenes.vorgaenger]);
  for (const gewerk of daten.gewerke) {
    if (gewerk.vorgaenger.includes(eigenes.id)) erlaubteIds.add(gewerk.id);
  }

  return daten.gewerke.filter((g) => erlaubteIds.has(g.id));
}

/** Klartextname einer Rolle, für den Rollenumschalter und Protokolleinträge. */
export const ROLLENNAME: Record<Rolle, string> = {
  gu: 'Bauleiter',
  bauherr: 'Bauherr',
  gewerk: 'Betrieb',
};

export const MODUSNAME: Record<Betriebsmodus, string> = {
  begleitet: 'Generalunternehmer baut',
  selbst: 'Ich koordiniere selbst',
  stellvertretend: 'Ich koordiniere und trage selbst ein',
};

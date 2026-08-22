/*
 * Rechnen und Schreiben mit Bauterminen.
 *
 * Zwei Zeitrechnungen laufen im Bauablauf nebeneinander und dürfen nie
 * vermischt werden:
 *
 * - **Arbeitsvorgänge** zählen in Arbeitstagen. Am Wochenende arbeitet
 *   niemand. (Feiertage bleiben im MVP bewusst außen vor.)
 * - **Wartezeiten** zählen in Kalendertagen. Estrich trocknet auch sonntags.
 *
 * Ausgetauscht wird durchgehend `YYYY-MM-DD`. `Date`-Objekte entstehen nur
 * innerhalb dieser Datei und verlassen sie nicht — damit ist die Zeitzone
 * konstruktiv kein Thema mehr.
 */

import { addDays, differenceInCalendarDays, format, getISOWeek, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';

/** Ein Datum ohne Uhrzeit, `YYYY-MM-DD`. */
export type IsoDatum = string;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function zuDatum(iso: IsoDatum): Date {
  if (!ISO.test(iso)) {
    throw new Error(`Kein Datum im Format YYYY-MM-DD: ${iso}`);
  }
  return parseISO(iso);
}

function zuIso(datum: Date): IsoDatum {
  return format(datum, 'yyyy-MM-dd');
}

/** Der heutige Tag als ISO-Datum, in der Zeitzone des Geräts. */
export function heute(): IsoDatum {
  return zuIso(new Date());
}

// --- Arbeitstage --------------------------------------------------------

/** Montag bis Freitag. Feiertage werden im MVP nicht berücksichtigt. */
export function istArbeitstag(iso: IsoDatum): boolean {
  const tag = zuDatum(iso).getDay();
  return tag !== 0 && tag !== 6;
}

/** Gibt `iso` zurück, wenn es ein Arbeitstag ist, sonst den nächsten. */
export function naechsterArbeitstag(iso: IsoDatum): IsoDatum {
  let datum = zuDatum(iso);
  while (datum.getDay() === 0 || datum.getDay() === 6) {
    datum = addDays(datum, 1);
  }
  return zuIso(datum);
}

/** Der erste Arbeitstag **nach** `iso`. `iso` selbst zählt nicht mit. */
export function naechsterArbeitstagNach(iso: IsoDatum): IsoDatum {
  return naechsterArbeitstag(zuIso(addDays(zuDatum(iso), 1)));
}

/** Der letzte Arbeitstag **vor** `iso`. */
export function vorherigerArbeitstag(iso: IsoDatum): IsoDatum {
  let datum = addDays(zuDatum(iso), -1);
  while (datum.getDay() === 0 || datum.getDay() === 6) {
    datum = addDays(datum, -1);
  }
  return zuIso(datum);
}

/** Verschiebt um `anzahl` Arbeitstage zurück. */
export function minusArbeitstage(iso: IsoDatum, anzahl: number): IsoDatum {
  let ergebnis = naechsterArbeitstag(iso);
  for (let i = 0; i < anzahl; i += 1) {
    ergebnis = vorherigerArbeitstag(ergebnis);
  }
  return ergebnis;
}

/**
 * Verschiebt um `anzahl` Arbeitstage. `anzahl === 0` liefert den Starttag
 * selbst, auf den nächsten Arbeitstag gerückt.
 */
export function plusArbeitstage(iso: IsoDatum, anzahl: number): IsoDatum {
  let ergebnis = naechsterArbeitstag(iso);
  for (let i = 0; i < anzahl; i += 1) {
    ergebnis = naechsterArbeitstagNach(ergebnis);
  }
  return ergebnis;
}

/**
 * Das Ende eines Vorgangs, der an `start` beginnt und `dauer` Arbeitstage
 * dauert. Der Starttag zählt als erster Arbeitstag mit: Dauer 1 endet am
 * Starttag.
 */
export function endeNachDauer(start: IsoDatum, dauer: number): IsoDatum {
  return plusArbeitstage(start, Math.max(1, Math.round(dauer)) - 1);
}

/** Anzahl der Arbeitstage von `start` bis `ende`, beide Tage eingeschlossen. */
export function arbeitstageZwischen(start: IsoDatum, ende: IsoDatum): number {
  const bis = zuDatum(ende);
  let datum = zuDatum(start);
  let anzahl = 0;
  while (differenceInCalendarDays(bis, datum) >= 0) {
    if (datum.getDay() !== 0 && datum.getDay() !== 6) anzahl += 1;
    datum = addDays(datum, 1);
  }
  return Math.max(1, anzahl);
}

// --- Kalendertage --------------------------------------------------------

export function plusKalendertage(iso: IsoDatum, anzahl: number): IsoDatum {
  return zuIso(addDays(zuDatum(iso), anzahl));
}

/** Kalendertage von `a` nach `b`. Positiv, wenn `b` später liegt. */
export function kalendertageZwischen(a: IsoDatum, b: IsoDatum): number {
  return differenceInCalendarDays(zuDatum(b), zuDatum(a));
}

export function istVor(a: IsoDatum, b: IsoDatum): boolean {
  return a < b;
}

export function frueheres(a: IsoDatum, b: IsoDatum): IsoDatum {
  return a < b ? a : b;
}

export function spaeteres(a: IsoDatum, b: IsoDatum): IsoDatum {
  return a > b ? a : b;
}

// --- Schreibweise ---------------------------------------------------------

/** `12.05.2026` */
export function alsDatum(iso: IsoDatum): string {
  return format(zuDatum(iso), 'dd.MM.yyyy', { locale: de });
}

/** `12.05.` — für Angaben innerhalb des laufenden Jahres. */
export function alsTagUndMonat(iso: IsoDatum): string {
  return format(zuDatum(iso), 'dd.MM.', { locale: de });
}

/** `Di, 12.05.2026` */
export function alsDatumMitWochentag(iso: IsoDatum): string {
  return format(zuDatum(iso), 'EEEEEE, dd.MM.yyyy', { locale: de });
}

/** `Mai 2026` */
export function alsMonat(iso: IsoDatum): string {
  return format(zuDatum(iso), 'LLLL yyyy', { locale: de });
}

/** `KW 20` */
export function alsKalenderwoche(iso: IsoDatum): string {
  return `KW ${getISOWeek(zuDatum(iso))}`;
}

/**
 * `12.05. bis 16.05.` — der Zeitraum eines Vorgangs. Das Jahr steht nur dabei,
 * wenn es nicht das laufende ist.
 */
export function alsZeitraum(start: IsoDatum, ende: IsoDatum, bezugsjahr?: string): string {
  const jahr = (bezugsjahr ?? heute()).slice(0, 4);
  const mitJahr = start.slice(0, 4) !== jahr || ende.slice(0, 4) !== jahr;
  return mitJahr
    ? `${alsDatum(start)} bis ${alsDatum(ende)}`
    : `${alsTagUndMonat(start)} bis ${alsTagUndMonat(ende)}`;
}

/** `5 Arbeitstage` — Einzahl und Mehrzahl, nie abgekürzt. */
export function alsArbeitstage(anzahl: number): string {
  return anzahl === 1 ? '1 Arbeitstag' : `${anzahl} Arbeitstage`;
}

/** `28 Kalendertage` — Wartezeiten werden nie in Arbeitstagen ausgedrückt. */
export function alsKalendertage(anzahl: number): string {
  return anzahl === 1 ? '1 Kalendertag' : `${anzahl} Kalendertage`;
}

/** `8 Tage später` / `3 Tage früher` / `unverändert` */
export function alsVerschiebung(tage: number): string {
  if (tage === 0) return 'unverändert';
  const betrag = Math.abs(tage);
  const wort = betrag === 1 ? 'Tag' : 'Tage';
  return tage > 0 ? `${betrag} ${wort} später` : `${betrag} ${wort} früher`;
}

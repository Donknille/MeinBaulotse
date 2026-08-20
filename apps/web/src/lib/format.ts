/**
 * Datums- und Zahlenformate aus Abschnitt 11.5 des Gestaltungssystems.
 *
 * Werktage und Kalendertage werden nie vermischt und nie abgekürzt. Der
 * Unterschied ist für den Bauherren der Unterschied zwischen fünf und sieben
 * Wochen.
 */

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

function parts(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

/**
 * Tage seit dem 1. Januar 1970, ganzzahlig.
 *
 * Dieselbe Rechnung wie im Berechnungskern, aus demselben Grund: Ein
 * Date-Objekt trägt eine Uhrzeit und eine Zeitzone mit sich herum, und beides
 * hat in einem Terminplan nichts zu suchen. Für die Zeitachse ist ein Tag eine
 * Zahl, nicht ein Zeitpunkt.
 */
export function epochDay(isoDate: string): number {
  const { year, month, day } = parts(isoDate);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export function fromEpochDay(value: number): string {
  const date = new Date(value * 86_400_000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** 1970-01-01 war ein Donnerstag — derselbe Versatz wie im Berechnungskern. */
function weekday(isoDate: string): string {
  return WEEKDAYS[(((epochDay(isoDate) + 3) % 7) + 7) % 7]!;
}

export function isWeekendIso(isoDate: string): boolean {
  const index = ((epochDay(isoDate) + 3) % 7 + 7) % 7;
  return index >= 5;
}

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
] as const;

/** `Mai 26` — der Monat ausgeschrieben, das Jahr zweistellig. */
export function monthLabel(isoDate: string): string {
  const { year, month } = parts(isoDate);
  return `${MONTHS[month - 1]!} ${String(year).slice(2)}`;
}

/** `12.05.` im laufenden Jahr, sonst `12.05.2026`. */
export function formatDate(isoDate: string | null, referenceYear?: number): string {
  if (isoDate === null) return '—';
  const { year, month, day } = parts(isoDate);
  const short = `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.`;
  return referenceYear === year ? short : `${short}${year}`;
}

/** `Di 12.05.` */
export function formatDateWithWeekday(isoDate: string | null, referenceYear?: number): string {
  if (isoDate === null) return '—';
  return `${weekday(isoDate)} ${formatDate(isoDate, referenceYear)}`;
}

/** `12.–21.05.` bei gleichem Monat, sonst beide Daten vollständig. */
export function formatRange(
  start: string | null,
  end: string | null,
  referenceYear?: number,
): string {
  if (start === null && end === null) return 'noch offen';
  if (start === null) return formatDate(end, referenceYear);
  if (end === null) return formatDate(start, referenceYear);
  if (start === end) return formatDate(start, referenceYear);

  const from = parts(start);
  const to = parts(end);
  if (from.year === to.year && from.month === to.month) {
    return `${String(from.day).padStart(2, '0')}.–${formatDate(end, referenceYear)}`;
  }
  return `${formatDate(start, referenceYear)} – ${formatDate(end, referenceYear)}`;
}

/** `8 Werktage` oder `35 Kalendertage`. Nie abgekürzt. */
export function formatDuration(days: number, unit: 'werktage' | 'kalendertage'): string {
  const name = unit === 'kalendertage' ? 'Kalendertag' : 'Werktag';
  return `${days} ${name}${days === 1 ? '' : 'e'}`;
}

export function formatMoney(cents: number | null): string {
  if (cents === null) return '—';
  return `${new Intl.NumberFormat('de-DE').format(Math.round(cents / 100))} €`;
}

/** Wortwahl aus Abschnitt 3.4 der Spezifikation. */
export const CONFIRMATION_LABEL = {
  self_stated: 'Von dir eingetragen',
  counterparty_stated: 'Vom GU genannt',
  mutual: 'Abgestimmt',
  disputed: 'Zwei Angaben',
} as const;

export const STATUS_LABEL = {
  geplant: 'Geplant',
  terminiert: 'Terminiert',
  bestaetigt: 'Bestätigt',
  laeuft: 'Läuft',
  fertig: 'Fertig',
  abgenommen: 'Abgenommen',
  verschoben: 'Verschoben',
  entfallen: 'Entfallen',
} as const;

export const FEDERAL_STATE_LABEL: Record<string, string> = {
  BW: 'Baden-Württemberg',
  BY: 'Bayern',
  BE: 'Berlin',
  BB: 'Brandenburg',
  HB: 'Bremen',
  HH: 'Hamburg',
  HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen',
  NW: 'Nordrhein-Westfalen',
  RP: 'Rheinland-Pfalz',
  SL: 'Saarland',
  SN: 'Sachsen',
  ST: 'Sachsen-Anhalt',
  SH: 'Schleswig-Holstein',
  TH: 'Thüringen',
};

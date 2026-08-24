/**
 * Der Zeitraum der Bauakte.
 *
 * Eine Zeile Rechnung, und trotzdem eine eigene Datei mit eigener Gegenprobe.
 * Der Grund ist der 31.: „drei Monate vor dem 31. Mai" ergibt naiv den
 * 31. Februar. Ein `<input type="date">` nimmt den nicht an, und die API
 * beantwortet ihn mit einem Datenbankfehler — an einem einzigen Tag im Monat,
 * an dem es niemand nachstellt, der es nicht gerade sucht.
 *
 * Deshalb wird der Tag auf das Monatsende geklemmt: Aus dem 31. Mai wird der
 * 28. Februar, im Schaltjahr der 29.
 */

function tageImMonat(jahr: number, monat: number): number {
  // Der nullte Tag des Folgemonats ist der letzte des gesuchten. UTC, damit
  // keine Zeitzone den Monat kippt.
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

/** `2026-05-31` minus drei Monate → `2026-02-28`. */
export function monateZurueck(isoDate: string, monate: number): string {
  const [jahr, monat, tag] = isoDate.split('-').map(Number);
  if (jahr === undefined || monat === undefined || tag === undefined) return isoDate;

  const gesamt = jahr * 12 + (monat - 1) - monate;
  const zielJahr = Math.floor(gesamt / 12);
  const zielMonat = (gesamt % 12) + 1;
  const zielTag = Math.min(tag, tageImMonat(zielJahr, zielMonat));

  return `${String(zielJahr).padStart(4, '0')}-${String(zielMonat).padStart(2, '0')}-${String(zielTag).padStart(2, '0')}`;
}

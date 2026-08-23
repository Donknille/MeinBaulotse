/**
 * Was ein Foto über sich selbst verrät.
 *
 * Zwei Angaben entstehen im Browser, bevor die Datei irgendwohin geht:
 *
 * - **Die Prüfsumme des Originals.** Sie belegt später, dass das Bild in der
 *   Akte dasselbe ist wie das aus der Kamera, und sie verhindert nebenbei,
 *   dass dieselbe Aufnahme zweimal in der Akte landet.
 * - **Die Aufnahmezeit aus den EXIF-Daten.** Sie ist der Grund, warum die
 *   Abnahme von AP 5 im Flugmodus funktioniert: Der Zeitpunkt steht in der
 *   Datei, nicht im Moment des Hochladens. Drei Fotos, die drei Tage später
 *   ankommen, tragen trotzdem ihren richtigen Tag.
 *
 * Der EXIF-Leser ist bewusst klein: Er sucht genau drei Angaben und ist
 * ansonsten sprachlos. Eine vollständige Bibliothek wäre hundertmal so groß
 * und läse Dinge, die niemand braucht.
 */

/** Prüfsumme des Originals, hexadezimal. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface PhotoMetadata {
  /** Aufnahmezeit laut Kamera, als ISO-Zeitpunkt. */
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
}

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_DATETIME_DIGITIZED = 0x9004;
const TAG_DATETIME = 0x0132;

/**
 * Liest Aufnahmezeit und Ort aus einer JPEG-Datei.
 *
 * Gibt überall `null` zurück, wo nichts steht — ein Foto ohne EXIF ist keine
 * Ausnahme, sondern der Normalfall bei Bildschirmfotos und bei allem, was
 * schon einmal durch einen Messenger gelaufen ist.
 */
export function readPhotoMetadata(buffer: ArrayBuffer): PhotoMetadata {
  const leer: PhotoMetadata = { takenAt: null, lat: null, lon: null };
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return leer; // kein JPEG

  // Die APP1-Marke mit dem EXIF-Block suchen.
  let offset = 2;
  let exifStart = -1;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1 && offset + 10 <= view.byteLength) {
      const kennung = String.fromCharCode(
        view.getUint8(offset + 4),
        view.getUint8(offset + 5),
        view.getUint8(offset + 6),
        view.getUint8(offset + 7),
      );
      if (kennung === 'Exif') {
        exifStart = offset + 10;
        break;
      }
    }
    if (marker === 0xda) break; // ab hier kommen Bilddaten
    offset += 2 + size;
  }
  if (exifStart === -1 || exifStart + 8 > view.byteLength) return leer;

  // TIFF-Kopf: Bytereihenfolge und Zeiger auf die erste Verzeichnisseite.
  const byteOrder = view.getUint16(exifStart);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return leer;
  const little = byteOrder === 0x4949;
  if (view.getUint16(exifStart + 2, little) !== 42) return leer;

  const ifd0 = exifStart + view.getUint32(exifStart + 4, little);

  interface Eintrag {
    tag: number;
    type: number;
    count: number;
    valueOffset: number;
  }

  const leseIfd = (start: number): Eintrag[] => {
    if (start + 2 > view.byteLength) return [];
    const anzahl = view.getUint16(start, little);
    const eintraege: Eintrag[] = [];
    for (let i = 0; i < anzahl; i += 1) {
      const pos = start + 2 + i * 12;
      if (pos + 12 > view.byteLength) break;
      eintraege.push({
        tag: view.getUint16(pos, little),
        type: view.getUint16(pos + 2, little),
        count: view.getUint32(pos + 4, little),
        valueOffset: pos + 8,
      });
    }
    return eintraege;
  };

  const leseText = (eintrag: Eintrag): string | null => {
    // Bis vier Zeichen stehen direkt im Eintrag, sonst folgt ein Zeiger.
    const laenge = eintrag.count;
    const start =
      laenge <= 4 ? eintrag.valueOffset : exifStart + view.getUint32(eintrag.valueOffset, little);
    if (start + laenge > view.byteLength) return null;
    let text = '';
    for (let i = 0; i < laenge; i += 1) {
      const zeichen = view.getUint8(start + i);
      if (zeichen === 0) break;
      text += String.fromCharCode(zeichen);
    }
    return text;
  };

  const leseBrueche = (eintrag: Eintrag): number[] => {
    const start = exifStart + view.getUint32(eintrag.valueOffset, little);
    const werte: number[] = [];
    for (let i = 0; i < eintrag.count; i += 1) {
      const pos = start + i * 8;
      if (pos + 8 > view.byteLength) break;
      const zaehler = view.getUint32(pos, little);
      const nenner = view.getUint32(pos + 4, little);
      werte.push(nenner === 0 ? 0 : zaehler / nenner);
    }
    return werte;
  };

  const eintraege0 = leseIfd(ifd0);
  const exifZeiger = eintraege0.find((eintrag) => eintrag.tag === TAG_EXIF_IFD);
  const gpsZeiger = eintraege0.find((eintrag) => eintrag.tag === TAG_GPS_IFD);

  const exifEintraege =
    exifZeiger === undefined
      ? []
      : leseIfd(exifStart + view.getUint32(exifZeiger.valueOffset, little));

  // Aufnahmezeit: erst das Original, dann die Digitalisierung, dann das
  // Dateidatum. Die Reihenfolge folgt der Aussagekraft.
  const zeitEintrag =
    exifEintraege.find((eintrag) => eintrag.tag === TAG_DATETIME_ORIGINAL) ??
    exifEintraege.find((eintrag) => eintrag.tag === TAG_DATETIME_DIGITIZED) ??
    eintraege0.find((eintrag) => eintrag.tag === TAG_DATETIME);

  let takenAt: string | null = null;
  if (zeitEintrag !== undefined) {
    const roh = leseText(zeitEintrag);
    // EXIF schreibt „2026:05:04 09:12:00" — ohne Zonenangabe. Gelesen wird
    // als örtliche Zeit des Geräts; alles andere wäre geraten.
    const treffer = roh?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (treffer !== null && treffer !== undefined) {
      const [, jahr, monat, tag, stunde, minute, sekunde] = treffer;
      const datum = new Date(
        Number(jahr),
        Number(monat) - 1,
        Number(tag),
        Number(stunde),
        Number(minute),
        Number(sekunde),
      );
      if (!Number.isNaN(datum.getTime())) takenAt = datum.toISOString();
    }
  }

  let lat: number | null = null;
  let lon: number | null = null;
  if (gpsZeiger !== undefined) {
    const gps = leseIfd(exifStart + view.getUint32(gpsZeiger.valueOffset, little));
    const grad = (eintrag: Eintrag | undefined): number | null => {
      if (eintrag === undefined || eintrag.count < 3) return null;
      const [g, m, s] = leseBrueche(eintrag);
      if (g === undefined || m === undefined || s === undefined) return null;
      return g + m / 60 + s / 3600;
    };
    const richtung = (tag: number): string | null => {
      const eintrag = gps.find((e) => e.tag === tag);
      return eintrag === undefined ? null : leseText(eintrag);
    };

    const roheBreite = grad(gps.find((e) => e.tag === 2));
    const roheLaenge = grad(gps.find((e) => e.tag === 4));
    if (roheBreite !== null) lat = richtung(1) === 'S' ? -roheBreite : roheBreite;
    if (roheLaenge !== null) lon = richtung(3) === 'W' ? -roheLaenge : roheLaenge;
  }

  return { takenAt, lat, lon };
}

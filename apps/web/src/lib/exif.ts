/**
 * Aufnahmezeit und Ort aus einer JPEG-Datei lesen.
 *
 * Abschnitt 3.8 verlangt, dass die EXIF-Angaben **getrennt** vom Nutzerdatum
 * geführt werden und Abweichungen sichtbar bleiben. Dafür müssen sie erst
 * einmal ausgelesen werden, und zwar im Browser: Die Datei geht direkt in den
 * Objektspeicher und kommt nie an einem Server vorbei, der sie öffnen könnte.
 *
 * Von Hand geschrieben statt mit einer Bibliothek, und das aus einem Grund,
 * der auf der Baustelle zählt: Gebraucht werden vier Angaben — Aufnahmezeit,
 * Zeitzonenversatz, Breite, Länge. Eine vollständige EXIF-Bibliothek bringt
 * dreihundert Kilobyte für Objektivdaten und Farbprofile mit, die hier
 * niemanden interessieren, und die lädt jemand mit einem Balken Empfang.
 *
 * Was hier nicht gelesen wird, wird auch nicht behauptet: Fehlt ein Feld,
 * bleibt es leer. Eine Kamera, die kein Datum schreibt, ist häufiger als man
 * denkt — der Kamera-Aufsatz mancher Browser liefert das Bild ganz ohne EXIF.
 * Dafür gibt es `capturedAt`, die Uhr des Geräts.
 */

export interface ExifData {
  /** ISO-8601 mit Versatz, sofern die Datei einen nennt; sonst ohne. */
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
}

const LEER: ExifData = { takenAt: null, lat: null, lon: null };

// Feldkennungen nach EXIF 2.32.
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;
const TAG_GPS_LAT_REF = 0x0001;
const TAG_GPS_LAT = 0x0002;
const TAG_GPS_LON_REF = 0x0003;
const TAG_GPS_LON = 0x0004;

export async function readExif(file: Blob): Promise<ExifData> {
  try {
    // Nur der Anfang der Datei. EXIF steht im ersten Segment nach dem
    // Dateikopf; 128 KB zu lesen reicht sicher und erspart es, ein
    // 12-MB-Foto in den Speicher zu ziehen, nur um vier Zahlen zu finden.
    const kopf = await file.slice(0, 131_072).arrayBuffer();
    return parseExif(kopf);
  } catch {
    // Eine unlesbare Datei ist kein Fehler in der Erfassung. Das Foto wird
    // trotzdem hochgeladen, nur ohne diese Zugabe.
    return LEER;
  }
}

export function parseExif(buffer: ArrayBuffer): ExifData {
  const sicht = new DataView(buffer);
  if (sicht.byteLength < 4 || sicht.getUint16(0) !== 0xffd8) return LEER;

  // Durch die Segmente laufen, bis APP1 mit „Exif\0\0" kommt.
  let stelle = 2;
  while (stelle + 4 <= sicht.byteLength) {
    if (sicht.getUint8(stelle) !== 0xff) return LEER;
    const marke = sicht.getUint8(stelle + 1);
    // 0xDA ist der Beginn der Bilddaten — danach kommt kein EXIF mehr.
    if (marke === 0xda) return LEER;
    const laenge = sicht.getUint16(stelle + 2);
    if (laenge < 2) return LEER;

    if (marke === 0xe1 && stelle + 10 <= sicht.byteLength) {
      const kennung = String.fromCharCode(
        sicht.getUint8(stelle + 4),
        sicht.getUint8(stelle + 5),
        sicht.getUint8(stelle + 6),
        sicht.getUint8(stelle + 7),
      );
      if (kennung === 'Exif') return parseTiff(sicht, stelle + 10);
    }
    stelle += 2 + laenge;
  }
  return LEER;
}

interface Eintrag {
  tag: number;
  typ: number;
  anzahl: number;
  /** Wo die Daten liegen, absolut im Puffer. */
  ort: number;
}

function parseTiff(sicht: DataView, tiffStart: number): ExifData {
  if (tiffStart + 8 > sicht.byteLength) return LEER;
  const ordnung = sicht.getUint16(tiffStart);
  // „II" = Intel, kleinstwertiges Byte zuerst. „MM" = Motorola, umgekehrt.
  const klein = ordnung === 0x4949;
  if (!klein && ordnung !== 0x4d4d) return LEER;
  if (sicht.getUint16(tiffStart + 2, klein) !== 42) return LEER;

  const ifd0 = tiffStart + sicht.getUint32(tiffStart + 4, klein);
  const felder = readIfd(sicht, ifd0, tiffStart, klein);
  if (felder === null) return LEER;

  const zeiger = (tag: number): number | null => {
    const feld = felder.get(tag);
    if (feld === undefined || feld.typ !== 4) return null;
    return tiffStart + sicht.getUint32(feld.ort, klein);
  };

  const exif = zeiger(TAG_EXIF_IFD);
  const exifFelder = exif === null ? null : readIfd(sicht, exif, tiffStart, klein);
  const gps = zeiger(TAG_GPS_IFD);
  const gpsFelder = gps === null ? null : readIfd(sicht, gps, tiffStart, klein);

  const rohDatum =
    (exifFelder === null ? null : ascii(sicht, exifFelder.get(TAG_DATETIME_ORIGINAL))) ??
    ascii(sicht, felder.get(TAG_DATETIME));
  const versatz =
    exifFelder === null ? null : ascii(sicht, exifFelder.get(TAG_OFFSET_TIME_ORIGINAL));

  return {
    takenAt: toIso(rohDatum, versatz),
    ...gpsPosition(sicht, gpsFelder, klein),
  };
}

function readIfd(
  sicht: DataView,
  ort: number,
  tiffStart: number,
  klein: boolean,
): Map<number, Eintrag> | null {
  if (ort + 2 > sicht.byteLength) return null;
  const anzahl = sicht.getUint16(ort, klein);
  // Ein Verzeichnis mit tausend Feldern ist keins, sondern eine kaputte Datei.
  if (anzahl > 512) return null;

  const felder = new Map<number, Eintrag>();
  for (let index = 0; index < anzahl; index += 1) {
    const eintrag = ort + 2 + index * 12;
    if (eintrag + 12 > sicht.byteLength) break;

    const tag = sicht.getUint16(eintrag, klein);
    const typ = sicht.getUint16(eintrag + 2, klein);
    const menge = sicht.getUint32(eintrag + 4, klein);
    const groesse = TYP_GROESSE[typ] ?? 0;
    if (groesse === 0) continue;

    // Bis zu vier Bytes stehen direkt im Eintrag, alles Größere anderswo.
    const gesamt = groesse * menge;
    const datenOrt =
      gesamt <= 4 ? eintrag + 8 : tiffStart + sicht.getUint32(eintrag + 8, klein);
    if (datenOrt + gesamt > sicht.byteLength) continue;

    felder.set(tag, { tag, typ, anzahl: menge, ort: datenOrt });
  }
  return felder;
}

const TYP_GROESSE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

function ascii(sicht: DataView, feld: Eintrag | undefined): string | null {
  if (feld === undefined || (feld.typ !== 2 && feld.typ !== 7)) return null;
  let text = '';
  for (let index = 0; index < feld.anzahl; index += 1) {
    const zeichen = sicht.getUint8(feld.ort + index);
    if (zeichen === 0) break;
    text += String.fromCharCode(zeichen);
  }
  return text.trim() === '' ? null : text.trim();
}

/**
 * EXIF schreibt „2026:05:04 09:12:00" — Doppelpunkte auch im Datum, und ohne
 * jede Angabe zur Zeitzone. Der Versatz steht seit EXIF 2.31 in einem eigenen
 * Feld, das viele Kameras nicht füllen.
 *
 * Fehlt er, wird **keine** Zeitzone erfunden. Die Angabe geht dann als lokale
 * Zeit weiter, und die API bekommt sie mit dem Versatz des Geräts — das ist
 * die einzige Annahme, die auf einer deutschen Baustelle fast immer stimmt und
 * die einzige, die überhaupt eine Grundlage hat.
 */
export function toIso(roh: string | null, versatz: string | null): string | null {
  if (roh === null) return null;
  const treffer = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(roh);
  if (treffer === null) return null;

  const [, jahr, monat, tag, stunde, minute, sekunde] = treffer;
  const ortszeit = `${jahr}-${monat}-${tag}T${stunde}:${minute}:${sekunde}`;
  const zone = versatz !== null && /^[+-]\d{2}:\d{2}$/.test(versatz) ? versatz : geraeteVersatz();
  return `${ortszeit}${zone}`;
}

function geraeteVersatz(): string {
  const minuten = -new Date().getTimezoneOffset();
  const zeichen = minuten < 0 ? '-' : '+';
  const betrag = Math.abs(minuten);
  return `${zeichen}${String(Math.floor(betrag / 60)).padStart(2, '0')}:${String(betrag % 60).padStart(2, '0')}`;
}

function gpsPosition(
  sicht: DataView,
  felder: Map<number, Eintrag> | null,
  klein: boolean,
): { lat: number | null; lon: number | null } {
  if (felder === null) return { lat: null, lon: null };

  const breite = grad(sicht, felder.get(TAG_GPS_LAT), klein);
  const laenge = grad(sicht, felder.get(TAG_GPS_LON), klein);
  const breiteRef = ascii(sicht, felder.get(TAG_GPS_LAT_REF));
  const laengeRef = ascii(sicht, felder.get(TAG_GPS_LON_REF));

  return {
    lat: breite === null ? null : breiteRef === 'S' ? -breite : breite,
    lon: laenge === null ? null : laengeRef === 'W' ? -laenge : laenge,
  };
}

/** GPS steht als drei Brüche: Grad, Minuten, Sekunden. */
function grad(sicht: DataView, feld: Eintrag | undefined, klein: boolean): number | null {
  if (feld === undefined || feld.typ !== 5 || feld.anzahl < 3) return null;

  const teile: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const zaehler = sicht.getUint32(feld.ort + index * 8, klein);
    const nenner = sicht.getUint32(feld.ort + index * 8 + 4, klein);
    if (nenner === 0) return null;
    teile.push(zaehler / nenner);
  }
  const wert = teile[0]! + teile[1]! / 60 + teile[2]! / 3600;
  return Number.isFinite(wert) ? Math.round(wert * 1_000_000) / 1_000_000 : null;
}

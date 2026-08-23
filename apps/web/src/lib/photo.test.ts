import { describe, expect, it } from 'vitest';
import { readPhotoMetadata, sha256Hex } from './photo';

/**
 * Baut eine JPEG-Datei mit EXIF-Block.
 *
 * Ein echtes Foto als Testdatei wäre einfacher zu bekommen und schwerer zu
 * verstehen: Man sähe nicht, welches Byte welche Aussage trägt. Hier steht
 * der Aufbau im Code, und jeder Fall lässt sich einzeln herstellen.
 */
function jpegMitExif(options: {
  dateTimeOriginal?: string;
  gps?: { lat: [number, number, number]; latRef: string; lon: [number, number, number]; lonRef: string };
}): ArrayBuffer {
  const nachlauf: number[] = [];

  // Der EXIF-Bereich beginnt hinter „Exif\0\0"; alle Zeiger zählen ab dort.
  const tiff: number[] = [];
  const schreibe16 = (ziel: number[], wert: number): void => {
    ziel.push(wert & 0xff, (wert >> 8) & 0xff); // little endian
  };
  const schreibe32 = (ziel: number[], wert: number): void => {
    ziel.push(wert & 0xff, (wert >> 8) & 0xff, (wert >> 16) & 0xff, (wert >> 24) & 0xff);
  };

  // TIFF-Kopf: II, 42, Zeiger auf IFD0 (immer 8).
  tiff.push(0x49, 0x49);
  schreibe16(tiff, 42);
  schreibe32(tiff, 8);

  // Aufbau: IFD0 (mit Zeigern), dann Exif-IFD, dann GPS-IFD, dann Werte.
  const ifd0Eintraege = 1 + (options.gps === undefined ? 0 : 1);
  const ifd0Groesse = 2 + ifd0Eintraege * 12 + 4;
  const exifIfdStart = 8 + ifd0Groesse;
  const exifIfdGroesse = 2 + 1 * 12 + 4;
  const gpsIfdStart = exifIfdStart + exifIfdGroesse;
  const gpsIfdGroesse = options.gps === undefined ? 0 : 2 + 4 * 12 + 4;
  let werteStart = gpsIfdStart + gpsIfdGroesse;

  // IFD0
  schreibe16(tiff, ifd0Eintraege);
  // Zeiger auf das Exif-IFD
  schreibe16(tiff, 0x8769);
  schreibe16(tiff, 4);
  schreibe32(tiff, 1);
  schreibe32(tiff, exifIfdStart);
  if (options.gps !== undefined) {
    schreibe16(tiff, 0x8825);
    schreibe16(tiff, 4);
    schreibe32(tiff, 1);
    schreibe32(tiff, gpsIfdStart);
  }
  schreibe32(tiff, 0); // kein IFD1

  // Exif-IFD mit DateTimeOriginal
  const zeit = `${options.dateTimeOriginal ?? '2026:05:04 09:12:00'}\0`;
  schreibe16(tiff, 1);
  schreibe16(tiff, 0x9003);
  schreibe16(tiff, 2); // ASCII
  schreibe32(tiff, zeit.length);
  schreibe32(tiff, werteStart);
  schreibe32(tiff, 0);
  const zeitOffset = werteStart;
  werteStart += zeit.length;

  // GPS-IFD
  const gpsWerte: number[] = [];
  if (options.gps !== undefined) {
    const latOffset = werteStart;
    const lonOffset = werteStart + 24;

    schreibe16(tiff, 4);
    // 1: LatitudeRef (ASCII, 2 Zeichen, passt direkt in den Eintrag)
    schreibe16(tiff, 1);
    schreibe16(tiff, 2);
    schreibe32(tiff, 2);
    tiff.push(options.gps.latRef.charCodeAt(0), 0, 0, 0);
    // 2: Latitude (3 Brüche)
    schreibe16(tiff, 2);
    schreibe16(tiff, 5);
    schreibe32(tiff, 3);
    schreibe32(tiff, latOffset);
    // 3: LongitudeRef
    schreibe16(tiff, 3);
    schreibe16(tiff, 2);
    schreibe32(tiff, 2);
    tiff.push(options.gps.lonRef.charCodeAt(0), 0, 0, 0);
    // 4: Longitude
    schreibe16(tiff, 4);
    schreibe16(tiff, 5);
    schreibe32(tiff, 3);
    schreibe32(tiff, lonOffset);
    schreibe32(tiff, 0);

    for (const teil of [...options.gps.lat, ...options.gps.lon]) {
      schreibe32(gpsWerte, Math.round(teil * 100));
      schreibe32(gpsWerte, 100);
    }
  }

  // Werte anhängen: erst die Zeit, dann die GPS-Brüche.
  while (tiff.length < zeitOffset) tiff.push(0);
  for (const zeichen of zeit) tiff.push(zeichen.charCodeAt(0));
  nachlauf.push(...gpsWerte);
  tiff.push(...nachlauf);

  const app1 = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]; // "Exif\0\0" + TIFF
  const laenge = app1.length + 2;

  const datei = [
    0xff,
    0xd8, // SOI
    0xff,
    0xe1, // APP1
    (laenge >> 8) & 0xff,
    laenge & 0xff,
    ...app1,
    0xff,
    0xd9, // EOI
  ];
  return new Uint8Array(datei).buffer;
}

describe('Prüfsumme des Originals', () => {
  it('ist stabil und hexadezimal', async () => {
    const daten = new TextEncoder().encode('ein foto').buffer;
    const hash = await sha256Hex(daten);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(new TextEncoder().encode('ein foto').buffer)).toBe(hash);
  });

  it('unterscheidet zwei Bilder', async () => {
    const a = await sha256Hex(new TextEncoder().encode('foto a').buffer);
    const b = await sha256Hex(new TextEncoder().encode('foto b').buffer);
    expect(a).not.toBe(b);
  });
});

describe('Aufnahmezeit aus dem Foto', () => {
  it('liest sie aus dem EXIF-Block', () => {
    const { takenAt } = readPhotoMetadata(jpegMitExif({ dateTimeOriginal: '2026:05:04 09:12:00' }));
    expect(takenAt).not.toBeNull();
    // Gelesen wird als örtliche Zeit des Geräts — der Tag muss stimmen.
    expect(new Date(takenAt!).getFullYear()).toBe(2026);
    expect(new Date(takenAt!).getMonth()).toBe(4);
    expect(new Date(takenAt!).getDate()).toBe(4);
  });

  it('liest den Ort, wenn er drinsteht', () => {
    const { lat, lon } = readPhotoMetadata(
      jpegMitExif({
        gps: { lat: [48, 8, 13.75], latRef: 'N', lon: [11, 34, 34.05], lonRef: 'E' },
      }),
    );
    expect(lat).toBeCloseTo(48.137, 2);
    expect(lon).toBeCloseTo(11.576, 2);
  });

  it('kehrt das Vorzeichen bei Süd und West um', () => {
    const { lat, lon } = readPhotoMetadata(
      jpegMitExif({
        gps: { lat: [33, 51, 0], latRef: 'S', lon: [151, 12, 0], lonRef: 'W' },
      }),
    );
    expect(lat).toBeLessThan(0);
    expect(lon).toBeLessThan(0);
  });

  it('kommt mit einem Foto ohne EXIF zurecht', () => {
    // Bildschirmfotos und alles, was durch einen Messenger lief, hat keins.
    const ohne = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer;
    expect(readPhotoMetadata(ohne)).toEqual({ takenAt: null, lat: null, lon: null });
  });

  it('kommt mit etwas zurecht, das gar kein JPEG ist', () => {
    const unsinn = new TextEncoder().encode('kein bild').buffer;
    expect(readPhotoMetadata(unsinn)).toEqual({ takenAt: null, lat: null, lon: null });
  });
});

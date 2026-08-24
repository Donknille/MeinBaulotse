/**
 * Der EXIF-Leser.
 *
 * Die Prüfdateien entstehen hier im Test, Byte für Byte nach EXIF 2.32 —
 * es gibt keine eingecheckten Beispielfotos. Das hat zwei Gründe: Ein echtes
 * Baustellenfoto im Repository wäre eine personenbezogene Datei, die niemand
 * dort haben will, und ein gebautes Beispiel kann Fälle zeigen, die eine
 * einzelne Kamera nie liefert — beide Byte-Reihenfolgen, fehlende Felder,
 * Südhalbkugel.
 *
 * Der Preis ist ehrlich zu benennen: Geprüft wird der Leser gegen die
 * Formatbeschreibung, nicht gegen eine bestimmte Kamera. Fehlende oder
 * unlesbare Felder enden deshalb bewusst in `null` statt in einer Annahme —
 * dann trägt `capturedAt` die Uhrzeit, und die stammt vom Gerät, nicht von
 * einer Vermutung.
 */

import { describe, expect, it } from 'vitest';
import { parseExif, toIso } from './exif.js';

const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_OFFSET_TIME_ORIGINAL = 0x9011;

interface Feld {
  tag: number;
  typ: number;
  werte: string | number[];
}

interface Bauplan {
  klein?: boolean;
  datum?: string;
  datumOriginal?: string;
  versatz?: string;
  breite?: [number, number, number];
  breiteRef?: string;
  laenge?: [number, number, number];
  laengeRef?: string;
  ohneExif?: boolean;
}

/**
 * Baut eine JPEG-Datei mit genau einem APP1-Segment.
 *
 * Bildinhalt gibt es keinen — der Leser sucht das Segment und hört auf, sobald
 * die Bilddaten anfangen. Ein echtes Bild dahinter würde nichts beweisen.
 */
function jpeg(plan: Bauplan): ArrayBuffer {
  const klein = plan.klein ?? true;
  const puffer = new ArrayBuffer(2048);
  const sicht = new DataView(puffer);

  sicht.setUint16(0, 0xffd8); // SOI
  if (plan.ohneExif === true) {
    sicht.setUint16(2, 0xffda); // direkt zu den Bilddaten
    sicht.setUint16(4, 2);
    return puffer.slice(0, 6);
  }

  const tiff = 12; // 2 SOI + 2 Marke + 2 Länge + „Exif\0\0"
  sicht.setUint16(2, 0xffe1);
  for (const [index, zeichen] of [...'Exif'].entries()) {
    sicht.setUint8(6 + index, zeichen.charCodeAt(0));
  }
  sicht.setUint8(10, 0);
  sicht.setUint8(11, 0);

  sicht.setUint16(tiff, klein ? 0x4949 : 0x4d4d);
  sicht.setUint16(tiff + 2, 42, klein);
  sicht.setUint32(tiff + 4, 8, klein); // IFD0 beginnt direkt hinter dem Kopf

  // Erst die Unterverzeichnisse einplanen, dann IFD0 — es braucht deren Lage.
  const exifFelder: Feld[] = [];
  if (plan.datumOriginal !== undefined) {
    exifFelder.push({ tag: TAG_DATETIME_ORIGINAL, typ: 2, werte: plan.datumOriginal });
  }
  if (plan.versatz !== undefined) {
    exifFelder.push({ tag: TAG_OFFSET_TIME_ORIGINAL, typ: 2, werte: plan.versatz });
  }

  const gpsFelder: Feld[] = [];
  if (plan.breite !== undefined) {
    gpsFelder.push({ tag: 0x0001, typ: 2, werte: plan.breiteRef ?? 'N' });
    gpsFelder.push({ tag: 0x0002, typ: 5, werte: rationals(plan.breite) });
  }
  if (plan.laenge !== undefined) {
    gpsFelder.push({ tag: 0x0003, typ: 2, werte: plan.laengeRef ?? 'E' });
    gpsFelder.push({ tag: 0x0004, typ: 5, werte: rationals(plan.laenge) });
  }

  const ifd0Felder: Feld[] = [];
  if (plan.datum !== undefined) ifd0Felder.push({ tag: TAG_DATETIME, typ: 2, werte: plan.datum });

  // Belegung: IFD0, dann Exif-IFD, dann GPS-IFD, dann der Datenbereich.
  const ifd0 = 8;
  const ifd0Laenge = 2 + (ifd0Felder.length + (exifFelder.length > 0 ? 1 : 0) +
    (gpsFelder.length > 0 ? 1 : 0)) * 12 + 4;
  const exifIfd = ifd0 + ifd0Laenge;
  const exifLaenge = exifFelder.length === 0 ? 0 : 2 + exifFelder.length * 12 + 4;
  const gpsIfd = exifIfd + exifLaenge;
  const gpsLaenge = gpsFelder.length === 0 ? 0 : 2 + gpsFelder.length * 12 + 4;
  let daten = gpsIfd + gpsLaenge;

  const zeiger: Feld[] = [];
  if (exifFelder.length > 0) zeiger.push({ tag: TAG_EXIF_IFD, typ: 4, werte: [exifIfd] });
  if (gpsFelder.length > 0) zeiger.push({ tag: TAG_GPS_IFD, typ: 4, werte: [gpsIfd] });

  const schreibeIfd = (ort: number, felder: Feld[]): void => {
    if (felder.length === 0) return;
    sicht.setUint16(tiff + ort, felder.length, klein);
    felder.forEach((feld, index) => {
      const eintrag = tiff + ort + 2 + index * 12;
      const groesse = feld.typ === 2 ? 1 : feld.typ === 4 ? 4 : 8;
      const menge = typeof feld.werte === 'string' ? feld.werte.length + 1 : feld.werte.length /
        (feld.typ === 5 ? 2 : 1);
      const gesamt = groesse * menge;

      sicht.setUint16(eintrag, feld.tag, klein);
      sicht.setUint16(eintrag + 2, feld.typ, klein);
      sicht.setUint32(eintrag + 4, menge, klein);

      const ziel = gesamt <= 4 ? eintrag + 8 : tiff + daten;
      if (gesamt > 4) sicht.setUint32(eintrag + 8, daten, klein);

      if (typeof feld.werte === 'string') {
        for (const [stelle, zeichen] of [...feld.werte].entries()) {
          sicht.setUint8(ziel + stelle, zeichen.charCodeAt(0));
        }
        sicht.setUint8(ziel + feld.werte.length, 0);
      } else if (feld.typ === 4) {
        sicht.setUint32(ziel, feld.werte[0]!, klein);
      } else {
        feld.werte.forEach((wert, stelle) => sicht.setUint32(ziel + stelle * 4, wert, klein));
      }
      if (gesamt > 4) daten += gesamt;
    });
  };

  schreibeIfd(ifd0, [...ifd0Felder, ...zeiger]);
  schreibeIfd(exifIfd, exifFelder);
  schreibeIfd(gpsIfd, gpsFelder);

  const segmentLaenge = 2 + 6 + daten;
  sicht.setUint16(4, segmentLaenge);
  return puffer.slice(0, 4 + segmentLaenge);
}

/** Grad, Minuten, Sekunden als Zähler/Nenner-Paare, wie EXIF sie schreibt. */
function rationals(gms: [number, number, number]): number[] {
  return [gms[0], 1, gms[1], 1, Math.round(gms[2] * 100), 100];
}

describe('Der EXIF-Leser', () => {
  it('liest die Aufnahmezeit mit dem Zeitzonenversatz der Datei', () => {
    const daten = parseExif(
      jpeg({ datumOriginal: '2026:05:04 09:12:33', versatz: '+02:00' }),
    );
    expect(daten.takenAt).toBe('2026-05-04T09:12:33+02:00');
  });

  it('nimmt DateTime aus IFD0, wenn die Kamera kein DateTimeOriginal schreibt', () => {
    const daten = parseExif(jpeg({ datum: '2026:05:04 07:00:00', versatz: '+02:00' }));
    expect(daten.takenAt).toBe('2026-05-04T07:00:00+02:00');
  });

  it('liest Breite und Länge aus dem GPS-Verzeichnis', () => {
    const daten = parseExif(
      jpeg({ breite: [48, 8, 30], laenge: [11, 34, 45], datumOriginal: '2026:05:04 09:12:33' }),
    );
    expect(daten.lat).toBeCloseTo(48.141667, 5);
    expect(daten.lon).toBeCloseTo(11.579167, 5);
  });

  it('dreht das Vorzeichen bei Süd und West', () => {
    const daten = parseExif(
      jpeg({ breite: [33, 51, 0], breiteRef: 'S', laenge: [18, 25, 0], laengeRef: 'W' }),
    );
    expect(daten.lat).toBeCloseTo(-33.85, 4);
    expect(daten.lon).toBeCloseTo(-18.416667, 5);
  });

  it('versteht beide Byte-Reihenfolgen', () => {
    const intel = parseExif(jpeg({ klein: true, datumOriginal: '2026:05:04 09:12:33' }));
    const motorola = parseExif(jpeg({ klein: false, datumOriginal: '2026:05:04 09:12:33' }));
    expect(motorola.takenAt).toBe(intel.takenAt);
  });

  it('liefert leere Felder statt Annahmen, wenn kein EXIF da ist', () => {
    // Der häufigste Fall auf dem Handy: Der Kamera-Aufsatz des Browsers gibt
    // das Bild ohne EXIF heraus. Dafür gibt es `capturedAt`.
    const daten = parseExif(jpeg({ ohneExif: true }));
    expect(daten).toEqual({ takenAt: null, lat: null, lon: null });
  });

  it('bricht an einer abgeschnittenen Datei nicht ab', () => {
    const ganz = jpeg({ datumOriginal: '2026:05:04 09:12:33', breite: [48, 8, 30] });
    expect(() => parseExif(ganz.slice(0, 30))).not.toThrow();
    expect(() => parseExif(new ArrayBuffer(3))).not.toThrow();
  });

  it('hält eine Datei, die kein JPEG ist, für kein JPEG', () => {
    const fremd = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(parseExif(fremd.buffer)).toEqual({ takenAt: null, lat: null, lon: null });
  });
});

describe('Die Umrechnung des EXIF-Datums', () => {
  it('macht aus Doppelpunkten im Datum Bindestriche', () => {
    expect(toIso('2026:05:04 09:12:33', '+02:00')).toBe('2026-05-04T09:12:33+02:00');
  });

  it('setzt den Versatz des Geräts ein, wenn die Datei keinen nennt', () => {
    const ergebnis = toIso('2026:05:04 09:12:33', null);
    // Welcher Versatz das ist, hängt von der Zeitzone des Prüfrechners ab —
    // geprüft wird, dass überhaupt einer dasteht und nicht „Z" behauptet wird.
    expect(ergebnis).toMatch(/^2026-05-04T09:12:33[+-]\d{2}:\d{2}$/);
  });

  it('gibt bei unlesbarem Datum nichts zurück', () => {
    expect(toIso('gestern nachmittag', null)).toBeNull();
    expect(toIso(null, '+02:00')).toBeNull();
  });
});

/**
 * Die Rechnung hinter der Unkenntlichmachung.
 *
 * Ohne Browser geprüft, und das ist hier nicht bloß bequem: Ein Fehler in
 * dieser Datei bedeutet, dass ein Gesicht doch erkennbar bleibt — und das
 * fällt an einem Bild mit bloßem Auge nicht auf.
 */

import { describe, expect, it } from 'vitest';
import { blockSizeFor, isUsable, pixelate, rectFromDrag, type BlurRect } from './blur.js';

/** Ein Bild, in dem jeder Bildpunkt eine andere Farbe hat. */
function buntesBild(width: number, height: number): Uint8ClampedArray {
  const daten = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    daten[i * 4] = i % 256;
    daten[i * 4 + 1] = (i * 7) % 256;
    daten[i * 4 + 2] = (i * 13) % 256;
    daten[i * 4 + 3] = 255;
  }
  return daten;
}

function farbenIn(
  daten: Uint8ClampedArray,
  width: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
): Set<string> {
  const farben = new Set<string>();
  for (let y = rect.y0; y < rect.y1; y += 1) {
    for (let x = rect.x0; x < rect.x1; x += 1) {
      const i = (y * width + x) * 4;
      farben.add(`${daten[i]},${daten[i + 1]},${daten[i + 2]}`);
    }
  }
  return farben;
}

describe('Ein Rechteck aus zwei Ecken', () => {
  it('funktioniert in alle vier Zugrichtungen', () => {
    const erwartet: BlurRect = { x: 0.2, y: 0.3, width: 0.3, height: 0.2 };
    expect(rectFromDrag({ x: 0.2, y: 0.3 }, { x: 0.5, y: 0.5 })).toEqual(erwartet);
    // Nach links oben gezogen ist dasselbe Rechteck.
    expect(rectFromDrag({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.3 })).toEqual(erwartet);
    expect(rectFromDrag({ x: 0.5, y: 0.3 }, { x: 0.2, y: 0.5 })).toEqual(erwartet);
  });

  it('beschneidet auf das Bild', () => {
    // Wer über den Rand hinaus zieht, meint den Rand.
    const rect = rectFromDrag({ x: -0.5, y: 0.5 }, { x: 1.5, y: 2 });
    expect(rect).toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 });
  });

  it('hält einen Fehlgriff für keine Absicht', () => {
    expect(isUsable(rectFromDrag({ x: 0.5, y: 0.5 }, { x: 0.502, y: 0.503 }))).toBe(false);
    expect(isUsable(rectFromDrag({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 }))).toBe(true);
  });
});

describe('Verpixeln', () => {
  it('macht aus vielen Farben wenige', () => {
    const width = 64;
    const height = 64;
    const daten = buntesBild(width, height);
    const vorher = farbenIn(daten, width, { x0: 16, y0: 16, x1: 48, y1: 48 });
    expect(vorher.size).toBeGreaterThan(100);

    pixelate(daten, width, height, [{ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }], 8);

    const nachher = farbenIn(daten, width, { x0: 16, y0: 16, x1: 48, y1: 48 });
    // 32 mal 32 Bildpunkte in Blöcken von 8: höchstens 16 Farben.
    expect(nachher.size).toBeLessThanOrEqual(16);
  });

  it('lässt alles außerhalb unangetastet', () => {
    const width = 64;
    const height = 64;
    const daten = buntesBild(width, height);
    const original = buntesBild(width, height);

    pixelate(daten, width, height, [{ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }], 8);

    // Die linke obere Ecke liegt außerhalb und muss Bildpunkt für Bildpunkt
    // dieselbe sein — sonst verändert das Werkzeug das Beweisstück.
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 64; x += 1) {
        const i = (y * width + x) * 4;
        expect(daten[i]).toBe(original[i]);
        expect(daten[i + 1]).toBe(original[i + 1]);
      }
    }
  });

  it('lässt die Durchsichtigkeit in Ruhe', () => {
    const daten = buntesBild(16, 16);
    daten[0 * 4 + 3] = 128;
    pixelate(daten, 16, 16, [{ x: 0, y: 0, width: 1, height: 1 }], 4);
    expect(daten[3]).toBe(128);
  });

  it('kommt mit Rechtecken über den Rand hinaus zurecht', () => {
    const daten = buntesBild(32, 32);
    expect(() =>
      pixelate(daten, 32, 32, [{ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }], 8),
    ).not.toThrow();
  });

  it('verpixelt mehrere Bereiche', () => {
    const width = 64;
    const daten = buntesBild(width, 64);
    pixelate(
      daten,
      width,
      64,
      [
        { x: 0, y: 0, width: 0.25, height: 0.25 },
        { x: 0.75, y: 0.75, width: 0.25, height: 0.25 },
      ],
      8,
    );
    expect(farbenIn(daten, width, { x0: 0, y0: 0, x1: 16, y1: 16 }).size).toBeLessThanOrEqual(4);
    expect(farbenIn(daten, width, { x0: 48, y0: 48, x1: 64, y1: 64 }).size).toBeLessThanOrEqual(4);
  });
});

describe('Die Blockgröße', () => {
  it('richtet sich nach dem markierten Bereich, nicht nach dem Bild', () => {
    // Der eigentliche Punkt: Ein Gesicht, das im Bild klein ist, muss
    // genauso unkenntlich werden wie eines, das groß ist. Bemäße sich die
    // Blockgröße am Bild, bliebe das kleine erkennbar.
    const klein: BlurRect = { x: 0.4, y: 0.4, width: 0.05, height: 0.05 };
    const gross: BlurRect = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    expect(blockSizeFor(4000, 3000, klein)).toBe(Math.round((3000 * 0.05) / 6));
    expect(blockSizeFor(4000, 3000, gross)).toBe(Math.round((3000 * 0.5) / 6));
  });

  it('wird nie feiner als sechs Bildpunkte', () => {
    expect(blockSizeFor(400, 300, { x: 0, y: 0, width: 0.02, height: 0.02 })).toBe(6);
  });

  it('zerlegt einen quadratischen Bereich in höchstens 6 mal 6 Blöcke', () => {
    // Sechsunddreißig Mittelwerte für ein Gesicht — daraus wird niemand mehr
    // eine Person erkennen. Bemessen wird an der **kürzeren** Kante, damit die
    // Blöcke quadratisch bleiben; ein langgezogener Bereich bekommt an der
    // langen Kante entsprechend mehr davon.
    const width = 400;
    const height = 300;
    const daten = buntesBild(width, height);
    // 36 mal 36 Bildpunkte, mitten im Bild — wie ein Gesicht in der Ferne.
    pixelate(daten, width, height, [{ x: 0.4, y: 0.4, width: 0.09, height: 0.12 }]);

    const farben = farbenIn(daten, width, {
      x0: Math.floor(0.4 * width) + 1,
      y0: Math.floor(0.4 * height) + 1,
      x1: Math.ceil(0.49 * width) - 1,
      y1: Math.ceil(0.52 * height) - 1,
    });
    expect(farben.size).toBeLessThanOrEqual(36);
  });
});

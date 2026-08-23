/**
 * Gesichter unkenntlich machen (Abschnitt 6.5).
 *
 * „Baustellenfotos können Beschäftigte zeigen: Hinweis beim ersten Upload,
 * Unkenntlichmachung im Editor."
 *
 * Der entscheidende Satz steht woanders, in Abschnitt 3.8: Ein Foto in der
 * Bauakte ist **nicht löschbar** — „ein Foto aus der Bauakte zu entfernen,
 * hieße eine Lücke zu hinterlassen, die niemand mehr erklären kann". Daraus
 * folgt zwingend, **wann** unkenntlich gemacht wird: vorher. Ein Werkzeug,
 * das ein hochgeladenes Bild nachträglich verpixelt, käme immer zu spät.
 *
 * Also im Browser, vor dem Hochladen, auf demselben Weg wie Prüfsumme und
 * Aufnahmezeit. Was hochgeht, ist das verpixelte Bild; das Original verlässt
 * das Gerät nie.
 *
 * Verpixeln und nicht weichzeichnen: Ein Weichzeichner lässt sich mit etwas
 * Mühe zurückrechnen, ein Mittelwert über 16 mal 16 Bildpunkte nicht. Und man
 * sieht ihm an, dass jemand etwas abgedeckt hat — das ist bei einer Akte
 * besser als eine unauffällige Verwischung.
 */

/** Ein Bereich im Bild, in Anteilen der Bildbreite und -höhe (0 bis 1). */
export interface BlurRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Zwei Eckpunkte werden ein Rechteck.
 *
 * Der Nutzer zieht in vier Richtungen, und in drei davon wäre `width`
 * negativ. Außerdem wird auf das Bild beschnitten: Wer über den Rand hinaus
 * zieht, meint den Rand.
 */
export function rectFromDrag(
  von: { x: number; y: number },
  bis: { x: number; y: number },
): BlurRect {
  const x0 = Math.max(0, Math.min(1, Math.min(von.x, bis.x)));
  const y0 = Math.max(0, Math.min(1, Math.min(von.y, bis.y)));
  const x1 = Math.max(0, Math.min(1, Math.max(von.x, bis.x)));
  const y1 = Math.max(0, Math.min(1, Math.max(von.y, bis.y)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Zu kleine Rechtecke sind Fehlgriffe, keine Absicht. */
export function isUsable(rect: BlurRect): boolean {
  return rect.width > 0.01 && rect.height > 0.01;
}

/**
 * In wie viele Blöcke ein markierter Bereich höchstens zerfällt.
 *
 * Der erste Anlauf hat die Blockgröße am **Bild** bemessen — und damit das
 * Falsche: Ein Gesicht, das im Bild klein ist, blieb in feine Blöcke zerlegt
 * und erkennbar. Ausschlaggebend ist der markierte Bereich: Wer ein Gesicht
 * markiert, will dieses Gesicht weg, unabhängig davon, wie groß das Foto ist.
 *
 * Sechs Blöcke je Kante sind sechsunddreißig Mittelwerte für ein Gesicht.
 * Daraus wird niemand mehr eine Person erkennen, und man sieht der Stelle an,
 * dass dort etwas abgedeckt wurde — das ist bei einer Akte gewollt.
 */
export const BLOECKE_JE_KANTE = 6;

/** Feiner als sechs Bildpunkte wird nicht verpixelt; das bliebe lesbar. */
export const BLOCK_MINDESTENS = 6;

export function blockSizeFor(width: number, height: number, rect?: BlurRect): number {
  if (rect === undefined) {
    return Math.max(BLOCK_MINDESTENS, Math.round(Math.max(width, height) / 48));
  }
  const kurz = Math.min(rect.width * width, rect.height * height);
  return Math.max(BLOCK_MINDESTENS, Math.round(kurz / BLOECKE_JE_KANTE));
}

/**
 * Verpixelt die angegebenen Bereiche in den Bilddaten.
 *
 * Arbeitet auf `Uint8ClampedArray` in RGBA — also auf dem, was
 * `ImageData.data` enthält, aber ohne die Web-Schnittstelle zu brauchen.
 * Dadurch ist die Rechnung ohne Browser prüfbar, und geprüft werden soll sie:
 * Ein Fehler hier bedeutet, dass ein Gesicht doch erkennbar bleibt.
 */
export function pixelate(
  daten: Uint8ClampedArray,
  width: number,
  height: number,
  rects: readonly BlurRect[],
  /** Ohne Angabe je Bereich neu bemessen — siehe `blockSizeFor`. */
  festeBlockgroesse?: number,
): void {
  for (const rect of rects) {
    const blockSize = festeBlockgroesse ?? blockSizeFor(width, height, rect);
    const x0 = Math.max(0, Math.floor(rect.x * width));
    const y0 = Math.max(0, Math.floor(rect.y * height));
    const x1 = Math.min(width, Math.ceil((rect.x + rect.width) * width));
    const y1 = Math.min(height, Math.ceil((rect.y + rect.height) * height));

    for (let by = y0; by < y1; by += blockSize) {
      for (let bx = x0; bx < x1; bx += blockSize) {
        const bisX = Math.min(bx + blockSize, x1);
        const bisY = Math.min(by + blockSize, y1);

        let r = 0;
        let g = 0;
        let b = 0;
        let anzahl = 0;
        for (let y = by; y < bisY; y += 1) {
          for (let x = bx; x < bisX; x += 1) {
            const i = (y * width + x) * 4;
            r += daten[i]!;
            g += daten[i + 1]!;
            b += daten[i + 2]!;
            anzahl += 1;
          }
        }
        if (anzahl === 0) continue;

        const mr = Math.round(r / anzahl);
        const mg = Math.round(g / anzahl);
        const mb = Math.round(b / anzahl);
        for (let y = by; y < bisY; y += 1) {
          for (let x = bx; x < bisX; x += 1) {
            const i = (y * width + x) * 4;
            daten[i] = mr;
            daten[i + 1] = mg;
            daten[i + 2] = mb;
          }
        }
      }
    }
  }
}

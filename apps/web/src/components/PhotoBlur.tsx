/**
 * Gesichter unkenntlich machen — vor dem Hochladen (Abschnitt 6.5).
 *
 * „Vor dem Hochladen" ist keine Bequemlichkeit, sondern die einzige Stelle,
 * an der es geht: Ein Foto in der Bauakte ist nicht löschbar (Abschnitt 3.8),
 * und ein Werkzeug, das nachträglich verpixelt, käme immer zu spät. Was
 * hochgeht, ist das verpixelte Bild; das Original verlässt das Gerät nie.
 *
 * Daraus folgt eine Falle, in die man beim Neucodieren zwangsläufig läuft:
 * **Ein Canvas kennt keine EXIF-Daten.** Das neu erzeugte JPEG hat keine
 * Aufnahmezeit und keinen Ort mehr. Die Aufnahmezeit ist aber genau das,
 * worauf die ganze Erfassung beruht — sie ist der Grund, warum drei Fotos,
 * die drei Tage später ankommen, trotzdem ihren richtigen Tag tragen. Sie
 * wird deshalb aus dem ursprünglich gelesenen Foto übernommen und nicht neu
 * gesucht.
 *
 * Die Prüfsumme dagegen wird neu gebildet, und das ist richtig: Sie belegt,
 * dass das Bild in der Akte dasselbe ist wie das hochgeladene — und das ist
 * jetzt das verpixelte.
 */

import { useEffect, useRef, useState } from 'react';
import { EyeOff, Undo2 } from 'lucide-react';
import { Button } from './ui';
import {
  isUsable,
  pixelate,
  rectFromDrag,
  type BlurRect,
} from '../lib/blur';
import { sha256Hex } from '../lib/photo';
import type { QueuedPhoto } from '../lib/queue';

export function PhotoBlur({
  photo,
  onDone,
  onCancel,
}: {
  photo: QueuedPhoto;
  onDone: (bearbeitet: QueuedPhoto) => void;
  onCancel: () => void;
}) {
  const bildRef = useRef<HTMLImageElement>(null);
  const flaecheRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [rects, setRects] = useState<BlurRect[]>([]);
  const [zieht, setZieht] = useState<BlurRect | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    const blob = new Blob([photo.data], { type: photo.mime });
    const adresse = URL.createObjectURL(blob);
    setUrl(adresse);
    return () => URL.revokeObjectURL(adresse);
  }, [photo.data, photo.mime]);

  function anteil(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const kasten = flaecheRef.current?.getBoundingClientRect();
    if (kasten === undefined || kasten.width === 0) return { x: 0, y: 0 };
    return {
      x: (event.clientX - kasten.left) / kasten.width,
      y: (event.clientY - kasten.top) / kasten.height,
    };
  }

  async function uebernehmen(): Promise<void> {
    const bild = bildRef.current;
    if (bild === null || rects.length === 0) return;
    setBusy(true);
    setFehler(null);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bild.naturalWidth;
      canvas.height = bild.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('kein Zeichenbereich');

      ctx.drawImage(bild, 0, 0);
      const daten = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Ohne feste Blockgröße: Jeder markierte Bereich wird für sich
      // bemessen, damit auch ein kleines Gesicht unkenntlich wird.
      pixelate(daten.data, canvas.width, canvas.height, rects);
      ctx.putImageData(daten, 0, 0);

      const blob = await new Promise<Blob | null>((fertig) =>
        canvas.toBlob((ergebnis) => fertig(ergebnis), 'image/jpeg', 0.9),
      );
      if (blob === null) throw new Error('kein Bild');

      const neu = await blob.arrayBuffer();
      onDone({
        ...photo,
        mime: 'image/jpeg',
        bytes: neu.byteLength,
        sha256: await sha256Hex(neu),
        data: neu,
        // Aus dem Original übernommen: Das neue JPEG trägt keine EXIF-Daten
        // mehr, und die Aufnahmezeit ist zu wichtig, um sie zu verlieren.
        takenAt: photo.takenAt,
        lat: photo.lat,
        lon: photo.lon,
      });
    } catch {
      setFehler('Das Bild ließ sich nicht bearbeiten. Du kannst es ohne Änderung behalten.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-steel">
        Zieh ein Rechteck über jedes Gesicht und jedes Kennzeichen. Was du markierst, wird
        verpixelt — und zwar bevor das Bild dein Gerät verlässt.
      </p>

      <div
        ref={flaecheRef}
        className="relative w-full cursor-crosshair touch-none overflow-hidden rounded-[var(--radius-card)] border border-ash select-none"
        onPointerDown={(event) => {
          (event.target as Element).setPointerCapture?.(event.pointerId);
          const punkt = anteil(event);
          setZieht(rectFromDrag(punkt, punkt));
        }}
        onPointerMove={(event) => {
          if (zieht === null) return;
          setZieht(rectFromDrag({ x: zieht.x, y: zieht.y }, anteil(event)));
        }}
        onPointerUp={() => {
          if (zieht !== null && isUsable(zieht)) setRects((vorher) => [...vorher, zieht]);
          setZieht(null);
        }}
      >
        {url === null ? null : (
          <img ref={bildRef} src={url} alt="" className="block w-full" draggable={false} />
        )}
        {[...rects, ...(zieht === null ? [] : [zieht])].map((rect, index) => (
          <div
            key={index}
            className="pointer-events-none absolute bg-charcoal/80"
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.width * 100}%`,
              height: `${rect.height * 100}%`,
            }}
          />
        ))}
      </div>

      {fehler === null ? null : <p className="text-body text-tangerine">{fehler}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy || rects.length === 0}
          onClick={() => void uebernehmen()}
        >
          <EyeOff size={16} aria-hidden />
          {rects.length === 0
            ? 'Nichts markiert'
            : `${rects.length} ${rects.length === 1 ? 'Stelle' : 'Stellen'} verpixeln`}
        </Button>
        {rects.length === 0 ? null : (
          <Button variant="ghost" onClick={() => setRects([])}>
            <Undo2 size={16} aria-hidden />
            Markierungen weg
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Ohne Änderung behalten
        </Button>
      </div>
    </div>
  );
}

/**
 * Der Hinweis beim ersten Hochladen (Abschnitt 6.5).
 *
 * Einmal je Gerät, nicht bei jedem Foto: Ein Hinweis, der jedes Mal
 * erscheint, wird ab dem dritten Mal weggeklickt, ohne gelesen zu werden.
 * Gemerkt wird das lokal — es ist eine Frage der Bedienung, keine Datenlage.
 */
const HINWEIS_SCHLUESSEL = 'mbl.fotohinweis.gelesen';

export function fotohinweisNoetig(): boolean {
  try {
    return window.localStorage.getItem(HINWEIS_SCHLUESSEL) === null;
  } catch {
    // Privates Fenster oder gesperrter Speicher: Dann lieber einmal zu viel
    // hinweisen als gar nicht.
    return true;
  }
}

export function fotohinweisGelesen(): void {
  try {
    window.localStorage.setItem(HINWEIS_SCHLUESSEL, new Date().toISOString());
  } catch {
    // Dann eben beim nächsten Mal wieder.
  }
}

export function Fotohinweis({ onOk }: { onOk: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-ash bg-paper-mist p-4">
      <p className="text-body font-medium text-charcoal">
        Auf Baustellenfotos sind oft Menschen zu sehen.
      </p>
      <p className="text-body text-steel">
        Handwerker, Nachbarn, Passanten. Für die Bauakte brauchst du das Bauwerk, nicht die
        Gesichter — und wer auf einem Foto erkennbar ist, hat ein Wort mitzureden.
      </p>
      <p className="text-body text-steel">
        Du kannst Gesichter und Kennzeichen vor dem Hochladen verpixeln. Das passiert auf
        deinem Gerät; das Original geht nirgendwohin.
      </p>
      <Button variant="outline" className="w-fit" onClick={onOk}>
        Verstanden
      </Button>
    </div>
  );
}

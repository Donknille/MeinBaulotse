/**
 * Die Erfassung, von der Kamera bis in die Datenbank.
 *
 * Hier wird die Warteschlange aus `queue.ts` mit den echten Gegenstellen
 * verdrahtet — Objektspeicher und eigene API — und der Anwendung als ein Haken
 * hingelegt, der nur zwei Fragen beantwortet: Wie viele Aufnahmen liegen noch,
 * und was hat es zuletzt aufgehalten.
 *
 * Aufnehmen und Abliefern sind getrennt, und das ist die ganze Idee: `capture`
 * schreibt nach IndexedDB und ist fertig — ohne Netz, ohne Warten, ohne
 * Rückfrage. Alles Weitere passiert, wenn es passieren kann.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { readExif } from './exif.js';
import { uploadToMediaStore } from './media-store.js';
import {
  flushQueue,
  hashBlob,
  openQueueStore,
  type CaptureTransport,
  type QueueStore,
  type QueuedCapture,
  type QueuedFile,
} from './queue.js';

let store: QueueStore | null = null;

function queueStore(): QueueStore {
  store ??= openQueueStore();
  return store;
}

/** Nur für die Gegenproben: eine andere Ablage einsetzen. */
export function useQueueStore(eigener: QueueStore): void {
  store = eigener;
}

const transport: CaptureTransport = {
  uploadFile: (_projectId, path, blob, mime) => uploadToMediaStore(path, blob, mime),
  createDiaryEntry: (projectId, entry) =>
    api.createDiaryEntry(projectId, { ...entry, withWeather: true }),
  registerMedia: (projectId, media) =>
    api.registerMedia(projectId, media as Parameters<typeof api.registerMedia>[1]),
};

export interface CaptureInput {
  projectId: string;
  files: File[];
  note: string;
  entryDate: string;
  taskId: string | null;
  photoPromptKey: string | null;
}

/**
 * Eine Erfassung entgegennehmen.
 *
 * Prüfsumme und EXIF werden **hier** gebildet, nicht beim Abliefern: Das
 * Gerät hat die Datei gerade in der Hand, und in zwei Tagen, wenn die
 * Warteschlange abläuft, ist die Aufnahmezeit nicht mehr rekonstruierbar.
 */
export async function capture(input: CaptureInput): Promise<QueuedCapture> {
  const jetzt = new Date();
  const dateien: QueuedFile[] = [];

  for (const file of input.files) {
    const exif = await readExif(file);
    dateien.push({
      sha256: await hashBlob(file),
      mime: file.type === '' ? 'image/jpeg' : file.type,
      bytes: file.size,
      blob: file,
      exifTakenAt: exif.takenAt,
      exifLat: exif.lat,
      exifLon: exif.lon,
      uploadedPath: null,
      mediaId: null,
    });
  }

  const erfassung: QueuedCapture = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    entryDate: input.entryDate,
    capturedAt: jetzt.toISOString(),
    note: input.note,
    taskId: input.taskId,
    photoPromptKey: input.photoPromptKey,
    files: dateien,
    diaryEntryId: null,
    attempts: 0,
    lastError: null,
    createdAt: jetzt.toISOString(),
  };

  await queueStore().put(erfassung);
  return erfassung;
}

/**
 * Der Zustand der Warteschlange, für die Oberfläche.
 *
 * Abgeliefert wird beim Öffnen, bei jeder Änderung und sobald das Netz
 * wiederkommt. Ein Zeitgeber steht bewusst nicht dabei: Ein Wecker, der alle
 * dreißig Sekunden gegen ein totes Netz läuft, kostet Akku und bringt nichts —
 * `online` sagt genau dann Bescheid, wenn es etwas zu holen gibt.
 *
 * **Zur Hintergrundsynchronisation**, die Abschnitt 6.1 nennt: Die Background
 * Sync API würde auch dann abliefern, wenn die Anwendung geschlossen ist. Sie
 * gibt es in Safari nicht, und ein Bauherr mit iPhone ist kein Sonderfall.
 * Eine Umsetzung, die nur auf der Hälfte der Geräte greift, verlagert das
 * Problem, statt es zu lösen: Auf der anderen Hälfte wartet die Aufnahme dann
 * still und niemand weiß davon.
 *
 * Deshalb hier der Weg, der überall gleich funktioniert — Ablieferung, sobald
 * die Anwendung offen ist, und eine Zeile in der Oberfläche, die sagt, was
 * noch aussteht. Der Nutzer sieht, dass etwas wartet, statt es zu hoffen.
 */
export interface QueueState {
  /**
   * Wie viele **Fotos** noch warten, nicht wie viele Erfassungen.
   *
   * Hier stand einmal die Zahl der Erfassungen, und die Oberfläche meldete
   * „Eine Aufnahme wartet", nachdem der Nutzer gerade drei Bilder gemacht
   * hatte. Gezählt wird, was er gezählt hat.
   */
  pending: number;
  lastError: string | null;
  busy: boolean;
}

function offeneFotos(warteschlange: readonly QueuedCapture[]): number {
  return warteschlange.reduce(
    (summe, erfassung) =>
      summe + erfassung.files.filter((datei) => datei.mediaId === null).length,
    0,
  );
}

export function useCaptureQueue(): QueueState & { flush: () => Promise<void> } {
  const [zustand, setZustand] = useState<QueueState>({
    pending: 0,
    lastError: null,
    busy: false,
  });

  const aktualisieren = useCallback(async () => {
    const offen = await queueStore().all();
    setZustand((vorher) => ({
      ...vorher,
      pending: offeneFotos(offen),
      lastError: offen.find((eintrag) => eintrag.lastError !== null)?.lastError ?? null,
    }));
  }, []);

  const flush = useCallback(async () => {
    setZustand((vorher) => ({ ...vorher, busy: true }));
    try {
      const ergebnis = await flushQueue(queueStore(), transport);
      setZustand({
        pending: offeneFotos(await queueStore().all()),
        lastError: ergebnis.errors[0] ?? null,
        busy: false,
      });
    } catch (error) {
      // Selbst der Ablieferlauf darf nicht die Anwendung mitreißen. Was
      // liegenbleibt, bleibt liegen — es ist ja gespeichert.
      setZustand((vorher) => ({
        ...vorher,
        busy: false,
        lastError: error instanceof Error ? error.message : String(error),
      }));
    }
  }, []);

  useEffect(() => {
    void aktualisieren().then(() => flush());
    const beiNetz = (): void => void flush();
    window.addEventListener('online', beiNetz);
    return () => window.removeEventListener('online', beiNetz);
  }, [aktualisieren, flush]);

  return { ...zustand, flush };
}

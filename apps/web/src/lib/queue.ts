/**
 * Die Warteschlange für die Erfassung ohne Netz.
 *
 * Abschnitt 5.4 setzt die Messlatte: „Ziel unter 20 Sekunden, mit Handschuhen
 * bedienbar, offlinefähig." Das Offline ist dabei nicht der Sonderfall. Ein
 * Rohbau hat Stahlbeton über sich und ein Balken Empfang, und der Moment, in
 * dem der Leitungsverlauf noch sichtbar ist, kommt genau einmal.
 *
 * Der Entwurf besteht aus zwei Sätzen:
 *
 * 1. **Aufnehmen darf nie scheitern.** Die Erfassung schreibt in IndexedDB und
 *    ist fertig. Ob gerade Netz da ist, erfährt der Nutzer nicht — er sieht
 *    sein Foto in der Liste.
 * 2. **Abliefern darf beliebig oft scheitern.** Jeder Schritt merkt sich sein
 *    Ergebnis, und jeder Schritt ist wiederholbar, ohne etwas doppelt
 *    anzulegen: Die Kennung des Tagebucheintrags wird nach dem ersten Erfolg
 *    festgehalten, der Ablageweg steht in der Prüfsumme, und die API führt
 *    dasselbe Foto nur einmal.
 *
 * Der Speicher steckt hinter `QueueStore`, damit die Ablauflogik ohne
 * IndexedDB prüfbar bleibt. Das ist keine Abstraktion um ihrer selbst willen:
 * Eine Warteschlange, die man nur im Browser prüfen kann, wird nicht geprüft.
 */

export interface QueuedFile {
  sha256: string;
  mime: string;
  bytes: number;
  blob: Blob;
  /** Aus der Datei gelesen, nicht behauptet. */
  exifTakenAt: string | null;
  exifLat: number | null;
  exifLon: number | null;
  /** Gesetzt, sobald die Datei im Objektspeicher liegt. */
  uploadedPath: string | null;
  /** Gesetzt, sobald die API die Zeile kennt. */
  mediaId: string | null;
}

export interface QueuedCapture {
  id: string;
  projectId: string;
  /** Der Tag, über den der Eintrag spricht. */
  entryDate: string;
  /** Uhrzeit des Geräts beim Auslösen. Die Antwort im Flugmodus. */
  capturedAt: string;
  note: string;
  taskId: string | null;
  photoPromptKey: string | null;
  files: QueuedFile[];
  /** Nach dem ersten erfolgreichen Anlegen gesetzt — verhindert Doppelte. */
  diaryEntryId: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface QueueStore {
  put(capture: QueuedCapture): Promise<void>;
  all(): Promise<QueuedCapture[]>;
  /** Der aktuelle Stand einer Erfassung — nicht der, mit dem der Lauf begann. */
  get(id: string): Promise<QueuedCapture | undefined>;
  remove(id: string): Promise<void>;
}

export interface CaptureTransport {
  /** Lädt die Datei direkt in den Objektspeicher — nie über die eigene API. */
  uploadFile(projectId: string, path: string, blob: Blob, mime: string): Promise<void>;
  createDiaryEntry(
    projectId: string,
    entry: { entryDate: string; body: string; taskIds: string[] },
  ): Promise<{ id: string }>;
  registerMedia(projectId: string, media: Record<string, unknown>): Promise<{ id: string }>;
}

export interface FlushResult {
  delivered: number;
  remaining: number;
  errors: string[];
}

/**
 * Der Ablageweg wird aus der Prüfsumme gebildet, nicht zufällig gewürfelt.
 *
 * Damit ist ein wiederholter Versuch derselbe Versuch: Dieselbe Datei landet
 * auf demselben Pfad, und ein zweiter Anlauf nach einem abgebrochenen Upload
 * überschreibt seinen eigenen Rest, statt eine Karteileiche zu hinterlassen.
 *
 * Der erste Ordner ist die Kennung des Bauvorhabens. Daraus leitet die Policy
 * im Objektspeicher ihre Rechte ab — der Pfad ist Teil der Rechteprüfung, nicht
 * nur Ordnung.
 */
export function storagePathFor(projectId: string, sha256: string, mime: string): string {
  const endung = ENDUNGEN[mime] ?? 'bin';
  return `${projectId}/${sha256.slice(0, 2)}/${sha256}.${endung}`;
}

const ENDUNGEN: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};

/** Prüfsumme des Originals. Sie verbindet später die Zeile mit der Datei. */
export async function hashBlob(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Liefert ab, was liegen geblieben ist.
 *
 * Läuft nach jedem Erfassen, beim Wiederkommen des Netzes und beim Öffnen der
 * Anwendung. Ein Fehler bricht nicht die ganze Runde ab: Was durchgeht, geht
 * durch, der Rest bleibt liegen und wird beim nächsten Mal versucht. Sonst
 * hielte ein einziges kaputtes Foto alle anderen fest.
 */
export async function flushQueue(
  store: QueueStore,
  transport: CaptureTransport,
): Promise<FlushResult> {
  const offen = await store.all();
  const fehler: string[] = [];
  let abgeliefert = 0;

  for (const erfassung of offen) {
    try {
      const fertig = await deliver(store, transport, erfassung);
      if (fertig) {
        await store.remove(erfassung.id);
        abgeliefert += 1;
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      fehler.push(text);
      // Der Fehler wird am **aktuellen** Stand vermerkt, nicht an dem, mit dem
      // dieser Versuch begann. Hier stand einmal `...erfassung`, und das machte
      // jeden Abbruch teuer: Der Fortschritt, den `deliver` schon gesichert
      // hatte, wurde damit überschrieben — nach drei Anläufen standen drei
      // Tagebucheinträge für denselben Tag in der Bauakte.
      const stand = (await store.get(erfassung.id)) ?? erfassung;
      await store.put({ ...stand, attempts: stand.attempts + 1, lastError: text });
    }
  }

  return {
    delivered: abgeliefert,
    remaining: (await store.all()).length,
    errors: fehler,
  };
}

async function deliver(
  store: QueueStore,
  transport: CaptureTransport,
  erfassung: QueuedCapture,
): Promise<boolean> {
  let stand = erfassung;

  // Schritt 1: der Eintrag. Nur einmal — die Kennung wird festgehalten, damit
  // ein zweiter Anlauf nicht einen zweiten Eintrag für denselben Tag anlegt.
  if (stand.diaryEntryId === null) {
    const eintrag = await transport.createDiaryEntry(stand.projectId, {
      entryDate: stand.entryDate,
      body: stand.note,
      taskIds: stand.taskId === null ? [] : [stand.taskId],
    });
    stand = { ...stand, diaryEntryId: eintrag.id };
    await store.put(stand);
  }

  // Schritt 2 und 3 je Datei: hochladen, dann anmelden. Nach jeder Datei wird
  // der Stand gesichert — bricht die Verbindung nach dem zweiten von drei
  // Fotos ab, fängt der nächste Anlauf beim dritten an.
  for (let index = 0; index < stand.files.length; index += 1) {
    // Bewusst über den Index und nicht über `entries()`: Der Iterator hinge am
    // Feld von vor der ersten Zuweisung, und `stand` wird in dieser Schleife
    // ersetzt. Was hier gelesen wird, muss der aktuelle Stand sein.
    const datei = stand.files[index]!;
    if (datei.mediaId !== null) continue;

    const pfad = datei.uploadedPath ?? storagePathFor(stand.projectId, datei.sha256, datei.mime);
    if (datei.uploadedPath === null) {
      await transport.uploadFile(stand.projectId, pfad, datei.blob, datei.mime);
      stand = ersetze(stand, index, { uploadedPath: pfad });
      await store.put(stand);
    }

    const angemeldet = await transport.registerMedia(stand.projectId, {
      storagePath: pfad,
      mime: datei.mime,
      bytes: datei.bytes,
      sha256: datei.sha256,
      diaryEntryId: stand.diaryEntryId,
      taskId: stand.taskId,
      photoPromptKey: stand.photoPromptKey,
      // Der Aufnahmezeitpunkt kommt aus der Warteschlange, nicht aus der Uhr
      // des Servers. Genau darum geht es beim Erfassen im Funkloch: Das Foto
      // ist von vorgestern, auch wenn es heute ankommt.
      capturedAt: stand.capturedAt,
      statedDate: stand.entryDate,
      exifTakenAt: datei.exifTakenAt,
      exifLat: datei.exifLat,
      exifLon: datei.exifLon,
    });
    stand = ersetze(stand, index, { mediaId: angemeldet.id });
    await store.put(stand);
  }

  return stand.files.every((datei) => datei.mediaId !== null);
}

function ersetze(
  erfassung: QueuedCapture,
  index: number,
  aenderung: Partial<QueuedFile>,
): QueuedCapture {
  return {
    ...erfassung,
    files: erfassung.files.map((datei, stelle) =>
      stelle === index ? { ...datei, ...aenderung } : datei,
    ),
  };
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

const DB_NAME = 'meinbaulotse';
const DB_VERSION = 1;
const SPEICHER = 'erfassung';

/**
 * IndexedDB und nicht `localStorage`: Dort passen nur Zeichenketten und
 * ungefähr fünf Megabyte hinein. Ein einziges Baustellenfoto ist größer, und
 * ein Blob überlebt den Umweg über Base64 nicht ohne ein Drittel Aufschlag.
 */
export function openQueueStore(): QueueStore {
  let handle: Promise<IDBDatabase> | null = null;

  const db = (): Promise<IDBDatabase> => {
    handle ??= new Promise<IDBDatabase>((erfuellen, ablehnen) => {
      const anfrage = indexedDB.open(DB_NAME, DB_VERSION);
      anfrage.onupgradeneeded = () => {
        if (!anfrage.result.objectStoreNames.contains(SPEICHER)) {
          anfrage.result.createObjectStore(SPEICHER, { keyPath: 'id' });
        }
      };
      anfrage.onsuccess = () => erfuellen(anfrage.result);
      anfrage.onerror = () => ablehnen(anfrage.error ?? new Error('IndexedDB nicht verfügbar'));
    });
    return handle;
  };

  const lauf = async <T>(
    modus: IDBTransactionMode,
    run: (speicher: IDBObjectStore) => IDBRequest,
  ): Promise<T> => {
    const verbindung = await db();
    return new Promise<T>((erfuellen, ablehnen) => {
      const vorgang = verbindung.transaction(SPEICHER, modus);
      const anfrage = run(vorgang.objectStore(SPEICHER));
      anfrage.onsuccess = () => erfuellen(anfrage.result as T);
      anfrage.onerror = () => ablehnen(anfrage.error ?? new Error('Schreiben fehlgeschlagen'));
    });
  };

  return {
    put: (capture) => lauf('readwrite', (speicher) => speicher.put(capture)),
    get: (id) => lauf<QueuedCapture | undefined>('readonly', (speicher) => speicher.get(id)),
    all: async () => {
      const alle = await lauf<QueuedCapture[]>('readonly', (speicher) => speicher.getAll());
      return alle.sort((links, rechts) => links.createdAt.localeCompare(rechts.createdAt));
    },
    remove: (id) => lauf('readwrite', (speicher) => speicher.delete(id)),
  };
}

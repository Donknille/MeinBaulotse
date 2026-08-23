/**
 * Die Offline-Schlange.
 *
 * Leitsatz 1.6.1 der Spezifikation: „Erfassung unter 20 Sekunden. Fällt die
 * Pflege aus, ist alles Weitere wertlos." Auf einer Baustelle heißt das vor
 * allem eines — es gibt kein Netz. Keller, Rohbau, Funkloch am Ortsrand.
 *
 * Deshalb schreibt die Schnellerfassung **immer zuerst hierher** und erst
 * danach ins Netz. Was hier liegt, ist erfasst; ob es schon angekommen ist,
 * ist eine zweite Frage. Der Nutzer sieht seinen Eintrag sofort.
 *
 * Zwei Dinge machen das belastbar:
 *
 * - **Der Zeitpunkt kommt aus dem Foto, nicht aus dem Upload.** Drei Fotos,
 *   die drei Tage später ankommen, tragen trotzdem ihren richtigen Tag. Das
 *   ist die Abnahme von AP 5.
 * - **Doppelt gesendet ist nicht doppelt abgelegt.** Die Prüfsumme des
 *   Originals ist je Bauvorhaben eindeutig; ein zweiter Versuch nach einem
 *   abgebrochenen Upload erzeugt keinen zweiten Eintrag.
 *
 * Der Speicher ist austauschbar. Im Browser ist es IndexedDB; in Tests ein
 * Objekt im Arbeitsspeicher. Dadurch lässt sich die Schlange prüfen, ohne
 * einen Browser zu starten.
 */

export interface QueuedPhoto {
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
  /** Aufnahmezeit aus den EXIF-Daten. `null`, wenn das Foto keine trägt. */
  takenAt: string | null;
  lat: number | null;
  lon: number | null;
  data: ArrayBuffer;
  /** Erfüllt einen Fotoauftrag der Lotsenkarte. */
  photoPromptKey?: string;
}

export interface QueuedCapture {
  id: string;
  projectId: string;
  entryDate: string;
  body: string;
  taskIds: string[];
  photos: QueuedPhoto[];
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface QueueStore {
  all(): Promise<QueuedCapture[]>;
  put(item: QueuedCapture): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Was die Schlange braucht, um etwas loszuwerden. */
export interface QueueSender {
  createEntry(item: QueuedCapture): Promise<{ id: string }>;
  /** Legt die Datei ab und gibt den Pfad zurück. */
  uploadPhoto(item: QueuedCapture, photo: QueuedPhoto): Promise<string>;
  registerMedia(
    item: QueuedCapture,
    photo: QueuedPhoto,
    storagePath: string,
    diaryEntryId: string,
  ): Promise<void>;
}

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

/** Ein Speicher im Arbeitsspeicher — für Tests und als Rückfallebene. */
export function memoryStore(initial: QueuedCapture[] = []): QueueStore {
  const items = new Map(initial.map((item) => [item.id, item]));
  return {
    all: () => Promise.resolve([...items.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
    put: (item) => {
      items.set(item.id, item);
      return Promise.resolve();
    },
    remove: (id) => {
      items.delete(id);
      return Promise.resolve();
    },
  };
}

const DB_NAME = 'meinbaulotse';
const STORE = 'erfassung';

/**
 * IndexedDB. Fotos liegen als `ArrayBuffer` darin — Blobs überleben in
 * manchen Browsern einen Neustart nicht, und genau darauf kommt es hier an.
 */
export function indexedDbStore(): QueueStore {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB nicht erreichbar'));
    });

  const mit = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('Zugriff fehlgeschlagen'));
    });
  };

  return {
    all: async () => {
      const alle = await mit<QueuedCapture[]>('readonly', (store) => store.getAll());
      return alle.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    put: async (item) => {
      await mit('readwrite', (store) => store.put(item));
    },
    remove: async (id) => {
      await mit('readwrite', (store) => store.delete(id));
    },
  };
}

/**
 * Schickt weg, was in der Schlange liegt.
 *
 * Reihenfolge ist Absicht: erst der Eintrag, dann seine Fotos. Ein Foto ohne
 * Eintrag hätte keinen Ort in der Akte.
 *
 * Was scheitert, bleibt liegen und wird beim nächsten Mal erneut versucht.
 * Der Grund wird am Eintrag vermerkt — eine Schlange, die stillschweigend
 * nicht leerläuft, ist schlimmer als gar keine.
 */
export async function flushQueue(store: QueueStore, sender: QueueSender): Promise<FlushResult> {
  const offen = await store.all();
  let sent = 0;
  let failed = 0;

  for (const item of offen) {
    try {
      const entry = await sender.createEntry(item);
      for (const photo of item.photos) {
        const pfad = await sender.uploadPhoto(item, photo);
        await sender.registerMedia(item, photo, pfad, entry.id);
      }
      await store.remove(item.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      await store.put({
        ...item,
        attempts: item.attempts + 1,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { sent, failed, remaining: (await store.all()).length };
}

/** Eine Erfassung in die Schlange legen. Sie ist damit erfasst, nicht gesendet. */
export async function enqueue(
  store: QueueStore,
  capture: Omit<QueuedCapture, 'id' | 'createdAt' | 'attempts'>,
): Promise<QueuedCapture> {
  const item: QueuedCapture = {
    ...capture,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await store.put(item);
  return item;
}

/**
 * Die Abnahme von AP 5, erster Satz:
 *
 * „Im Flugmodus drei Fotos mit Notiz erfassen, Gerät online bringen, alle drei
 *  landen mit korrektem Aufnahmezeitpunkt."
 *
 * Genau das steht hier, plus die Fälle, die auf einer Baustelle eher eintreten
 * als der glatte Durchlauf: Die Verbindung bricht nach dem zweiten von drei
 * Fotos ab. Der Ablieferversuch läuft doppelt, weil der Nutzer die Anwendung
 * zweimal geöffnet hat. Ein Foto ist kaputt und blockiert die anderen.
 *
 * Der Speicher ist eine Landkarte statt IndexedDB — die Ablauflogik ist das,
 * was hier geprüft wird, und sie darf nicht davon abhängen, wo die Zeilen
 * liegen.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  flushQueue,
  hashBlob,
  storagePathFor,
  type CaptureTransport,
  type QueueStore,
  type QueuedCapture,
  type QueuedFile,
} from './queue.js';

const PROJEKT = '11111111-1111-1111-1111-111111111111';
const VORGANG = '22222222-2222-2222-2222-222222222222';

function speicher(): QueueStore & { inhalt: Map<string, QueuedCapture> } {
  const inhalt = new Map<string, QueuedCapture>();
  return {
    inhalt,
    put: (capture) => {
      inhalt.set(capture.id, capture);
      return Promise.resolve();
    },
    all: () =>
      Promise.resolve(
        [...inhalt.values()].sort((links, rechts) =>
          links.createdAt.localeCompare(rechts.createdAt),
        ),
      ),
    get: (id) => Promise.resolve(inhalt.get(id)),
    remove: (id) => {
      inhalt.delete(id);
      return Promise.resolve();
    },
  };
}

interface Protokoll {
  hochgeladen: string[];
  eintraege: { entryDate: string; body: string; taskIds: string[] }[];
  fotos: Record<string, unknown>[];
}

function transport(
  protokoll: Protokoll,
  stoerung: { beiUpload?: number; beiEintrag?: boolean } = {},
): CaptureTransport {
  let uploads = 0;
  return {
    uploadFile: (_projectId, path) => {
      uploads += 1;
      if (stoerung.beiUpload === uploads) {
        return Promise.reject(new Error('Verbindung abgebrochen'));
      }
      protokoll.hochgeladen.push(path);
      return Promise.resolve();
    },
    createDiaryEntry: (_projectId, entry) => {
      if (stoerung.beiEintrag === true) return Promise.reject(new Error('Keine Verbindung'));
      protokoll.eintraege.push(entry);
      return Promise.resolve({ id: `eintrag-${protokoll.eintraege.length}` });
    },
    registerMedia: (_projectId, media) => {
      protokoll.fotos.push(media);
      return Promise.resolve({ id: `foto-${protokoll.fotos.length}` });
    },
  };
}

function datei(nummer: number): QueuedFile {
  return {
    sha256: nummer.toString(16).padStart(64, 'b'),
    mime: 'image/jpeg',
    bytes: 2_400_000 + nummer,
    blob: new Blob([new Uint8Array([nummer])], { type: 'image/jpeg' }),
    exifTakenAt: null,
    exifLat: null,
    exifLon: null,
    uploadedPath: null,
    mediaId: null,
  };
}

function erfassung(anzahl: number, extras: Partial<QueuedCapture> = {}): QueuedCapture {
  return {
    id: 'erfassung-1',
    projectId: PROJEKT,
    entryDate: '2026-05-04',
    capturedAt: '2026-05-04T09:12:00.000+02:00',
    note: 'Leitungsverlauf vor dem Estrich.',
    taskId: VORGANG,
    photoPromptKey: 'leitungen',
    files: Array.from({ length: anzahl }, (_, index) => datei(index + 1)),
    diaryEntryId: null,
    attempts: 0,
    lastError: null,
    createdAt: '2026-05-04T09:12:00.000Z',
    ...extras,
  };
}

let protokoll: Protokoll;

beforeEach(() => {
  protokoll = { hochgeladen: [], eintraege: [], fotos: [] };
});

describe('Drei Fotos aus dem Flugmodus', () => {
  it('landen als ein Eintrag mit drei Fotos, sobald das Netz wieder da ist', async () => {
    const store = speicher();
    await store.put(erfassung(3));

    const ergebnis = await flushQueue(store, transport(protokoll));

    expect(ergebnis.delivered).toBe(1);
    expect(ergebnis.remaining).toBe(0);
    expect(protokoll.eintraege).toHaveLength(1);
    expect(protokoll.eintraege[0]!.body).toBe('Leitungsverlauf vor dem Estrich.');
    expect(protokoll.hochgeladen).toHaveLength(3);
    expect(protokoll.fotos).toHaveLength(3);
  });

  it('behalten den Aufnahmezeitpunkt des Geräts, nicht den der Ablieferung', async () => {
    const store = speicher();
    await store.put(erfassung(3));
    await flushQueue(store, transport(protokoll));

    for (const foto of protokoll.fotos) {
      expect(foto['capturedAt']).toBe('2026-05-04T09:12:00.000+02:00');
      expect(foto['statedDate']).toBe('2026-05-04');
    }
  });

  it('hängen alle am selben Eintrag und am selben Vorgang', async () => {
    const store = speicher();
    await store.put(erfassung(3));
    await flushQueue(store, transport(protokoll));

    const kennungen = new Set(protokoll.fotos.map((foto) => foto['diaryEntryId']));
    expect(kennungen.size).toBe(1);
    expect(protokoll.fotos.every((foto) => foto['taskId'] === VORGANG)).toBe(true);
    expect(protokoll.fotos.every((foto) => foto['photoPromptKey'] === 'leitungen')).toBe(true);
  });
});

describe('Wenn es zwischendurch abbricht', () => {
  it('macht der nächste Anlauf beim dritten Foto weiter', async () => {
    const store = speicher();
    await store.put(erfassung(3));

    const ersterLauf = await flushQueue(store, transport(protokoll, { beiUpload: 3 }));
    expect(ersterLauf.delivered).toBe(0);
    expect(ersterLauf.remaining).toBe(1);
    expect(protokoll.hochgeladen).toHaveLength(2);
    expect(protokoll.fotos).toHaveLength(2);

    const zweiterLauf = await flushQueue(store, transport(protokoll));
    expect(zweiterLauf.delivered).toBe(1);
    // Zwei aus dem ersten Lauf, eines aus dem zweiten. Kein Foto doppelt.
    expect(protokoll.hochgeladen).toHaveLength(3);
    expect(protokoll.fotos).toHaveLength(3);
  });

  it('legt keinen zweiten Tagebucheintrag an', async () => {
    // Der Fehler, der am teuersten wäre: Nach jedem Abbruch ein neuer Eintrag,
    // und am Ende steht derselbe Tag dreimal in der Bauakte.
    const store = speicher();
    await store.put(erfassung(3));

    await flushQueue(store, transport(protokoll, { beiUpload: 1 }));
    await flushQueue(store, transport(protokoll, { beiUpload: 1 }));
    await flushQueue(store, transport(protokoll));

    expect(protokoll.eintraege).toHaveLength(1);
    expect(protokoll.fotos).toHaveLength(3);
  });

  it('merkt sich den Grund, damit die Oberfläche ihn nennen kann', async () => {
    const store = speicher();
    await store.put(erfassung(1));
    await flushQueue(store, transport(protokoll, { beiEintrag: true }));

    const liegengeblieben = (await store.all())[0]!;
    expect(liegengeblieben.attempts).toBe(1);
    expect(liegengeblieben.lastError).toBe('Keine Verbindung');
    // Nichts halb Erledigtes: Ohne Eintrag wurde auch nichts hochgeladen.
    expect(protokoll.hochgeladen).toHaveLength(0);
  });

  it('hält ein kaputtes Foto die anderen Erfassungen nicht auf', async () => {
    const store = speicher();
    await store.put(erfassung(1, { id: 'kaputt', createdAt: '2026-05-04T08:00:00.000Z' }));
    await store.put(erfassung(1, { id: 'heil', createdAt: '2026-05-04T09:00:00.000Z' }));

    const ergebnis = await flushQueue(store, transport(protokoll, { beiUpload: 1 }));

    expect(ergebnis.delivered).toBe(1);
    expect(ergebnis.remaining).toBe(1);
    expect((await store.all())[0]!.id).toBe('kaputt');
  });
});

describe('Der Ablageweg', () => {
  it('folgt der Prüfsumme, damit ein zweiter Anlauf derselbe ist', async () => {
    const bild = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
    const summe = await hashBlob(bild);

    expect(storagePathFor(PROJEKT, summe, 'image/jpeg')).toBe(
      storagePathFor(PROJEKT, summe, 'image/jpeg'),
    );
  });

  it('beginnt mit der Kennung des Bauvorhabens — daran hängen die Rechte', () => {
    const pfad = storagePathFor(PROJEKT, 'a'.repeat(64), 'image/jpeg');
    expect(pfad.startsWith(`${PROJEKT}/`)).toBe(true);
    expect(pfad.endsWith('.jpg')).toBe(true);
  });

  it('gibt einer unbekannten Dateiart eine neutrale Endung', () => {
    expect(storagePathFor(PROJEKT, 'b'.repeat(64), 'application/x-seltsam')).toMatch(/\.bin$/);
  });

  it('bildet dieselbe Prüfsumme wie die Datenbank sie erwartet: 64 Hexziffern', async () => {
    const summe = await hashBlob(new Blob([new Uint8Array([7, 7, 7])]));
    expect(summe).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * Die Abnahme von AP 5, erster Teil:
 *
 * „Im Flugmodus drei Fotos mit Notiz erfassen, Gerät online bringen, alle
 * drei landen mit korrektem Aufnahmezeitpunkt."
 *
 * Der Flugmodus wird hier durch einen Sender nachgestellt, der scheitert.
 * Das ist genauer als ein abgeschaltetes WLAN: Es lässt sich auch der Fall
 * prüfen, in dem das Netz mitten in der Übertragung wegbricht.
 */

import { describe, expect, it } from 'vitest';
import { enqueue, flushQueue, memoryStore, type QueueSender, type QueuedCapture } from './queue';

function foto(name: string, takenAt: string): QueuedCapture['photos'][number] {
  return {
    name,
    mime: 'image/jpeg',
    bytes: 1_200_000,
    sha256: name.padEnd(64, '0'),
    takenAt,
    lat: 48.137154,
    lon: 11.576124,
    data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer,
  };
}

function erfassung(overrides: Partial<QueuedCapture> = {}): Omit<
  QueuedCapture,
  'id' | 'createdAt' | 'attempts'
> {
  return {
    projectId: '00000000-0000-4000-8000-000000000001',
    entryDate: '2026-05-04',
    body: 'Bewehrung liegt, morgen wird betoniert.',
    taskIds: [],
    photos: [],
    ...overrides,
  };
}

/** Ein Sender, der aufschreibt, was ankommt — und auf Wunsch scheitert. */
function sender(options: { schlaegtFehl?: boolean } = {}): QueueSender & {
  entries: QueuedCapture[];
  media: { sha256: string; takenAt: string | null; storagePath: string; entryId: string }[];
} {
  const entries: QueuedCapture[] = [];
  const media: { sha256: string; takenAt: string | null; storagePath: string; entryId: string }[] = [];

  return {
    entries,
    media,
    createEntry(item) {
      if (options.schlaegtFehl === true) throw new Error('Kein Netz.');
      entries.push(item);
      return Promise.resolve({ id: `entry-${entries.length}` });
    },
    uploadPhoto(item, photo) {
      if (options.schlaegtFehl === true) throw new Error('Kein Netz.');
      return Promise.resolve(`${item.projectId}/${photo.sha256}.jpg`);
    },
    registerMedia(_item, photo, storagePath, diaryEntryId) {
      media.push({
        sha256: photo.sha256,
        takenAt: photo.takenAt,
        storagePath,
        entryId: diaryEntryId,
      });
      return Promise.resolve();
    },
  };
}

describe('Erfassen ohne Netz', () => {
  it('nimmt drei Fotos mit Notiz an, obwohl nichts hinausgeht', async () => {
    const store = memoryStore();
    const offline = sender({ schlaegtFehl: true });

    await enqueue(
      store,
      erfassung({
        photos: [
          foto('a', '2026-05-04T09:12:00.000Z'),
          foto('b', '2026-05-04T09:13:30.000Z'),
          foto('c', '2026-05-04T09:15:00.000Z'),
        ],
      }),
    );

    const ergebnis = await flushQueue(store, offline);
    expect(ergebnis.sent).toBe(0);
    expect(ergebnis.failed).toBe(1);
    expect(ergebnis.remaining).toBe(1);

    // Die Erfassung ist nicht verloren, und sie sagt, woran es lag.
    const liegen = await store.all();
    expect(liegen[0]!.photos).toHaveLength(3);
    expect(liegen[0]!.attempts).toBe(1);
    expect(liegen[0]!.lastError).toContain('Kein Netz');
  });

  it('schickt beim nächsten Mal alles los — mit den Zeitpunkten aus den Fotos', async () => {
    const store = memoryStore();
    await enqueue(
      store,
      erfassung({
        photos: [
          foto('a', '2026-05-04T09:12:00.000Z'),
          foto('b', '2026-05-04T09:13:30.000Z'),
          foto('c', '2026-05-04T09:15:00.000Z'),
        ],
      }),
    );

    // Erst ohne Netz …
    await flushQueue(store, sender({ schlaegtFehl: true }));
    // … dann mit.
    const online = sender();
    const ergebnis = await flushQueue(store, online);

    expect(ergebnis.sent).toBe(1);
    expect(ergebnis.remaining).toBe(0);
    expect(online.entries).toHaveLength(1);
    expect(online.media).toHaveLength(3);

    // Der Zeitpunkt kommt aus dem Foto, nicht aus dem Moment des Sendens.
    expect(online.media.map((m) => m.takenAt)).toEqual([
      '2026-05-04T09:12:00.000Z',
      '2026-05-04T09:13:30.000Z',
      '2026-05-04T09:15:00.000Z',
    ]);
    // Und alle drei hängen am selben Eintrag.
    expect(new Set(online.media.map((m) => m.entryId)).size).toBe(1);
  });

  it('behält die Reihenfolge, in der erfasst wurde', async () => {
    const store = memoryStore();
    await enqueue(store, erfassung({ body: 'Zuerst.', entryDate: '2026-05-04' }));
    await new Promise((resolve) => setTimeout(resolve, 2));
    await enqueue(store, erfassung({ body: 'Danach.', entryDate: '2026-05-05' }));

    const online = sender();
    await flushQueue(store, online);
    expect(online.entries.map((entry) => entry.body)).toEqual(['Zuerst.', 'Danach.']);
  });

  it('lässt Gescheitertes liegen und schickt den Rest', async () => {
    const store = memoryStore();
    await enqueue(store, erfassung({ body: 'Geht durch.' }));
    await new Promise((resolve) => setTimeout(resolve, 2));
    await enqueue(store, erfassung({ body: 'Bleibt hängen.' }));

    // Der zweite Eintrag scheitert, der erste nicht.
    const halb: QueueSender = {
      createEntry: (item) => {
        if (item.body.includes('hängen')) throw new Error('Der Server mag das nicht.');
        return Promise.resolve({ id: 'entry-1' });
      },
      uploadPhoto: () => Promise.resolve('pfad'),
      registerMedia: () => Promise.resolve(),
    };

    const ergebnis = await flushQueue(store, halb);
    expect(ergebnis.sent).toBe(1);
    expect(ergebnis.failed).toBe(1);

    const liegen = await store.all();
    expect(liegen).toHaveLength(1);
    expect(liegen[0]!.body).toContain('hängen');
  });

  it('gibt eine Erfassung erst frei, wenn auch die Fotos durch sind', async () => {
    const store = memoryStore();
    await enqueue(store, erfassung({ photos: [foto('a', '2026-05-04T09:12:00.000Z')] }));

    // Der Eintrag geht durch, das Foto nicht.
    const wackelig: QueueSender = {
      createEntry: () => Promise.resolve({ id: 'entry-1' }),
      uploadPhoto: () => {
        throw new Error('Die Ablage antwortet nicht.');
      },
      registerMedia: () => Promise.resolve(),
    };

    const ergebnis = await flushQueue(store, wackelig);
    expect(ergebnis.sent).toBe(0);
    // Die Erfassung bleibt vollständig liegen. Beim nächsten Versuch entsteht
    // kein zweiter Eintrag: Die Prüfsumme des Fotos ist je Bauvorhaben
    // eindeutig, und die API gibt den bestehenden zurück.
    expect((await store.all())[0]!.photos).toHaveLength(1);
  });
});

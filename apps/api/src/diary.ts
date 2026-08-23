/**
 * Tagebuch und Fotos (Arbeitspaket 5).
 *
 * Die Beweisqualität liegt in der Datenbank (siehe 0009_tagebuch.sql): 24
 * Stunden Bearbeitungszeit, dann Versiegelung, dann Hash-Kette. Hier steht,
 * was die Anwendung dazu tut — und das ist bewusst wenig:
 *
 * - Vor jedem Lesen und Schreiben wird versiegelt, was fällig ist. Ein eigener
 *   Zeitgeber wäre eine weitere Stelle, die laufen muss, damit die Akte
 *   stimmt — und die dann irgendwann nicht läuft.
 * - Der Verfasser trägt sich selbst ein. Das erzwingt schon die Policy; hier
 *   wird die Kennung nur beschafft, statt sie aus der Anfrage zu nehmen.
 * - Fotos gehen nie durch diesen Server (Abschnitt 6.1). Wenn eine Anfrage
 *   hier ankommt, liegt die Datei bereits im Ablagedienst; festgehalten wird
 *   nur, was über sie bekannt ist.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type {
  DiaryChainResult,
  DiaryCreateRequest,
  DiaryEntryDto,
  DiaryUpdateRequest,
  MediaCreateRequest,
  MediaItemDto,
} from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

interface EntryRow {
  id: string;
  entry_date: string;
  body: string;
  author_name: string | null;
  author_role: DiaryEntryDto['authorRole'];
  weather: Record<string, unknown> | null;
  weather_source: DiaryEntryDto['weatherSource'];
  task_ids: string[];
  locked_at: string | null;
  content_hash: string | null;
  retracted_at: string | null;
  retraction_reason: string | null;
  is_author: boolean;
  created_at: string;
}

interface MediaRow {
  id: string;
  diary_entry_id: string | null;
  storage_path: string;
  mime: string;
  bytes: string;
  sha256: string;
  exif_taken_at: string | null;
  exif_lat: string | null;
  exif_lon: string | null;
  stated_date: string | null;
  caption: string | null;
  photo_prompt_key: string | null;
  task_id: string | null;
  created_at: string;
}

const toMedia = (row: MediaRow): MediaItemDto => ({
  id: row.id,
  storagePath: row.storage_path,
  mime: row.mime,
  bytes: Number(row.bytes),
  sha256: row.sha256,
  exifTakenAt: row.exif_taken_at === null ? null : new Date(row.exif_taken_at).toISOString(),
  exifLat: row.exif_lat === null ? null : Number(row.exif_lat),
  exifLon: row.exif_lon === null ? null : Number(row.exif_lon),
  statedDate: row.stated_date,
  caption: row.caption,
  photoPromptKey: row.photo_prompt_key,
  taskId: row.task_id,
  createdAt: new Date(row.created_at).toISOString(),
});

/** Fällige Einträge versiegeln. Läuft vor jedem Zugriff auf das Tagebuch. */
async function sealDue(tx: Tx, projectId: string): Promise<void> {
  await tx.query('select mbl.seal_due_diary_entries($1)', [projectId]);
}

async function currentMemberId(tx: Tx, projectId: string): Promise<string> {
  const result = await tx.query<{ id: string | null }>(
    'select mbl.current_member_id($1) as id',
    [projectId],
  );
  const id = result.rows[0]?.id ?? null;
  if (id === null) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }
  return id;
}

export async function loadDiary(tx: Tx, projectId: string): Promise<DiaryEntryDto[]> {
  await sealDue(tx, projectId);

  const entries = await tx.query<EntryRow>(
    `select e.id, e.entry_date, e.body, m.display_name as author_name, e.author_role,
            e.weather, e.weather_source, e.task_ids, e.locked_at, e.content_hash,
            e.retracted_at, e.retraction_reason, e.created_at,
            (e.author_member_id = mbl.current_member_id(e.project_id)) as is_author
       from diary_entry e
       left join project_member m on m.id = e.author_member_id
      where e.project_id = $1
      order by e.entry_date desc, e.created_at desc`,
    [projectId],
  );

  const media = await tx.query<MediaRow>(
    `select id, diary_entry_id, storage_path, mime, bytes, sha256, exif_taken_at,
            exif_lat, exif_lon, stated_date, caption, photo_prompt_key, task_id, created_at
       from media where project_id = $1 order by created_at`,
    [projectId],
  );

  const byEntry = new Map<string, MediaItemDto[]>();
  for (const row of media.rows) {
    if (row.diary_entry_id === null) continue;
    const liste = byEntry.get(row.diary_entry_id) ?? [];
    liste.push(toMedia(row));
    byEntry.set(row.diary_entry_id, liste);
  }

  return entries.rows.map((row) => ({
    id: row.id,
    entryDate: row.entry_date,
    body: row.body,
    authorName: row.author_name,
    authorRole: row.author_role,
    weather: row.weather,
    weatherSource: row.weather_source,
    taskIds: row.task_ids,
    lockedAt: row.locked_at === null ? null : new Date(row.locked_at).toISOString(),
    contentHash: row.content_hash,
    retractedAt: row.retracted_at === null ? null : new Date(row.retracted_at).toISOString(),
    retractionReason: row.retraction_reason,
    // Änderbar ist nur, was noch nicht versiegelt ist — und nur für den, der
    // es geschrieben hat. „Fremden Eintrag ändern" steht in der Rechtematrix
    // bei keiner einzigen Rolle.
    editable: row.locked_at === null && row.is_author && row.retracted_at === null,
    media: byEntry.get(row.id) ?? [],
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function createDiaryEntry(
  tx: Tx,
  projectId: string,
  request: DiaryCreateRequest,
): Promise<DiaryEntryDto> {
  await sealDue(tx, projectId);
  const memberId = await currentMemberId(tx, projectId);

  const rolle = await tx.query<{ role: string }>(
    'select role::text as role from project_member where id = $1',
    [memberId],
  );

  const hatWetter = request.weather !== undefined && Object.keys(request.weather).length > 0;

  const inserted = await tx.query<{ id: string }>(
    `insert into diary_entry
       (project_id, entry_date, body, author_member_id, author_role,
        weather, weather_source, task_ids)
     values ($1, $2, $3, $4, $5::mbl.member_role, $6, $7::mbl.weather_source, $8)
     returning id`,
    [
      projectId,
      request.entryDate,
      request.body,
      memberId,
      rolle.rows[0]?.role ?? null,
      hatWetter ? JSON.stringify(request.weather) : null,
      hatWetter ? 'manuell' : 'keine',
      request.taskIds ?? [],
    ],
  );

  await tx.query(
    `insert into audit_log (project_id, actor_member_id, actor_channel, action, entity_type, entity_id)
     values ($1, $2, 'app', 'diary.created', 'diary_entry', $3)`,
    [projectId, memberId, inserted.rows[0]!.id],
  );

  const alle = await loadDiary(tx, projectId);
  return alle.find((entry) => entry.id === inserted.rows[0]!.id)!;
}

export async function updateDiaryEntry(
  tx: Tx,
  projectId: string,
  entryId: string,
  request: DiaryUpdateRequest,
): Promise<DiaryEntryDto> {
  await sealDue(tx, projectId);

  const felder: string[] = [];
  const werte: unknown[] = [entryId, projectId];
  const setze = (spalte: string, wert: unknown): void => {
    werte.push(wert);
    felder.push(`${spalte} = $${werte.length}`);
  };

  if (request.body !== undefined) setze('body', request.body);
  if (request.taskIds !== undefined) setze('task_ids', request.taskIds);
  if (request.retractionReason !== undefined) {
    setze('retraction_reason', request.retractionReason);
    felder.push('retracted_at = now()');
  }

  const updated = await tx.query(
    `update diary_entry set ${felder.join(', ')} where id = $1 and project_id = $2`,
    werte,
  );

  if (updated.rowCount === 0) {
    throw new HTTPException(404, {
      message: 'Diesen Tagebucheintrag gibt es in deinem Bauvorhaben nicht.',
    });
  }

  const alle = await loadDiary(tx, projectId);
  return alle.find((entry) => entry.id === entryId)!;
}

/**
 * Ein hochgeladenes Foto anmelden.
 *
 * Dieselbe Datei zweimal ist ein Eintrag, kein zweiter: Die Prüfsumme ist je
 * Bauvorhaben eindeutig. Wer dasselbe Bild erneut schickt — etwa weil die
 * Offline-Schlange es doppelt abgearbeitet hat — bekommt den bestehenden
 * Eintrag zurück statt eines Fehlers.
 */
export async function registerMedia(
  tx: Tx,
  projectId: string,
  request: MediaCreateRequest,
): Promise<MediaItemDto> {
  const memberId = await currentMemberId(tx, projectId);

  const inserted = await tx.query<MediaRow>(
    `insert into media
       (project_id, diary_entry_id, task_id, storage_path, mime, bytes, sha256,
        exif_taken_at, exif_lat, exif_lon, stated_date, caption, photo_prompt_key, uploaded_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (project_id, sha256) do nothing
     returning id, diary_entry_id, storage_path, mime, bytes, sha256, exif_taken_at,
               exif_lat, exif_lon, stated_date, caption, photo_prompt_key, task_id, created_at`,
    [
      projectId,
      request.diaryEntryId ?? null,
      request.taskId ?? null,
      request.storagePath,
      request.mime,
      request.bytes,
      request.sha256,
      request.exifTakenAt ?? null,
      request.exifLat ?? null,
      request.exifLon ?? null,
      request.statedDate ?? null,
      request.caption ?? null,
      request.photoPromptKey ?? null,
      memberId,
    ],
  );

  if (inserted.rowCount === 1) return toMedia(inserted.rows[0]!);

  const vorhanden = await tx.query<MediaRow>(
    `select id, diary_entry_id, storage_path, mime, bytes, sha256, exif_taken_at,
            exif_lat, exif_lon, stated_date, caption, photo_prompt_key, task_id, created_at
       from media where project_id = $1 and sha256 = $2`,
    [projectId, request.sha256],
  );
  const row = vorhanden.rows[0];
  if (row === undefined) {
    throw new HTTPException(403, {
      message: 'Fotos anlegen darf in diesem Bauvorhaben nur, wer die Dokumentation führt.',
    });
  }
  return toMedia(row);
}

/**
 * Die Kette prüfen.
 *
 * Der Kopf der Kette — die Prüfsumme des letzten versiegelten Eintrags —
 * gehört auf das Deckblatt der Bauakte. Wer sie notiert, kann später zeigen,
 * dass sich nichts geändert hat.
 */
export async function verifyDiaryChain(tx: Tx, projectId: string): Promise<DiaryChainResult> {
  await sealDue(tx, projectId);

  const result = await tx.query<{
    out_entry_id: string;
    out_entry_date: string;
    out_locked_at: string;
    out_ok: boolean;
    out_grund: string | null;
  }>('select * from mbl.verify_diary_chain($1)', [projectId]);

  const entries = result.rows.map((row) => ({
    entryId: row.out_entry_id,
    entryDate: row.out_entry_date,
    lockedAt: new Date(row.out_locked_at).toISOString(),
    ok: row.out_ok,
    reason: row.out_grund,
  }));

  const head = await tx.query<{ content_hash: string | null }>(
    `select content_hash from diary_entry
      where project_id = $1 and locked_at is not null
      order by locked_at desc, id desc limit 1`,
    [projectId],
  );

  return {
    headHash: head.rows[0]?.content_hash ?? null,
    sealedCount: entries.length,
    intact: entries.every((entry) => entry.ok),
    entries,
  };
}

/**
 * Welche Fotoaufträge der Lotsenkarten sind erfüllt?
 *
 * Der Schlüssel ist `<kartenschlüssel>#<index>`. Er hängt an der Karte und
 * nicht am Vorgang, damit ein Auftrag auch dann erfüllt bleibt, wenn der
 * Vorgang später umbenannt oder neu angelegt wird.
 */
export async function fulfilledPhotoPrompts(tx: Tx, projectId: string): Promise<string[]> {
  const result = await tx.query<{ photo_prompt_key: string }>(
    `select distinct photo_prompt_key from media
      where project_id = $1 and photo_prompt_key is not null`,
    [projectId],
  );
  return result.rows.map((row) => row.photo_prompt_key);
}

/**
 * Bautagebuch und Baustellenfotos.
 *
 * Die Datenbank kann das Meiste davon selbst: versiegeln, verketten, prüfen,
 * fremde Änderungen abweisen. Was hier steht, ist die dünne Schicht darüber —
 * Wetter holen, Zeilen zusammensetzen, Fehlermeldungen übersetzen. Wo eine
 * Policy oder ein Trigger entscheidet, entscheidet hier nichts mit.
 *
 * Eine Stelle prüft doch: der Ablageweg eines Fotos. Er beginnt mit der
 * Kennung des Bauvorhabens, und daraus leitet die Policy im Objektspeicher
 * ihre Rechte ab. Wer zu zwei Bauvorhaben gehört, könnte sonst eine Zeile im
 * einen anlegen, die auf eine Datei im anderen zeigt — die Rechte stimmten
 * beide Male, die Zuordnung wäre trotzdem falsch.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type {
  DiaryChainCheck,
  DiaryEntryCreateRequest,
  DiaryEntryDto,
  DiaryEntryUpdateRequest,
  MediaDto,
  MediaRegisterRequest,
  PhotoPromptStatus,
  WeatherObservation,
} from '@meinbaulotse/shared';
import { fetchWeather } from './weather.js';

type Tx = Pick<Transaction, 'query'>;

// Die 24 Stunden aus Abschnitt 3.8 stehen bewusst nicht als Konstante hier:
// Verbindlich ist die Frist in `mbl.seal_due_diary_entries`, denn dort wird
// versiegelt. Eine zweite Zahl im Anwendungscode wäre eine, die irgendwann
// abweicht — und dann zeigte die Oberfläche „noch änderbar" an einem Eintrag,
// den die Datenbank längst zugemacht hat.

/**
 * Wie weit vorausgeschaut wird, wenn ein Fotoauftrag „dringend" heißt.
 *
 * Sieben Tage, dieselbe Frist wie bei der Einblendung der Lotsenkarte
 * (Abschnitt 3.1). Der Leitungsverlauf vor dem Estrich ist genau so lange
 * fotografierbar, wie der Estrich noch nicht liegt.
 */
const DRINGEND_TAGE = 7;

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

interface DiaryRow {
  id: string;
  entry_date: string;
  body: string;
  author_name: string | null;
  author_role: DiaryEntryDto['authorRole'];
  weather: WeatherObservation | null;
  task_ids: string[];
  task_names: string[];
  locked_at: string | null;
  chain_index: number | null;
  content_hash: string | null;
  retracted_at: string | null;
  retraction_reason: string | null;
  created_at: string;
  editable_minutes: string | null;
  can_edit: boolean;
}

/**
 * Das Tagebuch eines Bauvorhabens, jüngster Eintrag zuerst.
 *
 * Versiegelt wird beim Lesen. Eine Uhr löst keinen Trigger aus, und ein
 * Hintergrunddienst wäre für diese eine Aufgabe ein eigener Betriebszweig —
 * mit eigener Überwachung, eigenen Fehlern und der Frage, was passiert, wenn
 * er drei Tage stillsteht. Faul zu versiegeln hat dieselbe Wirkung und keine
 * dieser Fragen: Ein Eintrag, den nie jemand ansieht, muss nicht versiegelt
 * sein, und sobald jemand hinsieht, ist er es.
 */
export async function listDiary(
  tx: Tx,
  projectId: string,
  limit = 100,
): Promise<DiaryEntryDto[]> {
  await tx.query('select mbl.seal_due_diary_entries($1)', [projectId]);

  const result = await tx.query<DiaryRow>(
    `select e.id, e.entry_date, e.body, m.display_name as author_name, e.author_role,
            e.weather, e.task_ids, e.locked_at, e.chain_index, e.content_hash,
            e.retracted_at, e.retraction_reason, e.created_at,
            coalesce((
              select array_agg(t.name order by t.sort_order, t.name)
                from task t where t.id = any(e.task_ids)
            ), '{}') as task_names,
            case when e.locked_at is not null then null else greatest(0, ceil(
              extract(epoch from (e.created_at + interval '24 hours' - now())) / 60
            ))::text end as editable_minutes,
            (e.locked_at is null
             and e.author_member_id = mbl.current_member_id(e.project_id)) as can_edit
       from diary_entry e
       left join project_member m on m.id = e.author_member_id
      where e.project_id = $1
      order by e.entry_date desc, e.created_at desc
      limit $2`,
    [projectId, limit],
  );

  const media = await loadMediaByEntry(
    tx,
    projectId,
    result.rows.map((row) => row.id),
  );

  return result.rows.map((row) => toDiaryEntry(row, media.get(row.id) ?? []));
}

function toDiaryEntry(row: DiaryRow, media: MediaDto[]): DiaryEntryDto {
  return {
    id: row.id,
    entryDate: row.entry_date,
    body: row.body,
    authorName: row.author_name,
    authorRole: row.author_role,
    weather: row.weather,
    taskIds: row.task_ids,
    taskNames: row.task_names,
    media,
    sealedAt: row.locked_at,
    chainIndex: row.chain_index,
    contentHash: row.content_hash,
    retractedAt: row.retracted_at,
    retractionReason: row.retraction_reason,
    editableForMinutes: row.editable_minutes === null ? null : Number(row.editable_minutes),
    createdAt: row.created_at,
    canEdit: row.can_edit,
  };
}

interface MediaRow {
  id: string;
  diary_entry_id: string | null;
  storage_path: string;
  mime: string;
  bytes: number;
  sha256: string;
  exif_taken_at: string | null;
  exif_lat: string | null;
  exif_lon: string | null;
  captured_at: string | null;
  stated_date: string | null;
  task_id: string | null;
  task_name: string | null;
  photo_prompt_key: string | null;
  caption: string | null;
  created_at: string;
}

function toMedia(row: MediaRow): MediaDto {
  return {
    id: row.id,
    storagePath: row.storage_path,
    mime: row.mime,
    bytes: row.bytes,
    sha256: row.sha256,
    exifTakenAt: row.exif_taken_at,
    exifLat: row.exif_lat === null ? null : Number(row.exif_lat),
    exifLon: row.exif_lon === null ? null : Number(row.exif_lon),
    capturedAt: row.captured_at,
    statedDate: row.stated_date,
    taskId: row.task_id,
    taskName: row.task_name,
    photoPromptKey: row.photo_prompt_key,
    caption: row.caption,
    createdAt: row.created_at,
  };
}

async function loadMediaByEntry(
  tx: Tx,
  projectId: string,
  entryIds: readonly string[],
): Promise<Map<string, MediaDto[]>> {
  const gruppiert = new Map<string, MediaDto[]>();
  if (entryIds.length === 0) return gruppiert;

  const result = await tx.query<MediaRow>(
    `select m.*, t.name as task_name
       from media m
       left join task t on t.id = m.task_id
      where m.project_id = $1 and m.diary_entry_id = any($2::uuid[])
      order by m.created_at`,
    [projectId, entryIds],
  );

  for (const row of result.rows) {
    const liste = gruppiert.get(row.diary_entry_id!) ?? [];
    liste.push(toMedia(row));
    gruppiert.set(row.diary_entry_id!, liste);
  }
  return gruppiert;
}

/** Alle Fotos eines Bauvorhabens, unabhängig vom Eintrag — das Fotoalbum. */
export async function listMedia(tx: Tx, projectId: string, limit = 300): Promise<MediaDto[]> {
  const result = await tx.query<MediaRow>(
    `select m.*, t.name as task_name
       from media m
       left join task t on t.id = m.task_id
      where m.project_id = $1
      order by coalesce(m.captured_at, m.exif_taken_at, m.created_at) desc
      limit $2`,
    [projectId, limit],
  );
  return result.rows.map(toMedia);
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------

/**
 * Einen Eintrag anlegen.
 *
 * Das Wetter wird **vor** dem Einfügen geholt und mit der Zeile gespeichert.
 * Später nachzutragen ginge nicht: Nach 24 Stunden ist die Zeile versiegelt,
 * und die Beobachtung steckt im Hash. Ein Eintrag ohne Wetter bleibt für immer
 * ohne Wetter — deshalb steht der Abruf hier und nicht in einem Nachlauf.
 */
export async function createDiaryEntry(
  tx: Tx,
  projectId: string,
  request: DiaryEntryCreateRequest,
): Promise<DiaryEntryDto> {
  const ort = await tx.query<{ lat: string | null; lon: string | null }>(
    'select lat, lon from project where id = $1',
    [projectId],
  );
  if (ort.rows.length === 0) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  const koordinaten = ort.rows[0]!;
  const wetter =
    request.withWeather && koordinaten.lat !== null && koordinaten.lon !== null
      ? await fetchWeather({
          lat: Number(koordinaten.lat),
          lon: Number(koordinaten.lon),
          date: request.entryDate,
        })
      : null;

  const eingefuegt = await tx
    .query<{ id: string }>(
      `insert into diary_entry
         (project_id, entry_date, body, task_ids, weather, author_member_id, author_role)
       values ($1, $2, $3, $4::uuid[], $5::jsonb, mbl.current_member_id($1), mbl.member_role($1))
       returning id`,
      [
        projectId,
        request.entryDate,
        request.body,
        request.taskIds,
        wetter === null ? null : JSON.stringify(wetter),
      ],
    )
    .catch(rethrowAsHttp('In deiner Rolle lässt sich hier kein Eintrag anlegen.'));

  return loadOne(tx, projectId, eingefuegt.rows[0]!.id);
}

/**
 * Ändern oder zurückziehen.
 *
 * Zwei Vorgänge, eine Route, und das ist Absicht: Nach dem Versiegeln bleibt
 * vom Ändern genau das Zurückziehen übrig. Wer die beiden trennte, müsste dem
 * Nutzer erklären, warum derselbe Knopf mal das eine und mal das andere ist.
 * So bleibt es ein Blatt mit einem Feld, das nach 24 Stunden seine Beschriftung
 * wechselt.
 */
export async function updateDiaryEntry(
  tx: Tx,
  projectId: string,
  entryId: string,
  request: DiaryEntryUpdateRequest,
): Promise<DiaryEntryDto> {
  await tx.query('select mbl.seal_due_diary_entries($1)', [projectId]);

  const felder: string[] = [];
  const werte: unknown[] = [entryId, projectId];
  const setze = (spalte: string, wert: unknown, cast = ''): void => {
    werte.push(wert);
    felder.push(`${spalte} = $${werte.length}${cast}`);
  };

  if (request.body !== undefined) setze('body', request.body);
  if (request.entryDate !== undefined) setze('entry_date', request.entryDate, '::date');
  if (request.taskIds !== undefined) setze('task_ids', request.taskIds, '::uuid[]');
  if (request.retract !== undefined) {
    felder.push('retracted_at = now()');
    setze('retraction_reason', request.retract);
  }
  if (felder.length === 0) return loadOne(tx, projectId, entryId);

  const result = await tx
    .query(`update diary_entry set ${felder.join(', ')} where id = $1 and project_id = $2`, werte)
    .catch(
      rethrowAsHttp(
        'Dieser Eintrag ist versiegelt. Zurückziehen kannst du ihn — er bleibt dann sichtbar und trägt deinen Grund.',
      ),
    );

  if (result.rowCount === 0) {
    // Entweder gibt es den Eintrag nicht, oder er ist nicht deiner. Von außen
    // dasselbe, und das ist richtig so: Ein 403 verriete, dass es ihn gibt.
    throw new HTTPException(404, {
      message: 'Diesen Eintrag gibt es nicht, oder er stammt von jemand anderem.',
    });
  }

  return loadOne(tx, projectId, entryId);
}

async function loadOne(tx: Tx, projectId: string, entryId: string): Promise<DiaryEntryDto> {
  const alle = await listDiary(tx, projectId, 500);
  const eintrag = alle.find((entry) => entry.id === entryId);
  if (eintrag === undefined) {
    throw new HTTPException(404, { message: 'Diesen Eintrag gibt es nicht.' });
  }
  return eintrag;
}

/**
 * Ein hochgeladenes Foto anmelden.
 *
 * Die Bytes sind zu diesem Zeitpunkt schon im Objektspeicher — der Browser hat
 * sie direkt dorthin geschickt. Hier entsteht nur die Zeile, die den Pfad mit
 * einem Bauvorhaben, einem Vorgang und einer Prüfsumme verbindet.
 */
export async function registerMedia(
  tx: Tx,
  projectId: string,
  request: MediaRegisterRequest,
): Promise<MediaDto> {
  // Der einzige Punkt, an dem hier eine Rechtefrage entschieden wird, und er
  // muss hier entschieden werden: Die Policy im Objektspeicher liest die
  // Zugehörigkeit aus dem ersten Ordner des Pfades. Eine Zeile, die auf einen
  // fremden Ordner zeigt, wäre für beide Seiten einzeln zulässig und zusammen
  // falsch.
  if (!request.storagePath.startsWith(`${projectId}/`)) {
    throw new HTTPException(400, {
      message: 'Dieser Ablageweg gehört nicht zu diesem Bauvorhaben.',
    });
  }

  const eingefuegt = await tx
    .query<{ id: string }>(
      `insert into media (
         project_id, diary_entry_id, task_id, storage_path, mime, bytes, sha256,
         exif_taken_at, exif_lat, exif_lon, captured_at, stated_date,
         photo_prompt_key, caption, uploaded_by_member_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               mbl.current_member_id($1))
       -- Dasselbe Foto zweimal ist kein Fehler, sondern eine Warteschlange, die
       -- nach einem Verbindungsabbruch noch einmal abliefert. Sie darf nicht in
       -- einer Fehlermeldung enden, und zwei Zeilen für ein Bild wären in der
       -- Bauakte eine Doppelung, die niemand erklären kann.
       on conflict (project_id, sha256) do update
         set caption          = coalesce(excluded.caption, media.caption),
             diary_entry_id   = coalesce(media.diary_entry_id, excluded.diary_entry_id),
             task_id          = coalesce(media.task_id, excluded.task_id),
             photo_prompt_key = coalesce(media.photo_prompt_key, excluded.photo_prompt_key)
       returning id`,
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
        request.capturedAt ?? null,
        request.statedDate ?? null,
        request.photoPromptKey ?? null,
        request.caption ?? null,
      ],
    )
    .catch(rethrowAsHttp('In deiner Rolle lässt sich hier kein Foto ablegen.'));

  const result = await tx.query<MediaRow>(
    `select m.*, t.name as task_name
       from media m left join task t on t.id = m.task_id
      where m.id = $1`,
    [eingefuegt.rows[0]!.id],
  );
  return toMedia(result.rows[0]!);
}

// ---------------------------------------------------------------------------
// Fotoaufträge
// ---------------------------------------------------------------------------

/**
 * Was jetzt fotografiert werden sollte, und was davon schon erledigt ist.
 *
 * Abschnitt 3.1 nennt die `photo_prompts` den „stillen Helden": Wer beim
 * Rohbau nicht fotografiert, wo die Leitungen liegen, bohrt sechs Jahre später
 * hinein. Der Erfüllungsstand macht daraus eine Liste, die kürzer wird — sonst
 * bliebe dieselbe Aufforderung stehen, bis niemand mehr hinsieht.
 */
export async function listPhotoPrompts(
  tx: Tx,
  projectId: string,
  on: string,
): Promise<PhotoPromptStatus[]> {
  const result = await tx.query<{
    task_id: string;
    task_name: string;
    task_start: string | null;
    prompts: { key: string; what: string; why: string | null }[];
    urgent: boolean;
  }>(
    `select t.id as task_id, t.name as task_name, t.current_start as task_start,
            c.photo_prompts as prompts,
            (t.current_start is not null
             and t.current_start <= ($2::date + $3::int)
             and coalesce(t.current_end, t.current_start) >= $2::date - 30) as urgent
       from task t
       join guide_card c on c.id = t.guide_card_id
      where t.project_id = $1
        and jsonb_array_length(c.photo_prompts) > 0
        and t.status <> 'entfallen'
        -- Was lange vorbei ist, ist nicht mehr fotografierbar. Eine Liste, die
        -- alles behält, ist nach einem halben Jahr niemandes Arbeitsvorrat mehr.
        and coalesce(t.current_end, t.current_start) >= $2::date - 60
      order by t.current_start nulls last, t.sort_order`,
    [projectId, on, DRINGEND_TAGE],
  );

  const erfuellt = await tx.query<{ task_id: string; photo_prompt_key: string; anzahl: string }>(
    `select task_id, photo_prompt_key, count(*)::text as anzahl
       from media
      where project_id = $1 and photo_prompt_key is not null and task_id is not null
      group by task_id, photo_prompt_key`,
    [projectId],
  );
  const zaehler = new Map(
    erfuellt.rows.map((row) => [`${row.task_id}|${row.photo_prompt_key}`, Number(row.anzahl)]),
  );

  return result.rows.flatMap((row) =>
    row.prompts.map((prompt) => ({
      taskId: row.task_id,
      taskName: row.task_name,
      taskStart: row.task_start,
      key: prompt.key,
      what: prompt.what,
      why: prompt.why,
      fulfilledBy: zaehler.get(`${row.task_id}|${prompt.key}`) ?? 0,
      urgent: row.urgent,
    })),
  );
}

// ---------------------------------------------------------------------------
// Die Kettenprüfung
// ---------------------------------------------------------------------------

/**
 * Ist das Tagebuch noch das, was damals aufgeschrieben wurde?
 *
 * Diese Auskunft ist der Grund für die ganze Mechanik. Sie steht als eigene
 * Route, weil sie zweimal gebraucht wird: einmal in der Bauakte, wo die
 * Prüfsumme aufs Deckblatt gehört, und einmal als Beruhigung im Tagebuch selbst
 * — „vollständig und unverändert" ist eine Zeile, die niemand liest, solange
 * sie stimmt.
 */
export async function checkDiaryChain(tx: Tx, projectId: string): Promise<DiaryChainCheck> {
  await tx.query('select mbl.seal_due_diary_entries($1)', [projectId]);

  const pruefung = await tx.query<{
    chain_index: number;
    entry_id: string;
    entry_date: string;
    ok: boolean;
    reason: string | null;
  }>('select * from mbl.verify_diary_chain($1)', [projectId]);

  const zahlen = await tx.query<{ sealed: string; open: string; head: string | null }>(
    `select count(*) filter (where locked_at is not null)::text as sealed,
            count(*) filter (where locked_at is null)::text     as open,
            (select diary_head_hash from project where id = $1) as head
       from diary_entry where project_id = $1`,
    [projectId],
  );

  const brueche = pruefung.rows.filter((row) => !row.ok);
  return {
    headHash: zahlen.rows[0]?.head ?? null,
    sealedCount: Number(zahlen.rows[0]?.sealed ?? 0),
    openCount: Number(zahlen.rows[0]?.open ?? 0),
    intact: brueche.length === 0,
    breaks: brueche.map((row) => ({
      chainIndex: row.chain_index,
      entryId: row.entry_id,
      entryDate: row.entry_date,
      reason: row.reason ?? 'Unbekannter Grund.',
    })),
  };
}

// ---------------------------------------------------------------------------

/**
 * Übersetzt die Ablehnung der Datenbank in eine Antwort, die weiterhilft.
 *
 * Geprüft hat weiterhin die Datenbank; hier wird nur übersetzt. Ohne das käme
 * beim Nutzer ein 500er an — „Das hat nicht geklappt" für etwas, das schlicht
 * nicht seine Rolle ist.
 */
function rethrowAsHttp(message: string): (cause: unknown) => never {
  return (cause: unknown): never => {
    const code = (cause as { code?: string } | null)?.code;
    if (code === '42501') throw new HTTPException(403, { message });
    // Eine verletzte Policy meldet Postgres beim INSERT als 42501, eine
    // fehlgeschlagene `with check`-Bedingung dagegen als 23514 mit dem Namen
    // der Policy im Text. Beides ist für den Nutzer dieselbe Auskunft.
    if (code === '23514' && String((cause as { message?: string }).message).includes('policy')) {
      throw new HTTPException(403, { message });
    }
    throw cause;
  };
}

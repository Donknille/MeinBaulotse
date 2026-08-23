/**
 * Die Bauakte (Abschnitt 5.6).
 *
 * „Im Produkt heißt das **Bauakte**, nicht Beweisakte. Der Nutzer soll sie
 * anlegen, weil sie ordentlich ist, nicht weil er Streit erwartet." Der Satz
 * bestimmt den Ton der ganzen Ansicht: Es ist eine Chronik des Baus, und dass
 * sie im Streit trägt, ist ein Nebenprodukt.
 *
 * Diese Datei stellt zusammen, was hineingehört. Sie erzeugt **kein PDF**,
 * und das ist die wichtigste Entscheidung hier — begründet in `Dossier` unten.
 *
 * Gelesen wird unter den Rechten des Exportierenden. Eine Akte, die mehr
 * enthält als der, der sie anlegt, sehen darf, wäre ein Leck mit Deckblatt.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type { IsoDate } from '@meinbaulotse/schedule';
import type { Dossier, DossierEvent } from '@meinbaulotse/shared';
import { verifyDiaryChain } from './diary.js';

type Tx = Pick<Transaction, 'query'>;

/**
 * Warum hier kein PDF entsteht.
 *
 * Zwei Gründe, und der zweite wiegt schwerer:
 *
 * 1. Eine PDF-Bibliothek in der Vercel-Function wäre ein Vielfaches ihrer
 *    heutigen Größe, samt eingebetteter Schriften, und würde eine schlechtere
 *    Typografie liefern als der Browser, der die CI-Schriften ohnehin hat.
 *
 * 2. **Fotos gehen nie durch den Anwendungsserver** (Abschnitt 6.1). Ein
 *    Erzeuger auf dem Server müsste jedes Baustellenfoto durch die Function
 *    ziehen, um es einzubetten — genau der Weg, den die Spezifikation
 *    ausschließt. Der Browser holt sie mit der Sitzung des Nutzers direkt aus
 *    der Ablage, wie überall sonst in der Anwendung.
 *
 * Also: Der Server stellt die Akte zusammen, die Ansicht setzt sie für den
 * Druck, und das PDF macht der Browser. „Drucken → Als PDF sichern" ist auf
 * jedem Gerät derselbe Griff, und das Ergebnis ist ein PDF wie jedes andere.
 */
const VORLAUF_ERKLAERUNG = true;
void VORLAUF_ERKLAERUNG;

interface Zeitraum {
  from: IsoDate;
  to: IsoDate;
}

/**
 * Wer die Akte anlegen darf, steht in der Rechtematrix (2.2): `owner`,
 * `co_owner`, `expert`.
 *
 * Die RLS allein reicht hier nicht. Sie begrenzt, **was** jemand sieht, und
 * ein GU sähe damit seinen Ausschnitt als Akte. Das Recht `export.run` sagt
 * etwas anderes: dass er sie gar nicht erst anlegen soll. Eine Akte ist ein
 * Dokument mit Deckblatt und Prüfsumme; wer sie in der Hand hält, hält etwas
 * anderes in der Hand als eine Bildschirmansicht.
 */
async function darfExportieren(tx: Tx, projectId: string): Promise<void> {
  const erlaubt = await tx.query<{ ok: boolean }>(
    "select mbl.has_perm($1, 'export.run') as ok",
    [projectId],
  );
  if (erlaubt.rows[0]?.ok !== true) {
    throw new HTTPException(403, {
      message: 'Die Bauakte legt der Bauherr an — oder ein Sachverständiger.',
      cause: { hint: 'Was du sehen darfst, steht im Plan und im Bautagebuch.' },
    });
  }
}

/**
 * Die Feldnamen der Historie, wie ein Mensch sie liest.
 *
 * `current_start` ist ein Spaltenname und in einer Akte, die jemand vorlegt,
 * eine Zumutung. Was hier nicht steht, kommt unverändert durch — dann fehlt
 * eine Zeile in dieser Tabelle, und das fällt beim Lesen auf.
 */
const FELD_NAME: Readonly<Record<string, string>> = {
  current_start: 'Beginn',
  current_end: 'Ende',
  duration_days: 'Dauer in Tagen',
  status: 'Stand',
  earliest_start: 'frühester Beginn',
  proposed_start: 'vorgeschlagener Beginn',
};

/**
 * Das Anlegen des Plans ist keine Änderung.
 *
 * Beim ersten Durchspielen standen achtunddreißig Zeilen „Terminänderung" in
 * der Chronologie, jede mit dem ganzen Vorgang als JSON — der Plan selbst,
 * ausgeschrieben als Ereignisfolge. Wer die Akte liest, sucht darin, was sich
 * **geändert** hat.
 */
const KEINE_AENDERUNG = 'task_created';

/**
 * Die Detailzeilen tragen ausgeschriebene Werte, keine Enum-Namen.
 *
 * Das ist keine Kosmetik: Die Akte ist das eine Dokument, das jemand aus der
 * Hand gibt — an einen Anwalt, einen Sachverständigen, eine Versicherung.
 * „Schwere: geringfuegig" liest sich dort wie ein Datenbankauszug, und ein
 * Datenbankauszug ist etwas anderes als eine Akte.
 *
 * Die Zuordnung der Bestätigungsgrade macht die Ansicht — sie sind Struktur
 * und keine Zeichenkette, weil sie optisch zu unterscheiden sein müssen.
 */
const SCHWERE: Readonly<Record<string, string>> = {
  geringfuegig: 'geringfügig',
  wesentlich: 'wesentlich',
};

const MANGELSTAND: Readonly<Record<string, string>> = {
  offen: 'offen',
  anerkannt: 'vom Unternehmen anerkannt',
  behoben_gemeldet: 'als behoben gemeldet',
  behoben: 'behoben',
  strittig: 'zwei Angaben',
  zurueckgestellt: 'zurückgestellt',
};

const GRUND: Readonly<Record<string, string>> = {
  witterung: 'Witterung',
  lieferzeit: 'Lieferzeit',
  kapazitaet: 'Kapazität',
  planungsaenderung: 'Planungsänderung',
  bauherren_entscheidung: 'Entscheidung des Bauherrn',
  vorgewerk_verzug: 'Vorgewerk später fertig',
  behoerde: 'Behörde',
  mangelbeseitigung: 'Mängelbeseitigung',
  nachtrag: 'Nachtrag',
  planinitialisierung: 'Plan angelegt',
  sonstiges: 'Sonstiges',
};

const ZAHLUNGSSTAND: Readonly<Record<string, string>> = {
  geplant: 'geplant',
  faellig: 'fällig',
  freigegeben: 'freigegeben',
  teilfreigabe: 'teilweise freigegeben',
  bezahlt: 'bezahlt',
};

/** `2026-07-09` liest sich in einem deutschen Dokument als `09.07.2026`. */
function tag(iso: string): string {
  const [jahr, monat, tagOfMonth] = iso.split('-');
  return `${tagOfMonth}.${monat}.${jahr}`;
}

/**
 * Ein Wert aus der Historie, wie er dasteht — nur Datumsangaben umgesetzt.
 *
 * `old_value` und `new_value` tragen je nach Feld ein Datum, eine Zahl oder
 * einen Stand. Übersetzt wird deshalb nur, was sicher ein Datum ist; alles
 * andere kommt unverändert durch, statt geraten zu werden.
 */
function wert(roh: string | null): string {
  if (roh === null) return '—';
  return /^\d{4}-\d{2}-\d{2}$/.test(roh) ? tag(roh) : roh;
}

function sortiert(events: DossierEvent[]): DossierEvent[] {
  return events.sort((a, b) => (a.date === b.date ? a.kind.localeCompare(b.kind) : a.date.localeCompare(b.date)));
}

export async function buildDossier(
  tx: Tx,
  projectId: string,
  zeitraum: Zeitraum,
): Promise<Dossier> {
  await darfExportieren(tx, projectId);

  const kopf = await tx.query<{
    id: string;
    name: string;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    federal_state: string;
    build_type: string;
    contract_type: string;
    has_basement: boolean;
    planned_start: string;
    contractual_completion: string | null;
    contract_sum_cents: string | null;
    security_pct: string | null;
  }>(
    `select id, name, address, postal_code, city, federal_state::text as federal_state,
            build_type::text as build_type, contract_type::text as contract_type,
            has_basement, planned_start, contractual_completion, contract_sum_cents,
            security_pct
       from project where id = $1`,
    [projectId],
  );
  const p = kopf.rows[0];
  if (p === undefined) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  const mitglieder = await tx.query<{
    display_name: string | null;
    company: string | null;
    role: string;
    trade_name: string | null;
    email: string | null;
  }>(
    `select m.display_name, m.company, m.role::text as role, t.name as trade_name, m.email
       from project_member m
       left join trade t on t.id = m.trade_id
      where m.project_id = $1 and m.revoked_at is null
      order by m.role, m.display_name`,
    [projectId],
  );

  const kette = await verifyDiaryChain(tx, projectId);

  // -- Die Chronologie --------------------------------------------------------
  //
  // Fünf Quellen, ein Strang. Das ist der Punkt einer Akte: Was am selben Tag
  // passiert ist, steht am selben Tag — und nicht in fünf Kapiteln, zwischen
  // denen der Leser hin- und herblättern muss.

  const events: DossierEvent[] = [];

  const vorgaenge = await tx.query<{
    id: string;
    name: string;
    current_start: string;
    current_end: string | null;
    actual_start: string | null;
    actual_end: string | null;
    status: string;
    confirmation: string;
    is_wait: boolean;
    trade_name: string | null;
  }>(
    `select t.id, t.name, t.current_start, t.current_end, t.actual_start, t.actual_end,
            t.status::text as status, t.confirmation::text as confirmation, t.is_wait,
            tr.name as trade_name
       from task t left join trade tr on tr.id = t.trade_id
      where t.project_id = $1
        and t.current_start is not null
        and t.current_start <= $3
        and coalesce(t.current_end, t.current_start) >= $2
      order by t.current_start`,
    [projectId, zeitraum.from, zeitraum.to],
  );

  for (const row of vorgaenge.rows) {
    events.push({
      kind: 'vorgang',
      date: row.actual_start ?? row.current_start,
      title: row.name,
      detail:
        `${tag(row.current_start)} bis ${tag(row.current_end ?? row.current_start)}`
        + (row.actual_start === null
          ? ''
          : `, tatsächlich ab ${tag(row.actual_start)}`
            + (row.actual_end === null ? '' : ` bis ${tag(row.actual_end)}`))
        + (row.trade_name === null ? '' : `, ${row.trade_name}`),
      confirmation: row.confirmation,
      status: row.status,
      isWait: row.is_wait,
      mediaIds: [],
    });
  }

  const aenderungen = await tx.query<{
    task_name: string | null;
    field: string;
    old_value: string | null;
    new_value: string | null;
    reason_code: string | null;
    reason_text: string | null;
    actor_name: string | null;
    actor_channel: string;
    effect_days_on_completion: number | null;
    /**
     * Als `date` und nicht als `timestamptz`: Der Treiber gibt `date` als
     * Zeichenkette zurück (siehe `client.ts`), `timestamptz` als `Date`. Die
     * Chronologie rechnet auf Tagen, also wird auf Tage gecastet — statt im
     * TypeScript hinterher zu raten, was gerade herauskam.
     */
    created_date: string;
  }>(
    `select t.name as task_name, c.field, c.old_value #>> '{}' as old_value,
            c.new_value #>> '{}' as new_value, c.reason_code::text as reason_code,
            c.reason_text, m.display_name as actor_name,
            c.actor_channel::text as actor_channel, c.effect_days_on_completion,
            c.created_at::date as created_date
       from schedule_change c
       left join task t on t.id = c.task_id
       left join project_member m on m.id = c.actor_member_id
      where c.project_id = $1 and c.created_at::date between $2 and $3
        and c.field <> '${KEINE_AENDERUNG}'
      order by c.created_at`,
    [projectId, zeitraum.from, zeitraum.to],
  );

  for (const row of aenderungen.rows) {
    events.push({
      kind: 'aenderung',
      date: row.created_date,
      title: `${row.task_name ?? 'Bauvorhaben'}: ${FELD_NAME[row.field] ?? row.field}`,
      detail:
        `${wert(row.old_value)} → ${wert(row.new_value)}`
        + (row.reason_code === null
          ? ''
          : `, Grund: ${GRUND[row.reason_code] ?? row.reason_code}`)
        + (row.reason_text === null ? '' : ` (${row.reason_text})`)
        + (row.effect_days_on_completion === null || row.effect_days_on_completion === 0
          ? ''
          : `, Endtermin ${row.effect_days_on_completion > 0 ? '+' : ''}${row.effect_days_on_completion} Werktage`),
      actor: row.actor_name,
      channel: row.actor_channel,
      mediaIds: [],
    });
  }

  const eintraege = await tx.query<{
    id: string;
    entry_date: string;
    body: string;
    author_name: string | null;
    locked_at: string | null;
    content_hash: string | null;
    retracted_at: string | null;
    retraction_reason: string | null;
    media_ids: string[] | null;
  }>(
    `select d.id, d.entry_date, d.body, m.display_name as author_name, d.locked_at,
            d.content_hash, d.retracted_at, d.retraction_reason,
            (select array_agg(md.id order by md.created_at) from media md
              where md.diary_entry_id = d.id) as media_ids
       from diary_entry d
       left join project_member m on m.id = d.author_member_id
      where d.project_id = $1 and d.entry_date between $2 and $3
      order by d.entry_date`,
    [projectId, zeitraum.from, zeitraum.to],
  );

  for (const row of eintraege.rows) {
    events.push({
      kind: 'tagebuch',
      date: row.entry_date,
      title: row.retracted_at === null ? 'Bautagebuch' : 'Bautagebuch (zurückgezogen)',
      detail:
        row.body
        + (row.retraction_reason === null ? '' : `\n\nZurückgezogen: ${row.retraction_reason}`),
      actor: row.author_name,
      sealed: row.locked_at !== null,
      hash: row.content_hash,
      retracted: row.retracted_at !== null,
      mediaIds: row.media_ids ?? [],
    });
  }

  const maengel = await tx.query<{
    id: string;
    title: string;
    description: string | null;
    location_text: string | null;
    severity: string;
    status: string;
    deadline: string | null;
    reported_date: string;
    task_name: string | null;
    media_ids: string[] | null;
  }>(
    `select d.id, d.title, d.description, d.location_text, d.severity::text as severity,
            d.status::text as status, d.deadline, d.reported_at::date as reported_date,
            t.name as task_name,
            (select array_agg(md.id order by md.created_at) from media md
              where md.defect_id = d.id) as media_ids
       from defect d left join task t on t.id = d.task_id
      where d.project_id = $1 and d.reported_at::date between $2 and $3
      order by d.reported_at`,
    [projectId, zeitraum.from, zeitraum.to],
  );

  for (const row of maengel.rows) {
    events.push({
      kind: 'mangel',
      date: row.reported_date,
      title: row.title,
      detail:
        [
          row.description,
          row.location_text === null ? null : `Ort: ${row.location_text}`,
          row.task_name === null ? null : `Vorgang: ${row.task_name}`,
          `Schwere: ${SCHWERE[row.severity] ?? row.severity}, `
            + `Stand: ${MANGELSTAND[row.status] ?? row.status}`,
          row.deadline === null ? null : `Frist: ${tag(row.deadline)}`,
        ]
          .filter((teil): teil is string => teil !== null)
          .join('\n'),
      severity: row.severity,
      status: row.status,
      mediaIds: row.media_ids ?? [],
    });
  }

  const zahlungen = await tx.query<{
    name: string;
    amount_cents: string | null;
    status: string;
    released_date: string | null;
    withheld_cents: string | null;
    withheld_reason: string | null;
  }>(
    `select name, amount_cents, status::text as status, released_at::date as released_date,
            withheld_cents, withheld_reason
       from payment_milestone
      where project_id = $1 and released_at::date between $2 and $3
      order by released_at`,
    [projectId, zeitraum.from, zeitraum.to],
  );

  for (const row of zahlungen.rows) {
    events.push({
      kind: 'zahlung',
      date: row.released_date ?? zeitraum.to,
      title: row.name,
      detail:
        `${row.amount_cents === null ? '—' : `${Math.round(Number(row.amount_cents) / 100)} Euro`}`
        + `, ${ZAHLUNGSSTAND[row.status] ?? row.status}`
        + (row.withheld_cents === null
          ? ''
          : `, einbehalten ${Math.round(Number(row.withheld_cents) / 100)} Euro — ${row.withheld_reason}`),
      status: row.status,
      mediaIds: [],
    });
  }

  // -- Die Fotos --------------------------------------------------------------
  //
  // Nur die Angaben. Die Bilder holt der Browser mit der Sitzung des Nutzers
  // direkt aus der Ablage — Abschnitt 6.1, und der Grund, warum das PDF nicht
  // hier entsteht.
  const fotos = await tx.query<{
    id: string;
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
  }>(
    `select id, storage_path, mime, bytes, sha256, exif_taken_at, exif_lat, exif_lon,
            stated_date, caption, photo_prompt_key, task_id, created_at
       from media
      where project_id = $1
        and coalesce(stated_date, created_at::date) between $2 and $3
      order by coalesce(exif_taken_at, created_at)`,
    [projectId, zeitraum.from, zeitraum.to],
  );

  return {
    project: {
      id: p.id,
      name: p.name,
      address: [p.address, [p.postal_code, p.city].filter(Boolean).join(' ')]
        .filter((teil) => teil !== null && teil !== '')
        .join(', '),
      federalState: p.federal_state,
      buildType: p.build_type,
      contractType: p.contract_type,
      hasBasement: p.has_basement,
      plannedStart: p.planned_start,
      contractualCompletion: p.contractual_completion,
      contractSumCents: p.contract_sum_cents === null ? null : Number(p.contract_sum_cents),
      securityPct: p.security_pct === null ? null : Number(p.security_pct),
    },
    period: zeitraum,
    members: mitglieder.rows.map((row) => ({
      displayName: row.display_name,
      company: row.company,
      role: row.role,
      tradeName: row.trade_name,
      email: row.email,
    })),
    chain: {
      headHash: kette.headHash,
      sealedCount: kette.sealedCount,
      intact: kette.intact,
    },
    events: sortiert(events),
    photos: fotos.rows.map((row) => ({
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
    })),
    // Das Datum der Erstellung gehört aufs Deckblatt: Eine Akte ohne Stichtag
    // sagt nicht, worauf sie sich bezieht.
    createdAt: new Date().toISOString(),
  };
}

/**
 * Der vollständige Datenexport (Abschnitt 6.5).
 *
 * „Vollständiger Datenexport und Löschung als Selbstbedienung." Das hier ist
 * die erste Hälfte: alles, was zu diesem Bauvorhaben in der Datenbank steht,
 * als JSON — gelesen unter den Rechten des Exportierenden, also genau das,
 * was er ohnehin sehen darf.
 *
 * Bewusst roh und ohne Aufbereitung: Ein Export ist kein Bericht. Er soll
 * vollständig sein und maschinenlesbar, und beides verträgt sich schlecht mit
 * schön.
 */
const EXPORT_TABELLEN = [
  'project',
  'project_member',
  'task',
  'dependency',
  'schedule_change',
  'decision',
  'diary_entry',
  'media',
  'defect',
  'defect_event',
  'payment_milestone',
  'change_order',
  'loan_drawdown',
  'contract_check',
  'contract_description_item',
  'task_confirmation',
  'guide_card_read',
  'checklist_item',
  'audit_log',
] as const;

export async function buildExport(
  tx: Tx,
  projectId: string,
): Promise<Record<string, unknown>> {
  await darfExportieren(tx, projectId);

  const daten: Record<string, unknown> = {};

  for (const tabelle of EXPORT_TABELLEN) {
    // Der Tabellenname kommt aus dieser Liste und niemals aus einer Anfrage —
    // deshalb ist die Verkettung hier unbedenklich und anderswo nicht.
    const spalte = tabelle === 'project' ? 'id' : 'project_id';
    const result = await tx.query(
      `select * from ${tabelle} where ${spalte} = $1`,
      [projectId],
    );
    daten[tabelle] = result.rows;
  }

  return {
    exportedAt: new Date().toISOString(),
    projectId,
    note:
      'Vollständiger Export dieses Bauvorhabens. Enthält nur, was du in der '
      + 'Anwendung ohnehin sehen darfst — dieselben Rechte, dieselbe Sicht.',
    data: daten,
  };
}

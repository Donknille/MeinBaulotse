/**
 * Die Bauakte — Abschnitt 5.6.
 *
 *     „Im Produkt heißt das **Bauakte**, nicht Beweisakte. Der Nutzer soll sie
 *      anlegen, weil sie ordentlich ist, nicht weil er Streit erwartet."
 *
 * Der Inhalt ist trotzdem für den Streitfall gebaut. Was ihn trägt, ist nicht
 * die Vollständigkeit — die hat jedes Protokoll —, sondern die
 * **Unterscheidbarkeit**: Eine Chronik, in der abgestimmte und einseitige
 * Angaben gleich aussehen, beweist nichts. Deshalb trägt jeder Eintrag, der
 * eine Terminangabe ist, seinen Bestätigungsgrad mit, und jeder Eintrag
 * überhaupt den Kanal, über den er hereinkam.
 *
 * ---
 *
 * **Warum das PDF hier nicht entsteht.**
 *
 * Abschnitt 6.1 nennt für PDF „serverseitig, React-PDF oder Headless-Chromium".
 * Genau das geht in diesem Entwurf nicht, und der Grund ist keine Bequemlichkeit,
 * sondern dieselbe Regel, die die Fotos überhaupt sicher macht:
 *
 *     Fotos gehen nie durch den Anwendungsserver (Abschnitt 6.1), und der
 *     Anwendungscode benutzt niemals eine privilegierte Rolle (Abschnitt 6.4).
 *
 * Der Fotoanhang, den 5.6 verlangt, bräuchte einen Server, der die Bilder lesen
 * kann. Lesen darf sie nur, wer eine Sitzung hat — und eine Sitzung hat der
 * Browser des Bauherrn, nicht die Function. Ein serverseitiges PDF mit
 * Fotoanhang wäre nur mit einem Servicekonto zu haben, und damit mit genau dem
 * Generalschlüssel, den dieses Produkt nirgends besitzt.
 *
 * Also andersherum: **Der Server stellt die Akte zusammen, der Browser setzt
 * sie und druckt sie.** Die Chronologie, die Prüfsummen und die Reihenfolge
 * kommen von hier — nachprüfbar und für jeden Beteiligten gleich. Die Bilder
 * holt der Browser mit seiner eigenen Sitzung, und „Drucken → Als PDF sichern"
 * kann jedes Gerät, auf dem diese Anwendung läuft. Der Preis ist ein Klick mehr.
 * Der Gewinn ist, dass es keinen Generalschlüssel gibt, den jemand stehlen
 * könnte.
 */

import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type { Dossier, DossierEntry, MediaDto } from '@meinbaulotse/shared';
import { checkDiaryChain } from './diary.js';

type Tx = Pick<Transaction, 'query'>;

const CHANNEL_LABEL: Record<string, string> = {
  app: 'in der Anwendung',
  guest_link: 'über den Abstimmungslink',
  import: 'importiert',
  system: 'vom System',
};

/** Zustände in Worten. Ein `behoben_gemeldet` ist ein Wert, kein Satzteil. */
const TASK_STATUS_LABEL: Record<string, string> = {
  geplant: 'geplant',
  terminiert: 'terminiert',
  bestaetigt: 'bestätigt',
  laeuft: 'läuft',
  fertig: 'fertig',
  abgenommen: 'abgenommen',
  verschoben: 'verschoben',
  entfallen: 'entfallen',
};

const DEFECT_STATUS_LABEL: Record<string, string> = {
  offen: 'offen',
  in_bearbeitung: 'in Bearbeitung',
  behoben_gemeldet: 'als behoben gemeldet',
  behoben: 'behoben',
  abgelehnt: 'abgelehnt',
};

const REASON_LABEL: Record<string, string> = {
  witterung: 'Witterung',
  lieferzeit: 'Lieferzeit',
  kapazitaet: 'Kapazität beim Gewerk',
  planungsaenderung: 'Planungsänderung',
  bauherren_entscheidung: 'Entscheidung des Bauherrn',
  vorgewerk_verzug: 'Vorgewerk in Verzug',
  behoerde: 'Behörde',
  mangelbeseitigung: 'Mängelbeseitigung',
  nachtrag: 'Nachtrag',
  sonstiges: 'Sonstiges',
  planinitialisierung: 'Plan angelegt',
};

function iso(wert: Date | string): string {
  return wert instanceof Date ? wert.toISOString() : wert;
}

function tag(wert: Date | string): string {
  return iso(wert).slice(0, 10);
}

/**
 * `2026-09-24` → `24.09.2026`.
 *
 * Nur für die Fließtexte der Akte. Die Felder, an denen sortiert und gruppiert
 * wird (`on`, `at`), bleiben ISO — ein Dokument liest sich auf Deutsch, ein
 * Datenfeld rechnet sich nicht darin.
 */
function datum(wert: string | null): string {
  if (wert === null) return '—';
  const [jahr, monat, tag_] = wert.split('-');
  return jahr === undefined || monat === undefined || tag_ === undefined
    ? wert
    : `${tag_}.${monat}.${jahr}`;
}

/**
 * Stellt die Akte für einen Zeitraum zusammen.
 *
 * Alles läuft unter derselben RLS wie jede andere Abfrage. Ein Baubegleiter
 * bekommt damit dieselbe Akte wie der Bauherr, ein Einzelgewerk nur seinen
 * Ausschnitt — und niemand muss dafür eine zweite Rechteprüfung schreiben.
 */
export async function buildDossier(
  tx: Tx,
  projectId: string,
  from: string,
  to: string,
  computedEnd: string | null,
): Promise<Dossier> {
  const projekt = await tx.query<{
    id: string;
    name: string;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    federal_state: Dossier['project']['federalState'];
    build_type: Dossier['project']['buildType'];
    contract_type: Dossier['project']['contractType'];
    planned_start: string;
    contractual_completion: string | null;
    contract_sum_cents: number | null;
  }>(
    `select id, name, address, postal_code, city, federal_state, build_type, contract_type,
            planned_start, contractual_completion, contract_sum_cents
       from project where id = $1`,
    [projectId],
  );
  if (projekt.rows.length === 0) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }
  const kopf = projekt.rows[0]!;

  const beteiligte = await tx.query<{
    display_name: string | null;
    company: string | null;
    role: Dossier['members'][number]['role'];
    trade_name: string | null;
    email: string | null;
  }>(
    `select m.display_name, m.company, m.role, tr.name as trade_name, m.email
       from project_member m
       left join trade tr on tr.id = m.trade_id
      where m.project_id = $1 and m.revoked_at is null
      order by m.role, m.display_name`,
    [projectId],
  );

  // Die Kettenprüfung steht **vor** den Einträgen, und das ist keine Kosmetik:
  // Sie versiegelt nebenbei, was fällig ist (`mbl.seal_due_diary_entries`).
  // Andersherum läse die Chronik die Einträge eine Zeile zu früh — und ein
  // gestern geschriebener Eintrag käme beim ersten Öffnen ohne Prüfsumme in
  // die Akte und beim zweiten mit.
  const kette = await checkDiaryChain(tx, projectId);

  const eintraege: DossierEntry[] = [
    ...(await terminEintraege(tx, projectId, from, to)),
    ...(await verschiebungen(tx, projectId, from, to)),
    ...(await tagebuch(tx, projectId, from, to)),
    ...(await maengel(tx, projectId, from, to)),
    ...(await zahlungen(tx, projectId, from, to)),
    ...(await entscheidungen(tx, projectId, from, to)),
  ].sort((links, rechts) => links.at.localeCompare(rechts.at));

  const zaehler = { self_stated: 0, counterparty_stated: 0, mutual: 0, disputed: 0 };
  for (const eintrag of eintraege) {
    if (eintrag.confirmation !== null) zaehler[eintrag.confirmation] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    period: { from, to },
    project: {
      id: kopf.id,
      name: kopf.name,
      address: kopf.address,
      postalCode: kopf.postal_code,
      city: kopf.city,
      federalState: kopf.federal_state,
      buildType: kopf.build_type,
      contractType: kopf.contract_type,
      plannedStart: kopf.planned_start,
      contractualCompletion: kopf.contractual_completion,
      computedEnd,
      contractSumCents: kopf.contract_sum_cents,
    },
    members: beteiligte.rows.map((row) => ({
      displayName: row.display_name,
      company: row.company,
      role: row.role,
      tradeName: row.trade_name,
      email: row.email,
    })),
    chain: kette,
    entries: eintraege,
    media: await medienImZeitraum(tx, projectId, from, to),
    confirmationCounts: zaehler,
  };
}

/**
 * Die Vorgänge, die im Zeitraum liefen — mit ihrem Bestätigungsgrad.
 *
 * Sie sind das Rückgrat der Chronik: An ihnen hängt die Unterscheidung, um die
 * es in der Abnahme geht. „Innenputz 12.–21.05." ist eine Angabe;
 * „Innenputz 12.–21.05., abgestimmt am 03.05." ist eine Vereinbarung; und
 * „Innenputz 12.–21.05., zwei Angaben" ist ein offener Streitpunkt, den man
 * hinterher nicht mehr rekonstruieren könnte.
 */
async function terminEintraege(
  tx: Tx,
  projectId: string,
  from: string,
  to: string,
): Promise<DossierEntry[]> {
  const result = await tx.query<{
    name: string;
    current_start: string;
    current_end: string | null;
    actual_start: string | null;
    actual_end: string | null;
    status: string;
    confirmation: DossierEntry['confirmation'];
    confirmed_at: Date | null;
    confirmed_by: string | null;
    counter_start: string | null;
    counter_end: string | null;
    counter_by: string | null;
    trade_name: string | null;
  }>(
    `select t.name, t.current_start, t.current_end, t.actual_start, t.actual_end,
            t.status::text, t.confirmation, t.confirmed_at, cf.display_name as confirmed_by,
            t.counter_start, t.counter_end, cb.display_name as counter_by, tr.name as trade_name
       from task t
       left join trade tr on tr.id = t.trade_id
       left join project_member cf on cf.id = t.confirmed_by
       left join project_member cb on cb.id = t.counter_by
      where t.project_id = $1
        and t.status <> 'entfallen'
        and t.current_start is not null
        and t.current_start <= $3::date
        and coalesce(t.current_end, t.current_start) >= $2::date
      order by t.current_start, t.sort_order`,
    [projectId, from, to],
  );

  return result.rows.map((row) => {
    const teile: string[] = [
      `Geplant ${datum(row.current_start)} bis ${datum(row.current_end ?? row.current_start)}`,
    ];
    if (row.actual_start !== null) {
      teile.push(
        `tatsächlich ab ${datum(row.actual_start)}${row.actual_end === null ? '' : ` bis ${datum(row.actual_end)}`}`,
      );
    }
    if (row.confirmation === 'mutual' && row.confirmed_at !== null) {
      teile.push(
        `abgestimmt am ${datum(tag(row.confirmed_at))}${row.confirmed_by === null ? '' : ` mit ${row.confirmed_by}`}`,
      );
    }
    if (row.confirmation === 'disputed' && row.counter_start !== null) {
      teile.push(
        `abweichende Angabe ${datum(row.counter_start)} bis ${datum(row.counter_end ?? row.counter_start)}` +
          `${row.counter_by === null ? '' : ` von ${row.counter_by}`}`,
      );
    }

    return {
      on: row.current_start,
      // Für die Sortierung: der Beginn des Vorgangs, nicht die Erfassung.
      at: `${row.current_start}T00:00:00.000Z`,
      kind: 'vorgang' as const,
      title: row.name,
      detail: teile.join(' · '),
      actor: row.trade_name,
      actorRole: null,
      channel: null,
      confirmation: row.confirmation,
      hash: null,
    };
  });
}

/**
 * Was sich am Terminplan geändert hat — und wer es gesagt hat.
 *
 * Ohne `planinitialisierung`: Beim Anlegen des Plans schreibt der Trigger für
 * jeden Vorgang einen Eintrag „— → Termin". Das sind auf einen Schlag über
 * dreißig Zeilen, die alle dasselbe sagen wie die Vorgänge selbst. Eine
 * Chronik, in der die ersten drei Seiten aus einem einzigen Klick bestehen,
 * liest niemand bis zur vierten.
 */
async function verschiebungen(
  tx: Tx,
  projectId: string,
  from: string,
  to: string,
): Promise<DossierEntry[]> {
  const result = await tx.query<{
    created_at: Date;
    task_name: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
    reason_code: string | null;
    reason_text: string | null;
    effect_days_on_completion: number | null;
    actor_role: DossierEntry['actorRole'];
    actor_channel: string;
    actor_name: string | null;
  }>(
    `select c.created_at, t.name as task_name, c.field, c.old_value, c.new_value,
            c.reason_code::text, c.reason_text, c.effect_days_on_completion,
            c.actor_role, c.actor_channel::text, m.display_name as actor_name
       from schedule_change c
       join task t on t.id = c.task_id
       left join project_member m on m.id = c.actor_member_id
      where c.project_id = $1
        and c.created_at >= $2::date
        and c.created_at < ($3::date + 1)
        and c.field in ('current_start', 'current_end', 'counter_proposal', 'confirmation', 'status')
        and c.reason_code is distinct from 'planinitialisierung'
      order by c.created_at`,
    [projectId, from, to],
  );

  return result.rows.map((row) => {
    const abstimmung = row.field === 'confirmation' || row.field === 'counter_proposal';
    const wirkung =
      row.effect_days_on_completion === null || row.effect_days_on_completion === 0
        ? null
        : `${row.effect_days_on_completion > 0 ? '+' : ''}${row.effect_days_on_completion} Werktage auf den Endtermin`;

    return {
      on: tag(row.created_at),
      at: iso(row.created_at),
      kind: abstimmung ? ('abstimmung' as const) : ('verschiebung' as const),
      title: row.task_name,
      detail: [
        beschreibeAenderung(row.field, row.old_value, row.new_value),
        row.reason_code === null ? null : (REASON_LABEL[row.reason_code] ?? row.reason_code),
        row.reason_text,
        wirkung,
      ]
        .filter(Boolean)
        .join(' · '),
      actor: row.actor_name,
      actorRole: row.actor_role,
      channel: CHANNEL_LABEL[row.actor_channel] ?? row.actor_channel,
      confirmation: null,
      hash: null,
    };
  });
}

function beschreibeAenderung(field: string, alt: unknown, neu: unknown): string {
  if (field === 'counter_proposal') {
    const wert = neu as { start?: string | null; end?: string | null } | null;
    return wert?.start == null
      ? 'Abweichende Angabe zurückgenommen'
      : `Abweichende Angabe: ${datum(wert.start)} bis ${datum(wert.end ?? wert.start)}`;
  }
  if (field === 'confirmation') return 'Termin beidseitig bestätigt';
  if (field === 'status') {
    const wort = (wert: unknown): string =>
      wert === null || wert === undefined
        ? '—'
        : (TASK_STATUS_LABEL[String(wert)] ?? String(wert));
    return `Zustand ${wort(alt)} → ${wort(neu)}`;
  }
  const name = field === 'current_start' ? 'Beginn' : 'Ende';
  return `${name} ${datum(alt === null ? null : String(alt))} → ${datum(neu === null ? null : String(neu))}`;
}

async function tagebuch(
  tx: Tx,
  projectId: string,
  from: string,
  to: string,
): Promise<DossierEntry[]> {
  const result = await tx.query<{
    entry_date: string;
    created_at: Date;
    body: string;
    author: string | null;
    author_role: DossierEntry['actorRole'];
    content_hash: string | null;
    retracted_at: Date | null;
    retraction_reason: string | null;
    weather: { temperatureMinC: number | null; temperatureMaxC: number | null } | null;
  }>(
    `select e.entry_date, e.created_at, e.body, m.display_name as author, e.author_role,
            e.content_hash, e.retracted_at, e.retraction_reason, e.weather
       from diary_entry e
       left join project_member m on m.id = e.author_member_id
      where e.project_id = $1 and e.entry_date between $2::date and $3::date
      order by e.entry_date, e.created_at`,
    [projectId, from, to],
  );

  return result.rows.map((row) => ({
    on: row.entry_date,
    at: `${row.entry_date}T12:00:00.000Z`,
    kind: 'tagebuch' as const,
    title: row.retracted_at === null ? 'Tagebuch' : 'Tagebuch (zurückgezogen)',
    detail: [
      row.body,
      row.retraction_reason === null ? null : `Zurückgezogen: ${row.retraction_reason}`,
      row.weather?.temperatureMinC == null
        ? null
        : `${Math.round(row.weather.temperatureMinC)} bis ${Math.round(row.weather.temperatureMaxC ?? row.weather.temperatureMinC)} °C`,
    ]
      .filter(Boolean)
      .join(' · '),
    actor: row.author,
    actorRole: row.author_role,
    channel: null,
    confirmation: null,
    hash: row.content_hash,
  }));
}

async function maengel(
  tx: Tx,
  projectId: string,
  from: string,
  to: string,
): Promise<DossierEntry[]> {
  const result = await tx.query<{
    reported_at: Date;
    title: string;
    description: string | null;
    location_text: string | null;
    severity: string;
    status: string;
    deadline: string | null;
    resolved_at: Date | null;
    reported_by: string | null;
  }>(
    `select d.reported_at, d.title, d.description, d.location_text, d.severity::text,
            d.status::text, d.deadline, d.resolved_at, m.display_name as reported_by
       from defect d
       left join project_member m on m.id = d.reported_by
      where d.project_id = $1
        and d.reported_at >= $2::date and d.reported_at < ($3::date + 1)
      order by d.reported_at`,
    [projectId, from, to],
  );

  return result.rows.map((row) => ({
    on: tag(row.reported_at),
    at: iso(row.reported_at),
    kind: 'mangel' as const,
    title: `Mangel: ${row.title}`,
    detail: [
      row.severity === 'wesentlich' ? 'wesentlich' : 'geringfügig',
      row.location_text,
      row.description,
      row.deadline === null ? null : `Frist ${datum(row.deadline)}`,
      row.resolved_at === null
        ? `Zustand: ${DEFECT_STATUS_LABEL[row.status] ?? row.status}`
        : `behoben am ${datum(tag(row.resolved_at))}`,
    ]
      .filter(Boolean)
      .join(' · '),
    actor: row.reported_by,
    actorRole: null,
    channel: null,
    confirmation: null,
    hash: null,
  }));
}

async function zahlungen(
  tx: Tx,
  projectId: string,
  from: string,
  to: string,
): Promise<DossierEntry[]> {
  const result = await tx.query<{
    name: string;
    amount_cents: number;
    status: string;
    released_at: Date | null;
    released_by: string | null;
    withheld_cents: number;
    withheld_reason: string | null;
    paid_at: string | null;
  }>(
    `select p.name, p.amount_cents, p.status::text, p.released_at,
            coalesce(rb.display_name, rb.email) as released_by,
            p.withheld_cents, p.withheld_reason, p.paid_at
       from payment_milestone p
       left join project_member rb on rb.id = p.released_by
      where p.project_id = $1
        and p.released_at is not null
        and p.released_at >= $2::date and p.released_at < ($3::date + 1)
      order by p.released_at`,
    [projectId, from, to],
  );

  return result.rows.map((row) => ({
    on: tag(row.released_at!),
    at: iso(row.released_at!),
    kind: 'zahlung' as const,
    title: `${row.name} freigegeben`,
    detail: [
      `${(row.amount_cents / 100).toFixed(2)} €`,
      row.withheld_cents > 0
        ? `davon ${(row.withheld_cents / 100).toFixed(2)} € einbehalten${row.withheld_reason === null ? '' : `: ${row.withheld_reason}`}`
        : null,
      row.paid_at === null ? null : `bezahlt am ${datum(row.paid_at)}`,
    ]
      .filter(Boolean)
      .join(' · '),
    actor: row.released_by,
    actorRole: null,
    channel: null,
    confirmation: null,
    hash: null,
  }));
}

async function entscheidungen(
  tx: Tx,
  projectId: string,
  from: string,
  to: string,
): Promise<DossierEntry[]> {
  const result = await tx.query<{
    title: string;
    decided_at: Date;
    decided_note: string | null;
    status: string;
  }>(
    `select title, decided_at, decided_note, status::text
       from decision
      where project_id = $1
        and decided_at is not null
        and decided_at >= $2::date and decided_at < ($3::date + 1)
      order by decided_at`,
    [projectId, from, to],
  );

  return result.rows.map((row) => ({
    on: tag(row.decided_at),
    at: iso(row.decided_at),
    kind: 'entscheidung' as const,
    title: `Entschieden: ${row.title}`,
    detail: row.decided_note,
    actor: null,
    actorRole: null,
    channel: null,
    confirmation: null,
    hash: null,
  }));
}

async function medienImZeitraum(
  tx: Tx,
  projectId: string,
  from: string,
  to: string,
): Promise<MediaDto[]> {
  const result = await tx.query<{
    id: string;
    storage_path: string;
    mime: string;
    bytes: number;
    sha256: string;
    exif_taken_at: Date | null;
    exif_lat: string | null;
    exif_lon: string | null;
    captured_at: Date | null;
    stated_date: string | null;
    task_id: string | null;
    task_name: string | null;
    photo_prompt_key: string | null;
    caption: string | null;
    created_at: Date;
  }>(
    `select m.id, m.storage_path, m.mime, m.bytes, m.sha256, m.exif_taken_at, m.exif_lat,
            m.exif_lon, m.captured_at, m.stated_date, m.task_id, t.name as task_name,
            m.photo_prompt_key, m.caption, m.created_at
       from media m
       left join task t on t.id = m.task_id
      where m.project_id = $1
        and coalesce(m.stated_date, m.captured_at::date, m.created_at::date)
              between $2::date and $3::date
      order by coalesce(m.captured_at, m.exif_taken_at, m.created_at)`,
    [projectId, from, to],
  );

  return result.rows.map((row) => ({
    id: row.id,
    storagePath: row.storage_path,
    mime: row.mime,
    bytes: row.bytes,
    sha256: row.sha256,
    exifTakenAt: row.exif_taken_at === null ? null : iso(row.exif_taken_at),
    exifLat: row.exif_lat === null ? null : Number(row.exif_lat),
    exifLon: row.exif_lon === null ? null : Number(row.exif_lon),
    capturedAt: row.captured_at === null ? null : iso(row.captured_at),
    statedDate: row.stated_date,
    taskId: row.task_id,
    taskName: row.task_name,
    photoPromptKey: row.photo_prompt_key,
    caption: row.caption,
    createdAt: iso(row.created_at),
  }));
}

/**
 * Der vollständige Datenexport (Abschnitt 6.5).
 *
 *     „Vollständiger Datenexport und Löschung als Selbstbedienung."
 *
 * Bewusst roh und ohne Aufbereitung: Die Bauakte ist die lesbare Fassung, das
 * hier ist die vollständige. Wer seine Daten mitnimmt, soll sie bekommen, wie
 * sie liegen — auch die Spalten, die keine Ansicht je zeigt.
 *
 * Was **nicht** darin steht, ist der Klartext der Gast-Token: Er existiert
 * nirgends mehr, auch nicht für uns. Der Hash steht drin, und der ist wertlos
 * für alles außer dem Nachvollziehen, dass es diesen Link gab.
 */
export async function exportProject(tx: Tx, projectId: string): Promise<Record<string, unknown>> {
  const tabellen = [
    'project',
    'project_member',
    'task',
    'dependency',
    'schedule_change',
    'decision',
    'diary_entry',
    'media',
    'checklist_item',
    'guide_card_read',
    'guest_token',
    'defect',
    'change_order',
    'payment_milestone',
    'financing',
    'loan_drawdown',
    'contract_check',
    'audit_log',
  ] as const;

  const inhalt: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    note:
      'Vollständiger Datenexport nach Abschnitt 6.5. Enthält alles, was zu diesem ' +
      'Bauvorhaben gespeichert ist — auch Felder, die keine Ansicht zeigt. Der Klartext ' +
      'von Gast-Links steht nicht darin; er existiert nirgends mehr.',
  };

  for (const tabelle of tabellen) {
    // `project` heißt in seiner eigenen Tabelle `id`, überall sonst `project_id`.
    const spalte = tabelle === 'project' ? 'id' : 'project_id';
    const result = await tx.query(
      `select * from ${tabelle} where ${spalte} = $1`,
      [projectId],
    );
    inhalt[tabelle] = result.rows;
  }

  return inhalt;
}

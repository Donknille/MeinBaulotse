/**
 * Gast-Zugang und Terminabstimmung (Arbeitspaket 6).
 *
 * Der Gast-Zugang ist die Antwort auf Leitsatz 1.6.2: „Das Produkt
 * funktioniert allein. Keine Funktion darf die Mitwirkung des GU
 * voraussetzen." Ein Bauleiter, der ein Konto anlegen soll, um einen Termin
 * zu bestätigen, bestätigt keinen Termin — und damit stünde der ganze
 * Bestätigungsgrad aus Abschnitt 3.4 auf dem Papier.
 *
 * Drei Dinge sind hier wichtiger als der Rest:
 *
 * 1. **Der Token steht nur im Link.** In der Datenbank liegt sein Hash. Wer
 *    die Datenbank liest, kann damit keinen Zugang bauen.
 * 2. **Ein Gegenvorschlag ist keine Terminänderung.** Er wird festgehalten,
 *    nicht ausgeführt: Der Plan gehört dem Bauherrn. Widerspricht die
 *    Gegenseite, entstehen zwei Angaben — entscheiden muss ein Mensch.
 * 3. **Der Kanal steht in jeder Spur.** Was über einen Gast-Link kommt, trägt
 *    `guest_link` in Historie und Protokoll. Später ist der Unterschied
 *    zwischen „der Bauherr hat es eingetragen" und „der GU hat bestätigt"
 *    genau die Frage, um die es geht.
 */

import { createHash, randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { withUserTx, type JwtClaims, type Transaction } from '@meinbaulotse/db';
import type {
  ConfirmationLevel,
  GuestSession,
  GuestTaskView,
  GuestTokenCreated,
} from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

/** Der Link trägt dieses Präfix, damit er in Protokollen erkennbar ist. */
const PREFIX = 'mblg_';

/** Wie viele Zugriffe je Token in einer Minute (Abschnitt 2.3, Ratenbegrenzung). */
const LIMIT_PRO_MINUTE = 30;

export function isGuestToken(value: string): boolean {
  return value.startsWith(PREFIX);
}

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface GuestContext {
  tokenId: string;
  projectId: string;
  memberId: string;
  role: string;
  displayName: string | null;
  scopes: string[];
  locale: string;
}

/**
 * Löst einen Gast-Token auf — der einzige Zugriff, der ohne Mitgliedschaft
 * auskommen muss.
 *
 * Läuft über eine `security definer`-Funktion in der Datenbank, nicht über
 * eine privilegierte Rolle: Sie gibt nur zu einem gültigen Hash etwas heraus
 * und ist damit kein Schlüssel, sondern ein Schloss.
 */
export async function resolveGuestToken(token: string): Promise<GuestContext> {
  const hash = hashOf(token);

  const kontext = await withUserTx({} as JwtClaims, async (tx) => {
    const result = await tx.query<{
      token_id: string;
      project_id: string;
      member_id: string;
      role: string;
      display_name: string | null;
      scopes: string[];
      locale: string;
      zu_oft: boolean;
    }>('select * from mbl.use_guest_token($1, $2)', [hash, LIMIT_PRO_MINUTE]);
    return result.rows[0] ?? null;
  });

  if (kontext === null) {
    // Abgelaufen, gesperrt oder erfunden — von außen dasselbe. Ein
    // unterschiedlicher Text verriete, welche Links es gibt.
    throw new HTTPException(401, {
      message: 'Dieser Link gilt nicht mehr.',
      cause: {
        hint: 'Bitte den Bauherrn um einen neuen Link. Links laufen nach 180 Tagen ab.',
      },
    });
  }

  if (kontext.zu_oft) {
    throw new HTTPException(429, {
      message: 'Das waren gerade sehr viele Aufrufe. Versuch es in einer Minute noch einmal.',
    });
  }

  return {
    tokenId: kontext.token_id,
    projectId: kontext.project_id,
    memberId: kontext.member_id,
    role: kontext.role,
    displayName: kontext.display_name,
    scopes: kontext.scopes,
    locale: kontext.locale,
  };
}

/** Die Claims, unter denen ein Gast in der Datenbank arbeitet. */
export function claimsFor(kontext: GuestContext): JwtClaims {
  // Kein `sub`: Ein Gast hat kein Konto. `mbl_token` ist der ganze Ausweis,
  // und die Datenbank prüft ihn bei jedem Zugriff erneut.
  return { mbl_token: kontext.tokenId } as unknown as JwtClaims;
}

/**
 * Einen Link anlegen.
 *
 * Der Token wird genau einmal zurückgegeben — danach steht in der Datenbank
 * nur noch sein Hash. Wer ihn verliert, bekommt einen neuen; wer ihn hat,
 * kommt hinein.
 */
export async function createGuestToken(
  tx: Tx,
  projectId: string,
  memberId: string,
  options: { scopes?: string[]; locale?: string; sentTo?: string; expiresInDays?: number },
): Promise<GuestTokenCreated> {
  const mitglied = await tx.query<{ role: string; display_name: string | null }>(
    `select role::text as role, display_name from project_member
      where id = $1 and project_id = $2 and revoked_at is null`,
    [memberId, projectId],
  );
  const person = mitglied.rows[0];
  if (person === undefined) {
    throw new HTTPException(404, { message: 'Dieses Mitglied gibt es in dem Bauvorhaben nicht.' });
  }

  // Was der Gast darf, folgt aus seiner Rolle — nicht aus dem, was der
  // Einladende gerade eintippt (Abschnitt 2.3).
  const scopes =
    options.scopes ??
    (person.role === 'trade'
      ? ['confirm:task', 'report:progress', 'view:trade']
      : person.role === 'contractor'
        ? ['confirm:task', 'report:progress', 'view:project']
        : ['view:project']);

  const token = `${PREFIX}${randomBytes(32).toString('base64url')}`;

  const inserted = await tx.query<{ id: string; expires_at: string }>(
    `insert into guest_token
       (project_id, member_id, token_hash, scopes, locale, sent_to, expires_at, created_by)
     values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7), mbl.current_member_id($1))
     returning id, expires_at`,
    [
      projectId,
      memberId,
      hashOf(token),
      scopes,
      options.locale ?? 'de',
      options.sentTo ?? null,
      options.expiresInDays ?? 180,
    ],
  );

  await tx.query(
    `insert into audit_log (project_id, actor_member_id, actor_channel, action, entity_type, entity_id, meta)
     values ($1, mbl.current_member_id($1), 'app', 'guest_token.created', 'project_member', $2, $3)`,
    [projectId, memberId, JSON.stringify({ scopes, locale: options.locale ?? 'de' })],
  );

  return {
    id: inserted.rows[0]!.id,
    token,
    memberId,
    displayName: person.display_name,
    role: person.role as GuestTokenCreated['role'],
    scopes,
    expiresAt: new Date(inserted.rows[0]!.expires_at).toISOString(),
  };
}

export async function revokeGuestToken(tx: Tx, projectId: string, tokenId: string): Promise<void> {
  const result = await tx.query(
    'update guest_token set revoked_at = now() where id = $1 and project_id = $2 and revoked_at is null',
    [tokenId, projectId],
  );
  if (result.rowCount === 0) {
    throw new HTTPException(404, { message: 'Diesen Link gibt es nicht oder er ist schon gesperrt.' });
  }
}

/**
 * Was der Gast sieht.
 *
 * Ein Einzelgewerk sieht nur seine eigenen Vorgänge — das entscheidet die
 * RLS, nicht diese Abfrage. Hier steht nur, was davon auf die Seite kommt.
 */
export async function guestView(tx: Tx, kontext: GuestContext): Promise<GuestSession> {
  const projekt = await tx.query<{ name: string; address: string | null }>(
    'select name, address from project where id = $1',
    [kontext.projectId],
  );
  const kopf = projekt.rows[0];
  if (kopf === undefined) {
    throw new HTTPException(404, { message: 'Dieses Bauvorhaben gibt es nicht.' });
  }

  const tasks = await tx.query<{
    id: string;
    name: string;
    trade_name: string | null;
    current_start: string | null;
    current_end: string | null;
    confirmation: ConfirmationLevel;
    status: string;
    is_wait: boolean;
    meine_rueckmeldung: string | null;
  }>(
    `select t.id, t.name, tr.name as trade_name, t.current_start, t.current_end,
            t.confirmation, t.status::text as status, t.is_wait,
            (select c.action::text from task_confirmation c
              where c.task_id = t.id and c.member_id = $2
              order by c.created_at desc limit 1) as meine_rueckmeldung
       from task t
       left join trade tr on tr.id = t.trade_id
      where t.project_id = $1
        and t.status not in ('entfallen','abgenommen')
        and t.current_end >= current_date - 30
      order by t.current_start, t.sort_order
      limit 40`,
    [kontext.projectId, kontext.memberId],
  );

  return {
    projectName: kopf.name,
    displayName: kontext.displayName,
    role: kontext.role as GuestSession['role'],
    scopes: kontext.scopes,
    locale: kontext.locale as GuestSession['locale'],
    tasks: tasks.rows.map<GuestTaskView>((row) => ({
      id: row.id,
      name: row.name,
      tradeName: row.trade_name,
      start: row.current_start,
      end: row.current_end,
      confirmation: row.confirmation,
      isWait: row.is_wait,
      myAnswer:
        row.meine_rueckmeldung === null
          ? null
          : (row.meine_rueckmeldung as 'bestaetigt' | 'gegenvorschlag'),
    })),
  };
}

/**
 * „Passt das?" — die Antwort.
 *
 * Bei Zustimmung wird der Bestätigungsgrad auf `mutual` gehoben: Beide Seiten
 * haben denselben Termin genannt. Bei einem Gegenvorschlag entstehen zwei
 * Angaben (`disputed`), und der Vorschlag landet in der Historie — der Termin
 * selbst bleibt, wie er ist.
 */
export async function answerTask(
  tx: Tx,
  kontext: GuestContext,
  taskId: string,
  antwort: { agree: true } | { agree: false; start: string; end?: string; note?: string },
): Promise<GuestTaskView> {
  const vorgang = await tx.query<{
    id: string;
    name: string;
    trade_name: string | null;
    current_start: string | null;
    current_end: string | null;
    is_wait: boolean;
  }>(
    `select t.id, t.name, tr.name as trade_name, t.current_start, t.current_end, t.is_wait
       from task t left join trade tr on tr.id = t.trade_id
      where t.id = $1 and t.project_id = $2`,
    [taskId, kontext.projectId],
  );
  const head = vorgang.rows[0];
  if (head === undefined) {
    throw new HTTPException(404, { message: 'Diesen Vorgang gibt es hier nicht.' });
  }

  const naechsterGrad: ConfirmationLevel = antwort.agree ? 'mutual' : 'disputed';

  await tx.query(
    `insert into task_confirmation
       (project_id, task_id, member_id, action, stated_start, stated_end,
        proposed_start, proposed_end, note, actor_channel)
     values ($1,$2,$3,$4::mbl.confirmation_action,$5,$6,$7,$8,$9,'guest_link')`,
    [
      kontext.projectId,
      taskId,
      kontext.memberId,
      antwort.agree ? 'bestaetigt' : 'gegenvorschlag',
      head.current_start,
      head.current_end,
      antwort.agree ? null : antwort.start,
      antwort.agree ? null : (antwort.end ?? null),
      antwort.agree ? null : (antwort.note ?? null),
    ],
  );

  await tx.query(
    `update task set confirmation = $2::mbl.confirmation,
                     confirmed_by = $3, confirmed_at = now()
      where id = $1`,
    [taskId, naechsterGrad, kontext.memberId],
  );

  // Der Gegenvorschlag gehört in die Historie — nicht in den Plan. Das Feld
  // heißt deshalb `proposed_start` und nicht `current_start`: Es ist eine
  // Aussage, keine Änderung.
  if (!antwort.agree) {
    await tx.query(
      `insert into schedule_change
         (project_id, task_id, field, old_value, new_value, actor_member_id,
          actor_role, actor_channel, reason_code, reason_text)
       values ($1, $2, 'proposed_start', to_jsonb($3::text), to_jsonb($4::text), $5,
               $6::mbl.member_role, 'guest_link', 'kapazitaet', $7)`,
      [
        kontext.projectId,
        taskId,
        head.current_start,
        antwort.start,
        kontext.memberId,
        kontext.role,
        antwort.note ?? 'Gegenvorschlag über den Abstimmungslink.',
      ],
    );
  }

  await tx.query(
    `insert into audit_log (project_id, actor_member_id, actor_channel, action, entity_type, entity_id)
     values ($1, $2, 'guest_link', $3, 'task', $4)`,
    [
      kontext.projectId,
      kontext.memberId,
      antwort.agree ? 'task.confirmed' : 'task.disputed',
      taskId,
    ],
  );

  return {
    id: head.id,
    name: head.name,
    tradeName: head.trade_name,
    start: head.current_start,
    end: head.current_end,
    confirmation: naechsterGrad,
    isWait: head.is_wait,
    myAnswer: antwort.agree ? 'bestaetigt' : 'gegenvorschlag',
  };
}

/**
 * Abstimmung ohne Konto — Abschnitt 2.3 und 5.5.
 *
 * Der Polier bekommt einen Link, tippt einmal und ist fertig. Alles, was
 * dieses Modul tut, dient dieser einen Bewegung.
 *
 * **Der Token steht im Anfragekörper, nie in der Adresse.** Abschnitt 6.4
 * verbietet personenbezogene Daten in URLs, und ein Zugangstoken ist mehr als
 * das: Er landet in Server-Protokollen, im Verlauf des Browsers und in jedem
 * Referrer, den die Seite auslöst. Der Link, den der Gast bekommt, trägt ihn
 * deshalb im **Fragment** — `…/abstimmung#<token>`. Fragmente sendet kein
 * Browser an einen Server; die Anwendung liest ihn aus `location.hash` und
 * schickt ihn im Körper weiter.
 *
 * **Gespeichert wird nur der Hash.** Der Klartext verlässt den Server genau
 * einmal, beim Anlegen. Wer die Datenbank liest — auch der Eigentümer im
 * SQL-Editor —, kann daraus keinen Link bauen.
 *
 * **Die Rechteprüfung ist dieselbe wie überall.** `withGuestTx` hinterlegt den
 * Hash, `mbl.current_member_id` löst daraus die Mitgliedschaft auf, und ab da
 * greift jede Policy unverändert. Hier wird nichts geprüft, was eine Policy
 * prüfen kann — mit einer Ausnahme, die keine Rechtefrage ist: die
 * Ratenbegrenzung.
 */

import { createHash, randomBytes } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import type { Transaction } from '@meinbaulotse/db';
import type {
  GuestCounterRequest,
  GuestLinkCreateRequest,
  GuestLinkSummary,
  GuestProgressRequest,
  GuestTask,
  GuestView,
} from '@meinbaulotse/shared';

type Tx = Pick<Transaction, 'query'>;

/**
 * 32 Byte Zufall, base64url.
 *
 * Nicht als UUID: Eine UUID v4 trägt 122 Bit und sieht aus wie eine Kennung,
 * die man irgendwo nachschlagen könnte. Das hier ist ein Schlüssel, und er
 * soll auch so aussehen.
 */
export function newGuestToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Ein Streuwert der Herkunft, kein Klartext.
 *
 * Abschnitt 6.5: Das Protokoll soll beantworten, ob derselbe Link plötzlich
 * von woanders benutzt wird — nicht, wo jemand wohnt. Ein Streuwert kann das
 * eine und nicht das andere.
 */
export function traceHash(value: string | undefined): string | null {
  if (value === undefined || value === '') return null;
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// Die Sicht des Gastes
// ---------------------------------------------------------------------------

interface GuestSession {
  projectId: string;
  memberId: string;
  locale: GuestView['locale'];
  scopes: GuestView['scopes'];
}

/**
 * Zählt die Benutzung, begrenzt die Rate und protokolliert sie — in einem
 * Schritt, weil alle drei zusammengehören.
 *
 * Wirft 401, wenn der Token nichts auflöst: abgelaufen, zurückgezogen oder
 * erfunden. Von außen ist das dasselbe, und das ist richtig so — ein
 * unterschiedlicher Fehler wäre die Auskunft, dass es diesen Link gab.
 */
export async function openGuestSession(
  tx: Tx,
  trace: { ipHash: string | null; userAgentHash: string | null },
): Promise<GuestSession> {
  const result = await tx.query<{
    allowed: boolean;
    project_id: string;
    member_id: string;
    locale: GuestView['locale'];
    scopes: GuestView['scopes'];
  }>('select * from mbl.use_guest_token($1, $2)', [trace.ipHash, trace.userAgentHash]);

  const zeile = result.rows[0];
  if (zeile === undefined) {
    throw new HTTPException(401, {
      message: 'Dieser Link gilt nicht mehr. Frag bitte beim Bauherrn nach einem neuen.',
    });
  }
  if (!zeile.allowed) {
    throw new HTTPException(429, {
      message: 'Das war eben viel auf einmal. Versuch es in einer Minute noch einmal.',
    });
  }

  return {
    projectId: zeile.project_id,
    memberId: zeile.member_id,
    locale: zeile.locale,
    scopes: zeile.scopes,
  };
}

/** „Erste Nutzung erfasst optional Name und Firma" (Abschnitt 2.3). */
export async function introduceGuest(
  tx: Tx,
  name: string | undefined,
  company: string | undefined,
): Promise<void> {
  if (name === undefined && company === undefined) return;
  await tx.query('select mbl.claim_guest_token($1, $2)', [name ?? null, company ?? null]);
}

interface GuestTaskRow {
  id: string;
  name: string;
  trade_name: string | null;
  current_start: string | null;
  current_end: string | null;
  status: GuestTask['status'];
  confirmation: GuestTask['confirmation'];
  counter_start: string | null;
  counter_end: string | null;
  counter_note: string | null;
  counter_by: string | null;
  actual_start: string | null;
  actual_end: string | null;
}

export async function loadGuestView(tx: Tx, session: GuestSession): Promise<GuestView> {
  const kopf = await tx.query<{
    project_name: string;
    address: string | null;
    city: string | null;
    display_name: string | null;
    company: string | null;
    role: GuestView['role'];
    claimed_at: string | null;
    expires_at: string;
    can_confirm: boolean;
  }>(
    `select p.name as project_name, p.address, p.city,
            m.display_name, m.company, m.role,
            t.claimed_at, t.expires_at,
            mbl.has_perm(p.id, 'task.confirm') as can_confirm
       from project p
       join project_member m on m.id = $2
       join guest_token t on t.id = mbl.guest_token_id()
      where p.id = $1`,
    [session.projectId, session.memberId],
  );
  const zeile = kopf.rows[0];
  if (zeile === undefined) {
    throw new HTTPException(401, { message: 'Dieser Link gilt nicht mehr.' });
  }

  // Die Zeilenschärfe kommt aus der Policy, nicht von hier: Ein Einzelgewerk
  // sieht nur seine eigenen Vorgänge, weil `task_select` das so entscheidet.
  // Diese Abfrage stellt keine zweite Frage nach Rechten.
  const vorgaenge = await tx.query<GuestTaskRow>(
    `select t.id, t.name, tr.name as trade_name, t.current_start, t.current_end,
            t.status, t.confirmation, t.counter_start, t.counter_end, t.counter_note,
            cb.display_name as counter_by, t.actual_start, t.actual_end
       from task t
       left join trade tr on tr.id = t.trade_id
       left join project_member cb on cb.id = t.counter_by
      where t.project_id = $1
        and t.status <> 'entfallen'
      order by t.current_start nulls last, t.sort_order`,
    [session.projectId],
  );

  return {
    projectName: zeile.project_name,
    siteLine: [zeile.address, zeile.city].filter(Boolean).join(', ') || null,
    memberName: zeile.display_name,
    company: zeile.company,
    role: zeile.role,
    locale: session.locale,
    scopes: session.scopes,
    needsIntroduction: zeile.claimed_at === null,
    expiresAt: zeile.expires_at,
    tasks: vorgaenge.rows.map((row) => ({
      id: row.id,
      name: row.name,
      tradeName: row.trade_name,
      start: row.current_start,
      end: row.current_end,
      status: row.status,
      confirmation: row.confirmation,
      counterStart: row.counter_start,
      counterEnd: row.counter_end,
      counterNote: row.counter_note,
      counterBy: row.counter_by,
      actualStart: row.actual_start,
      actualEnd: row.actual_end,
      // Bestätigen kann nur, wer nicht selbst zuletzt gesprochen hat. Der
      // Trigger `mbl.guard_confirmation` weist das Gegenteil ab; hier steht
      // dieselbe Regel als Auskunft, damit der Knopf gar nicht erst erscheint.
      canConfirm:
        zeile.can_confirm &&
        (row.confirmation === 'self_stated' || row.confirmation === 'disputed'),
    })),
  };
}

// ---------------------------------------------------------------------------
// Die drei Knöpfe
// ---------------------------------------------------------------------------

/** „Passt." */
export async function confirmTask(
  tx: Tx,
  session: GuestSession,
  taskId: string,
): Promise<GuestView> {
  const result = await tx
    .query(
      `update task
          set confirmation = 'mutual',
              confirmed_by = mbl.current_member_id(project_id),
              confirmed_at = now(),
              -- Ein bestätigter Termin räumt den Gegenvorschlag ab: Wer
              -- zustimmt, hat seinen eigenen Einwand zurückgenommen.
              counter_start = null, counter_end = null,
              counter_by = null, counter_at = null, counter_note = null
        where id = $1 and project_id = $2`,
      [taskId, session.projectId],
    )
    .catch(translate);

  if (result.rowCount === 0) {
    throw new HTTPException(404, { message: 'Diesen Vorgang gibt es hier nicht.' });
  }
  return loadGuestView(tx, session);
}

/**
 * „Anderer Termin."
 *
 * Der Gegenvorschlag überschreibt den Termin **nicht**. Das ist der ganze
 * Unterschied zwischen „zwei Angaben" und „der GU hat den Termin geändert":
 * Solange beide dastehen, entscheidet der Bauherr, welcher gilt. Überschriebe
 * der GU, hätte er entschieden — und der Bauherr erführe es aus dem Plan
 * statt aus einem Gespräch.
 */
export async function counterProposeTask(
  tx: Tx,
  session: GuestSession,
  taskId: string,
  vorschlag: GuestCounterRequest,
): Promise<GuestView> {
  if (vorschlag.end < vorschlag.start) {
    throw new HTTPException(422, { message: 'Das Ende liegt vor dem Beginn.' });
  }

  const result = await tx
    .query(
      `update task
          set counter_start = $3::date,
              counter_end   = $4::date,
              counter_note  = $5,
              counter_by    = mbl.current_member_id(project_id),
              counter_at    = now(),
              confirmation  = 'disputed'
        where id = $1 and project_id = $2`,
      [taskId, session.projectId, vorschlag.start, vorschlag.end, vorschlag.note ?? null],
    )
    .catch(translate);

  if (result.rowCount === 0) {
    throw new HTTPException(404, { message: 'Diesen Vorgang gibt es hier nicht.' });
  }
  return loadGuestView(tx, session);
}

/** „Ist-Beginn und Ist-Ende melden" — der Scope `report:progress`. */
export async function reportProgress(
  tx: Tx,
  session: GuestSession,
  taskId: string,
  meldung: GuestProgressRequest,
): Promise<GuestView> {
  const felder: string[] = [];
  const werte: unknown[] = [taskId, session.projectId];
  const setze = (spalte: string, wert: unknown): void => {
    werte.push(wert);
    felder.push(`${spalte} = $${werte.length}::date`);
  };
  if (meldung.actualStart !== undefined) setze('actual_start', meldung.actualStart);
  if (meldung.actualEnd !== undefined) setze('actual_end', meldung.actualEnd);
  if (felder.length === 0) return loadGuestView(tx, session);

  const result = await tx
    .query(
      `update task set ${felder.join(', ')} where id = $1 and project_id = $2`,
      werte,
    )
    .catch(translate);

  if (result.rowCount === 0) {
    throw new HTTPException(404, { message: 'Diesen Vorgang gibt es hier nicht.' });
  }
  return loadGuestView(tx, session);
}

// ---------------------------------------------------------------------------
// Links verwalten — die Bauherrenseite
// ---------------------------------------------------------------------------

export async function listGuestLinks(tx: Tx, projectId: string): Promise<GuestLinkSummary[]> {
  const result = await tx.query<{
    id: string;
    member_id: string;
    display_name: string | null;
    company: string | null;
    role: GuestLinkSummary['role'];
    trade_name: string | null;
    scopes: GuestLinkSummary['scopes'];
    locale: GuestLinkSummary['locale'];
    bound_email: string | null;
    expires_at: string;
    last_used_at: string | null;
    use_count: number;
    claimed_name: string | null;
    revoked_at: string | null;
  }>(
    `select g.id, g.member_id, m.display_name, m.company, m.role, tr.name as trade_name,
            g.scopes, g.locale, g.bound_email, g.expires_at, g.last_used_at,
            g.use_count, g.claimed_name, g.revoked_at
       from guest_token g
       join project_member m on m.id = g.member_id
       left join trade tr on tr.id = m.trade_id
      where g.project_id = $1
      order by g.revoked_at nulls first, g.created_at desc`,
    [projectId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    memberId: row.member_id,
    displayName: row.display_name,
    company: row.company,
    role: row.role,
    tradeName: row.trade_name,
    scopes: row.scopes,
    locale: row.locale,
    boundEmail: row.bound_email,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    useCount: row.use_count,
    claimedName: row.claimed_name,
    revokedAt: row.revoked_at,
  }));
}

/**
 * Legt Mitgliedschaft und Link in einem Zug an.
 *
 * Zwei Schritte wären hier eine Falle: Wer die Mitgliedschaft anlegt und beim
 * Token scheitert, hinterlässt einen Beteiligten, der nie erreicht wird und
 * den niemand sucht. Beides in einer Transaktion, oder keines von beiden.
 */
export async function createGuestLink(
  tx: Tx,
  projectId: string,
  wunsch: GuestLinkCreateRequest,
  baseUrl: string,
): Promise<{ link: GuestLinkSummary; url: string }> {
  let tradeId: string | null = null;
  if (wunsch.tradeCode !== undefined) {
    const gewerk = await tx.query<{ id: string }>(
      `select id from trade
        where code = $2 and (project_id = $1 or project_id is null)
        order by project_id nulls last limit 1`,
      [projectId, wunsch.tradeCode],
    );
    tradeId = gewerk.rows[0]?.id ?? null;
  }
  if (wunsch.role === 'trade' && tradeId === null) {
    throw new HTTPException(422, {
      message: 'Ein Einzelgewerk braucht sein Gewerk — sonst sieht es alles oder nichts.',
    });
  }

  const mitglied = await tx
    .query<{ id: string }>(
      `insert into project_member
         (project_id, role, display_name, company, email, phone, trade_id, invited_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       returning id`,
      [
        projectId,
        wunsch.role,
        wunsch.displayName,
        wunsch.company ?? null,
        wunsch.email ?? null,
        wunsch.phone ?? null,
        tradeId,
      ],
    )
    .catch(translate);

  const token = newGuestToken();
  const angelegt = await tx
    .query<{ id: string }>(
      `insert into guest_token
         (project_id, member_id, token_hash, scopes, locale, bound_email, bound_phone,
          expires_at, created_by)
       values ($1, $2, $3, $4::text[], $5, $6, $7, now() + ($8 || ' days')::interval,
               mbl.current_member_id($1))
       returning id`,
      [
        projectId,
        mitglied.rows[0]!.id,
        hashGuestToken(token),
        wunsch.scopes,
        wunsch.locale,
        wunsch.email ?? null,
        wunsch.phone ?? null,
        String(wunsch.daysValid),
      ],
    )
    .catch(translate);

  const alle = await listGuestLinks(tx, projectId);
  const link = alle.find((eintrag) => eintrag.id === angelegt.rows[0]!.id)!;

  // Der Token im Fragment, nicht im Pfad: Fragmente sendet kein Browser an
  // einen Server. Er steht damit weder im Zugriffsprotokoll noch im Referrer.
  return { link, url: `${baseUrl}/abstimmung#${token}` };
}

export async function revokeGuestLink(
  tx: Tx,
  projectId: string,
  linkId: string,
): Promise<GuestLinkSummary[]> {
  const result = await tx.query(
    `update guest_token set revoked_at = now()
      where id = $1 and project_id = $2 and revoked_at is null`,
    [linkId, projectId],
  );
  if (result.rowCount === 0) {
    throw new HTTPException(404, { message: 'Diesen Link gibt es nicht mehr.' });
  }
  return listGuestLinks(tx, projectId);
}

// ---------------------------------------------------------------------------

/**
 * Die Ablehnung der Datenbank in eine Antwort übersetzen, die weiterhilft.
 *
 * Die Trigger aus 0012 sprechen in ganzen Sätzen — „Diesen Termin hat die
 * Bauherrenseite eingetragen. Bestätigen muss ihn das ausführende
 * Unternehmen." Der Satz ist für den Gast gedacht und wird deshalb
 * durchgereicht, statt hinter „Das hat nicht geklappt" zu verschwinden.
 */
function translate(cause: unknown): never {
  const fehler = cause as { code?: string; message?: string } | null;
  if (fehler?.code === '42501') {
    throw new HTTPException(403, {
      message: fehler.message ?? 'Das darf dieser Link nicht.',
    });
  }
  if (fehler?.code === '23514' || fehler?.code === '23505') {
    throw new HTTPException(422, { message: fehler.message ?? 'Diese Angabe passt nicht.' });
  }
  throw cause;
}

// ---------------------------------------------------------------------------
// Zwei Angaben auflösen — die Bauherrenseite
// ---------------------------------------------------------------------------

/**
 * Der Bauherr entscheidet, welche der beiden Angaben gilt.
 *
 * Genau dafür stehen beide nebeneinander in der Zeile: Hätte der
 * Gegenvorschlag den Termin überschrieben, hätte das Unternehmen entschieden,
 * und der Bauherr erführe es aus dem Plan statt aus einem Gespräch.
 *
 * `accept` heißt: Der Termin des Unternehmens wird der Termin — und ist damit
 * im selben Zug abgestimmt. Das ist der einzige Fall, in dem eine
 * Terminänderung eine Abstimmung herstellt statt sie zu beenden; der Trigger
 * `mbl.stamp_confirmation` kennt ihn als ausdrückliche Ausnahme.
 *
 * Ohne `accept` bleibt der eingetragene Termin stehen, der Gegenvorschlag wird
 * abgeräumt, und der Vorgang ist wieder eine einseitige Angabe. Das ist kein
 * Rückschritt, sondern die Wahrheit: Man hat gesprochen und ist sich nicht
 * einig geworden.
 */
export async function resolveDispute(
  tx: Tx,
  projectId: string,
  taskId: string,
  accept: boolean,
): Promise<{ counterStart: string | null; counterEnd: string | null }> {
  const zeile = await tx.query<{ counter_start: string | null; counter_end: string | null }>(
    `select counter_start, counter_end from task where id = $1 and project_id = $2`,
    [taskId, projectId],
  );
  const vorschlag = zeile.rows[0];
  if (vorschlag === undefined) {
    throw new HTTPException(404, { message: 'Diesen Vorgang gibt es hier nicht.' });
  }

  if (!accept) {
    await tx
      .query(
        `update task
            set counter_start = null, counter_end = null, counter_by = null,
                counter_at = null, counter_note = null,
                confirmation = 'self_stated'
          where id = $1 and project_id = $2`,
        [taskId, projectId],
      )
      .catch(translate);
    return { counterStart: null, counterEnd: null };
  }

  if (vorschlag.counter_start === null) {
    throw new HTTPException(422, { message: 'Zu diesem Vorgang steht kein anderer Termin.' });
  }

  // Nur der früheste Beginn wird gesetzt, nicht Beginn und Ende.
  //
  // Das Ende folgt aus Dauer und Kalender; es steht nicht zur Abstimmung. Hier
  // stand zuerst beides, und die Neuberechnung überschrieb das Ende sofort
  // wieder — womit der Trigger eine Terminänderung sah und die gerade
  // hergestellte Einigkeit wieder abräumte.
  //
  // Den Bestätigungsgrad setzt diese Anweisung bewusst nicht: Das erledigt
  // `mbl.stamp_confirmation` über `app.confirmation_from = 'counterparty'` —
  // der Termin ist ab jetzt der des Unternehmens, nicht der des Bauherrn.
  await tx
    .query(
      `update task
          set earliest_start = counter_start
        where id = $1 and project_id = $2`,
      [taskId, projectId],
    )
    .catch(translate);

  return { counterStart: vorschlag.counter_start, counterEnd: vorschlag.counter_end };
}

/**
 * Der zweite Halbschritt: Der Bauherr bestätigt den übernommenen Termin.
 *
 * Getrennt vom Übernehmen, und zwar **nach** der Neuberechnung. Vorher wäre es
 * eine Bestätigung von Zahlen, die sich gleich noch ändern; nachher ist es
 * eine Aussage über das, was tatsächlich im Plan steht.
 */
export async function confirmAccepted(
  tx: Tx,
  projectId: string,
  taskId: string,
): Promise<void> {
  await tx
    .query(
      `update task
          set confirmation = 'mutual',
              confirmed_by = mbl.current_member_id(project_id),
              confirmed_at = now()
        where id = $1 and project_id = $2 and confirmation = 'counterparty_stated'`,
      [taskId, projectId],
    )
    .catch(translate);
}

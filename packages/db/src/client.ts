/**
 * Datenbankzugriff mit wirksamer RLS.
 *
 * Der Anwendungscode benutzt **niemals** `service_role` oder eine andere
 * privilegierte Rolle (Abschnitt 6.4 der Spezifikation). Stattdessen wird je
 * Transaktion die Rolle auf `authenticated` gesetzt und der JWT-Claim
 * hinterlegt — derselbe Mechanismus, den PostgREST verwendet. Damit gelten die
 * Policies aus `0002_rls.sql` unverändert, und der volle SQL-Sprachumfang
 * bleibt verfügbar.
 */

import pg from 'pg';

export interface JwtClaims {
  /** Nutzerkennung aus Supabase Auth. */
  sub: string;
  role?: string;
  email?: string;
  [key: string]: unknown;
}

export type ActorChannel = 'app' | 'guest_link' | 'import' | 'system';

export interface TransactionOptions {
  actorChannel?: ActorChannel;
  /** Grund einer Terminänderung; wandert in den `schedule_change`-Eintrag. */
  changeReason?: string;
  changeReasonText?: string;
}

export type Sql = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: readonly unknown[],
) => Promise<pg.QueryResult<T>>;

export interface Transaction {
  query: Sql;
  client: pg.PoolClient;
}

let pool: pg.Pool | undefined;

export function getPool(connectionString = process.env['DATABASE_URL']): pg.Pool {
  if (pool !== undefined) return pool;
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL ist nicht gesetzt.');
  }
  pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    // Supabase erzwingt TLS; lokal im Container gibt es keines.
    ssl: connectionString.includes('supabase.co') ? { rejectUnauthorized: true } : false,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool !== undefined) {
    await pool.end();
    pool = undefined;
  }
}

/**
 * Führt `run` in einer Transaktion als Rolle `authenticated` aus, mit gesetztem
 * JWT-Claim. Alles, was darin passiert, unterliegt der RLS.
 *
 * Die gesetzten Konfigurationswerte sind transaktionslokal (`set_config(…,
 * true)`) und verschwinden mit dem Commit — eine zurückgegebene Verbindung im
 * Pool trägt niemals fremde Identität.
 */
export async function withUserTx<T>(
  claims: JwtClaims,
  run: (tx: Transaction) => Promise<T>,
  options: TransactionOptions = {},
  connectionString?: string,
): Promise<T> {
  const client = await getPool(connectionString).connect();
  try {
    await client.query('begin');
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ role: 'authenticated', ...claims }),
    ]);
    await client.query("select set_config('role', 'authenticated', true)");
    await client.query('select set_config($1, $2, true)', [
      'app.actor_channel',
      options.actorChannel ?? 'app',
    ]);
    if (options.changeReason !== undefined) {
      await client.query('select set_config($1, $2, true)', [
        'app.change_reason',
        options.changeReason,
      ]);
    }
    if (options.changeReasonText !== undefined) {
      await client.query('select set_config($1, $2, true)', [
        'app.change_reason_text',
        options.changeReasonText,
      ]);
    }

    const query: Sql = (text, values) => client.query(text, values as unknown[]);
    const result = await run({ query, client });
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Nur für Migrationen, Seed und Tests: Zugriff ohne Rollenwechsel, also mit
 * den Rechten des Verbindungsnutzers. Im Anwendungscode hat das nichts zu
 * suchen.
 */
export async function withAdminTx<T>(
  run: (tx: Transaction) => Promise<T>,
  connectionString?: string,
): Promise<T> {
  const client = await getPool(connectionString).connect();
  try {
    await client.query('begin');
    const query: Sql = (text, values) => client.query(text, values as unknown[]);
    const result = await run({ query, client });
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

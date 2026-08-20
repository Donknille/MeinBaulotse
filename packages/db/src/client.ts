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

// ---------------------------------------------------------------------------
// `date`-Spalten kommen als Zeichenkette zurück, nicht als Date-Objekt.
//
// node-postgres wandelt `date` (OID 1082) standardmäßig in ein JavaScript-Date
// um — und damit in einen Zeitpunkt in der Zeitzone des Servers. Aus dem
// 23.04.2026 wird je nach Umgebung der 22.04. oder eine Zeichenkette mit
// Uhrzeit. Genau dieser Fehler ist der Grund, warum der Berechnungskern
// überhaupt auf Epochentagen rechnet; er darf nicht durch den Treiber wieder
// hereinkommen.
//
// Dasselbe für `timestamptz` gilt ausdrücklich nicht: Zeitpunkte sind
// Zeitpunkte und bleiben Date-Objekte.
// ---------------------------------------------------------------------------
const PG_TYPE_DATE = 1082;
pg.types.setTypeParser(PG_TYPE_DATE, (value: string) => value);

// bigint (OID 20) käme sonst als Zeichenkette; Centbeträge passen sicher in
// eine JavaScript-Zahl, solange sie unter 2^53 liegen.
const PG_TYPE_INT8 = 20;
pg.types.setTypeParser(PG_TYPE_INT8, (value: string) => Number(value));

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

/**
 * Läuft dieser Prozess in einer Serverless-Funktion?
 *
 * Der Unterschied ist nicht kosmetisch: Ein langlebiger Server hat genau einen
 * Pool, eine Serverless-Umgebung hat einen Pool **je Instanz**. Zwanzig
 * gleichzeitige Instanzen mit je zehn Verbindungen reißen das Verbindungslimit
 * des Poolers, und zwar genau dann, wenn viel los ist.
 */
function isServerless(): boolean {
  return process.env['VERCEL'] !== undefined || process.env['AWS_LAMBDA_FUNCTION_NAME'] !== undefined;
}

/**
 * Braucht diese Verbindung TLS?
 *
 * Alles außer der lokalen Entwicklungsdatenbank. Bewusst so herum formuliert:
 * Eine Prüfung auf bekannte Anbieter-Namen vergisst früher oder später einen
 * Host, und das Ergebnis wäre eine unverschlüsselte Verbindung zur
 * Produktionsdatenbank.
 */
function needsTls(connectionString: string): boolean {
  try {
    const host = new URL(connectionString).hostname;
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== 'db';
  } catch {
    return true;
  }
}

export function getPool(connectionString = process.env['DATABASE_URL']): pg.Pool {
  if (pool !== undefined) return pool;
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL ist nicht gesetzt.');
  }
  const serverless = isServerless();
  pool = new pg.Pool({
    connectionString,
    // Eine Node-Funktion bearbeitet eine Anfrage zur Zeit; mehr als eine
    // Verbindung je Instanz bringt nichts und kostet Plätze im Pooler.
    max: serverless ? 1 : 10,
    idleTimeoutMillis: serverless ? 10_000 : 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: needsTls(connectionString) ? { rejectUnauthorized: true } : false,
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

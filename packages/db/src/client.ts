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

import { rootCertificates } from 'node:tls';
import pg from 'pg';
import { SUPABASE_ROOT_CA_2021 } from './supabase-ca.js';

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
  return (
    process.env['VERCEL'] !== undefined || process.env['AWS_LAMBDA_FUNCTION_NAME'] !== undefined
  );
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

/**
 * Die **Form** der eingestellten Verbindung, ohne ein Geheimnis zu nennen.
 *
 * Wenn eine Verbindung im Betrieb scheitert, ist die erste Frage nicht, wie
 * das Passwort lautet, sondern welche der beiden Supabase-Adressen eingetragen
 * ist. Die Direktverbindung (Port 5432) ist nur über IPv6 erreichbar und von
 * einer Vercel-Function aus deshalb gar nicht; der Transaction-Pooler (Port
 * 6543) verlangt den Benutzernamen `postgres.<projektkennung>`. Beides lässt
 * sich beantworten, ohne Host, Benutzer oder Passwort herauszugeben.
 */
export interface ConnectionShape {
  configured: boolean;
  /** 6543 ist der Transaction-Pooler, 5432 die Direktverbindung. */
  port: number | null;
  tls: boolean;
  /** Wird das Zertifikat der Gegenstelle geprüft? Siehe `DATABASE_SSL_NO_VERIFY`. */
  verifyTls: boolean;
  /** Trägt der Benutzername eine Projektkennung? Nur der Pooler verlangt das. */
  poolerUser: boolean;
}

export function describeConnection(
  connectionString = process.env['DATABASE_URL'],
): ConnectionShape {
  if (connectionString === undefined || connectionString === '') {
    return { configured: false, port: null, tls: false, verifyTls: false, poolerUser: false };
  }
  try {
    const url = new URL(connectionString);
    return {
      configured: true,
      port: url.port === '' ? null : Number(url.port),
      tls: needsTls(connectionString),
      verifyTls: needsTls(connectionString) && !verificationDisabled(),
      poolerUser: decodeURIComponent(url.username).includes('.'),
    };
  } catch {
    // Eine Adresse, die sich nicht lesen lässt, ist selbst schon die Auskunft.
    return {
      configured: true,
      port: null,
      tls: true,
      verifyTls: !verificationDisabled(),
      poolerUser: false,
    };
  }
}

/**
 * Ist die Gegenprüfung des Zertifikats abgeschaltet?
 *
 * Ausdrücklich benannt und ausdrücklich zu setzen. Es ist eine Absenkung:
 * Die Verbindung bleibt verschlüsselt, aber es wird nicht mehr geprüft, mit
 * wem. Der Weg dahin steht nur für den Fall offen, dass die hinterlegte
 * Wurzel einmal nicht mehr passt — dann ist ein gesetztes `1` besser als eine
 * Anwendung, die niemand mehr erreicht.
 */
function verificationDisabled(): boolean {
  return process.env['DATABASE_SSL_NO_VERIFY'] === '1';
}

/**
 * TLS-Einstellungen der Verbindung.
 *
 * Die bekannten Wurzeln **und** die von Supabase. `ca` ersetzt in Node den
 * Vertrauensspeicher, statt ihn zu ergänzen — würde hier nur die
 * Supabase-Wurzel stehen, liefe keine andere Datenbank mit öffentlichem
 * Zertifikat mehr.
 */
export function sslOptions(connectionString: string): pg.PoolConfig['ssl'] {
  if (!needsTls(connectionString)) return false;
  if (verificationDisabled()) return { rejectUnauthorized: false };
  return { rejectUnauthorized: true, ca: [...rootCertificates, SUPABASE_ROOT_CA_2021] };
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
    ssl: sslOptions(connectionString),
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

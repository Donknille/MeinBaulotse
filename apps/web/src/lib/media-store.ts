/**
 * Der Bildspeicher, vom Browser aus.
 *
 * Abschnitt 6.1: „Fotos gehen nie durch den Anwendungsserver." Der Browser
 * lädt mit **seiner eigenen** Supabase-Sitzung hoch; die Rechte prüft dieselbe
 * `mbl.is_member`, die auch über den Tabellen steht, nur an `storage.objects`
 * (siehe `0011_storage.sql`).
 *
 * Zwei Nebenwirkungen, beide erwünscht: Ein 12-MB-Foto belegt nie eine
 * Vercel-Function, und die 4,5-MB-Grenze für Anfragekörper spielt keine Rolle.
 *
 * Ohne eingerichtetes Supabase gibt es keinen Bildspeicher. Dann sagt die
 * Erfassung das offen, statt so zu tun, als sei das Foto angekommen — die
 * Aufnahme bleibt in der Warteschlange und geht nicht verloren.
 */

import { supabase } from './supabase.js';

export const BUCKET = 'baustellenfotos';

export class MediaStoreUnavailable extends Error {
  constructor() {
    super(
      'Der Bildspeicher ist nicht eingerichtet. Deine Aufnahme bleibt gespeichert und geht los, sobald er da ist.',
    );
    this.name = 'MediaStoreUnavailable';
  }
}

export function isMediaStoreConfigured(): boolean {
  return supabase !== null;
}

/**
 * Lädt eine Datei hoch. Vorhandenes wird nicht überschrieben.
 *
 * `upsert: false` ist Absicht und nicht Vorsicht: Der Pfad wird aus der
 * Prüfsumme gebildet, dieselbe Datei landet also immer am selben Ort. Ein
 * zweiter Anlauf nach einem Verbindungsabbruch trifft auf sich selbst — das
 * ist kein Fehler, sondern das Ziel. Überschreiben dagegen wäre die stille
 * Form des Austauschens.
 */
export async function uploadToMediaStore(
  path: string,
  blob: Blob,
  mime: string,
): Promise<void> {
  if (supabase === null) throw new MediaStoreUnavailable();

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false, cacheControl: '31536000' });

  if (error === null) return;

  // „Existiert schon" heißt hier: derselbe Inhalt liegt bereits dort, denn der
  // Pfad ist die Prüfsumme. Das ist ein erledigter Auftrag, kein Fehler.
  const bereitsDa =
    (error as { statusCode?: string }).statusCode === '409' ||
    /exists/i.test(error.message);
  if (bereitsDa) return;

  throw error;
}

/**
 * Eine kurzlebige Adresse zum Ansehen (Abschnitt 6.4: „Signierte, kurzlebige
 * URLs für Fotoabruf").
 *
 * Auch das läuft am Anwendungsserver vorbei — der Browser signiert mit seiner
 * eigenen Sitzung. Eine Stunde ist lang genug, um ein Album durchzublättern,
 * und kurz genug, dass eine weitergeleitete Adresse morgen nichts mehr taugt.
 */
export async function signedUrlFor(path: string, secondsValid = 3600): Promise<string | null> {
  if (supabase === null) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, secondsValid);
  if (error !== null) return null;
  return data.signedUrl;
}

/**
 * Mehrere Adressen auf einmal.
 *
 * Ein Album mit dreißig Bildern sonst dreißig Anfragen — auf einer Baustelle
 * mit schlechtem Netz ist das der Unterschied zwischen „lädt" und „lädt nicht".
 */
export async function signedUrlsFor(
  paths: readonly string[],
  secondsValid = 3600,
): Promise<Map<string, string>> {
  const adressen = new Map<string, string>();
  if (supabase === null || paths.length === 0) return adressen;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls([...paths], secondsValid);
  if (error !== null || data === null) return adressen;

  for (const eintrag of data) {
    if (eintrag.signedUrl !== null && eintrag.path !== null) {
      adressen.set(eintrag.path, eintrag.signedUrl);
    }
  }
  return adressen;
}

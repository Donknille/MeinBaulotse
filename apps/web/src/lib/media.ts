/**
 * Wo die Fotos liegen.
 *
 * Abschnitt 6.1: „Dateien: S3-kompatibel, signierte Upload-URLs — Fotos gehen
 * nie durch den Anwendungsserver." Das ist keine Feinheit der Architektur,
 * sondern eine Frage der Kosten und der Sicherheit: Ein Server, durch den
 * jedes Baustellenfoto läuft, ist teuer und hat Daten, die er nicht braucht.
 *
 * Genommen wird die Ablage des Supabase-Projekts, in dem auch die Datenbank
 * liegt. Der Browser lädt mit der Sitzung des Nutzers hoch; wer worauf
 * zugreifen darf, entscheidet die Ablage über dieselben Policies wie die
 * Datenbank (siehe docs/SETUP.md, Abschnitt „Fotos").
 *
 * Ohne eingerichtete Ablage bleibt die Erfassung benutzbar — nur eben ohne
 * Fotos. Ein Notizbuch ohne Bilder ist immer noch ein Notizbuch.
 */

import { isSupabaseConfigured, supabase } from './supabase';
import type { QueuedPhoto } from './queue';

export const BUCKET = 'bauakte';

export function storageConfigured(): boolean {
  return isSupabaseConfigured && supabase !== null;
}

/**
 * Legt das Foto ab und gibt den Pfad zurück.
 *
 * Der Pfad enthält die Prüfsumme. Dadurch ist derselbe Upload zweimal
 * derselbe Pfad — eine abgebrochene Übertragung, die wiederholt wird,
 * erzeugt keine Dublette in der Ablage.
 */
export async function uploadPhoto(projectId: string, photo: QueuedPhoto): Promise<string> {
  if (supabase === null) {
    throw new Error('Für Fotos fehlt die Ablage. Der Eintrag selbst ist gespeichert.');
  }

  const endung = photo.mime === 'image/png' ? 'png' : 'jpg';
  const pfad = `${projectId}/${photo.sha256}.${endung}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(pfad, new Blob([photo.data], { type: photo.mime }), {
      contentType: photo.mime,
      // Derselbe Pfad heißt dieselbe Datei — überschreiben ist hier kein
      // Datenverlust, sondern das Ende eines abgebrochenen Versuchs.
      upsert: true,
    });

  if (error !== null) {
    throw new Error(`Die Ablage hat das Foto nicht angenommen: ${error.message}`);
  }
  return pfad;
}

/**
 * Eine kurzlebige Adresse zum Ansehen.
 *
 * Signiert und befristet (Abschnitt 6.4). Eine dauerhafte öffentliche Adresse
 * wäre ein Baustellenfoto im offenen Netz, für immer.
 */
export async function viewUrl(storagePath: string): Promise<string | null> {
  if (supabase === null) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  return error === null ? data.signedUrl : null;
}

/**
 * Die Schnellerfassung — Abschnitt 5.4 der Spezifikation.
 *
 * „Ein Knopf, Kamera öffnet sofort. Ziel unter 20 Sekunden, mit Handschuhen
 * bedienbar, offlinefähig."
 *
 * Daraus folgt der Aufbau: Der Kameraknopf ist das Erste und das Größte,
 * alles andere ist freiwillig. Datum steht auf heute, der Vorgang ist
 * vorbelegt, die Notiz darf leer bleiben — solange ein Foto da ist.
 *
 * **Gespeichert wird zuerst im Gerät.** Erst danach geht etwas ins Netz.
 * Auf einer Baustelle ist das der Normalfall und keine Ausnahme: Keller,
 * Rohbau, Funkloch. Wer hier auf eine Antwort warten müsste, würde die
 * Erfassung beim zweiten Mal sein lassen.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';
import type { ScheduledTaskDto } from '@meinbaulotse/shared';
import { Button, Field, Select, TextInput } from './ui';
import { readPhotoMetadata, sha256Hex } from '../lib/photo';
import { storageConfigured } from '../lib/media';
import type { QueuedPhoto } from '../lib/queue';
import { todayIso } from '../lib/progress';

export interface CaptureDraft {
  entryDate: string;
  body: string;
  taskIds: string[];
  photos: QueuedPhoto[];
}

export function QuickCapture({
  tasks,
  defaultTaskId,
  defaultPromptKey,
  onClose,
  onSave,
}: {
  tasks: readonly ScheduledTaskDto[];
  defaultTaskId?: string;
  /** Erfüllt einen Fotoauftrag der Lotsenkarte. */
  defaultPromptKey?: string;
  onClose: () => void;
  onSave: (draft: CaptureDraft) => Promise<{ queued: boolean }>;
}) {
  const titleId = useId();
  const dateiFeld = useRef<HTMLInputElement>(null);
  const [entryDate, setEntryDate] = useState(todayIso());
  const [body, setBody] = useState('');
  const [taskId, setTaskId] = useState(defaultTaskId ?? '');
  const [photos, setPhotos] = useState<QueuedPhoto[]>([]);
  const [lese, setLese] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hinweis, setHinweis] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function dateienLesen(dateien: FileList | null): Promise<void> {
    if (dateien === null || dateien.length === 0) return;
    setLese(true);
    setError(null);
    try {
      const gelesen: QueuedPhoto[] = [];
      for (const datei of Array.from(dateien)) {
        const daten = await datei.arrayBuffer();
        const { takenAt, lat, lon } = readPhotoMetadata(daten);
        gelesen.push({
          name: datei.name,
          mime: datei.type === '' ? 'image/jpeg' : datei.type,
          bytes: datei.size,
          sha256: await sha256Hex(daten),
          // Der Zeitpunkt kommt aus dem Foto. Fehlt er, bleibt das Feld leer —
          // die Uhrzeit des Hochladens wäre eine andere Aussage.
          takenAt,
          lat,
          lon,
          data: daten,
          ...(defaultPromptKey === undefined ? {} : { photoPromptKey: defaultPromptKey }),
        });
      }
      setPhotos((vorher) => [...vorher, ...gelesen]);

      // Wenn das erste Foto ein Datum mitbringt, übernimmt der Eintrag es.
      const erstes = gelesen.find((photo) => photo.takenAt !== null);
      if (erstes?.takenAt != null && photos.length === 0) {
        setEntryDate(erstes.takenAt.slice(0, 10));
        setHinweis('Datum aus der Aufnahmezeit des ersten Fotos übernommen.');
      }
    } catch {
      setError('Ein Foto ließ sich nicht lesen. Versuch es noch einmal.');
    } finally {
      setLese(false);
    }
  }

  async function speichern(): Promise<void> {
    if (photos.length === 0 && body.trim() === '') {
      setError('Ein Foto oder eine Notiz — eins von beiden braucht es.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const ergebnis = await onSave({
        entryDate,
        // Ohne Notiz steht wenigstens da, worum es ging. Ein leerer Eintrag
        // wäre in der Akte später nicht zuzuordnen.
        body: body.trim() === '' ? `${photos.length} Fotos von der Baustelle.` : body.trim(),
        taskIds: taskId === '' ? [] : [taskId],
        photos,
      });
      if (ergebnis.queued) {
        setHinweis('Gespeichert. Es geht hinaus, sobald wieder Netz da ist.');
        setTimeout(onClose, 1200);
      } else {
        onClose();
      }
    } catch (fehler) {
      setError(fehler instanceof Error ? fehler.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(false);
    }
  }

  const mitFotos = storageConfigured();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/30 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-[32rem] overflow-y-auto rounded-t-[var(--radius-large)] bg-canvas-white p-5 sm:rounded-[var(--radius-large)]"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-subheading font-medium text-charcoal">
            Was ist gerade auf der Baustelle?
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Schließen">
            <X size={18} aria-hidden />
          </Button>
        </div>

        <div className="flex flex-col gap-4">
          {/* Der Kameraknopf ist das Erste und das Größte. Alles darunter ist
              freiwillig. */}
          {mitFotos ? (
            <>
              <input
                ref={dateiFeld}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="sr-only"
                onChange={(event) => void dateienLesen(event.target.files)}
              />
              <Button
                type="button"
                variant="primary"
                size="field"
                className="w-full"
                disabled={lese}
                onClick={() => dateiFeld.current?.click()}
              >
                {lese ? (
                  <Loader2 size={20} className="animate-spin" aria-hidden />
                ) : (
                  <Camera size={20} aria-hidden />
                )}
                {photos.length === 0 ? 'Foto aufnehmen' : 'Noch ein Foto'}
              </Button>
            </>
          ) : (
            <p className="rounded-[var(--radius-large)] bg-paper-mist p-3 text-caption text-steel">
              Für Fotos fehlt die Ablage — sie hängt am Supabase-Projekt (siehe docs/SETUP.md).
              Notizen lassen sich trotzdem erfassen, und sie kommen genauso in die Bauakte.
            </p>
          )}

          {photos.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {photos.map((photo, index) => (
                <li
                  key={photo.sha256}
                  className="flex items-baseline justify-between gap-3 border-b border-ash py-1.5 last:border-b-0"
                >
                  <span className="text-body text-charcoal">Foto {index + 1}</span>
                  <span className="text-caption text-steel">
                    {photo.takenAt === null
                      ? 'ohne Aufnahmezeit'
                      : new Date(photo.takenAt).toLocaleString('de-DE')}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <Field label="Notiz" hint="Ein Satz genügt. Was du siehst, nicht was du vermutest.">
            <TextInput
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Bewehrung liegt, morgen wird betoniert."
            />
          </Field>

          <Field label="Tag" hint="Steht auf heute, sofern kein Foto ein anderes Datum mitbringt.">
            <TextInput
              type="date"
              value={entryDate}
              onChange={(event) => setEntryDate(event.target.value)}
            />
          </Field>

          <Field label="Gehört zu" hint="Freiwillig. Ordnet den Eintrag einem Vorgang zu.">
            <Select value={taskId} onChange={(event) => setTaskId(event.target.value)}>
              <option value="">Keinem bestimmten Vorgang</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.name}
                </option>
              ))}
            </Select>
          </Field>

          {error !== null ? <p className="text-body text-alarm-red">{error}</p> : null}
          {hinweis !== null ? <p className="text-body text-vivid-green">{hinweis}</p> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Abbrechen
            </Button>
            <Button
              type="button"
              variant="primary"
              size="field"
              disabled={busy || lese}
              onClick={() => void speichern()}
            >
              {busy ? 'Wird gespeichert' : 'Speichern'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

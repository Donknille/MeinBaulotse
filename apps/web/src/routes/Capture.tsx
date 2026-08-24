/**
 * Die Schnellerfassung — Abschnitt 5.4.
 *
 *     „Ein Knopf, Kamera öffnet sofort. Nach dem Foto: Datum, Wetter und Ort
 *      automatisch, Vorgang vorbelegt, optionale Notiz. Ziel unter 20 Sekunden,
 *      mit Handschuhen bedienbar, offlinefähig."
 *
 * Jedes Wort davon ist eine Entwurfsentscheidung:
 *
 * - **Kamera sofort.** `capture="environment"` öffnet auf dem Handy die
 *   Rückkamera, ohne Zwischenmaske. Die Seite hat deshalb keinen
 *   Begrüßungstext und keine Auswahl davor.
 * - **Datum, Wetter und Ort automatisch.** Nichts davon steht als Feld hier.
 *   Das Datum kommt aus der Uhr, das Wetter holt der Server, der Ort steht im
 *   Bauvorhaben. Drei Felder weniger sind drei Felder weniger.
 * - **Vorgang vorbelegt.** Was heute läuft, ist ausgewählt. Wer etwas anderes
 *   meint, ändert es; die meisten meinen das, was gerade passiert.
 * - **Handschuhe.** Alle Tippziele in Feldgröße (56 px). Das ist der Grund für
 *   `size="field"` in `ui.tsx`.
 * - **Offlinefähig.** Der Speichern-Knopf schreibt nach IndexedDB und ist
 *   fertig. Ob Netz da ist, erfährt der Nutzer nicht — er sieht sein Foto in
 *   der Liste.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Camera, Check, CloudOff, Images, Loader2, X } from 'lucide-react';
import type { PhotoPromptStatus, ProjectSchedule } from '@meinbaulotse/shared';
import { Button, Card, Field, Select } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { api } from '../lib/api';
import { capture, useCaptureQueue } from '../lib/capture';
import { isMediaStoreConfigured } from '../lib/media-store';
import { formatDateWithWeekday } from '../lib/format';

/** Heute, als `YYYY-MM-TT` in der Zeitzone des Geräts. */
function heute(): string {
  const jetzt = new Date();
  return new Date(jetzt.getTime() - jetzt.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function Capture() {
  const { projectId } = useParams<{ projectId: string }>();
  const [suche] = useSearchParams();
  const navigate = useNavigate();
  const dateiFeld = useRef<HTMLInputElement>(null);

  const [dateien, setDateien] = useState<File[]>([]);
  const [notiz, setNotiz] = useState('');
  const [vorgang, setVorgang] = useState<string>(suche.get('vorgang') ?? '');
  const [gespeichert, setGespeichert] = useState(false);
  const auftrag = suche.get('auftrag');
  const tag = heute();

  const warteschlange = useCaptureQueue();

  const plan = useQuery({
    queryKey: ['schedule', projectId],
    queryFn: () => api.schedule(projectId!),
    enabled: projectId !== undefined,
  });

  const auftraege = useQuery({
    queryKey: ['photo-prompts', projectId, tag],
    queryFn: () => api.photoPrompts(projectId!, tag),
    enabled: projectId !== undefined,
  });

  // Was heute läuft, ist vorbelegt. Kommt der Nutzer über einen Fotoauftrag
  // herein, gilt dessen Vorgang — er hat schon gesagt, was er meint.
  const laufend = useMemo(() => laufendeVorgaenge(plan.data, tag), [plan.data, tag]);
  useEffect(() => {
    if (vorgang !== '' || laufend.length === 0) return;
    setVorgang(laufend[0]!.id);
  }, [laufend, vorgang]);

  const dieserAuftrag =
    auftrag === null
      ? null
      : (auftraege.data?.prompts.find(
          (prompt) => prompt.key === auftrag && prompt.taskId === vorgang,
        ) ?? null);

  async function speichern(): Promise<void> {
    if (projectId === undefined || dateien.length === 0) return;
    await capture({
      projectId,
      files: dateien,
      note: notiz,
      entryDate: tag,
      taskId: vorgang === '' ? null : vorgang,
      photoPromptKey: dieserAuftrag?.key ?? null,
    });
    setGespeichert(true);
    setDateien([]);
    setNotiz('');
    // Erst speichern, dann versuchen abzuliefern. Scheitert das, ist nichts
    // verloren — es steht ja schon in der Warteschlange.
    void warteschlange.flush();
  }

  if (gespeichert) {
    return (
      <main className="mx-auto flex w-full max-w-[34rem] flex-col gap-6 px-4 py-8 sm:px-6">
        <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />
        <Card className="flex flex-col items-start gap-4">
          <span className="flex items-center gap-2 text-body-xl font-medium text-charcoal">
            <Check size={22} className="text-vivid-green" aria-hidden />
            Gespeichert.
          </span>
          <p className="text-body text-steel">
            {warteschlange.pending === 0
              ? 'Die Aufnahme ist angekommen und steht in deinem Bautagebuch.'
              : `${warteschlange.pending === 1 ? 'Ein Foto wartet' : `${warteschlange.pending} Fotos warten`} auf eine Verbindung. Du kannst die App schließen — sie gehen los, sobald wieder Netz da ist.`}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" size="field" onClick={() => setGespeichert(false)}>
              <Camera size={20} aria-hidden />
              Noch eins
            </Button>
            <Button
              size="field"
              onClick={() => navigate(`/projekt/${projectId ?? ''}/tagebuch`)}
            >
              <Images size={20} aria-hidden />
              Zum Tagebuch
            </Button>
          </div>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-[34rem] flex-col gap-6 px-4 py-8 sm:px-6">
      <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />

      <header className="flex flex-col gap-1">
        <h1 className="display-title text-heading-lg text-charcoal">Foto aufnehmen</h1>
        <p className="text-body text-steel">
          {formatDateWithWeekday(tag)} · Datum, Wetter und Ort trägt der Lotse selbst ein.
        </p>
      </header>

      {dieserAuftrag !== null ? (
        <Card tone="muted" className="flex flex-col gap-1">
          <span className="text-body font-medium text-charcoal">{dieserAuftrag.what}</span>
          {dieserAuftrag.why === null ? null : (
            <span className="text-body text-steel">{dieserAuftrag.why}</span>
          )}
        </Card>
      ) : null}

      {/* Der eine Knopf. Auf dem Handy öffnet er die Rückkamera direkt. */}
      <input
        ref={dateiFeld}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(event) => {
          setDateien([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />

      {dateien.length === 0 ? (
        <Button
          variant="primary"
          size="field"
          className="h-32 w-full text-body-xl"
          onClick={() => dateiFeld.current?.click()}
        >
          <Camera size={28} aria-hidden />
          Kamera öffnen
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {dateien.map((datei, index) => (
              <Vorschau
                key={`${datei.name}-${index}`}
                datei={datei}
                entfernen={() =>
                  setDateien((vorher) => vorher.filter((_, stelle) => stelle !== index))
                }
              />
            ))}
          </div>
          <Button size="md" onClick={() => dateiFeld.current?.click()}>
            <Camera size={18} aria-hidden />
            Weitere aufnehmen
          </Button>
        </div>
      )}

      <Field label="Notiz" hint="Was man auf dem Bild nicht sieht. Ein Satz genügt.">
        <textarea
          value={notiz}
          onChange={(event) => setNotiz(event.target.value)}
          rows={3}
          placeholder="Leitungsverlauf vor dem Estrich."
          className="w-full rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white px-3 py-2 text-body-lg text-charcoal placeholder:text-fog"
        />
      </Field>

      <Field label="Vorgang" hint="Vorbelegt mit dem, was gerade läuft.">
        <Select value={vorgang} onChange={(event) => setVorgang(event.target.value)}>
          <option value="">Ohne Vorgang</option>
          {(plan.data?.tasks ?? []).map((task) => (
            <option key={task.id} value={task.id}>
              {task.name}
            </option>
          ))}
        </Select>
      </Field>

      {!isMediaStoreConfigured() ? (
        // Offen sagen, was fehlt, statt eine Aufnahme anzunehmen und
        // stillschweigend nirgends abzulegen.
        <Card tone="muted" className="flex items-start gap-3">
          <CloudOff size={18} className="mt-0.5 shrink-0 text-steel" aria-hidden />
          <p className="text-body text-steel">
            Der Bildspeicher ist in dieser Umgebung nicht eingerichtet. Deine Aufnahme wird
            gespeichert und geht los, sobald er da ist — verloren geht sie nicht.
          </p>
        </Card>
      ) : null}

      <Button
        variant="primary"
        size="field"
        disabled={dateien.length === 0}
        onClick={() => void speichern()}
      >
        {warteschlange.busy ? (
          <Loader2 size={20} className="animate-spin" aria-hidden />
        ) : (
          <Check size={20} aria-hidden />
        )}
        {dateien.length <= 1 ? 'Aufnahme speichern' : `${dateien.length} Aufnahmen speichern`}
      </Button>

      {warteschlange.pending > 0 ? (
        <p className="text-caption text-steel">
          {warteschlange.pending === 1
            ? 'Ein früheres Foto wartet noch auf eine Verbindung.'
            : `${warteschlange.pending} frühere Fotos warten noch auf eine Verbindung.`}
          {warteschlange.lastError === null ? '' : ` Zuletzt: ${warteschlange.lastError}`}
        </p>
      ) : null}
    </main>
  );
}

/**
 * Die Vorschau eines noch nicht gespeicherten Bildes.
 *
 * `URL.createObjectURL` und nicht `FileReader`: Ein 12-MB-Foto als Base64 in
 * den Speicher zu legen, nur um es anzuzeigen, bringt ein älteres Handy bei
 * drei Aufnahmen an seine Grenze.
 */
function Vorschau({ datei, entfernen }: { datei: File; entfernen: () => void }) {
  const [adresse, setAdresse] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(datei);
    setAdresse(url);
    return () => URL.revokeObjectURL(url);
  }, [datei]);

  return (
    <div className="relative aspect-square overflow-hidden rounded-[var(--radius-card)] bg-paper-mist">
      {adresse === null ? null : (
        <img src={adresse} alt="" className="h-full w-full object-cover" />
      )}
      <button
        type="button"
        onClick={entfernen}
        aria-label="Aufnahme verwerfen"
        className="absolute top-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-midnight-ink/80 text-canvas-white"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Was an diesem Tag läuft — daraus wird die Vorbelegung. */
function laufendeVorgaenge(
  plan: ProjectSchedule | undefined,
  tag: string,
): ProjectSchedule['tasks'] {
  if (plan === undefined) return [];
  return plan.tasks.filter(
    (task) =>
      task.currentStart !== null &&
      task.currentEnd !== null &&
      task.currentStart <= tag &&
      task.currentEnd >= tag &&
      task.status !== 'entfallen',
  );
}

/** Für das Cockpit: der Weg zur Kamera, mit Fotoauftrag im Gepäck. */
export function captureLink(
  projectId: string,
  prompt?: Pick<PhotoPromptStatus, 'taskId' | 'key'>,
): string {
  const basis = `/projekt/${projectId}/erfassen`;
  if (prompt === undefined) return basis;
  return `${basis}?vorgang=${prompt.taskId}&auftrag=${encodeURIComponent(prompt.key)}`;
}

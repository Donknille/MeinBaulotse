/**
 * Das Bautagebuch — Abschnitt 3.8.
 *
 * „Der Nutzer erlebt davon nichts. Er sieht ein Fotoalbum seiner Baustelle."
 * Genau so ist diese Ansicht gebaut: Einträge nach Tagen, Fotos dabei, ein
 * Knopf zum Erfassen. Die Beweiskette läuft darunter mit und meldet sich nur,
 * wenn etwas nicht stimmt.
 *
 * Was hier trotzdem sichtbar ist, ist Absicht: dass ein Eintrag versiegelt
 * wurde, und dass ein zurückgezogener Eintrag stehen bleibt. Beides ist der
 * Unterschied zwischen einer Akte und einer Sammlung.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Lock, ShieldCheck, ShieldAlert, Undo2 } from 'lucide-react';
import type { DiaryChainResult, DiaryEntryDto } from '@meinbaulotse/shared';
import { Button, Card, Pill } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { QuickCapture, type CaptureDraft } from '../components/QuickCapture';
import { Photo } from '../components/Photo';
import { ApiError, api } from '../lib/api';
import { formatDate, formatDateWithWeekday } from '../lib/format';
import { ROLE_LABEL } from '../lib/roles';
import { enqueue, flushQueue, indexedDbStore } from '../lib/queue';
import { uploadPhoto } from '../lib/media';

export function Diary() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [erfassen, setErfassen] = useState(false);
  const [offline, setOffline] = useState<string | null>(null);

  const plan = useQuery({
    queryKey: ['schedule', projectId],
    queryFn: () => api.schedule(projectId!),
    enabled: projectId !== undefined,
  });

  const diary = useQuery({
    queryKey: ['diary', projectId],
    queryFn: () => api.diary(projectId!),
    enabled: projectId !== undefined,
  });

  const chain = useQuery({
    queryKey: ['diary-chain', projectId],
    queryFn: () => api.verifyDiary(projectId!),
    enabled: projectId !== undefined,
  });

  const zurueckziehen = useMutation({
    mutationFn: ({ entryId, reason }: { entryId: string; reason: string }) =>
      api.updateDiaryEntry(projectId!, entryId, { retractionReason: reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['diary', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['diary-chain', projectId] });
    },
  });

  /**
   * Erfassen heißt: erst ins Gerät, dann ins Netz.
   *
   * Der Nutzer bekommt seine Rückmeldung, sobald es im Gerät liegt. Ob das
   * Netz mitspielt, entscheidet nur, wie lange es dort liegen bleibt.
   */
  async function speichern(draft: CaptureDraft): Promise<{ queued: boolean }> {
    const store = indexedDbStore();
    await enqueue(store, { projectId: projectId!, ...draft });

    const ergebnis = await flushQueue(store, {
      createEntry: (item) =>
        api.createDiaryEntry(item.projectId, {
          entryDate: item.entryDate,
          body: item.body,
          taskIds: item.taskIds,
        }),
      uploadPhoto: (item, photo) => uploadPhoto(item.projectId, photo),
      registerMedia: async (item, photo, storagePath, diaryEntryId) => {
        await api.registerMedia(item.projectId, {
          storagePath,
          mime: photo.mime,
          bytes: photo.bytes,
          sha256: photo.sha256,
          exifTakenAt: photo.takenAt,
          exifLat: photo.lat,
          exifLon: photo.lon,
          statedDate: item.entryDate,
          diaryEntryId,
          ...(item.taskIds[0] === undefined ? {} : { taskId: item.taskIds[0] }),
          ...(photo.photoPromptKey === undefined ? {} : { photoPromptKey: photo.photoPromptKey }),
        });
      },
    });

    void queryClient.invalidateQueries({ queryKey: ['diary', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['diary-chain', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['photo-prompts', projectId] });

    setOffline(
      ergebnis.remaining > 0
        ? `${ergebnis.remaining} ${ergebnis.remaining === 1 ? 'Erfassung wartet' : 'Erfassungen warten'} auf Netz.`
        : null,
    );
    return { queued: ergebnis.remaining > 0 };
  }

  return (
    <main className="mx-auto flex w-full max-w-[840px] flex-col gap-8 px-4 py-8 sm:px-6">
      <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="display-title text-heading-lg text-charcoal">Bautagebuch</h1>
          <p className="text-body text-steel">
            Was auf der Baustelle passiert ist — mit Fotos, Tag für Tag.
          </p>
        </div>
        <Button variant="primary" size="field" onClick={() => setErfassen(true)}>
          <Camera size={20} aria-hidden />
          Erfassen
        </Button>
      </header>

      {offline !== null ? (
        <p className="rounded-[var(--radius-large)] bg-soft-amber px-4 py-2 text-body text-tangerine">
          {offline} Sie geht von selbst hinaus, sobald du wieder online bist.
        </p>
      ) : null}

      <Kette chain={chain.data} />

      {diary.isPending ? (
        <p className="text-body text-steel">Das Tagebuch wird geladen.</p>
      ) : diary.isError || diary.data === undefined ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-charcoal">Das Tagebuch ließ sich gerade nicht laden.</p>
          <p className="text-body text-steel">
            {diary.error instanceof ApiError ? diary.error.message : 'Versuch es noch einmal.'}
          </p>
          <Button variant="outline" onClick={() => void diary.refetch()}>
            Erneut versuchen
          </Button>
        </div>
      ) : diary.data.length === 0 ? (
        <Card>
          {/* Leerer Zustand nach CI 9.10: ein Satz und eine Aktion. */}
          <div className="flex flex-col items-start gap-3 py-6">
            <p className="max-w-[34rem] text-body text-steel">
              Noch kein Eintrag. Was du hier festhältst, steht später in der Bauakte — mit Datum,
              Verfasser und Foto.
            </p>
            <Button variant="outline" size="field" onClick={() => setErfassen(true)}>
              <Camera size={20} aria-hidden />
              Den ersten Eintrag anlegen
            </Button>
          </div>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {diary.data.map((entry) => (
            <Eintrag
              key={entry.id}
              entry={entry}
              onRetract={(reason) =>
                zurueckziehen.mutateAsync({ entryId: entry.id, reason }).then(() => undefined)
              }
            />
          ))}
        </ul>
      )}

      {erfassen && plan.data !== undefined ? (
        <QuickCapture
          tasks={plan.data.tasks}
          onClose={() => setErfassen(false)}
          onSave={speichern}
        />
      ) : null}
    </main>
  );
}

/** Die Kette meldet sich nur, wenn es etwas zu melden gibt. */
function Kette({ chain }: { chain: DiaryChainResult | undefined }) {
  if (chain === undefined || chain.sealedCount === 0) return null;

  if (!chain.intact) {
    const gebrochen = chain.entries.filter((entry) => !entry.ok);
    return (
      <Card tone="muted" className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-body-lg font-medium text-alarm-red">
          <ShieldAlert size={18} aria-hidden />
          Die Kette der Einträge stimmt nicht mehr
        </p>
        <p className="text-body text-steel">
          {gebrochen.length === 1 ? 'Ein Eintrag' : `${gebrochen.length} Einträge`} wurden nach der
          Versiegelung verändert:{' '}
          {gebrochen.map((entry) => formatDate(entry.entryDate)).join(', ')}. Über die Anwendung ist
          das nicht möglich — sieh bitte nach, wer sonst Zugriff auf die Datenbank hat.
        </p>
      </Card>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-2 text-caption text-steel">
      <ShieldCheck size={16} className="text-vivid-green" aria-hidden />
      {chain.sealedCount} {chain.sealedCount === 1 ? 'Eintrag ist' : 'Einträge sind'} versiegelt und
      lückenlos verkettet.
      <span className="font-mono">{chain.headHash?.slice(0, 12)}…</span>
    </p>
  );
}

function Eintrag({
  entry,
  onRetract,
}: {
  entry: DiaryEntryDto;
  onRetract: (reason: string) => Promise<void>;
}) {
  const [ruecknahme, setRuecknahme] = useState(false);
  const [grund, setGrund] = useState('');

  return (
    <li>
      <Card className={`flex flex-col gap-3 ${entry.retractedAt === null ? '' : 'opacity-70'}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-body-lg font-medium text-charcoal">
            {formatDateWithWeekday(entry.entryDate)}
          </p>
          <div className="flex items-center gap-2">
            {entry.authorRole !== null ? (
              <span className="text-caption text-steel">
                {entry.authorName ?? ROLE_LABEL[entry.authorRole]}
              </span>
            ) : null}
            {entry.lockedAt !== null ? (
              <Pill tone="neutral" icon={<Lock size={12} />}>
                Versiegelt
              </Pill>
            ) : (
              <Pill tone="blue">Heute noch änderbar</Pill>
            )}
          </div>
        </div>

        <p className="text-body-lg whitespace-pre-line text-charcoal">{entry.body}</p>

        {entry.weather !== null ? (
          <p className="text-caption text-steel">
            Wetter: {String(entry.weather['condition'] ?? '—')}
            {entry.weather['temperatureC'] === undefined
              ? ''
              : `, ${String(entry.weather['temperatureC'])} °C`}
          </p>
        ) : null}

        {entry.media.length > 0 ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {entry.media.map((item) => (
              <li key={item.id}>
                <Photo item={item} />
              </li>
            ))}
          </ul>
        ) : null}

        {entry.retractedAt !== null ? (
          <p className="border-t border-ash pt-2 text-body text-tangerine">
            Zurückgezogen am {formatDate(entry.retractedAt.slice(0, 10))}: {entry.retractionReason}
          </p>
        ) : ruecknahme ? (
          <div className="flex flex-col gap-2 border-t border-ash pt-3">
            <label className="text-caption text-steel" htmlFor={`grund-${entry.id}`}>
              Warum ziehst du den Eintrag zurück? Er bleibt sichtbar und trägt den Grund.
            </label>
            <input
              id={`grund-${entry.id}`}
              className="h-11 rounded-[var(--radius-input)] border border-pebble px-3 text-body"
              value={grund}
              onChange={(event) => setGrund(event.target.value)}
              placeholder="Verwechslung, betrifft ein anderes Grundstück"
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={grund.trim().length < 3}
                onClick={() => void onRetract(grund.trim())}
              >
                Zurückziehen
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRuecknahme(false)}>
                Abbrechen
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="w-fit text-caption text-steel underline-offset-4 hover:underline"
            onClick={() => setRuecknahme(true)}
          >
            <Undo2 size={12} className="mr-1 inline" aria-hidden />
            Zurückziehen
          </button>
        )}
      </Card>
    </li>
  );
}

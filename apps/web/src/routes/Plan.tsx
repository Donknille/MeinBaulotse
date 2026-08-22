import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui';
import { PlanView } from '../components/PlanView';
import { GuideCardSheet } from '../components/GuideCardSheet';
import { TopBar } from '../components/TopBar';
import { ApiError, api } from '../lib/api';
import type { ScheduledTaskDto, TaskUpdateRequest } from '@meinbaulotse/shared';

/** Route: holt den Plan und übergibt ihn an die Darstellung. */
export function Plan() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [guideTask, setGuideTask] = useState<ScheduledTaskDto | null>(null);
  const query = useQuery({
    queryKey: ['schedule', projectId],
    queryFn: () => api.schedule(projectId!),
    enabled: projectId !== undefined,
  });

  // Die Antwort ist der neu gerechnete Plan. Sie wird direkt in den
  // Zwischenspeicher gelegt, statt eine zweite Abfrage auszulösen: Der Server
  // hat gerade gerechnet, ein Nachfragen brächte dasselbe Ergebnis und ein
  // Flackern dazu.
  const change = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: TaskUpdateRequest }) =>
      api.updateTask(projectId!, taskId, body),
    onSuccess: (schedule) => {
      queryClient.setQueryData(['schedule', projectId], schedule);
      // Die Liste zeigt Baubeginn und Bundesland — beides kann sich nicht
      // ändern. Der Endtermin steht dort nicht, also gibt es nichts zu
      // erneuern außer diesem einen Plan.
    },
  });

  // Die Karte wird erst beim Öffnen geholt. Zwölf vollständige Karten mit
  // jedem Plan mitzuliefern wäre ein Vielfaches der Nutzlast für etwas, das
  // die meisten Besuche nie aufschlagen.
  const guide = useQuery({
    queryKey: ['guide-card', projectId, guideTask?.id],
    queryFn: () => api.guideCard(projectId!, guideTask!.id),
    enabled: guideTask !== null,
  });

  // Das Abrufen der Karte hält fest, dass sie gelesen wurde — und genau das
  // steht im Plan („lies dich ein"). Ohne dieses Nachladen bliebe die
  // Aufforderung stehen, bis jemand die Seite neu lädt.
  const planErneuern = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['schedule', projectId] });
  };

  const bewerten = useMutation({
    mutationFn: (helpful: boolean | null) =>
      api.rateGuideCard(projectId!, guideTask!.id, helpful),
  });

  const abhaken = useMutation({
    mutationFn: ({ itemId, isDone }: { itemId: string; isDone: boolean }) =>
      api.updateChecklistItem(projectId!, itemId, { isDone }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['guide-card', projectId, guideTask?.id],
      });
    },
  });

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-4 py-8 sm:px-6">
      {/* Ohne diese Zeile ist die Planansicht eine Sackgasse: Als installierte
          PWA gibt es keinen Zurück-Knopf des Browsers. */}
      <TopBar back={{ to: '/', label: 'Deine Bauvorhaben' }} />

      {query.isPending ? (
        <p className="text-body text-steel">Der Plan wird geladen.</p>
      ) : query.isError || query.data === undefined ? (
        // Den Grund nennen, nicht nur das Scheitern.
        //
        // Hier stand einmal nur `message`, und das war „Das hat nicht
        // geklappt" — der Sammeltext der API für jeden unerwarteten Fehler.
        // Die eigentliche Auskunft steckte daneben in `detail` und wurde
        // verschwiegen, ausgerechnet auf der Seite, auf der der Fehler
        // auftauchte. Die Projektliste zeigte sie längst; diese hier nicht.
        <div className="flex flex-col items-start gap-3 py-8">
          <p className="max-w-[34rem] text-body text-charcoal">
            Dieses Bauvorhaben ließ sich gerade nicht laden. Deine Daten sind davon nicht betroffen.
          </p>
          <p className="max-w-[34rem] text-body text-steel">
            {query.error instanceof ApiError
              ? query.error.message
              : 'Prüf bitte den Link, oder öffne es noch einmal aus deiner Übersicht.'}
          </p>
          {query.error instanceof ApiError && query.error.detail !== undefined ? (
            <p className="max-w-[34rem] font-mono text-caption break-words text-steel">
              {query.error.detail}
            </p>
          ) : null}
          {query.error instanceof ApiError && query.error.schemaHint !== undefined ? (
            <p className="max-w-[34rem] text-caption text-steel">{query.error.schemaHint}</p>
          ) : null}
          <Button variant="primary" size="field" onClick={() => void query.refetch()}>
            Erneut versuchen
          </Button>
        </div>
      ) : (
        <PlanView
          schedule={query.data}
          onChangeTask={async (taskId, body) => {
            await change.mutateAsync({ taskId, body });
          }}
          onOpenGuide={(task) => setGuideTask(task)}
        />
      )}

      {guideTask !== null && guide.data !== undefined ? (
        <GuideCardSheet
          view={guide.data}
          onClose={() => {
            setGuideTask(null);
            planErneuern();
          }}
          onRate={async (helpful) => {
            await bewerten.mutateAsync(helpful);
          }}
          onToggle={async (item, isDone) => {
            await abhaken.mutateAsync({ itemId: item.id, isDone });
          }}
        />
      ) : null}

      {/* Solange die Karte lädt, steht da ein Satz und kein Blatt: Ein leeres
          Blatt, das sich gleich füllt, springt beim Erscheinen. */}
      {guideTask !== null && guide.isPending ? (
        <p className="fixed inset-x-0 bottom-6 mx-auto w-fit rounded-[var(--radius-pill)] bg-charcoal px-4 py-2 text-body text-canvas-white">
          Die Lotsenkarte wird geholt.
        </p>
      ) : null}

      {guideTask !== null && guide.isError ? (
        <p className="fixed inset-x-0 bottom-6 mx-auto w-fit max-w-[90vw] rounded-[var(--radius-pill)] bg-charcoal px-4 py-2 text-body text-canvas-white">
          {guide.error instanceof ApiError
            ? guide.error.message
            : 'Die Lotsenkarte ließ sich gerade nicht laden.'}{' '}
          <button type="button" className="underline" onClick={() => setGuideTask(null)}>
            Schließen
          </button>
        </p>
      ) : null}
    </main>
  );
}

import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '../components/ui';
import { PlanView } from '../components/PlanView';
import type { GuideCardHandlers } from '../components/GuideCard';
import { TopBar } from '../components/TopBar';
import { ApiError, api } from '../lib/api';
import type {
  DecisionUpdateRequest,
  ProjectSchedule,
  TaskUpdateRequest,
} from '@meinbaulotse/shared';

/** Route: holt den Plan und übergibt ihn an die Darstellung. */
export function Plan() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
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

  // Die Antwort ist die geänderte Entscheidung, nicht der Plan: Ein
  // Zustandswechsel verschiebt keinen Termin. Sie wird in den vorhandenen Plan
  // eingesetzt, damit die Ansicht nicht flackert.
  const changeDecision = useMutation({
    mutationFn: ({ decisionId, body }: { decisionId: string; body: DecisionUpdateRequest }) =>
      api.updateDecision(projectId!, decisionId, body),
    onSuccess: (entscheidung) => {
      queryClient.setQueryData(['schedule', projectId], (vorher: ProjectSchedule | undefined) =>
        vorher === undefined
          ? vorher
          : {
              ...vorher,
              decisions: vorher.decisions.map((entry) =>
                entry.id === entscheidung.id ? entscheidung : entry,
              ),
            },
      );
    },
  });

  // Die Lotsenkarte holt ihre Daten selbst, wenn sie geöffnet wird — sie
  // gehört nicht in den Zwischenspeicher des Plans. Zwölf vollständige Karten
  // mitzuladen, von denen der Nutzer keine liest, wäre auf einer Baustelle mit
  // schlechtem Netz die falsche Rechnung.
  //
  // `useMemo`, weil `GuideCardSheet` beim Öffnen genau einmal laden soll. Ein
  // bei jedem Rendern neu erzeugtes Objekt löste den Effekt wieder aus, und
  // die Karte lüde in einer Schleife.
  const guideCards = useMemo<GuideCardHandlers>(
    () => ({
      markRead: (taskId, feedback) => api.markGuideCardRead(projectId!, taskId, feedback),
      setChecklistItem: (taskId, sourceKey, change) =>
        api.setChecklistItem(projectId!, taskId, sourceKey, change),
    }),
    [projectId],
  );

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
          guideCards={guideCards}
          onChangeTask={async (taskId, body) => {
            await change.mutateAsync({ taskId, body });
          }}
          onChangeDecision={async (decisionId, body) => {
            await changeDecision.mutateAsync({ decisionId, body });
          }}
        />
      )}
    </main>
  );
}

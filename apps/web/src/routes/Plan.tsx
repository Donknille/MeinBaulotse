import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '../components/ui';
import { PlanView } from '../components/PlanView';
import { api } from '../lib/api';

/** Route: holt den Plan und übergibt ihn an die Darstellung. */
export function Plan() {
  const { projectId } = useParams<{ projectId: string }>();
  const query = useQuery({
    queryKey: ['schedule', projectId],
    queryFn: () => api.schedule(projectId!),
    enabled: projectId !== undefined,
  });

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-4 py-8 sm:px-6">
      {query.isPending ? (
        <p className="text-body text-steel">Der Plan wird geladen.</p>
      ) : query.isError || query.data === undefined ? (
        <EmptyState text="Dieses Projekt konnten wir nicht laden. Prüf bitte den Link, oder öffne es noch einmal aus deiner Übersicht." />
      ) : (
        <PlanView schedule={query.data} />
      )}
    </main>
  );
}

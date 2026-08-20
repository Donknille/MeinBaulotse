/**
 * Verlauf — die Änderungshistorie aus `schedule_change`.
 *
 * Append-only, per Rechteentzug und Trigger. Was hier steht, steht dort, und
 * es lässt sich nicht nachträglich glattziehen. Genau deshalb ist es später
 * etwas wert.
 */

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import {
  CHANGE_REASON_LABEL,
  ROLE_LABEL,
  type ScheduleChangeEntry,
} from '@meinbaulotse/shared';
import { Card, EmptyState, Pill, SectionPill } from '../components/ui';
import { api } from '../lib/api';
import { formatDate, STATUS_LABEL } from '../lib/format';
import { useProject } from './ProjectLayout';

const FIELD_LABEL: Record<string, string> = {
  task_created: 'angelegt',
  current_start: 'Beginn',
  current_end: 'Ende',
  duration_days: 'Dauer',
  status: 'Status',
};

export function Changes() {
  const { projectId } = useProject();
  const query = useQuery({
    queryKey: ['changes', projectId],
    queryFn: () => api.changes(projectId),
  });

  const entries = (query.data?.changes ?? []).filter(
    (entry) => entry.field !== 'task_created' || entry.reasonCode !== 'planinitialisierung',
  );

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="display-title text-heading-lg text-charcoal">Verlauf</h1>
        <p className="max-w-[34rem] text-body text-steel">
          Jede Terminänderung mit Zeitpunkt, Verursacher und Grund. Einträge werden ergänzt, nie
          ersetzt — auch nicht von uns.
        </p>
      </header>

      <SectionPill tone="neutral" icon={<History size={18} />}>
        {entries.length} Einträge
      </SectionPill>

      {query.isPending ? (
        <p className="text-body text-steel">Wird geladen.</p>
      ) : entries.length === 0 ? (
        <EmptyState text="Noch keine Verschiebungen. Wenn sich ein Termin ändert, steht er hier — mit Grund und Auswirkung auf den Endtermin." />
      ) : (
        <Card className="py-0">
          <ol>
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}

function Entry({ entry }: { entry: ScheduleChangeEntry }) {
  return (
    <li className="flex flex-col gap-1 border-b border-ash py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-[8rem] text-body text-steel">
          {new Date(entry.createdAt).toLocaleString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span className="grow text-body-lg font-medium text-charcoal">
          {entry.taskName ?? 'Vorgang'}
        </span>
        <span className="text-body text-steel">
          {FIELD_LABEL[entry.field] ?? entry.field}: {render(entry.field, entry.oldValue)} →{' '}
          <span className="font-medium text-charcoal">{render(entry.field, entry.newValue)}</span>
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-caption text-steel">
        {entry.reasonCode === null ? null : (
          <Pill tone="amber">{CHANGE_REASON_LABEL[entry.reasonCode]}</Pill>
        )}
        {entry.reasonText === null ? null : <span>{entry.reasonText}</span>}
        <span>
          {entry.actorName ?? 'Unbekannt'}
          {entry.actorRole === null ? '' : ` · ${ROLE_LABEL[entry.actorRole]}`}
          {entry.actorChannel === 'guest_link' ? ' · über Gast-Link' : ''}
        </span>
      </div>
    </li>
  );
}

function render(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
    if (field === 'status') return STATUS_LABEL[value as keyof typeof STATUS_LABEL] ?? value;
    return value;
  }
  if (typeof value === 'number') return String(value);
  return '—';
}

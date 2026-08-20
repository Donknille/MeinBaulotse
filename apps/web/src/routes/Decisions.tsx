/**
 * Entscheidungen — Abschnitt 3.2 der Spezifikation.
 *
 * Sortiert nach Frist, nicht nach Thema: Was zuerst fällig ist, steht oben.
 * Die Frist selbst wird nicht gepflegt, sondern gerechnet — verschiebt sich
 * der blockierte Vorgang, wandert sie mit.
 *
 * Keine Produktempfehlungen, keine Anbieter, keine Verweise nach draußen. Die
 * Neutralität an dieser Stelle ist das, was das ganze Produkt trägt.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, ChevronDown } from 'lucide-react';
import {
  DECISION_STATUS_LABEL,
  decisionDueInPlainWords,
  decisionStatus as decisionStatusSchema,
  type DecisionDto,
  type DecisionStatus,
} from '@meinbaulotse/shared';
import { Button, Card, EmptyState, Field, Pill, Select, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDate, formatDuration } from '../lib/format';
import { useProject } from './ProjectLayout';

export function Decisions() {
  const { projectId, decisions, can, view } = useProject();
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const patch = useMutation({
    mutationFn: ({ id, ...rest }: { id: string; status?: DecisionStatus; decidedNote?: string }) =>
      api.patchDecision(projectId, id, rest),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['decisions', projectId] });
    },
    onError: (cause: unknown) =>
      setError(
        cause instanceof ApiError
          ? [cause.message, cause.hint].filter(Boolean).join(' ')
          : 'Das hat nicht geklappt.',
      ),
  });

  if (view.role === 'trade') {
    return (
      <EmptyState text="Entscheidungen sind Sache des Bauherrn. In dieser Rolle siehst du sie nicht — auch nicht, was sie kosten." />
    );
  }

  const offen = decisions.filter(
    (entry) => entry.status === 'offen' || entry.status === 'in_bemusterung',
  );
  const erledigt = decisions.filter(
    (entry) => entry.status !== 'offen' && entry.status !== 'in_bemusterung',
  );

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="display-title text-heading-lg text-charcoal">Entscheidungen</h1>
        <p className="max-w-[34rem] text-body text-steel">
          Jede dieser Entscheidungen hängt an einem Vorgang und einer Vorlaufzeit. Verschiebt sich
          der Vorgang, verschiebt sich die Frist mit.
        </p>
      </header>

      {error !== null ? (
        <Card tone="muted">
          <p className="text-body text-alarm-red">{error}</p>
        </Card>
      ) : null}

      {decisions.length === 0 ? (
        <EmptyState text="Zu diesem Projekt sind noch keine Entscheidungen hinterlegt." />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-subheading font-medium text-charcoal">
            Offen ({offen.length})
          </h2>
          {offen.length === 0 ? (
            <EmptyState text="Alles entschieden. Sobald ein Vorgang näher rückt, kommt hier die nächste Frist dazu." />
          ) : (
            <ul className="flex flex-col gap-2">
              {offen.map((decision) => (
                <li key={decision.id}>
                  <DecisionCard
                    decision={decision}
                    editable={can('decision.write')}
                    busy={patch.isPending}
                    onPatch={(input) => patch.mutate({ id: decision.id, ...input })}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {erledigt.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-subheading font-medium text-charcoal">
            Erledigt ({erledigt.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {erledigt.map((decision) => (
              <li key={decision.id}>
                <DecisionCard
                  decision={decision}
                  editable={can('decision.write')}
                  busy={patch.isPending}
                  onPatch={(input) => patch.mutate({ id: decision.id, ...input })}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function DecisionCard({
  decision,
  editable,
  busy,
  onPatch,
}: {
  decision: DecisionDto;
  editable: boolean;
  busy: boolean;
  onPatch: (input: { status?: DecisionStatus; decidedNote?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(decision.decidedNote ?? '');

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-body-xl font-medium text-charcoal">{decision.title}</h3>
          {decision.description === null ? null : (
            <p className="text-body text-steel">{decision.description}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Pill
            tone={
              decision.status === 'entschieden' || decision.status === 'beauftragt'
                ? 'green'
                : decision.isOverdue
                  ? 'red'
                  : 'neutral'
            }
          >
            {DECISION_STATUS_LABEL[decision.status]}
          </Pill>
          <span className="text-body font-medium text-charcoal">
            {decision.dueDate === null ? 'ohne Frist' : `bis ${formatDate(decision.dueDate)}`}
          </span>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-body text-steel">
        {decision.isOverdue ? <AlarmClock size={15} className="text-alarm-red" aria-hidden /> : null}
        {decisionDueInPlainWords(decision.remainingWorkdays, decision.isOverdue)}
      </p>

      <p className="text-caption text-fog">
        {decision.blocksTaskName === null
          ? 'Ohne Vorgangsbezug'
          : `Blockiert „${decision.blocksTaskName}" · Vorlauf ${formatDuration(
              decision.leadTimeDays,
              decision.leadTimeUnit,
            )}`}
      </p>

      {decision.helpText === null ? null : (
        <div>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex items-center gap-1.5 text-body font-medium text-electric-blue"
          >
            <ChevronDown
              size={15}
              aria-hidden
              className={`transition-transform duration-[var(--motion-micro)] ${open ? 'rotate-180' : ''}`}
            />
            Worum es geht
          </button>
          {open ? (
            <p className="mt-2 max-w-[42rem] text-body-lg text-slate">{decision.helpText}</p>
          ) : null}
        </div>
      )}

      {editable ? (
        <div className="flex flex-col gap-3 border-t border-ash pt-3">
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <Field label="Stand">
              <Select
                value={decision.status}
                disabled={busy}
                onChange={(event) => onPatch({ status: event.target.value as DecisionStatus })}
              >
                {decisionStatusSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {DECISION_STATUS_LABEL[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Notiz" hint="Was habt ihr entschieden? Ein Satz reicht.">
              <TextInput
                value={note}
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
                onBlur={() => {
                  if (note !== (decision.decidedNote ?? '')) onPatch({ decidedNote: note });
                }}
              />
            </Field>
          </div>
          {decision.status === 'offen' ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onPatch({ status: 'entschieden' })}
              >
                Als entschieden eintragen
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

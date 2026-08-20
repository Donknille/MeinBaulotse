/**
 * Vorgangsblatt: ansehen, verschieben, bestätigen, Ist-Stand melden.
 *
 * Es fährt von unten ein und liegt über der Liste, statt sie zu ersetzen —
 * der Bauherr verliert sonst die Stelle, an der er gerade war.
 *
 * Nach jeder Änderung steht die Folge als Satz da: wie viele Vorgänge
 * mitwandern und was mit dem Bauende passiert. Eine Verschiebung ohne diese
 * Auskunft ist der Grund, warum niemand seinem Terminplan traut.
 */

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  CHANGE_REASON_LABEL,
  endShiftInPlainWords,
  floatInPlainWords,
  changeReason as changeReasonSchema,
  type ChangeReason,
  type ScheduledTaskDto,
  type TaskPatchRequest,
  type TaskPatchResult,
} from '@meinbaulotse/shared';
import { Button, Card, Field, Pill, Select, TextInput } from './ui';
import { ConfirmationChip } from './schedule';
import { api, ApiError } from '../lib/api';
import { formatDate, formatDuration, formatRange } from '../lib/format';
import { STATUS_LABEL } from '../lib/format';

const REASONS = changeReasonSchema.options.filter((value) => value !== 'planinitialisierung');

export function TaskSheet({
  projectId,
  task,
  can,
  onClose,
}: {
  projectId: string;
  task: ScheduledTaskDto;
  can: (permission: string) => boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [start, setStart] = useState(task.currentStart ?? '');
  const [duration, setDuration] = useState(String(task.durationDays));
  const [reason, setReason] = useState<ChangeReason>('planungsaenderung');
  const [reasonText, setReasonText] = useState('');
  const [actualStart, setActualStart] = useState(task.actualStart ?? '');
  const [actualEnd, setActualEnd] = useState(task.actualEnd ?? '');
  const [result, setResult] = useState<TaskPatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStart(task.currentStart ?? '');
    setDuration(String(task.durationDays));
    setActualStart(task.actualStart ?? '');
    setActualEnd(task.actualEnd ?? '');
    setResult(null);
    setError(null);
  }, [task.id, task.currentStart, task.durationDays, task.actualStart, task.actualEnd]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = useMutation({
    mutationFn: (input: TaskPatchRequest) => api.patchTask(projectId, task.id, input),
    onSuccess: async (data) => {
      setResult(data);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['schedule', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['decisions', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['changes', projectId] });
    },
    onError: (cause: unknown) => {
      const message =
        cause instanceof ApiError
          ? [cause.message, cause.hint].filter(Boolean).join(' ')
          : 'Das hat nicht geklappt. Versuch es bitte noch einmal.';
      setError(message);
      setResult(null);
    },
  });

  const mayReschedule = can('task.schedule');
  const mayConfirm = can('task.confirm');
  const mayReport = can('task.report');

  function submitSchedule(): void {
    const input: TaskPatchRequest = {
      reasonCode: reason,
      ...(reasonText.trim() === '' ? {} : { reasonText: reasonText.trim() }),
      ...(start === '' || start === task.currentStart ? {} : { currentStart: start }),
      ...(Number(duration) === task.durationDays ? {} : { durationDays: Number(duration) }),
    };
    if (input.currentStart === undefined && input.durationDays === undefined) {
      setError('Da ist noch nichts geändert.');
      return;
    }
    patch.mutate(input);
  }

  function submitActuals(): void {
    patch.mutate({
      reasonCode: 'sonstiges',
      actualStart: actualStart === '' ? null : actualStart,
      actualEnd: actualEnd === '' ? null : actualEnd,
      ...(actualEnd === '' ? {} : { status: 'fertig' as const }),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Schließen"
        onClick={onClose}
        className="absolute inset-0 bg-midnight-ink/20"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={task.name}
        className="relative flex max-h-[92dvh] w-full max-w-[38rem] flex-col overflow-y-auto rounded-t-[var(--radius-large)] border border-ash bg-canvas-white shadow-[var(--shadow-sheet)] sm:rounded-[var(--radius-large)]"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ash bg-canvas-white p-5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-heading-sm font-medium text-charcoal">{task.name}</h2>
            <div className="flex flex-wrap items-center gap-2">
              <ConfirmationChip value={task.confirmation} />
              <Pill>{STATUS_LABEL[task.status]}</Pill>
              {task.isCritical ? <Pill tone="amber">kritischer Pfad</Pill> : null}
              {task.tradeName === null ? null : <Pill>{task.tradeName}</Pill>}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Schließen">
            <X size={18} aria-hidden />
          </Button>
        </header>

        <div className="flex flex-col gap-6 p-5">
          <dl className="grid grid-cols-2 gap-4">
            <Detail label="Geplant" value={formatRange(task.currentStart, task.currentEnd)} />
            <Detail label="Dauer" value={formatDuration(task.durationDays, task.durationUnit)} />
            <Detail
              label="Ursprünglich"
              value={formatRange(task.baselineStart, task.baselineEnd)}
            />
            <Detail
              label="Ist"
              value={
                task.actualStart === null && task.actualEnd === null
                  ? 'noch nicht gemeldet'
                  : formatRange(task.actualStart, task.actualEnd)
              }
            />
          </dl>

          <p className="text-body text-steel">{floatInPlainWords(task.totalFloatDays)}</p>

          {task.isWait ? (
            <Card tone="muted">
              <p className="text-body text-steel">
                Das ist eine technologische Wartezeit. Sie läuft in Kalendertagen, auch über
                Wochenenden und Feiertage, und lässt sich nicht verkürzen — auch nicht gegen
                Aufpreis.
              </p>
            </Card>
          ) : null}

          {result !== null ? (
            <Card tone="muted">
              <p className="text-body-lg font-medium text-charcoal">
                {endShiftInPlainWords(result.endShiftWorkdays, result.shiftedCount)}
              </p>
              {result.shifted.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {result.shifted.slice(0, 8).map((entry) => (
                    <li key={entry.id} className="text-caption text-steel">
                      {entry.name}: {formatDate(entry.fromStart)} → {formatDate(entry.toStart)}
                    </li>
                  ))}
                  {result.shifted.length > 8 ? (
                    <li className="text-caption text-fog">
                      und {result.shifted.length - 8} weitere
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </Card>
          ) : null}

          {error !== null ? (
            <Card tone="muted">
              <p className="text-body text-alarm-red">{error}</p>
            </Card>
          ) : null}

          {mayReschedule && !task.isWait ? (
            <section className="flex flex-col gap-4">
              <h3 className="text-subheading font-medium text-charcoal">Termin ändern</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Beginn" hint="Früher als die Vorgänger geht nicht — wir sagen dir, wo er landet.">
                  <TextInput
                    type="date"
                    value={start}
                    onChange={(event) => setStart(event.target.value)}
                  />
                </Field>
                <Field label={task.durationUnit === 'kalendertage' ? 'Kalendertage' : 'Werktage'}>
                  <TextInput
                    type="number"
                    min={task.isMilestone ? 0 : 1}
                    max={999}
                    value={duration}
                    onChange={(event) => setDuration(event.target.value)}
                    disabled={task.isMilestone}
                  />
                </Field>
              </div>
              <Field label="Warum?" hint="Der Grund steht später im Verlauf und im Wochenbericht.">
                <Select value={reason} onChange={(event) => setReason(event.target.value as ChangeReason)}>
                  {REASONS.map((value) => (
                    <option key={value} value={value}>
                      {CHANGE_REASON_LABEL[value]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Notiz" hint="Optional. Ein Satz genügt.">
                <TextInput
                  value={reasonText}
                  onChange={(event) => setReasonText(event.target.value)}
                  placeholder="Estrichpumpe erst in zwei Wochen frei"
                />
              </Field>
              <Button variant="primary" size="field" onClick={submitSchedule} disabled={patch.isPending}>
                {patch.isPending ? 'Wird gerechnet …' : 'Termin ändern'}
              </Button>
            </section>
          ) : null}

          {mayReport ? (
            <section className="flex flex-col gap-4 border-t border-ash pt-5">
              <h3 className="text-subheading font-medium text-charcoal">Ist-Stand melden</h3>
              <p className="text-body text-steel">
                Ein gemeldeter Ist-Termin schlägt die Rechnung. Der Rest des Ablaufs richtet sich
                danach.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Tatsächlich begonnen">
                  <TextInput
                    type="date"
                    value={actualStart}
                    onChange={(event) => setActualStart(event.target.value)}
                  />
                </Field>
                <Field label="Tatsächlich fertig">
                  <TextInput
                    type="date"
                    value={actualEnd}
                    onChange={(event) => setActualEnd(event.target.value)}
                  />
                </Field>
              </div>
              <Button variant="outline" size="field" onClick={submitActuals} disabled={patch.isPending}>
                Ist-Stand speichern
              </Button>
            </section>
          ) : null}

          {mayConfirm && task.confirmation !== 'mutual' ? (
            <section className="flex flex-col gap-3 border-t border-ash pt-5">
              <h3 className="text-subheading font-medium text-charcoal">Termin bestätigen</h3>
              <p className="text-body text-steel">
                Bestätigt bedeutet: Beide Seiten haben denselben Termin im Kalender. Das ist der
                Unterschied zwischen einem Wunsch und einer Absprache.
              </p>
              <Button
                variant="outline"
                size="field"
                onClick={() => patch.mutate({ confirmation: 'mutual' })}
                disabled={patch.isPending}
              >
                Als abgestimmt eintragen
              </Button>
            </section>
          ) : null}

          {!mayReschedule && !mayReport && !mayConfirm ? (
            <p className="text-body text-steel">
              In dieser Rolle liest du den Plan. Termine ändert der Bauherr oder der
              Generalunternehmer.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-steel">{label}</dt>
      <dd className="text-body-lg text-charcoal">{value}</dd>
    </div>
  );
}

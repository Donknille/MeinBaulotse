/**
 * Cockpit — Abschnitt 5.1 der Spezifikation.
 *
 * Die Reihenfolge ist Absicht und wird nicht umsortiert:
 * erst wo stehen wir, dann was kommt, dann was **du** tun musst,
 * dann erst was schiefgeht.
 *
 * Wer die schlechten Nachrichten nach oben zieht, bekommt eine App, die
 * niemand freiwillig öffnet.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, CalendarDays, ClipboardList, Compass, MoveRight } from 'lucide-react';
import {
  CHANGE_REASON_LABEL,
  decisionDueInPlainWords,
  type DecisionDto,
  type ScheduleChangeEntry,
  type ScheduledTaskDto,
} from '@meinbaulotse/shared';
import { Button, Card, EmptyState, Pill, SectionPill } from '../components/ui';
import { currentPhaseKey, PhaseBar } from '../components/schedule';
import { api, todayIso } from '../lib/api';
import { epochDay, formatDate, formatDateWithWeekday, formatRange } from '../lib/format';
import { useProject } from './ProjectLayout';

export function Cockpit() {
  const { projectId, schedule, decisions, view } = useProject();
  const today = todayIso();
  const referenceYear = Number(schedule.project.plannedStart.slice(0, 4));

  const changes = useQuery({
    queryKey: ['changes', projectId],
    queryFn: () => api.changes(projectId),
  });

  const thisWeek = useMemo(() => tasksInWindow(schedule.tasks, today, 7), [schedule.tasks, today]);
  const upcoming = useMemo(
    () => decisions.filter((entry) => entry.status === 'offen' || entry.status === 'in_bemusterung'),
    [decisions],
  );
  const currentPhase = currentPhaseKey(schedule, today);
  const recent = useMemo(() => recentShifts(changes.data?.changes ?? []), [changes.data]);

  return (
    <>
      {/* 1. Wo stehen wir ---------------------------------------------------- */}
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="display-title text-heading-lg text-charcoal">
            {schedule.project.name}
          </h1>
          <Link to="plan">
            <Button variant="outline" size="sm">
              Ganzen Ablauf ansehen
              <MoveRight size={15} aria-hidden />
            </Button>
          </Link>
        </div>

        <Card className="flex flex-col gap-5">
          <PhaseBar
            phases={schedule.phases}
            {...(currentPhase === undefined ? {} : { currentKey: currentPhase })}
          />

          <dl className="flex flex-wrap gap-x-10 gap-y-4">
            <Metric label="Errechnetes Ende" value={formatDate(schedule.computedEnd)} strong />
            <Metric
              label="Geschuldet"
              value={
                schedule.contractualEnd === null
                  ? 'nicht erfasst'
                  : formatDate(schedule.contractualEnd)
              }
            />
            {schedule.deviationWorkdays !== null ? (
              <Metric
                label="Abweichung"
                value={deviationInWords(schedule.deviationWorkdays)}
                tone={schedule.deviationWorkdays > 0 ? 'warn' : 'ok'}
              />
            ) : null}
          </dl>

          {schedule.contractualEnd === null ? (
            <p className="text-caption text-steel">
              Sobald du den vertraglich geschuldeten Fertigstellungstermin erfasst, sagen wir dir,
              wie weit der errechnete Plan davon abweicht.{' '}
              <Link to="einstellungen" className="font-medium text-electric-blue underline">
                Jetzt nachtragen
              </Link>
            </p>
          ) : null}
        </Card>
      </header>

      {/* 2. Was kommt -------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionPill tone="blue" icon={<CalendarDays size={18} />}>
          Diese Woche
        </SectionPill>

        {thisWeek.length === 0 ? (
          <EmptyState text="In den nächsten sieben Tagen steht in deinem Ausschnitt kein Vorgang an. Der nächste Termin steht im Terminplan." />
        ) : (
          <Card className="py-0">
            <ul>
              {thisWeek.map((task) => (
                <li
                  key={task.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-ash py-3 last:border-b-0"
                >
                  <span className="min-w-[8.5rem] text-body text-steel">
                    {formatDateWithWeekday(task.currentStart, referenceYear)}
                  </span>
                  <span className="grow text-body-lg font-medium text-charcoal">{task.name}</span>
                  {task.tradeName === null ? null : (
                    <span className="text-caption text-steel">{task.tradeName}</span>
                  )}
                  <span className="text-caption text-fog">
                    {formatRange(task.currentStart, task.currentEnd, referenceYear)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* 3. Was DU tun musst -------------------------------------------------- */}
      {view.role === 'trade' ? null : (
        <section className="flex flex-col gap-3">
          <SectionPill tone="violet" icon={<ClipboardList size={18} />}>
            Du musst entscheiden
          </SectionPill>

          {upcoming.length === 0 ? (
            <EmptyState text="Gerade steht keine Entscheidung an. Sobald eine Frist näher rückt, steht sie hier — mit dem Vorgang, den sie blockiert." />
          ) : (
            <Card className="py-0">
              <ul>
                {upcoming.slice(0, 5).map((decision) => (
                  <DecisionLine key={decision.id} decision={decision} />
                ))}
              </ul>
            </Card>
          )}

          {upcoming.length > 5 ? (
            <Link to="entscheidungen" className="text-body text-electric-blue underline">
              Alle {upcoming.length} Entscheidungen ansehen
            </Link>
          ) : null}
        </section>
      )}

      {/* 4. Und erst danach: was schiefgeht ----------------------------------- */}
      <section className="flex flex-col gap-3">
        <SectionPill tone="amber" icon={<Compass size={18} />}>
          Zuletzt verschoben
        </SectionPill>

        {recent.length === 0 ? (
          <EmptyState text="Noch keine Verschiebungen. Wenn sich ein Termin ändert, steht er hier — mit Grund und Auswirkung auf den Endtermin." />
        ) : (
          <Card className="py-0">
            <ul>
              {recent.slice(0, 6).map((change) => (
                <li key={change.id} className="flex flex-col gap-1 border-b border-ash py-3 last:border-b-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="grow text-body-lg font-medium text-charcoal">
                      {change.taskName ?? 'Vorgang'}
                    </span>
                    <span className="text-body text-steel">
                      {formatDate(asDate(change.oldValue), referenceYear)} →{' '}
                      <span className="font-medium text-charcoal">
                        {formatDate(asDate(change.newValue), referenceYear)}
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-caption text-steel">
                    {change.reasonCode === null ? null : (
                      <Pill tone="amber">{CHANGE_REASON_LABEL[change.reasonCode]}</Pill>
                    )}
                    {change.reasonText === null ? null : <span>{change.reasonText}</span>}
                    {change.actorName === null ? null : <span>· {change.actorName}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Link to="verlauf" className="text-body text-electric-blue underline">
          Ganzen Verlauf ansehen
        </Link>
      </section>
    </>
  );
}

function DecisionLine({ decision }: { decision: DecisionDto }) {
  return (
    <li className="flex flex-col gap-1 border-b border-ash py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="grow text-body-lg font-medium text-charcoal">{decision.title}</span>
        <span
          className={`text-body ${decision.isOverdue ? 'font-medium text-alarm-red' : 'text-steel'}`}
        >
          {decision.dueDate === null ? 'ohne Frist' : `bis ${formatDate(decision.dueDate)}`}
        </span>
      </div>
      <p className="flex items-center gap-1.5 text-caption text-steel">
        {decision.isOverdue ? <AlarmClock size={13} className="text-alarm-red" aria-hidden /> : null}
        {decisionDueInPlainWords(decision.remainingWorkdays, decision.isOverdue)}
      </p>
      {decision.blocksTaskName === null ? null : (
        <p className="text-caption text-fog">Blockiert: {decision.blocksTaskName}</p>
      )}
    </li>
  );
}

function Metric({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'ok' | 'warn';
}) {
  const color =
    tone === 'warn' ? 'text-tangerine' : tone === 'ok' ? 'text-vivid-green' : 'text-charcoal';
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-steel">{label}</dt>
      <dd className={`${strong ? 'text-heading-sm' : 'text-subheading'} font-medium ${color}`}>
        {value}
      </dd>
    </div>
  );
}

/** Auch die schlechte Zahl kommt als Satz, nicht als nacktes Vorzeichen. */
function deviationInWords(workdays: number): string {
  if (workdays === 0) return 'genau im Plan';
  if (workdays > 0) return `${workdays} Werktage später`;
  return `${Math.abs(workdays)} Werktage früher`;
}

/** Vorgänge, die im Fenster laufen — nicht nur die, die darin beginnen. */
function tasksInWindow(
  tasks: readonly ScheduledTaskDto[],
  today: string,
  days: number,
): ScheduledTaskDto[] {
  const from = epochDay(today);
  const to = from + days;
  return tasks
    .filter((task) => {
      if (task.currentStart === null || task.currentEnd === null) return false;
      if (task.status === 'entfallen') return false;
      return epochDay(task.currentStart) <= to && epochDay(task.currentEnd) >= from;
    })
    .sort((a, b) => (a.currentStart! < b.currentStart! ? -1 : 1));
}

/** Nur Terminverschiebungen, und je Vorgang die jüngste. */
function recentShifts(changes: readonly ScheduleChangeEntry[]): ScheduleChangeEntry[] {
  const seen = new Set<string>();
  const result: ScheduleChangeEntry[] = [];
  for (const change of changes) {
    if (change.field !== 'current_start') continue;
    if (change.reasonCode === 'planinitialisierung') continue;
    const key = change.taskId ?? change.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(change);
  }
  return result;
}

function asDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

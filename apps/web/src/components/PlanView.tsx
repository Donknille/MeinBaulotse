/**
 * Darstellung des Terminplans, ohne Datenbeschaffung.
 *
 * Die Trennung hat einen praktischen Grund: So lässt sich die Ansicht im
 * Styleguide mit einer festen Datenlage prüfen, ohne Anmeldung und ohne
 * Datenbank.
 *
 * Reihenfolge nach Abschnitt 5.1 der Spezifikation: erst wo stehen wir, dann
 * was kommt.
 */

import { useState } from 'react';
import { CalendarDays, Check, ChevronDown, GanttChartSquare, Scale } from 'lucide-react';
import type {
  DecisionDto,
  DecisionUpdateRequest,
  ProjectSchedule,
  ScheduledTaskDto,
  ShiftPreview,
  TaskUpdateRequest,
} from '@meinbaulotse/shared';
import { decisionInPlainWords, isDecisionOpen } from '@meinbaulotse/shared';
import { Card, Pill, SectionPill } from './ui';
import { TaskRow } from './schedule';
import { Cockpit } from './Cockpit';
import { Timeline } from './Timeline';
import { TaskSheet } from './TaskSheet';
import { GuideCardSheet, type GuideCardHandlers } from './GuideCard';
import { DecisionSheet, DECISION_STATUS_LABEL } from './DecisionSheet';
import { WeeklyReportLink } from '../routes/WeeklyReport';
import { formatDate } from '../lib/format';
import { calendarOf, remainingWorkdays, urgencyOf } from '../lib/decisions';
import { abilitiesOf, ROLE_DESCRIPTION, ROLE_LABEL } from '../lib/roles';

export function PlanView({
  schedule,
  onChangeTask,
  onPreviewShift,
  onChangeDecision,
  guideCards,
}: {
  schedule: ProjectSchedule;
  /** Fehlt sie, ist die Ansicht nur zum Lesen — so wie im Styleguide. */
  onChangeTask?: (taskId: string, change: TaskUpdateRequest) => Promise<void>;
  /** Fehlt sie, wird ohne Vorschau verschoben. */
  onPreviewShift?: (taskId: string, change: TaskUpdateRequest) => Promise<ShiftPreview>;
  /** Fehlt sie, lässt sich eine Entscheidung ansehen, aber nicht pflegen. */
  onChangeDecision?: (decisionId: string, change: DecisionUpdateRequest) => Promise<void>;
  /** Fehlen sie, führt keine Zeile zur Lotsenkarte. */
  guideCards?: GuideCardHandlers;
}) {
  const [selected, setSelected] = useState<ScheduledTaskDto | null>(null);
  const [guideCardTask, setGuideCardTask] = useState<ScheduledTaskDto | null>(null);
  const [decision, setDecision] = useState<DecisionDto | null>(null);
  const calendar = calendarOf(schedule.project);
  const referenceYear = Number(schedule.project.plannedStart.slice(0, 4));
  const currentPhase = currentPhaseKey(schedule);
  const byPhase = schedule.phases.filter((phase) => phase.taskCount > 0);

  return (
    <>
      <header className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="display-title text-heading-lg text-charcoal">{schedule.project.name}</h1>
            {/* Wer schaut, steht neben dem Namen: In einem Projekt mit mehreren
                Beteiligten ist das die erste Frage, nicht die letzte. */}
            <Pill tone={schedule.project.role === 'owner' ? 'blue' : 'neutral'}>
              {ROLE_LABEL[schedule.project.role]}
            </Pill>
          </div>
          <p className="text-body text-steel">
            Baubeginn {formatDate(schedule.project.plannedStart)} ·{' '}
            {schedule.project.hasBasement ? 'mit Keller' : 'ohne Keller'} · {schedule.tasks.length}{' '}
            Vorgänge
          </p>
        </div>

        {/* Das Cockpit steht vor allem anderen. Reihenfolge nach CI 10.2:
            erst wo wir stehen, dann was kommt, dann was du tun musst, dann
            erst was schiefgeht. */}
        <Cockpit
          schedule={schedule}
          currentPhase={currentPhase}
          {...(onChangeTask === undefined ? {} : { onSelect: setSelected })}
          {...(guideCards === undefined ? {} : { onGuideCard: setGuideCardTask })}
          onDecision={setDecision}
        />

        {/* Der Wochenbericht steht direkt unter dem Cockpit: Er beantwortet
            dieselben Fragen, nur zusammengefasst und für einen Blick pro
            Woche statt für einen pro Tag. */}
        {onChangeTask !== undefined ? <WeeklyReportLink projectId={schedule.project.id} /> : null}
      </header>

      {/* Die Zeitachse erst ab 768 px. Mobil bleibt die Liste die Grundansicht
          (CI 10.1): Ein halbes Jahr Bauzeit auf 360 px ist kein Überblick. */}
      <section className="hidden flex-col gap-4 md:flex">
        <SectionPill tone="blue" icon={<GanttChartSquare size={18} />}>
          Die Zeitachse
        </SectionPill>
        <Card>
          <Timeline schedule={schedule} />
        </Card>
      </section>

      {/* Der vollständige Ablauf ist zugeklappt. 34 Vorgänge am Stück sind
          die Tiefe dieser Anwendung, nicht ihr Einstieg — wer zum ersten Mal
          baut, sieht darin alles und weiß nichts. Wer sie braucht, klappt sie
          auf; der Browser merkt sich das nicht, und das ist richtig so: Der
          Einstieg soll bei jedem Öffnen derselbe sein. */}
      <details className="group flex flex-col gap-8">
        <summary className="cursor-pointer list-none">
          <SectionPill tone="blue" icon={<CalendarDays size={18} />}>
            Der ganze Ablauf · {schedule.tasks.length} Vorgänge
            <ChevronDown
              size={16}
              className="ml-1 transition-transform duration-[var(--motion-micro)] group-open:rotate-180"
              aria-hidden
            />
          </SectionPill>
        </summary>
        <div className="mt-6 flex flex-col gap-8">
          {byPhase.map((phase) => {
            const tasks = schedule.tasks.filter((task) => task.phaseKey === phase.key);
            return (
              <div key={phase.key} className="flex flex-col gap-2">
                <h2 className="text-subheading font-medium text-charcoal">
                  {phase.ordinal}. {phase.name}
                </h2>
                <Card className="py-0">
                  <ul>
                    {tasks.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        referenceYear={referenceYear}
                        {...(onChangeTask === undefined ? {} : { onSelect: setSelected })}
                        {...(guideCards === undefined ? {} : { onGuideCard: setGuideCardTask })}
                      />
                    ))}
                  </ul>
                </Card>
              </div>
            );
          })}
        </div>
      </details>
      {/* Alle Entscheidungen, auch die erledigten. Das Cockpit zeigt nur, was
          jetzt ansteht; wer den Überblick will, klappt hier auf. */}
      {schedule.decisions.length > 0 ? (
        <details className="group flex flex-col gap-8">
          <summary className="cursor-pointer list-none">
            <SectionPill tone="amber" icon={<Scale size={18} />}>
              Alle Entscheidungen · {schedule.decisions.filter(isDecisionOpen).length} offen von{' '}
              {schedule.decisions.length}
              <ChevronDown
                size={16}
                className="ml-1 transition-transform duration-[var(--motion-micro)] group-open:rotate-180"
                aria-hidden
              />
            </SectionPill>
          </summary>
          <Card className="mt-6 py-0">
            <ul>
              {schedule.decisions.map((entry) => {
                const dringlichkeit = urgencyOf(entry, calendar);
                return (
                  <li key={entry.id} className="border-b border-ash last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setDecision(entry)}
                      className="flex min-h-11 w-full flex-col gap-0.5 py-3 text-left transition-colors duration-[var(--motion-micro)] hover:bg-paper-mist sm:flex-row sm:items-baseline sm:gap-3"
                    >
                      <span
                        className={`text-body sm:min-w-[11rem] ${
                          dringlichkeit === 'verstrichen'
                            ? 'text-alarm-red'
                            : dringlichkeit === 'knapp'
                              ? 'text-tangerine'
                              : 'text-steel'
                        }`}
                      >
                        {entry.dueDate === null ? 'ohne Frist' : formatDate(entry.dueDate)}
                        {isDecisionOpen(entry)
                          ? ` · ${decisionInPlainWords(remainingWorkdays(entry, calendar))}`
                          : ''}
                      </span>
                      <span className="flex flex-wrap items-baseline gap-x-2 text-body-lg font-medium text-charcoal">
                        {entry.title}
                        <span className="text-caption font-normal text-steel">
                          {DECISION_STATUS_LABEL[entry.status]}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        </details>
      ) : null}

      {/* Die Rechte stehen weiterhin da, nur nicht mehr als Erstes: dreizehn
          Zeilen „was du darfst" beantworten keine der Fragen, mit denen jemand
          die Anwendung öffnet. Wer wissen will, was seine Rolle bedeutet,
          klappt es auf. */}
      <details>
        <summary className="cursor-pointer list-none">
          <SectionPill tone="neutral" icon={<Check size={18} />}>
            Was du in diesem Bauvorhaben tun kannst
            <ChevronDown
              size={16}
              className="ml-1 transition-transform duration-[var(--motion-micro)]"
              aria-hidden
            />
          </SectionPill>
        </summary>
        <div className="mt-4">
          <RoleCard schedule={schedule} />
        </div>
      </details>

      {selected !== null && onChangeTask !== undefined ? (
        <TaskSheet
          task={selected}
          schedule={schedule}
          onClose={() => setSelected(null)}
          onSave={(change) => onChangeTask(selected.id, change)}
          {...(onPreviewShift === undefined
            ? {}
            : { onPreview: (change: TaskUpdateRequest) => onPreviewShift(selected.id, change) })}
        />
      ) : null}

      {decision !== null ? (
        <DecisionSheet
          decision={decision}
          calendar={calendar}
          canWrite={
            onChangeDecision !== undefined && schedule.permissions.includes('decision.write')
          }
          onClose={() => setDecision(null)}
          onSave={async (change) => {
            await onChangeDecision!(decision.id, change);
          }}
        />
      ) : null}

      {guideCardTask !== null && guideCards !== undefined ? (
        <GuideCardSheet
          taskId={guideCardTask.id}
          referenceYear={referenceYear}
          handlers={guideCards}
          onClose={() => setGuideCardTask(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Was diese Rolle in diesem Projekt tun kann — und was nicht.
 *
 * Die Liste kommt aus `schedule.permissions`, also aus der Rechtematrix in der
 * Datenbank. Die Oberfläche verspricht damit nichts, was eine Policy hinterher
 * ablehnt, und verschweigt nichts, was erlaubt wäre.
 *
 * Auch die Fehlanzeige trägt den nächsten Schritt: Wer etwas nicht selbst darf,
 * erfährt, wer es tut.
 */
function RoleCard({ schedule }: { schedule: ProjectSchedule }) {
  const role = schedule.project.role;
  const { allowed, denied } = abilitiesOf(schedule.permissions);

  if (allowed.length === 0 && denied.length === 0) return null;

  return (
    <Card tone="muted" className="flex flex-col gap-3">
      <div>
        <p className="text-body-lg font-medium text-charcoal">Deine Rolle: {ROLE_LABEL[role]}</p>
        <p className="mt-1 text-body text-steel">{ROLE_DESCRIPTION[role]}</p>
      </div>

      {allowed.length > 0 ? (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {allowed.map((entry) => (
            <li key={entry} className="flex items-start gap-2 text-body text-charcoal">
              <Check size={16} className="mt-0.5 shrink-0 text-vivid-green" aria-hidden />
              {entry}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Die Fehlanzeige als ein Satz, nicht als zweite Liste: Sie soll die
          Rolle abgrenzen, nicht den Plan nach unten drücken. */}
      {denied.length > 0 ? (
        <p className="border-t border-ash pt-3 text-caption text-steel">
          Nicht in deiner Rolle: {denied.join(' · ')}.{' '}
          {role === 'contractor' || role === 'trade'
            ? 'Das entscheidet der Bauherr.'
            : 'Dafür ist eine andere Rolle zuständig.'}
        </p>
      ) : (
        <p className="text-caption text-steel">Du hast in diesem Bauvorhaben alle Rechte.</p>
      )}
    </Card>
  );
}

/**
 * Die laufende Phase: diejenige, deren Zeitraum das heutige Datum enthält.
 * Liegt der Baustart noch in der Zukunft, ist es die erste; ist alles vorbei,
 * die letzte.
 *
 * Das heutige Datum kommt hier aus dem Browser und nicht aus dem
 * Berechnungskern — es ist eine Frage der Darstellung, keine der Terminlogik.
 */
export function currentPhaseKey(schedule: ProjectSchedule, today = todayIso()): string | undefined {
  const withTasks = schedule.phases.filter((phase) => phase.taskCount > 0);
  if (withTasks.length === 0) return undefined;

  const running = withTasks.find(
    (phase) =>
      phase.firstStart !== null &&
      phase.lastEnd !== null &&
      phase.firstStart <= today &&
      today <= phase.lastEnd,
  );
  if (running !== undefined) return running.key;

  const upcoming = withTasks.find((phase) => phase.firstStart !== null && phase.firstStart > today);
  return upcoming?.key ?? withTasks.at(-1)?.key;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

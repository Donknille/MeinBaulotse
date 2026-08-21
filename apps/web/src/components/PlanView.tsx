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
import { CalendarDays, Check, GanttChartSquare } from 'lucide-react';
import type { ProjectSchedule, ScheduledTaskDto, TaskUpdateRequest } from '@meinbaulotse/shared';
import { Card, Pill, SectionPill } from './ui';
import { PhaseBar, TaskRow } from './schedule';
import { Timeline } from './Timeline';
import { TaskSheet } from './TaskSheet';
import { formatDate } from '../lib/format';
import { abilitiesOf, ROLE_DESCRIPTION, ROLE_LABEL } from '../lib/roles';

export function PlanView({
  schedule,
  onChangeTask,
}: {
  schedule: ProjectSchedule;
  /** Fehlt sie, ist die Ansicht nur zum Lesen — so wie im Styleguide. */
  onChangeTask?: (taskId: string, change: TaskUpdateRequest) => Promise<void>;
}) {
  const [selected, setSelected] = useState<ScheduledTaskDto | null>(null);
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
            // Auch der Hinweis auf eine Lücke trägt den nächsten Schritt.
            <p className="text-caption text-steel">
              Sobald du den vertraglich geschuldeten Fertigstellungstermin erfasst, sagen wir dir,
              wie weit der errechnete Plan davon abweicht.
            </p>
          ) : null}
        </Card>

        <RoleCard schedule={schedule} />
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

      <section className="flex flex-col gap-8">
        <SectionPill tone="blue" icon={<CalendarDays size={18} />}>
          Der ganze Ablauf
        </SectionPill>

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
                    />
                  ))}
                </ul>
              </Card>
            </div>
          );
        })}
      </section>
      {selected !== null && onChangeTask !== undefined ? (
        <TaskSheet
          task={selected}
          schedule={schedule}
          onClose={() => setSelected(null)}
          onSave={(change) => onChangeTask(selected.id, change)}
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
  // „1 Werktage später" hat im Betrieb gestanden, sobald eine Verschiebung
  // knapp über den Vertragstermin führte. Genau dann liest jemand die Zahl
  // besonders genau — und einen Grammatikfehler gleich mit.
  const tage = Math.abs(workdays) === 1 ? '1 Werktag' : `${Math.abs(workdays)} Werktage`;
  return workdays > 0 ? `${tage} später` : `${tage} früher`;
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

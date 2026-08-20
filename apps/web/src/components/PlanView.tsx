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

import { CalendarDays } from 'lucide-react';
import type { ProjectSchedule } from '@meinbaulotse/shared';
import { Card, SectionPill } from './ui';
import { PhaseBar, TaskRow } from './schedule';
import { formatDate } from '../lib/format';

export function PlanView({ schedule }: { schedule: ProjectSchedule }) {
  const referenceYear = Number(schedule.project.plannedStart.slice(0, 4));
  const currentPhase = currentPhaseKey(schedule);
  const byPhase = schedule.phases.filter((phase) => phase.taskCount > 0);

  return (
    <>
      <header className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="display-title text-heading-lg text-charcoal">{schedule.project.name}</h1>
          <p className="text-body text-steel">
            Baubeginn {formatDate(schedule.project.plannedStart)} ·{' '}
            {schedule.project.hasBasement ? 'mit Keller' : 'ohne Keller'} ·{' '}
            {schedule.tasks.length} Vorgänge
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
      </header>

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
                    <TaskRow key={task.id} task={task} referenceYear={referenceYear} />
                  ))}
                </ul>
              </Card>
            </div>
          );
        })}
      </section>
    </>
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

/**
 * Fachkomponenten des Terminplans: Bestätigungsgrad, Phasenleiste,
 * Vorgangszeile. Aufbau und Wortwahl nach Abschnitt 9 des Gestaltungssystems.
 */

import { Clock, Flag } from 'lucide-react';
import type { PhaseProgress, ScheduledTaskDto } from '@meinbaulotse/shared';
import { floatInPlainWords } from '@meinbaulotse/shared';
import { CONFIRMATION_LABEL, formatDuration, formatRange } from '../lib/format';

/**
 * Der gefüllte Punkt bedeutet: beide Seiten sind sich einig. Diese Füllung ist
 * die eigentliche Information — sie funktioniert auch in Graustufen, etwa im
 * gedruckten PDF der Bauakte.
 */
export function ConfirmationChip({
  value,
  confirmedOn,
}: {
  value: ScheduledTaskDto['confirmation'];
  confirmedOn?: string;
}) {
  const styles = {
    self_stated: { bg: 'bg-paper-mist', fg: 'text-steel', dot: 'border-steel' },
    counterparty_stated: {
      bg: 'bg-soft-blue',
      fg: 'text-electric-blue',
      dot: 'border-electric-blue',
    },
    mutual: { bg: 'bg-soft-mint', fg: 'text-vivid-green', dot: 'border-vivid-green bg-vivid-green' },
    // „Zwei Angaben" ist ein Sachverhalt, kein Alarm — deshalb Tangerine, nicht Rot.
    disputed: {
      bg: 'bg-soft-amber',
      fg: 'text-tangerine',
      dot: 'border-tangerine bg-linear-to-r from-tangerine from-50% to-transparent to-50%',
    },
  }[value];

  const label =
    value === 'mutual' && confirmedOn !== undefined
      ? `${CONFIRMATION_LABEL.mutual} am ${confirmedOn}`
      : CONFIRMATION_LABEL[value];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] ${styles.bg} ${styles.fg} px-2.5 py-1 text-caption font-medium`}
    >
      <span className={`size-2 rounded-full border-2 ${styles.dot}`} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Kein Fortschrittsbalken in Prozent — Prozentangaben zum Baufortschritt sind
 * eine Behauptung, die niemand belegen kann.
 */
export function PhaseBar({ phases, currentKey }: { phases: PhaseProgress[]; currentKey?: string }) {
  const withTasks = phases.filter((phase) => phase.taskCount > 0);
  const currentIndex = Math.max(
    0,
    withTasks.findIndex((phase) => phase.key === currentKey),
  );
  const current = withTasks[currentIndex];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center" role="img" aria-label={`Phase ${currentIndex + 1} von ${withTasks.length}`}>
        {withTasks.map((phase, index) => (
          <span key={phase.key} className="flex items-center">
            {index > 0 ? <span className="h-px w-6 bg-ash sm:w-10" aria-hidden /> : null}
            <span
              className={
                index < currentIndex
                  ? 'size-2.5 rounded-full bg-charcoal'
                  : index === currentIndex
                    ? 'size-3.5 rounded-full border-2 border-electric-blue bg-canvas-white ring-2 ring-soft-blue'
                    : 'size-2.5 rounded-full border border-ash bg-canvas-white'
              }
              aria-hidden
            />
          </span>
        ))}
      </div>
      <p className="text-body text-steel">
        Phase {currentIndex + 1} von {withTasks.length}
        {current === undefined ? '' : ` · ${current.name}`}
      </p>
    </div>
  );
}

export function TaskRow({ task, referenceYear }: { task: ScheduledTaskDto; referenceYear: number }) {
  return (
    <li
      className={`flex flex-col gap-1.5 border-b border-ash py-3 last:border-b-0 ${
        task.isWait ? 'border-b-dashed' : ''
      } ${
        // Der kritische Pfad bekommt eine Tangerine-Kante links, kein farbiges
        // Feld und keinen farbigen Text. Sonst leuchten bei einem langen
        // kritischen Pfad zwei Drittel der Liste orange — und wer ständig
        // warnt, wird nicht mehr gelesen.
        task.isCritical ? 'border-l-2 border-l-tangerine pl-3' : ''
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-[7.5rem] text-body text-steel">
          {formatRange(task.currentStart, task.currentEnd, referenceYear)}
        </span>
        <span className="flex items-center gap-2 text-body-lg font-medium text-charcoal">
          {task.isMilestone ? <Flag size={16} className="text-electric-blue" aria-hidden /> : null}
          {task.isWait ? <Clock size={16} className="text-silver" aria-hidden /> : null}
          {task.name}
        </span>
        {task.tradeCode !== null ? (
          <span className="text-caption font-medium tracking-wide text-steel uppercase">
            {task.tradeCode}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {task.isWait ? (
          // Der Nutzer soll sofort verstehen, dass dieser Zeitraum nicht
          // verhandelbar ist.
          <span className="text-caption text-steel">
            {formatDuration(task.durationDays, task.durationUnit)} · Trocknung — nicht verkürzbar
          </span>
        ) : task.isMilestone ? (
          <span className="text-caption text-steel">Meilenstein</span>
        ) : (
          <span className="text-caption text-steel">
            {formatDuration(task.durationDays, task.durationUnit)}
          </span>
        )}
        <ConfirmationChip value={task.confirmation} />
      </div>

      {/* Puffer nie als nackte Zahl, sondern als Satz — Abschnitt 3.6. */}
      <p className="text-caption text-fog">{floatInPlainWords(task.totalFloatDays)}</p>
    </li>
  );
}

/**
 * Die laufende Phase: diejenige, deren Zeitraum das heutige Datum enthält.
 * Liegt der Baustart noch in der Zukunft, ist es die erste; ist alles vorbei,
 * die letzte.
 *
 * Das heutige Datum kommt herein und wird nicht gelesen — dieselbe Regel wie
 * im Berechnungskern, aus demselben Grund: Wer die Uhr mitten in einer
 * Darstellung abfragt, bekommt eine Funktion, die sich nicht prüfen lässt.
 */
export function currentPhaseKey(
  schedule: { phases: readonly PhaseProgress[] },
  today: string,
): string | undefined {
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

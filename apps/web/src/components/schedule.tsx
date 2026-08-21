/**
 * Fachkomponenten des Terminplans: Bestätigungsgrad, Phasenleiste,
 * Vorgangszeile. Aufbau und Wortwahl nach Abschnitt 9 des Gestaltungssystems.
 */

import { Clock, Flag } from 'lucide-react';
import type { PhaseProgress, ScheduledTaskDto } from '@meinbaulotse/shared';
import { floatInPlainWords } from '@meinbaulotse/shared';
import { CONFIRMATION_LABEL, formatDuration, formatRange, STATUS_LABEL } from '../lib/format';

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
    mutual: {
      bg: 'bg-soft-mint',
      fg: 'text-vivid-green',
      dot: 'border-vivid-green bg-vivid-green',
    },
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
      <div
        className="flex items-center"
        role="img"
        aria-label={`Phase ${currentIndex + 1} von ${withTasks.length}`}
      >
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

export function TaskRow({
  task,
  referenceYear,
  onSelect,
}: {
  task: ScheduledTaskDto;
  referenceYear: number;
  onSelect?: (task: ScheduledTaskDto) => void;
}) {
  // Die ganze Zeile ist die Schaltfläche, nicht ein Stiftsymbol am Rand: Auf
  // einer Baustelle wird mit Handschuhen getippt. Ohne `onSelect` bleibt sie
  // ein `div` — im Styleguide gibt es nichts zu ändern.
  const Zeile = onSelect === undefined ? 'div' : 'button';

  return (
    <li
      className={`border-b border-ash last:border-b-0 ${task.isWait ? 'border-b-dashed' : ''} ${
        // Der kritische Pfad bekommt eine Tangerine-Kante links, kein farbiges
        // Feld und keinen farbigen Text. Sonst leuchten bei einem langen
        // kritischen Pfad zwei Drittel der Liste orange — und wer ständig
        // warnt, wird nicht mehr gelesen.
        task.isCritical ? 'border-l-2 border-l-tangerine pl-3' : ''
      }`}
    >
      <Zeile
        {...(onSelect === undefined
          ? {}
          : { type: 'button' as const, onClick: () => onSelect(task) })}
        className={`flex w-full flex-col gap-1.5 py-3 text-left ${
          onSelect === undefined
            ? ''
            : 'cursor-pointer transition-colors duration-[var(--motion-micro)] hover:bg-paper-mist'
        }`}
      >
        {/* Mobil steht das Datum über dem Namen. Die feste Spalte daneben riss
            auf 375 px eine Lücke auf, sobald ein Name kurz war — und drückte
            ihn in die nächste Zeile, sobald er lang war. */}
        <span className="flex flex-col gap-y-0.5 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
          <span className="text-body text-steel sm:min-w-[7.5rem]">
            {formatRange(task.currentStart, task.currentEnd, referenceYear)}
          </span>
          <span className="flex items-center gap-2 text-body-lg font-medium text-charcoal">
            {task.isMilestone ? (
              <Flag size={16} className="text-electric-blue" aria-hidden />
            ) : null}
            {task.isWait ? <Clock size={16} className="text-silver" aria-hidden /> : null}
            {task.name}
          </span>
          {task.tradeCode !== null ? (
            <span className="text-caption font-medium tracking-wide text-steel uppercase">
              {task.tradeCode}
            </span>
          ) : null}
        </span>

        <span className="flex flex-wrap items-center gap-2">
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
          {/* Eine Verschiebung von Hand muss man sehen, sonst sucht man den
              Grund im Berechnungskern. */}
          {task.earliestStart !== null ? (
            <span className="text-caption text-tangerine">verschoben</span>
          ) : null}
          {task.status !== 'terminiert' && task.status !== 'geplant' ? (
            <span className="text-caption text-steel">{STATUS_LABEL[task.status]}</span>
          ) : null}
        </span>

        {/* Puffer nie als nackte Zahl, sondern als Satz — Abschnitt 3.6. */}
        <span className="text-caption text-fog">{floatInPlainWords(task.totalFloatDays)}</span>
      </Zeile>
    </li>
  );
}

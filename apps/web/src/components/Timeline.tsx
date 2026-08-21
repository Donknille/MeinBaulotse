/**
 * Die Zeitachse — Abschnitt 5.3 der Spezifikation, Abschnitt 9.8 der CI.
 *
 * Je Vorgang zwei Spuren: **Baseline blass darüber**, **Ist-Stand darunter**.
 * Der Zwischenraum *ist* die Verschiebung; er wird nicht beschriftet, man
 * sieht ihn. Liegen beide Spuren übereinander, hat sich nichts verschoben —
 * auch das ist eine Aussage, und sie braucht keinen Text.
 *
 * Gerechnet wird auf Epochentagen, wie überall in diesem Projekt (Regel 2).
 * Die Umrechnung kommt aus `@meinbaulotse/schedule`, damit es keine zweite
 * Datumsarithmetik im Browser gibt. Der Kern hat keine Laufzeitabhängigkeiten,
 * er lässt sich deshalb bedenkenlos mitliefern.
 *
 * Ab 768 px. Mobil bleibt die Liste die Grundansicht (CI 10.1): Auf einem
 * Telefon ist ein halbes Jahr Bauzeit auf 360 px eine Zumutung, kein Überblick.
 *
 * Was noch fehlt: die Entscheidungsfristen, die laut CI 9.8 als Rauten vor dem
 * zugehörigen Vorgang auf der Achse sitzen. Es gibt sie in der API noch nicht.
 */

import { Flag } from 'lucide-react';
import type { PhaseProgress, ProjectSchedule, ScheduledTaskDto } from '@meinbaulotse/shared';
import { daysInMonth, makeIsoDate, parseIsoDate, toEpochDay } from '@meinbaulotse/schedule';
import { formatRange } from '../lib/format';
import { progressOf } from '../lib/progress';

/** Ein Vorgang ohne Termine hat auf einer Zeitachse nichts zu suchen. */
interface Span {
  readonly from: string;
  readonly to: string;
}

function spanOf(start: string | null, end: string | null): Span | null {
  if (start === null && end === null) return null;
  const from = start ?? end!;
  const to = end ?? start!;
  return from <= to ? { from, to } : { from: to, to: from };
}

function currentSpan(task: ScheduledTaskDto): Span | null {
  return spanOf(task.currentStart, task.currentEnd);
}

function baselineSpan(task: ScheduledTaskDto): Span | null {
  return spanOf(task.baselineStart, task.baselineEnd);
}

/** Erster Tag des Monats, in dem `date` liegt. */
function monthStart(date: string): string {
  const { year, month } = parseIsoDate(date);
  return makeIsoDate(year, month, 1);
}

/** Letzter Tag des Monats, in dem `date` liegt. */
function monthEnd(date: string): string {
  const { year, month } = parseIsoDate(date);
  return makeIsoDate(year, month, daysInMonth(year, month));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/**
 * Die Umrechnung von Datum auf Bildposition, einmal berechnet und
 * weitergereicht. Ein Prozentmaß statt Pixeln: Die Achse soll sich mit dem
 * Fenster dehnen, ohne dass etwas nachgerechnet werden muss.
 */
interface Axis {
  readonly from: string;
  readonly to: string;
  readonly totalDays: number;
}

function positionOf(axis: Axis, date: string): number {
  return ((toEpochDay(date) - toEpochDay(axis.from)) / axis.totalDays) * 100;
}

function widthOf(axis: Axis, span: Span): number {
  return ((toEpochDay(span.to) - toEpochDay(span.from) + 1) / axis.totalDays) * 100;
}

function buildAxis(tasks: readonly ScheduledTaskDto[]): Axis | null {
  const dates: string[] = [];
  for (const task of tasks) {
    for (const span of [currentSpan(task), baselineSpan(task)]) {
      if (span !== null) dates.push(span.from, span.to);
    }
  }
  if (dates.length === 0) return null;

  // Auf ganze Monate aufrunden, damit die Achse an Monatsgrenzen beginnt und
  // endet. Sonst steht die erste Beschriftung mitten im Nichts.
  const from = monthStart(dates.reduce((a, b) => (a < b ? a : b)));
  const to = monthEnd(dates.reduce((a, b) => (a > b ? a : b)));
  return { from, to, totalDays: toEpochDay(to) - toEpochDay(from) + 1 };
}

/** Die Monate der Achse, jeder mit Anfang und Breite in Prozent. */
function monthsOf(axis: Axis): { key: string; label: string; left: number; width: number }[] {
  const out: { key: string; label: string; left: number; width: number }[] = [];
  let { year, month } = parseIsoDate(axis.from);
  const last = parseIsoDate(axis.to);

  while (year < last.year || (year === last.year && month <= last.month)) {
    const first = makeIsoDate(year, month, 1);
    const span = { from: first, to: makeIsoDate(year, month, daysInMonth(year, month)) };
    out.push({
      key: first,
      label: `${MONTHS[month - 1]!} ${String(year).slice(2)}`,
      left: positionOf(axis, first),
      width: widthOf(axis, span),
    });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

export function Timeline({ schedule }: { schedule: ProjectSchedule }) {
  const axis = buildAxis(schedule.tasks);
  if (axis === null) return null;

  const today = todayIso();
  const months = monthsOf(axis);
  const phases = schedule.phases.filter((phase) => phase.taskCount > 0);
  const todayLeft = today >= axis.from && today <= axis.to ? positionOf(axis, today) : null;

  return (
    // Die Achse braucht Breite. Weniger als 52 rem sind kein Überblick mehr,
    // deshalb darf sie waagerecht scrollen statt sich zu quetschen.
    <div className="overflow-x-auto">
      <div className="min-w-[52rem]">
        <MonthRow months={months} />
        <PhaseAxis axis={axis} phases={phases} />

        <div className="relative">
          {/* Die senkrechten Monatslinien laufen durch alle Zeilen. Sie liegen
              hinter den Balken, nicht darüber. */}
          <div className="pointer-events-none absolute inset-0 left-[15rem]" aria-hidden>
            {months.map((month) => (
              <span
                key={month.key}
                className="absolute top-0 bottom-0 w-px bg-ash"
                style={{ left: `${month.left}%` }}
              />
            ))}
            {todayLeft !== null ? (
              <span
                className="absolute top-0 bottom-0 w-px bg-electric-blue"
                style={{ left: `${todayLeft}%` }}
              />
            ) : null}
          </div>

          {phases.map((phase) => (
            <div key={phase.key}>
              <p className="mt-3 mb-0.5 text-caption font-medium tracking-wide text-fog uppercase">
                {phase.ordinal}. {phase.name}
              </p>
              {schedule.tasks
                .filter((task) => task.phaseKey === phase.key)
                .map((task) => (
                  <TaskBar key={task.id} task={task} axis={axis} />
                ))}
            </div>
          ))}
        </div>

        <Legend />
      </div>
    </div>
  );
}

function MonthRow({ months }: { months: { key: string; label: string; left: number }[] }) {
  return (
    <div className="flex">
      <div className="w-[15rem] shrink-0" />
      <div className="relative h-6 grow border-b border-ash">
        {months.map((month) => (
          <span
            key={month.key}
            className="absolute top-0 pl-1.5 text-caption text-fog"
            style={{ left: `${month.left}%` }}
          >
            {month.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Die Bauphasen als Marken auf der Achse (Spezifikation 5.3).
 *
 * Sie beantworten die Frage, die man an einem Balkenplan zuerst stellt: Was
 * passiert eigentlich gerade — und was kommt als Nächstes.
 */
function PhaseAxis({ axis, phases }: { axis: Axis; phases: PhaseProgress[] }) {
  return (
    <div className="flex">
      <div className="w-[15rem] shrink-0" />
      <div className="relative h-5 grow">
        {phases.map((phase) => {
          if (phase.firstStart === null || phase.lastEnd === null) return null;
          const span = { from: phase.firstStart, to: phase.lastEnd };
          return (
            <span
              key={phase.key}
              title={phase.name}
              className="absolute top-1 h-2.5 rounded-[var(--radius-pill)] bg-paper-mist"
              style={{ left: `${positionOf(axis, span.from)}%`, width: `${widthOf(axis, span)}%` }}
            >
              <span className="sr-only">{phase.name}</span>
              <span className="absolute inset-y-0 left-0 w-px bg-smoke" aria-hidden />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function TaskBar({ task, axis }: { task: ScheduledTaskDto; axis: Axis }) {
  const current = currentSpan(task);
  const baseline = baselineSpan(task);
  if (current === null) return null;

  const referenceYear = Number(axis.from.slice(0, 4));
  const fortschritt = progressOf(task);
  const beschriftung = `${task.name} · ${formatRange(current.from, current.to, referenceYear)}`;

  return (
    <div
      className={`flex items-center ${
        // Der kritische Pfad bekommt eine Tangerine-Kante links, kein rotes
        // Feld — dieselbe Regel wie in der Liste (CI 9.8).
        task.isCritical ? 'border-l-2 border-l-tangerine' : 'border-l-2 border-l-transparent'
      }`}
    >
      <div
        className="w-[15rem] shrink-0 truncate pr-3 pl-2 text-caption text-steel"
        title={task.name}
      >
        {task.isMilestone ? (
          <Flag size={12} className="mr-1 inline text-electric-blue" aria-hidden />
        ) : null}
        {task.name}
      </div>

      <div className="relative h-6 grow" title={beschriftung}>
        {/* Baseline blass darüber. Nur, wenn es sie gibt und sie etwas anderes
            sagt als der Ist-Stand — sonst ist sie stumme Doppelung. */}
        {baseline !== null && (baseline.from !== current.from || baseline.to !== current.to) ? (
          <span
            className="absolute top-0.5 h-1.5 rounded-[var(--radius-pill)] bg-smoke"
            style={{
              left: `${positionOf(axis, baseline.from)}%`,
              width: `${Math.max(widthOf(axis, baseline), 0.4)}%`,
            }}
            aria-hidden
          />
        ) : null}

        {task.isMilestone ? (
          // Ein Meilenstein hat keine Dauer. Ein Balken von null Breite wäre
          // unsichtbar, also eine Raute auf dem Tag.
          <span
            className={`absolute top-2 size-2.5 -translate-x-1/2 rotate-45 border ${
              fortschritt === 'fertig'
                ? 'border-vivid-green bg-vivid-green'
                : 'border-electric-blue bg-canvas-white'
            }`}
            style={{ left: `${positionOf(axis, current.from)}%` }}
            aria-hidden
          />
        ) : (
          <span
            // Zwei Regeln überlagern sich hier, und beide sind Absicht.
            //
            // **Fertig ist grün** — `--color-vivid-green` trägt laut CI 3.5
            // genau diese Bedeutung: Einigkeit und Fertigstellung. Ohne das
            // sah ein abgeschlossener Vorgang aus wie ein geplanter, und die
            // Zeitachse beantwortete die erste Frage nicht, die man an sie
            // stellt: Wie weit sind wir?
            //
            // **Der kritische Pfad bleibt blau** — CI 9.8: „Tangerine-Kante
            // links, kein rotes Feld." Auf einem Bau ist der kritische Pfad
            // oft die halbe Liste; färbte man die Balken, wäre die halbe
            // Ansicht orange, und Dauerwarnung wird nicht gelesen.
            className={`absolute top-2.5 h-2.5 rounded-[var(--radius-pill)] ${
              task.isWait
                ? 'border border-dashed border-silver bg-canvas-white'
                : fortschritt === 'fertig'
                  ? 'bg-vivid-green'
                  : fortschritt === 'entfallen'
                    ? 'bg-ash'
                    : fortschritt === 'laeuft'
                      ? 'bg-electric-blue'
                      : // Geplant, aber noch nicht angefangen: dieselbe Farbe,
                        // schwächer. Der Unterschied zwischen „läuft" und
                        // „kommt noch" ist auf einen Blick sichtbar, ohne eine
                        // dritte Farbe einzuführen.
                        'bg-electric-blue/35'
            }`}
            style={{
              left: `${positionOf(axis, current.from)}%`,
              // Ein Vorgang von einem Tag wäre bei einem halben Jahr Bauzeit
              // schmaler als ein Haar. Eine Untergrenze macht ihn sichtbar,
              // ohne die Achse zu verfälschen.
              width: `${Math.max(widthOf(axis, current), 0.4)}%`,
            }}
            aria-hidden
          />
        )}
        <span className="sr-only">{beschriftung}</span>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ash pt-3 text-caption text-fog">
      <LegendItem className="bg-vivid-green">fertig</LegendItem>
      <LegendItem className="bg-electric-blue">läuft gerade</LegendItem>
      <LegendItem className="bg-electric-blue/35">steht noch aus</LegendItem>
      <span className="flex items-center gap-2">
        <span className="h-3.5 w-0.5 bg-tangerine" aria-hidden />
        ohne Puffer — jeder Tag Verzug verschiebt den Endtermin
      </span>
      <LegendItem className="border border-dashed border-silver bg-canvas-white">
        Trocknung — nicht verkürzbar
      </LegendItem>
      <LegendItem className="bg-smoke">ursprünglich geplant</LegendItem>
      <span className="flex items-center gap-2">
        <span className="size-2.5 rotate-45 border border-electric-blue" aria-hidden />
        Meilenstein
      </span>
      <span className="flex items-center gap-2">
        <span className="h-3.5 w-px bg-electric-blue" aria-hidden />
        heute
      </span>
    </div>
  );
}

function LegendItem({ className, children }: { className: string; children: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`h-2 w-6 rounded-[var(--radius-pill)] ${className}`} aria-hidden />
      {children}
    </span>
  );
}

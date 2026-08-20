/**
 * Zeitachse — Abschnitt 5.3 der Spezifikation, Abschnitt 9.8 des
 * Gestaltungssystems.
 *
 * Je Vorgang zwei Spuren: **Baseline blass darüber**, **Ist-Stand darunter**.
 * Der Zwischenraum *ist* die Verschiebung — er wird nicht beschriftet, man
 * sieht ihn. Der kritische Pfad bekommt eine Tangerine-Kante links, kein rotes
 * Feld: Bei einem langen kritischen Pfad leuchteten sonst zwei Drittel der
 * Ansicht, und wer ständig warnt, wird nicht mehr gelesen.
 *
 * Entscheidungsfristen sitzen als Rauten **vor** dem zugehörigen Vorgang, mit
 * einer Linie dorthin. Ohne diese Linie wäre eine Raute im Mai eine Raute im
 * Mai; mit ihr ist sie der Grund, warum im Juli gefliest werden kann.
 *
 * Umgesetzt in gewöhnlichem Fluss-Layout mit absolut gesetzten Balken, nicht
 * in einer Diagrammbibliothek: Der Text bleibt echter Text — auswählbar,
 * durchsuchbar, für Vorleseprogramme lesbar — und die Farben kommen aus den
 * Tokens statt aus einer Voreinstellung.
 */

import { useMemo, useRef, useState, useEffect } from 'react';
import type { DecisionDto, PhaseProgress, ScheduledTaskDto } from '@meinbaulotse/shared';
import { formatDate, formatRange, fromEpochDay, isWeekendIso, monthLabel } from '../lib/format';
import { barWidth, buildAxis, type Axis } from '../lib/timeline';
import { todayIso } from '../lib/api';

/** Pixel je Kalendertag. Drei Stufen genügen; mehr ist Bedienlast ohne Nutzen. */
const SCALES = {
  monat: { pxPerDay: 2.6, label: 'Monate' },
  woche: { pxPerDay: 7, label: 'Wochen' },
  tag: { pxPerDay: 18, label: 'Tage' },
} as const;

export type GanttScale = keyof typeof SCALES;

const LABEL_WIDTH = 224;
const ROW_HEIGHT = 44;

export function Gantt({
  tasks,
  phases,
  decisions = [],
  contractualEnd = null,
  onSelect,
  selectedId,
}: {
  tasks: readonly ScheduledTaskDto[];
  phases: readonly PhaseProgress[];
  decisions?: readonly DecisionDto[];
  contractualEnd?: string | null;
  onSelect?: (task: ScheduledTaskDto) => void;
  selectedId?: string | undefined;
}) {
  const [scale, setScale] = useState<GanttScale>('woche');
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = todayIso();

  const axis = useMemo(
    () =>
      buildAxis({
        dates: [
          today,
          contractualEnd,
          ...tasks.flatMap((task) => [
            task.currentStart,
            task.currentEnd,
            task.baselineStart,
            task.baselineEnd,
          ]),
          ...decisions.map((decision) => decision.dueDate),
        ],
      }),
    [tasks, decisions, contractualEnd, today],
  );

  const pxPerDay = SCALES[scale].pxPerDay;
  const trackWidth = Math.max(320, axis.days * pxPerDay);
  const x = (date: string): number => axis.offsetOf(date) * pxPerDay;

  // Beim Öffnen dorthin rollen, wo heute ist. Ein Terminplan, der beim
  // Baubeginn steht, während draußen der Innenputz läuft, ist eine Zumutung.
  useEffect(() => {
    const container = scrollRef.current;
    if (container === null) return;
    const target = x(today) - container.clientWidth / 2 + LABEL_WIDTH;
    container.scrollLeft = Math.max(0, target);
    // Absichtlich nur beim Maßstabswechsel und nicht bei jeder Änderung der
    // Daten: Sonst springt die Ansicht nach jedem Speichern zurück zur Mitte,
    // und man verliert die Stelle, die man gerade angesehen hat.
  }, [scale]);

  if (tasks.length === 0) {
    return (
      <p className="py-8 text-body text-steel">
        Für diese Ansicht steht noch kein Vorgang im Plan.
      </p>
    );
  }

  const byPhase = phases
    .filter((phase) => tasks.some((task) => task.phaseKey === phase.key))
    .map((phase) => ({
      phase,
      tasks: tasks.filter((task) => task.phaseKey === phase.key),
    }));

  const decisionsByTask = new Map<string, DecisionDto[]>();
  for (const decision of decisions) {
    if (decision.blocksTaskId === null || decision.dueDate === null) continue;
    if (decision.status === 'entschieden' || decision.status === 'beauftragt') continue;
    const list = decisionsByTask.get(decision.blocksTaskId) ?? [];
    list.push(decision);
    decisionsByTask.set(decision.blocksTaskId, list);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend />
        <div className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-paper-mist p-1">
          {(Object.keys(SCALES) as GanttScale[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setScale(key)}
              aria-pressed={scale === key}
              className={`rounded-[var(--radius-pill)] px-3 py-1 text-caption font-medium transition-colors duration-[var(--motion-micro)] ${
                scale === key ? 'bg-canvas-white text-charcoal shadow-[var(--shadow-subtle)]' : 'text-steel'
              }`}
            >
              {SCALES[key].label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-[var(--radius-card)] border border-ash bg-canvas-white"
      >
        <div style={{ width: LABEL_WIDTH + trackWidth }} className="relative">
          <AxisHeader axis={axis} pxPerDay={pxPerDay} scale={scale} />

          <div className="relative">
            {/* Marken quer über alle Zeilen: heute und der geschuldete Termin. */}
            <Marker
              left={LABEL_WIDTH + x(today)}
              tone="charcoal"
              label="heute"
              visible={axis.contains(today)}
            />
            <Marker
              left={LABEL_WIDTH + x(contractualEnd ?? today)}
              tone="green"
              label="geschuldet"
              visible={contractualEnd !== null && axis.contains(contractualEnd)}
            />

            {byPhase.map(({ phase, tasks: phaseTasks }) => (
              <div key={phase.key}>
                <div className="flex border-t border-ash bg-paper-mist/60">
                  <div
                    className="sticky left-0 z-20 shrink-0 bg-paper-mist px-4 py-1.5 text-caption font-medium tracking-wide text-steel uppercase"
                    style={{ width: LABEL_WIDTH }}
                  >
                    {phase.ordinal}. {phase.name}
                  </div>
                  <div className="grow" />
                </div>

                {phaseTasks.map((task) => (
                  <Row
                    key={task.id}
                    task={task}
                    decisions={decisionsByTask.get(task.id) ?? []}
                    x={x}
                    pxPerDay={pxPerDay}
                    axis={axis}
                    selected={selectedId === task.id}
                    {...(onSelect === undefined ? {} : { onSelect })}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Zeile -------------------------------------------------------------------

function Row({
  task,
  decisions,
  x,
  pxPerDay,
  axis,
  selected,
  onSelect,
}: {
  task: ScheduledTaskDto;
  decisions: readonly DecisionDto[];
  x: (date: string) => number;
  pxPerDay: number;
  axis: Axis;
  selected: boolean;
  onSelect?: (task: ScheduledTaskDto) => void;
}) {
  const start = task.currentStart;
  const end = task.currentEnd;
  const hasBaseline =
    task.baselineStart !== null &&
    task.baselineEnd !== null &&
    (task.baselineStart !== start || task.baselineEnd !== end);

  const width = (from: string, to: string): number => barWidth(from, to, pxPerDay);

  const interactive = onSelect !== undefined;
  const Element = interactive ? 'button' : 'div';

  return (
    <Element
      {...(interactive
        ? { type: 'button' as const, onClick: () => onSelect(task) }
        : {})}
      className={`flex w-full border-t border-ash text-left transition-colors duration-[var(--motion-micro)] ${
        selected ? 'bg-soft-blue/40' : 'hover:bg-paper-mist/70'
      }`}
      style={{ height: ROW_HEIGHT }}
    >
      <div
        className={`sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 px-4 ${
          selected ? 'bg-soft-blue' : 'bg-canvas-white'
        } ${
          // Kritischer Pfad: eine Kante links, kein farbiges Feld.
          task.isCritical ? 'border-l-2 border-l-tangerine' : 'border-l-2 border-l-transparent'
        }`}
        style={{ width: LABEL_WIDTH }}
      >
        <span className="truncate text-body text-charcoal">{task.name}</span>
        <span className="truncate text-caption text-fog">
          {[task.tradeCode?.toUpperCase(), formatRange(start, end)].filter(Boolean).join(' · ')}
        </span>
      </div>

      <div className="relative grow">
        {/* Entscheidungsfristen: Raute vor dem Vorgang, Linie zum Vorgang. */}
        {start !== null
          ? decisions.map((decision) =>
              decision.dueDate === null || !axis.contains(decision.dueDate) ? null : (
                <DecisionMark
                  key={decision.id}
                  left={x(decision.dueDate)}
                  right={x(start)}
                  overdue={decision.isOverdue}
                  title={`${decision.title} — Frist ${formatDate(decision.dueDate)}`}
                />
              ),
            )
          : null}

        {hasBaseline && task.baselineStart !== null && task.baselineEnd !== null ? (
          task.isMilestone ? (
            // Ein Meilenstein hat keine Länge; als Balken wäre seine Baseline
            // ein Punkt, den man für einen Fleck hält.
            <span
              className="absolute top-[8px] size-2.5 rotate-45 border border-smoke"
              style={{ left: x(task.baselineStart) - 2 }}
              title={`Ursprünglich ${formatDate(task.baselineStart)}`}
            />
          ) : (
            <span
              className="absolute top-[9px] h-[6px] rounded-[var(--radius-pill)] bg-smoke"
              style={{
                left: x(task.baselineStart),
                width: width(task.baselineStart, task.baselineEnd),
              }}
              title={`Ursprünglich ${formatRange(task.baselineStart, task.baselineEnd)}`}
            />
          )
        ) : null}

        {start !== null && end !== null ? (
          task.isMilestone ? (
            <span
              className="absolute size-3 rotate-45 border-2 border-electric-blue bg-canvas-white"
              style={{ left: x(start) - 2, top: hasBaseline ? 20 : 15 }}
              title={`${task.name} · ${formatDate(start)}`}
            />
          ) : (
            <span
              className={`absolute rounded-[var(--radius-pill)] ${
                task.isWait
                  ? // Wartezeit: gestrichelte Kontur statt Fläche. Sie ist nicht
                    // verhandelbar, aber sie ist auch keine Arbeit.
                    'border border-dashed border-silver bg-paper-mist'
                  : task.actualEnd !== null
                    ? 'bg-vivid-green'
                    : 'bg-electric-blue'
              }`}
              style={{
                left: x(start),
                width: width(start, end),
                top: hasBaseline ? 19 : 15,
                height: 12,
              }}
              title={`${task.name} · ${formatRange(start, end)}`}
            />
          )
        ) : null}
      </div>
    </Element>
  );
}

function DecisionMark({
  left,
  right,
  overdue,
  title,
}: {
  left: number;
  right: number;
  overdue: boolean;
  title: string;
}) {
  const color = overdue ? 'bg-alarm-red' : 'bg-lavender';
  return (
    <>
      <span
        className={`absolute top-[21px] h-px ${overdue ? 'bg-alarm-red/40' : 'bg-lavender/40'}`}
        style={{ left, width: Math.max(0, right - left) }}
        aria-hidden
      />
      <span
        className={`absolute top-[18px] size-2 rotate-45 ${color}`}
        style={{ left: left - 4 }}
        title={title}
      />
    </>
  );
}

// -- Achse -------------------------------------------------------------------

function AxisHeader({
  axis,
  pxPerDay,
  scale,
}: {
  axis: Axis;
  pxPerDay: number;
  scale: GanttScale;
}) {
  return (
    <div className="sticky top-0 z-30 flex border-b border-ash bg-canvas-white">
      <div
        className="sticky left-0 z-10 shrink-0 border-r border-ash bg-canvas-white px-4 py-2 text-caption font-medium tracking-wide text-fog uppercase"
        style={{ width: LABEL_WIDTH }}
      >
        Vorgang
      </div>
      <div className="relative grow" style={{ height: 34 }}>
        {axis.months.map((month) => (
          <span
            key={month.iso}
            className="absolute top-0 flex h-full items-center border-l border-ash pl-2 text-caption text-steel"
            style={{ left: month.offsetDays * pxPerDay, width: month.days * pxPerDay }}
          >
            {month.days * pxPerDay > 54 ? monthLabel(month.iso) : ''}
          </span>
        ))}
        {/* Wochenenden nur im Tagesmaßstab: darunter wären sie ein Streifenmuster. */}
        {scale === 'tag' ? <Weekends axis={axis} pxPerDay={pxPerDay} /> : null}
      </div>
    </div>
  );
}

function Weekends({ axis, pxPerDay }: { axis: Axis; pxPerDay: number }) {
  const marks: number[] = [];
  for (let day = axis.from; day <= axis.to; day += 1) {
    if (isWeekendIso(fromEpochDay(day))) marks.push(day - axis.from);
  }
  return (
    <>
      {marks.map((offset) => (
        <span
          key={offset}
          className="absolute top-0 h-full bg-paper-mist"
          style={{ left: offset * pxPerDay, width: pxPerDay }}
          aria-hidden
        />
      ))}
    </>
  );
}

function Marker({
  left,
  tone,
  label,
  visible,
}: {
  left: number;
  tone: 'charcoal' | 'green';
  label: string;
  visible: boolean;
}) {
  if (!visible) return null;
  const color = tone === 'green' ? 'bg-vivid-green' : 'bg-charcoal';
  return (
    <span
      className="pointer-events-none absolute top-0 bottom-0 z-0 flex flex-col items-start"
      style={{ left }}
      aria-hidden
    >
      <span className={`h-full w-px ${color} opacity-40`} />
      <span
        className={`absolute top-0 left-0 rounded-br-[var(--radius-input)] ${color} px-1.5 py-0.5 text-caption text-canvas-white`}
      >
        {label}
      </span>
    </span>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-steel">
      <LegendItem swatch={<span className="h-[6px] w-6 rounded-[var(--radius-pill)] bg-smoke" />}>
        ursprünglich geplant
      </LegendItem>
      <LegendItem swatch={<span className="h-[10px] w-6 rounded-[var(--radius-pill)] bg-electric-blue" />}>
        heutiger Stand
      </LegendItem>
      <LegendItem swatch={<span className="h-[10px] w-6 rounded-[var(--radius-pill)] bg-vivid-green" />}>
        abgeschlossen
      </LegendItem>
      <LegendItem
        swatch={
          <span className="h-[10px] w-6 rounded-[var(--radius-pill)] border border-dashed border-silver bg-paper-mist" />
        }
      >
        Trocknung
      </LegendItem>
      <LegendItem swatch={<span className="size-2 rotate-45 bg-lavender" />}>
        Entscheidungsfrist
      </LegendItem>
      <LegendItem swatch={<span className="h-4 w-0.5 bg-tangerine" />}>kritischer Pfad</LegendItem>
    </ul>
  );
}

function LegendItem({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      {swatch}
      {children}
    </li>
  );
}

/**
 * Terminplan — Abschnitt 5.3 der Spezifikation.
 *
 * Zwei Darstellungen derselben Daten: **Liste** ist der Standard auf dem
 * Handy, **Zeitachse** die Ansicht ab 768 Pixeln. Der Umschalter steht
 * trotzdem auf beiden Geräten, denn wer einmal die Zeitachse gesehen hat,
 * sucht sie danach auch auf dem Telefon.
 */

import { useState } from 'react';
import { CalendarDays, List, Rows3 } from 'lucide-react';
import type { ScheduledTaskDto } from '@meinbaulotse/shared';
import { Card, EmptyState, SectionPill } from '../components/ui';
import { TaskRow } from '../components/schedule';
import { Gantt } from '../components/Gantt';
import { TaskSheet } from '../components/TaskSheet';
import { useProject } from './ProjectLayout';

type Mode = 'liste' | 'zeitachse';

export function Plan() {
  const { projectId, schedule, decisions, can, view } = useProject();
  const [mode, setMode] = useState<Mode>(
    typeof window !== 'undefined' && window.innerWidth >= 768 ? 'zeitachse' : 'liste',
  );
  const [selected, setSelected] = useState<ScheduledTaskDto | null>(null);

  const referenceYear = Number(schedule.project.plannedStart.slice(0, 4));
  const byPhase = schedule.phases.filter((phase) => phase.taskCount > 0);

  // Die Vorschau kennt keine fremden Vorgänge; der Hinweis darauf gehört an
  // die Stelle, an der jemand sie vermisst.
  const narrowed = view.role === 'trade' && view.isPreview;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="display-title text-heading-lg text-charcoal">Terminplan</h1>
          <p className="text-body text-steel">
            {schedule.tasks.length} Vorgänge · errechnetes Ende{' '}
            {schedule.computedEnd === null ? 'offen' : schedule.computedEnd}
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-[var(--radius-pill)] bg-paper-mist p-1">
          <ModeButton active={mode === 'liste'} onClick={() => setMode('liste')} icon={<List size={15} />}>
            Liste
          </ModeButton>
          <ModeButton
            active={mode === 'zeitachse'}
            onClick={() => setMode('zeitachse')}
            icon={<Rows3 size={15} />}
          >
            Zeitachse
          </ModeButton>
        </div>
      </header>

      {narrowed ? (
        <p className="text-caption text-lavender">
          In dieser Vorschau siehst du nur die Vorgänge des gewählten Gewerks — genau so viel, wie
          ein Einzelgewerk zu sehen bekommt.
        </p>
      ) : null}

      {schedule.tasks.length === 0 ? (
        <EmptyState text="Für diese Ansicht steht noch kein Vorgang im Plan." />
      ) : mode === 'zeitachse' ? (
        <Gantt
          tasks={schedule.tasks}
          phases={schedule.phases}
          decisions={decisions}
          contractualEnd={schedule.contractualEnd}
          onSelect={setSelected}
          selectedId={selected?.id}
        />
      ) : (
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
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => setSelected(task)}
                          className="w-full cursor-pointer text-left transition-colors duration-[var(--motion-micro)] hover:bg-paper-mist"
                        >
                          <TaskRow task={task} referenceYear={referenceYear} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            );
          })}
        </section>
      )}

      {selected === null ? null : (
        <TaskSheet
          projectId={projectId}
          // Immer die frische Fassung aus dem Plan zeigen: Nach einer Änderung
          // hätte das festgehaltene Objekt sonst noch die alten Termine.
          task={schedule.tasks.find((task) => task.id === selected.id) ?? selected}
          can={can}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function ModeButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-body font-medium transition-colors duration-[var(--motion-micro)] ${
        active ? 'bg-canvas-white text-charcoal shadow-[var(--shadow-subtle)]' : 'text-steel'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

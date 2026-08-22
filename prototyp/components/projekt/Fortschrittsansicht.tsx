'use client';

import { useState } from 'react';
import { BarChart3, ListOrdered } from 'lucide-react';
import { GanttMitZiehen } from '@/components/projekt/GanttMitZiehen';
import { Zeitleiste } from '@/components/projekt/Zeitleiste';
import type { IsoDatum } from '@/lib/datum';
import { cn } from '@/lib/utils';
import type { Projektdaten } from '@/lib/types';

type Ansicht = 'zeitleiste' | 'gantt';

/**
 * Der Umschalter zwischen den zwei Fortschrittsansichten.
 *
 * Die Zeitleiste ist der Standard, weil sie ohne Erklärung funktioniert. Der
 * Gantt ist die Option für alle, die Balken lesen können — und die einzige
 * Ansicht, in der sich Termine ziehen lassen.
 */
export function Fortschrittsansicht({ daten, heute }: { daten: Projektdaten; heute: IsoDatum }) {
  const [ansicht, setAnsicht] = useState<Ansicht>('zeitleiste');

  // `min-w-0` ist hier kein Feinschliff: ein Rasterfeld richtet sich sonst nach
  // seinem breitesten Kind, und der Balkenplan schiebt dann die ganze Seite quer.
  return (
    <section aria-labelledby="fortschritt" className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id="fortschritt" className="text-lg font-semibold">
          Der ganze Ablauf
        </h2>

        <div role="group" aria-label="Ansicht wählen" className="flex rounded-md border border-border">
          <Wahl
            aktiv={ansicht === 'zeitleiste'}
            onClick={() => setAnsicht('zeitleiste')}
            symbol={ListOrdered}
            className="rounded-l-md"
          >
            Zeitleiste
          </Wahl>
          <Wahl
            aktiv={ansicht === 'gantt'}
            onClick={() => setAnsicht('gantt')}
            symbol={BarChart3}
            className="rounded-r-md border-l border-border"
          >
            Balken
          </Wahl>
        </div>
      </div>

      {ansicht === 'zeitleiste' ? (
        <Zeitleiste daten={daten} heute={heute} />
      ) : (
        <GanttMitZiehen daten={daten} heute={heute} />
      )}
    </section>
  );
}

function Wahl({
  aktiv,
  onClick,
  symbol: Symbol,
  className,
  children,
}: {
  aktiv: boolean;
  onClick: () => void;
  symbol: typeof ListOrdered;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={aktiv}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 px-4 text-sm font-medium',
        aktiv ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
        className,
      )}
    >
      <Symbol aria-hidden className="size-4" />
      {children}
    </button>
  );
}

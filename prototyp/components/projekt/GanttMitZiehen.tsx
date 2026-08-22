'use client';

import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { createSnapModifier, restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { Balken, Gantt } from '@/components/projekt/Gantt';
import { VerschiebungDialog, type Verschiebungsvorschlag } from '@/components/projekt/VerschiebungDialog';
import { plusKalendertage, type IsoDatum } from '@/lib/datum';
import { GANTT_STANDARD, type Ganttbild } from '@/lib/gantt';
import { darf } from '@/lib/rechte';
import { useAktionen, useEigenesGewerkId, useModus, useRolle } from '@/lib/store';
import type { Gewerk, Projektdaten } from '@/lib/types';

/**
 * Ziehen und Ablegen — nur hier, nur für Rollen mit Planungsrecht.
 *
 * Das Ziehen verändert nichts. Es stellt eine Frage, und die Antwort steht im
 * Vorschaudialog. Erst dessen Bestätigung schreibt.
 */
export function GanttMitZiehen({ daten, heute }: { daten: Projektdaten; heute: IsoDatum }) {
  const rolle = useRolle();
  const modus = useModus();
  const eigenesGewerkId = useEigenesGewerkId();
  const { vorschau, planVerschieben } = useAktionen();
  const [vorschlag, setVorschlag] = useState<Verschiebungsvorschlag | null>(null);

  const recht = darf('plan_verschieben', { rolle, modus, eigenesGewerkId });

  const sensoren = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: tagweiseMitTasten }),
  );

  function beimAblegen(ereignis: DragEndEvent) {
    const tage = Math.round(ereignis.delta.x / GANTT_STANDARD.tagBreite);
    if (tage === 0) return;

    const gewerk = daten.gewerke.find((g) => g.id === String(ereignis.active.id));
    if (!gewerk) return;

    const aenderung = vorschau(gewerk.id, plusKalendertage(gewerk.start, tage));
    if (!aenderung) return;

    setVorschlag({ gewerk, alterStart: gewerk.start, aenderung });
  }

  return (
    <div className="grid min-w-0 gap-3">
      <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
        {recht.erlaubt ? (
          <>
            Ziehen Sie einen Balken nach links oder rechts, um den Termin zu verschieben. Bevor
            etwas übernommen wird, sehen Sie, was daran hängt. Fertige Gewerke lassen sich nicht
            verschieben.
          </>
        ) : (
          <>{recht.erklaerung} Sie können den Plan hier ansehen, aber nicht ändern.</>
        )}
      </p>

      <DndContext
        sensors={sensoren}
        modifiers={[restrictToHorizontalAxis, createSnapModifier(GANTT_STANDARD.tagBreite)]}
        onDragEnd={beimAblegen}
      >
        <Gantt
          daten={daten}
          heute={heute}
          balken={(zeile: Ganttbild['zeilen'][number]) => (
            <ZiehbarerBalken
              key={zeile.gewerk.id}
              zeile={zeile}
              ziehbar={recht.erlaubt && zeile.gewerk.status !== 'fertig'}
              grund={
                !recht.erlaubt
                  ? recht.erklaerung
                  : zeile.gewerk.status === 'fertig'
                    ? 'Was fertig ist, wird nicht mehr verschoben.'
                    : ''
              }
            />
          )}
        />
      </DndContext>

      <VerschiebungDialog
        vorschlag={vorschlag}
        onAbbrechen={() => setVorschlag(null)}
        onUebernehmen={(bestaetigt) => {
          planVerschieben(bestaetigt.gewerk.id, bestaetigt.aenderung);
          setVorschlag(null);
        }}
      />
    </div>
  );
}

function ZiehbarerBalken({
  zeile,
  ziehbar,
  grund,
}: {
  zeile: Ganttbild['zeilen'][number];
  ziehbar: boolean;
  grund: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: zeile.gewerk.id,
    disabled: !ziehbar,
  });

  if (!ziehbar) {
    return <Balken zeile={zeile} versatz={0} grund={grund} />;
  }

  return (
    <Balken
      zeile={zeile}
      versatz={0}
      ziehend={isDragging}
      schub={transform ? `translateX(${transform.x}px)` : undefined}
      griffRef={setNodeRef}
      griffProps={{ ...listeners, ...attributes }}
      beschriftung={beschriftung(zeile.gewerk)}
    />
  );
}

function beschriftung(gewerk: Gewerk): string {
  return `${gewerk.name} verschieben. Mit den Pfeiltasten links und rechts um je einen Tag.`;
}

/**
 * Mit der Tastatur wandert der Balken um genau einen Kalendertag je Anschlag.
 * Die Voreinstellung von dnd-kit springt in Pixeln und trifft dabei keinen
 * ganzen Tag.
 */
const tagweiseMitTasten: KeyboardCoordinateGetter = (ereignis, { currentCoordinates }) => {
  const schritt = GANTT_STANDARD.tagBreite;
  switch (ereignis.code) {
    case 'ArrowRight':
      return { ...currentCoordinates, x: currentCoordinates.x + schritt };
    case 'ArrowLeft':
      return { ...currentCoordinates, x: currentCoordinates.x - schritt };
    default:
      return undefined;
  }
};

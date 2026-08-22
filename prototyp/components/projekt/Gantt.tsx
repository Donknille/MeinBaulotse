'use client';

import Link from 'next/link';
import { alsDatum, alsKalendertage, alsZeitraum, type IsoDatum } from '@/lib/datum';
import { berechneGanttbild, GANTT_STANDARD, xVon, type Ganttbild } from '@/lib/gantt';
import { cn } from '@/lib/utils';
import type { Projektdaten, Status } from '@/lib/types';

/*
 * Die Balkendarstellung.
 *
 * Sie ist die Option, nicht der Standard: Balkenlängen sind für jemanden, der
 * Bauabläufe kennt, das dichteste Bild — und für jemanden, der zum ersten Mal
 * baut, eine Grafik, die er höflich anschaut und nicht liest.
 *
 * Auf dem Telefon ist sie nur lesbar, nicht bedienbar. Das ist Absicht.
 */

const BALKENFARBE: Record<Status, string> = {
  geplant: 'bg-status-geplant',
  bestaetigt: 'bg-status-bestaetigt',
  laeuft: 'bg-status-laeuft',
  fertig: 'bg-status-fertig',
  verzoegert: 'bg-status-verzoegert',
  blockiert: 'bg-status-blockiert',
};

export function Gantt({
  daten,
  heute,
  balken,
}: {
  daten: Projektdaten;
  heute: IsoDatum;
  /** Ersetzt die Balkendarstellung, sobald Ziehen erlaubt ist. */
  balken?: (zeile: Ganttbild['zeilen'][number], bild: Ganttbild) => React.ReactNode;
}) {
  const bild = berechneGanttbild(daten.gewerke, GANTT_STANDARD);
  if (bild.zeilen.length === 0) return null;

  const heuteX = xVon(heute, bild.von, GANTT_STANDARD);
  const kopfHoehe = 32;

  /*
   * Zwei Spalten statt einer: die Namen stehen in einem eigenen, nicht
   * scrollenden Bereich, das Diagramm daneben scrollt. Der naheliegende Weg
   * über `position: sticky` innerhalb der Zeilen sieht kürzer aus, hält aber
   * nicht — und ein Balkenplan ohne Namen ist wertlos.
   */
  return (
    <div className="min-w-0 rounded-lg border border-border">
      <div className="flex">
        <div className="w-[200px] shrink-0 border-r border-border">
          <div className="border-b border-border" style={{ height: kopfHoehe }} />
          {bild.zeilen.map((zeile) => (
            <div
              key={zeile.gewerk.id}
              className="flex items-center px-3"
              style={{ height: GANTT_STANDARD.zeilenHoehe }}
            >
              <Link
                href={`/projekt/gewerk/${zeile.gewerk.id}`}
                className="truncate text-xs hover:underline"
                title={zeile.gewerk.name}
              >
                <span className="zahl text-muted-foreground">{zeile.gewerk.nummer}.</span>{' '}
                {zeile.gewerk.name}
              </Link>
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <div className="relative" style={{ width: bild.breite }}>
            <div className="relative border-b border-border" style={{ height: kopfHoehe }}>
              {bild.wochen.map((woche) => (
                <span
                  key={woche.datum}
                  className="zahl absolute top-0 whitespace-nowrap border-l border-border pl-1 text-[11px] text-muted-foreground"
                  style={{ left: woche.x, height: kopfHoehe, lineHeight: `${kopfHoehe}px` }}
                >
                  {woche.beschriftung}
                </span>
              ))}
            </div>

            <div className="relative" style={{ height: bild.hoehe }}>
              {bild.wochen.map((woche) => (
                <span
                  key={woche.datum}
                  aria-hidden
                  className="absolute top-0 w-px bg-border/60"
                  style={{ left: woche.x, height: bild.hoehe }}
                />
              ))}

              <span
                aria-hidden
                title={`Heute, ${alsDatum(heute)}`}
                className="absolute top-0 z-10 w-0.5 bg-heute"
                style={{ left: heuteX, height: bild.hoehe }}
              />

              <svg
                aria-hidden
                className="pointer-events-none absolute left-0 top-0"
                width={bild.breite}
                height={bild.hoehe}
              >
                {bild.verbindungen.map((verbindung) => {
                  const knick = Math.max(verbindung.vonX + 5, verbindung.nachX - 6);
                  return (
                    <polyline
                      key={`${verbindung.vonId}-${verbindung.nachId}`}
                      points={`${verbindung.vonX},${verbindung.vonY} ${knick},${verbindung.vonY} ${knick},${verbindung.nachY} ${verbindung.nachX},${verbindung.nachY}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1"
                      className="text-muted-foreground/45"
                    />
                  );
                })}
              </svg>

              {bild.zeilen.map((zeile) => (
                <div
                  key={zeile.gewerk.id}
                  className="absolute left-0 right-0"
                  style={{ top: zeile.y, height: GANTT_STANDARD.zeilenHoehe }}
                >
                  {balken ? balken(zeile, bild) : <Balken zeile={zeile} versatz={0} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <Legende />
    </div>
  );
}

/**
 * Ein Arbeitsbalken samt anschließender Wartezeit.
 *
 * Beide sind eigenständig positioniert und tragen denselben Versatz, damit sie
 * beim Ziehen zusammenbleiben. Der Griff ist nur der Arbeitsbalken: die
 * Wartezeit lässt sich nicht anfassen, weil sie sich nicht verschieben lässt.
 */
export function Balken({
  zeile,
  versatz,
  ziehend,
  schub,
  griffRef,
  griffProps,
  beschriftung,
  grund,
}: {
  zeile: Ganttbild['zeilen'][number];
  versatz: number;
  ziehend?: boolean;
  /** CSS-Transform während des Ziehens. */
  schub?: string | undefined;
  griffRef?: (element: HTMLElement | null) => void;
  griffProps?: Record<string, unknown>;
  beschriftung?: string;
  /** Erklärung, wenn sich der Balken nicht ziehen lässt. */
  grund?: string;
}) {
  const oben = (GANTT_STANDARD.zeilenHoehe - 16) / 2;
  const ziehbar = griffProps !== undefined;

  return (
    <>
      <span
        ref={griffRef}
        {...griffProps}
        {...(ziehbar ? { role: 'button', tabIndex: 0, 'aria-label': beschriftung } : {})}
        title={grund || `${zeile.gewerk.name}: ${alsZeitraum(zeile.gewerk.start, zeile.gewerk.ende)}`}
        className={cn(
          'absolute h-4 rounded-sm',
          BALKENFARBE[zeile.gewerk.status],
          ziehbar && 'cursor-grab touch-none active:cursor-grabbing',
          ziehend && 'ring-2 ring-offset-1 ring-foreground',
        )}
        style={{ left: versatz + zeile.x, top: oben, width: zeile.breite, transform: schub }}
      />
      {zeile.wartezeit ? (
        <span
          aria-hidden
          className="absolute h-4 rounded-sm border border-wartezeit/60"
          style={{
            left: versatz + zeile.wartezeit.x,
            top: oben,
            width: zeile.wartezeit.breite,
            transform: schub,
            backgroundImage:
              'repeating-linear-gradient(45deg, var(--wartezeit) 0 2px, transparent 2px 6px)',
            opacity: 0.55,
          }}
          title={`Wartezeit: ${alsKalendertage(zeile.wartezeit.tage)}`}
        />
      ) : null}
    </>
  );
}

function Legende() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-6 rounded-sm bg-status-fertig" aria-hidden /> fertig
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-6 rounded-sm bg-status-verzoegert" aria-hidden /> später als geplant
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-6 rounded-sm bg-status-blockiert" aria-hidden /> wartet auf Vorleistung
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-6 rounded-sm bg-status-geplant" aria-hidden /> geplant
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-3 w-6 rounded-sm border border-wartezeit/60"
          aria-hidden
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, var(--wartezeit) 0 2px, transparent 2px 6px)',
            opacity: 0.55,
          }}
        />{' '}
        Wartezeit, nicht verkürzbar
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-0.5 bg-heute" aria-hidden /> heute
      </span>
    </div>
  );
}


'use client';

import { alsDatum } from '@/lib/datum';
import { fortschrittProzent, verzugTage, voraussichtlicheFertigstellung } from '@/lib/data';
import type { Projektdaten } from '@/lib/types';

/**
 * Der Stand in einem Absatz Klartext, keine Kennzahlenkacheln.
 *
 * Eine Zahl in einer Kachel muss gedeutet werden. Ein Satz nicht. Und die
 * schlechte Nachricht trägt den nächsten Schritt gleich mit.
 */
export function Projektstatus({ daten }: { daten: Projektdaten }) {
  const prozent = fortschrittProzent(daten);
  const verzug = verzugTage(daten);
  const voraussichtlich = voraussichtlicheFertigstellung(daten);

  return (
    <section aria-labelledby="stand" className="border-b border-border pb-6">
      <h1 id="stand" className="sr-only">
        Stand Ihres Bauvorhabens
      </h1>

      <p className="max-w-[62ch] text-lg leading-relaxed sm:text-xl">
        Ihr Haus ist zu <span className="zahl font-semibold">{prozent} Prozent</span> fertig.{' '}
        {verzug > 0 ? (
          <>
            <span className="font-semibold text-status-verzoegert">
              Aktuell liegt der Bau {verzug} Tage hinter dem Plan.
            </span>{' '}
            Voraussichtliche Fertigstellung:{' '}
            <span className="zahl font-semibold text-status-verzoegert">
              {alsDatum(voraussichtlich)}
            </span>{' '}
            <span className="text-muted-foreground">
              statt <span className="zahl">{alsDatum(daten.projekt.zielFertigstellung)}</span>.
            </span>
          </>
        ) : (
          <>
            Der Bau liegt im Plan. Voraussichtliche Fertigstellung:{' '}
            <span className="zahl font-semibold">{alsDatum(voraussichtlich)}</span>.
          </>
        )}
      </p>

      {verzug > 0 ? (
        <p className="mt-3 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
          Das ist beim Hausbau normal und noch kein Grund zur Sorge. Unten in der Zeitleiste sehen
          Sie, welches Gewerk die Verschiebung ausgelöst hat und was daran hängt.
        </p>
      ) : null}
    </section>
  );
}

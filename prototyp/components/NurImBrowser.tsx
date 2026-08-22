'use client';

import type { ReactNode } from 'react';
import { useNachMontage } from '@/lib/useNachMontage';

/**
 * Die Projektdaten liegen im lokalen Speicher des Geräts. Auf dem Server gibt
 * es sie nicht — würde dort schon etwas davon gezeichnet, wiche der erste
 * Aufbau im Browser davon ab und React würde ihn verwerfen.
 *
 * Deshalb wartet alles, was Daten zeigt, bis der Speicher gelesen ist.
 */
export function NurImBrowser({ children, platzhalter }: { children: ReactNode; platzhalter?: ReactNode }) {
  const montiert = useNachMontage();
  if (!montiert) {
    return (
      platzhalter ?? (
        <div className="mx-auto w-full max-w-5xl px-4 py-10" aria-busy="true">
          <div className="h-5 w-56 animate-pulse rounded-sm bg-muted" />
          <div className="mt-4 h-32 w-full animate-pulse rounded-lg bg-muted" />
        </div>
      )
    );
  }
  return <>{children}</>;
}

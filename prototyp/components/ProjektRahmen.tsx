'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Kopfzeile } from '@/components/Kopfzeile';
import { NurImBrowser } from '@/components/NurImBrowser';
import { useModus, useProjektdaten } from '@/lib/store';
import type { Projektdaten } from '@/lib/types';

/**
 * Der gemeinsame Rahmen aller Projektseiten: Kopfzeile, Warten auf den lokalen
 * Speicher und der Rückweg zur Startseite, falls noch keine Betriebsart
 * gewählt ist.
 */
export function ProjektRahmen({ children }: { children: (daten: Projektdaten) => ReactNode }) {
  return (
    <NurImBrowser>
      <Inhalt>{children}</Inhalt>
    </NurImBrowser>
  );
}

function Inhalt({ children }: { children: (daten: Projektdaten) => ReactNode }) {
  const modus = useModus();
  const daten = useProjektdaten();
  const router = useRouter();

  useEffect(() => {
    if (!modus) router.replace('/');
  }, [modus, router]);

  if (!daten) {
    return (
      <main id="inhalt" className="mx-auto w-full max-w-5xl px-4 py-12">
        <p className="text-base">
          Für dieses Gerät ist noch kein Beispielprojekt angelegt. Wählen Sie auf der Startseite
          Ihre Situation, dann geht es weiter.
        </p>
      </main>
    );
  }

  return (
    <>
      <Kopfzeile />
      {children(daten)}
    </>
  );
}

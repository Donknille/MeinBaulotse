'use client';

import { DasPassiertJetzt } from '@/components/projekt/DasPassiertJetzt';
import { Fortschrittsansicht } from '@/components/projekt/Fortschrittsansicht';
import { Fototagebuch } from '@/components/projekt/Fototagebuch';
import { Projektstatus } from '@/components/projekt/Projektstatus';
import { ProjektRahmen } from '@/components/ProjektRahmen';
import { useHeute } from '@/lib/useHeute';

export default function Projektuebersicht() {
  const heute = useHeute();

  return (
    <ProjektRahmen>
      {(daten) => (
        <main id="inhalt" className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-6 sm:py-8">
          <Projektstatus daten={daten} />
          <DasPassiertJetzt daten={daten} heute={heute} />
          <Fortschrittsansicht daten={daten} heute={heute} />

          <section aria-labelledby="fotos" className="grid gap-4">
            <h2 id="fotos" className="text-lg font-semibold">
              Fototagebuch
            </h2>
            <Fototagebuch daten={daten} ueberschriftId="fotos" />
          </section>
        </main>
      )}
    </ProjektRahmen>
  );
}

'use client';

import { ImagePlus } from 'lucide-react';
import { DasPassiertJetzt } from '@/components/projekt/DasPassiertJetzt';
import { Entscheidungen } from '@/components/projekt/Entscheidungen';
import { Fortschrittsansicht } from '@/components/projekt/Fortschrittsansicht';
import { Fototagebuch } from '@/components/projekt/Fototagebuch';
import { Projektstatus } from '@/components/projekt/Projektstatus';
import { useErfassung } from '@/components/Erfassung';
import { ErlaubteAktion } from '@/components/ErlaubteAktion';
import { ProjektRahmen } from '@/components/ProjektRahmen';
import { useModus, useRolle } from '@/lib/store';
import { useHeute } from '@/lib/useHeute';
import type { Projektdaten } from '@/lib/types';
import type { IsoDatum } from '@/lib/datum';

export default function Projektuebersicht() {
  const heute = useHeute();

  return (
    <ProjektRahmen>{(daten) => <Inhalt daten={daten} heute={heute} />}</ProjektRahmen>
  );
}

function Inhalt({ daten, heute }: { daten: Projektdaten; heute: IsoDatum }) {
  const rolle = useRolle();
  const modus = useModus();
  const { fotoHinzufuegen } = useErfassung();

  return (
    <main id="inhalt" className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-6 sm:py-8">
      <Projektstatus daten={daten} />
      <DasPassiertJetzt daten={daten} heute={heute} />
      <Fortschrittsansicht daten={daten} heute={heute} />

      <section aria-labelledby="entscheidungen" className="grid gap-4">
        <h2 id="entscheidungen" className="text-lg font-semibold">
          Entscheidungen
        </h2>
        <Entscheidungen daten={daten} heute={heute} />
      </section>

      <section aria-labelledby="fotos" className="grid gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 id="fotos" className="text-lg font-semibold">
            Fototagebuch
          </h2>
          <ErlaubteAktion
            recht="foto_hochladen"
            kontext={{ rolle, modus }}
            size="sm"
            variant="outline"
            onClick={() => fotoHinzufuegen()}
          >
            <ImagePlus aria-hidden className="size-4" />
            Foto hinzufügen
          </ErlaubteAktion>
        </div>
        <Fototagebuch daten={daten} ueberschriftId="fotos" />
      </section>
    </main>
  );
}

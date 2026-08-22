'use client';

import Link from 'next/link';
import { PhoneCall, RotateCcw } from 'lucide-react';
import { meldungsrecht, useErfassung } from '@/components/Erfassung';
import { ErlaubteAktion } from '@/components/ErlaubteAktion';
import { Rollenumschalter } from '@/components/Rollenumschalter';
import { Button } from '@/components/ui/button';
import { useAktionen, useModus, useProjekt, useRolle } from '@/lib/store';

export function Kopfzeile() {
  const projekt = useProjekt();
  const rolle = useRolle();
  const modus = useModus();
  const { demoZuruecksetzen } = useAktionen();
  const { standEintragen } = useErfassung();

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Link href="/projekt" className="text-sm font-semibold">
            MeinBaulotse
          </Link>
          {projekt ? (
            <p className="text-sm text-muted-foreground">
              {projekt.name}
              {projekt.gu ? ` · Bauleitung ${projekt.gu}` : ''}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Rollenumschalter />

          <div className="flex flex-wrap items-center gap-2">
            {/*
              In der Betriebsart „stellvertretend" ist das der Hauptweg, in den
              anderen ein zweiter — verfügbar bleibt er überall, mit einem Klick.
            */}
            <ErlaubteAktion
              recht={meldungsrecht(rolle)}
              kontext={{ rolle, modus }}
              variant={modus === 'stellvertretend' ? 'default' : 'outline'}
              onClick={() => standEintragen()}
            >
              <PhoneCall aria-hidden className="size-4" />
              Stand eintragen
            </ErlaubteAktion>

            <Button
              variant="ghost"
              size="sm"
              onClick={demoZuruecksetzen}
              className="text-xs text-muted-foreground"
            >
              <RotateCcw aria-hidden className="size-3.5" />
              Demo zurücksetzen
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

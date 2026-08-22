'use client';

import { useRouter } from 'next/navigation';
import { Eye } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MODUSNAME } from '@/lib/rechte';
import { useAktionen, useEigenesGewerkId, useGewerke, useModus, useRolle } from '@/lib/store';
import { useNachMontage } from '@/lib/useNachMontage';
import { cn } from '@/lib/utils';
import type { Betriebsmodus, Rolle } from '@/lib/types';

/** Ohne geladenes Projekt ist das laufende Gewerk die Nummer 10 der Vorlage. */
function gewerkeNachModus(_modus?: Betriebsmodus): string {
  return 'gw-10';
}

const ROLLEN: Array<{ rolle: Rolle; beschriftung: string }> = [
  { rolle: 'bauherr', beschriftung: 'Bauherr' },
  { rolle: 'gu', beschriftung: 'Bauleiter' },
  { rolle: 'gewerk', beschriftung: 'Betrieb' },
];

/**
 * Ein Demo-Werkzeug, kein Produktmerkmal: es erlaubt, dieselben Daten aus
 * jeder Perspektive zu sehen, ohne die Seite neu zu laden. Es sieht deshalb
 * bewusst schlicht aus und steht am Rand.
 */
export function Rollenumschalter({
  className,
  beiFehlenderBetriebsart,
}: {
  className?: string;
  /** Auf der Startseite: welche Betriebsart gilt, wenn noch keine gewählt ist. */
  beiFehlenderBetriebsart?: Betriebsmodus;
}) {
  const rolle = useRolle();
  const modus = useModus();
  const gewerke = useGewerke();
  const eigenesGewerkId = useEigenesGewerkId();
  const { rolleWechseln, modusWaehlen } = useAktionen();
  const router = useRouter();
  const montiert = useNachMontage();

  const standardGewerk = eigenesGewerkId ?? gewerke.find((g) => g.status !== 'fertig')?.id ?? gewerke[0]?.id;

  function wechsle(neu: Rolle) {
    // Ohne Betriebsart gibt es noch kein Projekt. Wer von der Startseite aus
    // die Perspektive wechselt, meint die Betriebsart, die dort angeboten ist.
    if (!modus && beiFehlenderBetriebsart) modusWaehlen(beiFehlenderBetriebsart);

    if (neu === 'gewerk') {
      const ziel = standardGewerk ?? gewerkeNachModus(beiFehlenderBetriebsart);
      rolleWechseln('gewerk', ziel);
      router.push(`/gewerk/${ziel}`);
      return;
    }
    rolleWechseln(neu);
    router.push('/projekt');
  }

  // Rolle und Betriebsart stehen im lokalen Speicher: erst nach dem ersten
  // Aufbau zeigen, sonst weicht er vom Aufbau auf dem Server ab.
  if (!montiert) return <div className={cn('h-9', className)} aria-hidden />;

  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground', className)}
    >
      <span className="inline-flex items-center gap-1.5">
        <Eye aria-hidden className="size-3.5" />
        Ansicht als
      </span>

      <div role="group" aria-label="Ansicht als Rolle" className="flex rounded-md border border-border">
        {ROLLEN.map(({ rolle: kandidat, beschriftung }, index) => (
          <button
            key={kandidat}
            type="button"
            onClick={() => wechsle(kandidat)}
            aria-pressed={rolle === kandidat}
            className={cn(
              'min-h-9 px-3 text-xs font-medium',
              index > 0 && 'border-l border-border',
              index === 0 && 'rounded-l-md',
              index === ROLLEN.length - 1 && 'rounded-r-md',
              rolle === kandidat ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            )}
          >
            {beschriftung}
          </button>
        ))}
      </div>

      {rolle === 'gewerk' && gewerke.length > 0 ? (
        <label className="flex items-center gap-2">
          <span className="sr-only">Welches Gewerk</span>
          <Select
            value={eigenesGewerkId ?? standardGewerk ?? ''}
            onValueChange={(wert) => {
              rolleWechseln('gewerk', wert);
              router.push(`/gewerk/${wert}`);
            }}
          >
            <SelectTrigger className="min-h-9 w-56 py-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {gewerke.map((gewerk) => (
                <SelectItem key={gewerk.id} value={gewerk.id}>
                  {gewerk.nummer}. {gewerk.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}

      {modus ? (
        <label className="flex items-center gap-2">
          <span className="sr-only">Betriebsart</span>
          <Select value={modus} onValueChange={(wert) => modusWaehlen(wert as Betriebsmodus)}>
            <SelectTrigger className="min-h-9 w-64 py-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODUSNAME) as Betriebsmodus[]).map((kandidat) => (
                <SelectItem key={kandidat} value={kandidat}>
                  {MODUSNAME[kandidat]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}
    </div>
  );
}

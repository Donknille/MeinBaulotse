'use client';

import Link from 'next/link';
import { Hourglass } from 'lucide-react';
import { Herkunftsmarke, Statuspunkt } from '@/components/Marken';
import { Progress } from '@/components/ui/progress';
import { STATUSTEXT, zeitleiste, type Zeitleisteneintrag } from '@/lib/data';
import {
  alsArbeitstage,
  alsDatum,
  alsKalendertage,
  alsZeitraum,
  arbeitstageZwischen,
  type IsoDatum,
} from '@/lib/datum';
import { nachfolgerHuelle } from '@/lib/planung';
import { cn } from '@/lib/utils';
import type { Gewerk, Projektdaten } from '@/lib/types';

/**
 * Die Zeitleiste — die Standardansicht.
 *
 * Kein Gantt: die zeitliche Distanz zwischen zwei Einträgen wird nicht durch
 * Balkenlänge dargestellt, sondern ausgeschrieben. Ein Laie liest „28
 * Kalendertage, in dieser Zeit kann nicht weitergearbeitet werden" schneller
 * und richtiger, als er eine Lücke zwischen zwei Balken deutet.
 *
 * Die Liste ist absichtlich lang. Scrollen ist billiger als Rätselraten.
 */
export function Zeitleiste({ daten, heute }: { daten: Projektdaten; heute: IsoDatum }) {
  const abschnitte = zeitleiste(daten, heute);

  return (
    <div className="grid gap-8">
      {abschnitte.map((abschnitt) => (
        <section key={abschnitt.phase} aria-labelledby={`phase-${abschnitt.phase}`}>
          <h3
            id={`phase-${abschnitt.phase}`}
            className="border-b border-border pb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {abschnitt.phase}
          </h3>

          <ol className="mt-3 grid gap-0">
            {abschnitt.eintraege.map((eintrag) => (
              <li key={eintrag.schluessel}>
                <Eintrag eintrag={eintrag} daten={daten} heute={heute} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function Eintrag({
  eintrag,
  daten,
  heute,
}: {
  eintrag: Zeitleisteneintrag;
  daten: Projektdaten;
  heute: IsoDatum;
}) {
  if (eintrag.art === 'heute') return <HeuteMarke datum={eintrag.datum} />;
  if (eintrag.art === 'wartezeit') return <Wartezeit eintrag={eintrag} />;
  return <Gewerkzeile gewerk={eintrag.gewerk} daten={daten} heute={heute} />;
}

/** Die einzige Stelle, an der eine Linie quer über die Liste läuft. */
function HeuteMarke({ datum }: { datum: IsoDatum }) {
  return (
    <div className="flex items-center gap-3 py-3" aria-label={`Heute, ${alsDatum(datum)}`}>
      <span className="size-3 shrink-0 rounded-full bg-heute" aria-hidden />
      <span className="zahl text-sm font-semibold text-heute">Heute, {alsDatum(datum)}</span>
      <span className="h-px flex-1 bg-heute/40" aria-hidden />
    </div>
  );
}

function Wartezeit({
  eintrag,
}: {
  eintrag: Extract<Zeitleisteneintrag, { art: 'wartezeit' }>;
}) {
  return (
    <div className="flex gap-3 py-3">
      <span className="mt-1 flex size-3 shrink-0 items-center justify-center" aria-hidden>
        <Hourglass className="size-3.5 text-wartezeit" />
      </span>
      <div className="min-w-0 flex-1 rounded-md border border-dashed border-wartezeit/50 bg-wartezeit-flaeche p-3">
        <p className="text-sm font-semibold text-wartezeit">
          Wartezeit nach {eintrag.nachGewerk.name}
        </p>
        <p className="zahl mt-0.5 text-sm text-muted-foreground">
          {alsZeitraum(eintrag.von, eintrag.bis)} · {alsKalendertage(eintrag.tage)}
        </p>
        <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed">
          {eintrag.grund} In dieser Zeit kann auf der Baustelle nicht weitergearbeitet werden. Das
          ist normal und nicht verkürzbar.
        </p>
      </div>
    </div>
  );
}

function Gewerkzeile({
  gewerk,
  daten,
  heute,
}: {
  gewerk: Gewerk;
  daten: Projektdaten;
  heute: IsoDatum;
}) {
  const laeuft = gewerk.start <= heute && gewerk.ende >= heute && gewerk.status !== 'fertig';
  const dauer = arbeitstageZwischen(gewerk.start, gewerk.ende);

  return (
    <div className="flex gap-3 border-b border-border/60 py-3 last:border-b-0">
      <span className="mt-1.5">
        <Statuspunkt status={gewerk.status} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <Link
            href={`/projekt/gewerk/${gewerk.id}`}
            className={cn('font-medium hover:underline', gewerk.status === 'fertig' && 'text-muted-foreground')}
          >
            {gewerk.nummer}. {gewerk.name}
          </Link>
          <span className="zahl text-sm text-muted-foreground">
            {alsZeitraum(gewerk.start, gewerk.ende, heute)}, {alsArbeitstage(dauer)}
          </span>
        </div>

        <p className="mt-0.5 text-sm text-muted-foreground">
          {STATUSTEXT[gewerk.status]}
          {gewerk.betrieb ? ` · ${gewerk.betrieb}` : ''}
        </p>

        {laeuft ? (
          <div className="mt-2 flex max-w-sm items-center gap-2">
            <Progress value={gewerk.fortschrittProzent} aria-label="Fortschritt" />
            <span className="zahl shrink-0 text-xs text-muted-foreground">
              {gewerk.fortschrittProzent} %
            </span>
          </div>
        ) : null}

        {gewerk.status === 'verzoegert' ? <Folgen gewerk={gewerk} daten={daten} /> : null}

        {gewerk.status === 'blockiert' ? (
          <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-status-blockiert">
            Wartet auf die Vorleistung. Sobald das Gewerk davor fertig gemeldet ist, kann es
            losgehen.
          </p>
        ) : null}

        <Herkunftsmarke
          herkunft={gewerk.herkunft}
          notiz={gewerk.herkunftNotiz}
          zeitpunkt={gewerk.letzteMeldung}
          className="mt-1.5"
        />
      </div>
    </div>
  );
}

/** Bei einer Verzögerung gehört dazu, was daran hängt — sonst bleibt sie abstrakt. */
function Folgen({ gewerk, daten }: { gewerk: Gewerk; daten: Projektdaten }) {
  const betroffene = [...nachfolgerHuelle(daten.gewerke, gewerk.id)]
    .map((id) => daten.gewerke.find((g) => g.id === id))
    .filter((g): g is Gewerk => g !== undefined)
    .sort((a, b) => a.nummer - b.nummer);

  if (betroffene.length === 0) {
    return (
      <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-status-verzoegert">
        Später als geplant. Auf den weiteren Ablauf wirkt sich das nicht aus, weil nichts darauf
        aufbaut.
      </p>
    );
  }

  const ersten = betroffene.slice(0, 3).map((g) => g.name);

  return (
    <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed text-status-verzoegert">
      Später als geplant. Daran hängen {betroffene.length} weitere Gewerke, darunter{' '}
      {ersten.join(', ')}
      {betroffene.length > ersten.length ? ' und weitere' : ''}.
    </p>
  );
}

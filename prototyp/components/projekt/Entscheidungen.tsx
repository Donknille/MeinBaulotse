'use client';

import Link from 'next/link';
import { ArrowRight, Check, Undo2 } from 'lucide-react';
import { ErlaubteAktion } from '@/components/ErlaubteAktion';
import { Button } from '@/components/ui/button';
import { erledigteEntscheidungen, offeneEntscheidungen, tageBisFrist } from '@/lib/data';
import { alsDatum, type IsoDatum } from '@/lib/datum';
import { useAktionen, useModus, useRolle } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Entscheidung, Projektdaten } from '@/lib/types';

/**
 * Entscheidungen, offen und getroffen.
 *
 * Eine Frist allein sagt einem Bauherren nichts. Erst zusammen mit der
 * Auswirkung — was steht still, wenn ich mich nicht entscheide — wird sie zu
 * einer Handlungsaufforderung.
 */
export function Entscheidungen({
  daten,
  heute,
  nurFuerGewerk,
}: {
  daten: Projektdaten;
  heute: IsoDatum;
  /** Auf einer Gewerkseite nur die Entscheidungen, die dieses Gewerk betreffen. */
  nurFuerGewerk?: string;
}) {
  const passend = (liste: Entscheidung[]) =>
    nurFuerGewerk ? liste.filter((e) => e.betrifftGewerkId === nurFuerGewerk) : liste;

  const offen = passend(offeneEntscheidungen(daten));
  const erledigt = passend(erledigteEntscheidungen(daten));

  if (offen.length === 0 && erledigt.length === 0) {
    return (
      <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
        {nurFuerGewerk
          ? 'Für dieses Gewerk ist keine Entscheidung nötig.'
          : 'Gerade steht keine Entscheidung an. Sobald eine ihre Vorlaufzeit erreicht, erscheint sie hier — rechtzeitig, damit Lieferzeiten noch passen.'}
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {offen.length > 0 ? (
        <ul className="grid gap-3">
          {offen.map((entscheidung, rang) => (
            <li key={entscheidung.id}>
              <Karte
                daten={daten}
                entscheidung={entscheidung}
                heute={heute}
                dringend={rang === 0 && !nurFuerGewerk}
                zeigeGewerk={!nurFuerGewerk}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {erledigt.length > 0 ? <Erledigt entscheidungen={erledigt} /> : null}
    </div>
  );
}

function Karte({
  daten,
  entscheidung,
  heute,
  dringend,
  zeigeGewerk,
}: {
  daten: Projektdaten;
  entscheidung: Entscheidung;
  heute: IsoDatum;
  dringend: boolean;
  zeigeGewerk: boolean;
}) {
  const rolle = useRolle();
  const modus = useModus();
  const { entscheidungAbschliessen } = useAktionen();
  const tage = tageBisFrist(entscheidung, heute);
  const gewerk = daten.gewerke.find((g) => g.id === entscheidung.betrifftGewerkId);

  return (
    <div
      className={cn(
        'grid gap-2 rounded-lg border p-4',
        dringend ? 'border-status-verzoegert' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-base font-semibold leading-snug">{entscheidung.titel}</h3>
        <p
          className={cn(
            'zahl text-sm font-medium',
            tage <= 5 ? 'text-status-verzoegert' : 'text-muted-foreground',
          )}
        >
          {tage < 0
            ? `Frist war am ${alsDatum(entscheidung.fristBis)}`
            : tage === 0
              ? 'Frist ist heute'
              : `Noch ${tage} Tage, bis ${alsDatum(entscheidung.fristBis)}`}
        </p>
      </div>

      <p className="max-w-[62ch] text-sm leading-relaxed">{entscheidung.beschreibung}</p>
      <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
        {entscheidung.auswirkung}
      </p>

      <div className="mt-1 flex flex-wrap items-center gap-3">
        <ErlaubteAktion
          recht="entscheidung_treffen"
          kontext={{ rolle, modus }}
          size="sm"
          variant={dringend ? 'default' : 'outline'}
          onClick={() => entscheidungAbschliessen(entscheidung.id)}
        >
          <Check aria-hidden className="size-4" />
          Entscheidung getroffen
        </ErlaubteAktion>

        {zeigeGewerk && gewerk ? (
          <Link
            href={`/projekt/gewerk/${gewerk.id}`}
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Betrifft {gewerk.name}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Erledigt({ entscheidungen }: { entscheidungen: Entscheidung[] }) {
  const { entscheidungOeffnen } = useAktionen();

  return (
    <details className="rounded-lg border border-border">
      <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-medium">
        {entscheidungen.length} bereits getroffen
      </summary>
      <ul className="grid gap-0 border-t border-border">
        {entscheidungen.map((entscheidung) => (
          <li
            key={entscheidung.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 last:border-b-0"
          >
            <span className="text-sm">{entscheidung.titel}</span>
            <span className="flex items-center gap-3">
              {entscheidung.erledigtAm ? (
                <span className="zahl text-xs text-muted-foreground">
                  {alsDatum(entscheidung.erledigtAm)}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => entscheidungOeffnen(entscheidung.id)}
              >
                <Undo2 aria-hidden className="size-3.5" />
                Wieder öffnen
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

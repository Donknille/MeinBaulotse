'use client';

import Link from 'next/link';
import { ArrowRight, CalendarClock, Hammer, ListChecks } from 'lucide-react';
import { Herkunftsmarke, Statusmarke } from '@/components/Marken';
import { ErlaubteAktion } from '@/components/ErlaubteAktion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { alsArbeitstage, alsDatum, alsZeitraum, kalendertageZwischen, type IsoDatum } from '@/lib/datum';
import { laufendeGewerke, naechstesGewerk, offeneEntscheidungen, tageBisFrist } from '@/lib/data';
import { arbeitstageZwischen } from '@/lib/datum';
import { useAktionen, useModus, useRolle } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Projektdaten } from '@/lib/types';

export function DasPassiertJetzt({ daten, heute }: { daten: Projektdaten; heute: IsoDatum }) {
  return (
    <section aria-labelledby="jetzt" className="grid gap-3 md:grid-cols-3">
      <h2 id="jetzt" className="sr-only">
        Das passiert jetzt
      </h2>
      <LaeuftGerade daten={daten} heute={heute} />
      <AlsNaechstes daten={daten} heute={heute} />
      <WartetAufSie daten={daten} heute={heute} />
    </section>
  );
}

function Blockkopf({ symbol: Symbol, titel }: { symbol: typeof Hammer; titel: string }) {
  return (
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Symbol aria-hidden className="size-4" />
        {titel}
      </CardTitle>
    </CardHeader>
  );
}

function LaeuftGerade({ daten, heute }: { daten: Projektdaten; heute: IsoDatum }) {
  const laufend = laufendeGewerke(daten, heute);

  return (
    <Card>
      <Blockkopf symbol={Hammer} titel="Läuft gerade" />
      <CardContent className="grid gap-4">
        {laufend.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Heute arbeitet niemand auf der Baustelle. Sehen Sie in der Zeitleiste nach, ob gerade
            eine Wartezeit läuft — die ist eingeplant und kein Stillstand.
          </p>
        ) : (
          laufend.map((gewerk) => (
            <div key={gewerk.id} className="grid gap-2">
              <Link href={`/projekt/gewerk/${gewerk.id}`} className="text-base font-semibold hover:underline">
                {gewerk.name}
              </Link>
              <Statusmarke status={gewerk.status} />
              <p className="text-sm text-muted-foreground">
                {gewerk.betrieb ?? 'Betrieb noch nicht eingetragen'}
                {gewerk.ansprechpartner ? `, ${gewerk.ansprechpartner}` : ''}
              </p>
              <p className="zahl text-sm text-muted-foreground">
                Seit {alsDatum(gewerk.start)}, das sind{' '}
                {alsArbeitstage(arbeitstageZwischen(gewerk.start, heute))}
              </p>
              <div className="grid gap-1">
                <Progress value={gewerk.fortschrittProzent} aria-label="Fortschritt" />
                <span className="zahl text-xs text-muted-foreground">
                  {gewerk.fortschrittProzent} Prozent
                </span>
              </div>
              <Herkunftsmarke
                herkunft={gewerk.herkunft}
                notiz={gewerk.herkunftNotiz}
                zeitpunkt={gewerk.letzteMeldung}
              />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AlsNaechstes({ daten, heute }: { daten: Projektdaten; heute: IsoDatum }) {
  const naechstes = naechstesGewerk(daten, heute);

  return (
    <Card>
      <Blockkopf symbol={CalendarClock} titel="Als Nächstes" />
      <CardContent className="grid gap-2">
        {!naechstes ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Alle Gewerke sind abgeschlossen. Bleibt die Bauabnahme — dort werden Mängel schriftlich
            festgehalten, bevor Sie unterschreiben.
          </p>
        ) : (
          <>
            <Link
              href={`/projekt/gewerk/${naechstes.id}`}
              className="text-base font-semibold hover:underline"
            >
              {naechstes.name}
            </Link>
            <Statusmarke status={naechstes.status} />
            <p className="zahl text-sm text-muted-foreground">
              Voraussichtlich ab {alsDatum(naechstes.start)}, in{' '}
              {kalendertageZwischen(heute, naechstes.start)} Tagen
            </p>
            <p className="zahl text-sm text-muted-foreground">
              {alsZeitraum(naechstes.start, naechstes.ende, heute)} ·{' '}
              {alsArbeitstage(arbeitstageZwischen(naechstes.start, naechstes.ende))}
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">{naechstes.beschreibung}</p>
            <Herkunftsmarke herkunft={naechstes.herkunft} notiz={naechstes.herkunftNotiz} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function WartetAufSie({ daten, heute }: { daten: Projektdaten; heute: IsoDatum }) {
  const offen = offeneEntscheidungen(daten);
  const rolle = useRolle();
  const modus = useModus();
  const { entscheidungAbschliessen } = useAktionen();

  return (
    <Card>
      <Blockkopf symbol={ListChecks} titel="Wartet auf Sie" />
      <CardContent className="grid gap-4">
        {offen.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Gerade wartet nichts auf Sie. Die nächste Entscheidung meldet sich hier, sobald ihre
            Vorlaufzeit beginnt.
          </p>
        ) : (
          offen.map((entscheidung, rang) => {
            const tage = tageBisFrist(entscheidung, heute);
            const dringend = rang === 0;
            const gewerk = daten.gewerke.find((g) => g.id === entscheidung.betrifftGewerkId);

            return (
              <div
                key={entscheidung.id}
                className={cn(
                  'grid gap-2 rounded-md border p-3',
                  dringend ? 'border-status-verzoegert bg-muted/40' : 'border-border',
                )}
              >
                <p className="text-base font-semibold leading-snug">{entscheidung.titel}</p>
                <p
                  className={cn(
                    'zahl text-sm font-medium',
                    dringend ? 'text-status-verzoegert' : 'text-muted-foreground',
                  )}
                >
                  {tage < 0
                    ? `Frist war am ${alsDatum(entscheidung.fristBis)}`
                    : tage === 0
                      ? 'Frist ist heute'
                      : `Noch ${tage} Tage, bis ${alsDatum(entscheidung.fristBis)}`}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {entscheidung.auswirkung}
                </p>
                {gewerk ? (
                  <Link
                    href={`/projekt/gewerk/${gewerk.id}`}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    Betrifft {gewerk.name}
                    <ArrowRight aria-hidden className="size-3.5" />
                  </Link>
                ) : null}
                <ErlaubteAktion
                  recht="entscheidung_treffen"
                  kontext={{ rolle, modus }}
                  size="sm"
                  variant={dringend ? 'default' : 'outline'}
                  className="justify-self-start"
                  onClick={() => entscheidungAbschliessen(entscheidung.id)}
                >
                  Entscheidung getroffen
                </ErlaubteAktion>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

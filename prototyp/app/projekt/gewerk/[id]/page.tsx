'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Hourglass, Phone } from 'lucide-react';
import { Herkunftsmarke, Statusmarke } from '@/components/Marken';
import { Fototagebuch } from '@/components/projekt/Fototagebuch';
import { ProjektRahmen } from '@/components/ProjektRahmen';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  ereignisseZuGewerk,
  fotosZuGewerk,
  gewerkNachId,
  nachfolgerVon,
  vorgaengerVon,
} from '@/lib/data';
import {
  alsArbeitstage,
  alsDatum,
  alsDatumMitWochentag,
  alsKalendertage,
  arbeitstageZwischen,
} from '@/lib/datum';
import { phaseVonGewerk } from '@/lib/stammdaten';
import { ROLLENNAME } from '@/lib/rechte';
import { useHeute } from '@/lib/useHeute';
import type { Gewerk, Projektdaten } from '@/lib/types';

export default function Gewerkdetail() {
  const params = useParams<{ id: string }>();
  const heute = useHeute();

  return (
    <ProjektRahmen>
      {(daten) => {
        const gewerk = gewerkNachId(daten, params.id);

        if (!gewerk) {
          return (
            <main id="inhalt" className="mx-auto w-full max-w-3xl px-4 py-12">
              <h1 className="text-xl font-semibold">Dieses Gewerk gibt es hier nicht</h1>
              <p className="mt-2 max-w-[62ch] text-muted-foreground">
                Vermutlich ist der Verweis veraltet. Über die Übersicht finden Sie alle Gewerke des
                Bauvorhabens.
              </p>
              <Link href="/projekt" className="mt-4 inline-flex text-primary hover:underline">
                Zur Übersicht
              </Link>
            </main>
          );
        }

        return <Inhalt daten={daten} gewerk={gewerk} heute={heute} />;
      }}
    </ProjektRahmen>
  );
}

function Inhalt({
  daten,
  gewerk,
  heute,
}: {
  daten: Projektdaten;
  gewerk: Gewerk;
  heute: string;
}) {
  const vorher = vorgaengerVon(daten, gewerk.id);
  const danach = nachfolgerVon(daten, gewerk.id);
  const fotos = fotosZuGewerk(daten, gewerk.id);
  const verlauf = ereignisseZuGewerk(daten, gewerk.id);
  const laeuft = gewerk.start <= heute && gewerk.ende >= heute && gewerk.status !== 'fertig';

  return (
    <main id="inhalt" className="mx-auto grid w-full max-w-3xl gap-8 px-4 py-6 sm:py-8">
      <div>
        <Link
          href="/projekt"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Zur Übersicht
        </Link>

        <p className="mt-4 text-sm text-muted-foreground">
          {phaseVonGewerk(gewerk.id)} · Gewerk {gewerk.nummer} von {daten.gewerke.length}
        </p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight sm:text-3xl">{gewerk.name}</h1>
        <p className="mt-3 max-w-[62ch] text-base leading-relaxed">{gewerk.beschreibung}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Statusmarke status={gewerk.status} />
          <Herkunftsmarke
            herkunft={gewerk.herkunft}
            notiz={gewerk.herkunftNotiz}
            zeitpunkt={gewerk.letzteMeldung}
          />
        </div>

        {laeuft ? (
          <div className="mt-3 flex max-w-sm items-center gap-2">
            <Progress value={gewerk.fortschrittProzent} aria-label="Fortschritt" />
            <span className="zahl shrink-0 text-sm text-muted-foreground">
              {gewerk.fortschrittProzent} Prozent
            </span>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Termine</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p className="zahl">Beginn: {alsDatumMitWochentag(gewerk.start)}</p>
            <p className="zahl">Ende: {alsDatumMitWochentag(gewerk.ende)}</p>
            <p className="zahl text-muted-foreground">
              Dauer: {alsArbeitstage(arbeitstageZwischen(gewerk.start, gewerk.ende))}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ausführender Betrieb
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            {gewerk.betrieb ? (
              <>
                <p className="font-medium">{gewerk.betrieb}</p>
                {gewerk.ansprechpartner ? <p>{gewerk.ansprechpartner}</p> : null}
                {gewerk.telefon ? (
                  <a
                    href={`tel:${gewerk.telefon.replace(/\s/g, '')}`}
                    className="zahl inline-flex items-center gap-1.5 text-primary hover:underline"
                  >
                    <Phone aria-hidden className="size-4" />
                    {gewerk.telefon}
                  </a>
                ) : null}
              </>
            ) : (
              <p className="leading-relaxed text-muted-foreground">
                Noch kein Betrieb eingetragen. Sobald der Auftrag vergeben ist, gehören Name und
                Telefonnummer hierher — dann steht die Nummer da, wo Sie sie brauchen.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {gewerk.wartezeitTage ? (
        <section
          aria-label="Wartezeit nach diesem Gewerk"
          className="rounded-lg border border-dashed border-wartezeit/50 bg-wartezeit-flaeche p-4"
        >
          <p className="flex items-center gap-2 font-semibold text-wartezeit">
            <Hourglass aria-hidden className="size-4" />
            Danach {alsKalendertage(gewerk.wartezeitTage)} Wartezeit
          </p>
          <p className="mt-1.5 max-w-[62ch] text-sm leading-relaxed">
            {gewerk.wartezeitGrund} In dieser Zeit kann auf der Baustelle nicht weitergearbeitet
            werden. Das ist normal und nicht verkürzbar.
          </p>
        </section>
      ) : null}

      <section aria-labelledby="kette" className="grid gap-3">
        <h2 id="kette" className="text-lg font-semibold">
          Was davor und danach kommt
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <Kettenliste
            titel="Braucht vorher"
            gewerke={vorher}
            leer="Nichts. Dieses Gewerk kann unabhängig von anderen beginnen."
            symbol="vor"
          />
          <Kettenliste
            titel="Wartet darauf"
            gewerke={danach}
            leer="Nichts. Auf dieses Gewerk baut kein anderes auf."
            symbol="nach"
          />
        </div>
      </section>

      <section aria-labelledby="fotos-gewerk" className="grid gap-3">
        <h2 id="fotos-gewerk" className="text-lg font-semibold">
          Fotos zu diesem Gewerk
        </h2>
        <Fototagebuch daten={daten} eintraege={fotos} ueberschriftId="fotos-gewerk" />
      </section>

      <section aria-labelledby="verlauf" className="grid gap-3">
        <h2 id="verlauf" className="text-lg font-semibold">
          Verlauf
        </h2>
        {verlauf.length === 0 ? (
          <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            Zu diesem Gewerk ist noch nichts vermerkt. Jede Meldung und jede Terminänderung
            erscheint hier automatisch, mit Zeitpunkt und Urheber.
          </p>
        ) : (
          <ol className="grid gap-0 border-t border-border">
            {verlauf.map((eintrag) => (
              <li key={eintrag.id} className="border-b border-border py-2.5">
                <p className="text-sm leading-relaxed">{eintrag.text}</p>
                <p className="zahl mt-0.5 text-xs text-muted-foreground">
                  {alsDatum(eintrag.zeitpunkt.slice(0, 10))} · {ROLLENNAME[eintrag.akteur]}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function Kettenliste({
  titel,
  gewerke,
  leer,
  symbol,
}: {
  titel: string;
  gewerke: Gewerk[];
  leer: string;
  symbol: 'vor' | 'nach';
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">{titel}</CardTitle>
      </CardHeader>
      <CardContent>
        {gewerke.length === 0 ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{leer}</p>
        ) : (
          <ul className="grid gap-2">
            {gewerke.map((gewerk) => (
              <li key={gewerk.id}>
                <Link
                  href={`/projekt/gewerk/${gewerk.id}`}
                  className="flex items-center gap-2 text-sm hover:underline"
                >
                  {symbol === 'vor' ? (
                    <ArrowLeft aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{gewerk.name}</span>
                  <Statusmarke status={gewerk.status} className="shrink-0 text-xs" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

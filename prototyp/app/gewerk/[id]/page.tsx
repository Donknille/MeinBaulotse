'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CalendarCheck, CalendarX, Check, ImagePlus, PhoneCall } from 'lucide-react';
import { ErfassungAnbieter, useErfassung } from '@/components/Erfassung';
import { Herkunftsmarke, Statusmarke, Statuspunkt } from '@/components/Marken';
import { NurImBrowser } from '@/components/NurImBrowser';
import { Rollenumschalter } from '@/components/Rollenumschalter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { STATUSTEXT, vorgaengerVon } from '@/lib/data';
import {
  alsArbeitstage,
  alsDatumMitWochentag,
  alsKalendertage,
  alsTagUndMonat,
  arbeitstageZwischen,
} from '@/lib/datum';
import { useAktionen, useProjektdaten } from '@/lib/store';
import { useHeute } from '@/lib/useHeute';
import type { Gewerk, Projektdaten } from '@/lib/types';

/**
 * Die Ansicht, die ein Handwerksbetrieb über einen Link bekäme.
 *
 * Bewusst karg: ein Termin, zwei Schaltflächen, der Stand der Vorleistung.
 * Handwerksbetriebe benutzen keine zusätzlichen Apps. Wenn diese Seite in
 * zehn Sekunden nicht beantwortet, was der Betrieb wissen will, wird sie nicht
 * wieder geöffnet — und die Antwort auf „kann ich am Montag anfangen" ist der
 * einzige Grund, aus dem er sie überhaupt öffnet.
 */
export default function Gewerkesicht() {
  const params = useParams<{ id: string }>();

  return (
    <NurImBrowser>
      <Inhalt id={params.id} />
    </NurImBrowser>
  );
}

function Inhalt({ id }: { id: string }) {
  const daten = useProjektdaten();
  const { rolleWechseln } = useAktionen();
  const uebernommen = useRef<string | null>(null);

  /*
   * Wer diesen Verweis öffnet, ist der Betrieb. Im Prototyp wird die Rolle
   * deshalb übernommen, statt eine Anmeldung zu verlangen — aber genau einmal
   * je Gewerk.
   *
   * Ohne diese Sperre schlug der Rollenumschalter fehl: er setzt die Rolle auf
   * „Bauherr" und wechselt dann die Seite. Solange diese hier noch steht,
   * bemerkte sie die neue Rolle und stellte sie sofort wieder zurück.
   */
  useEffect(() => {
    if (uebernommen.current === id) return;
    uebernommen.current = id;
    rolleWechseln('gewerk', id);
  }, [id, rolleWechseln]);

  if (!daten) {
    return (
      <main id="inhalt" className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-xl font-semibold">Dieser Termin ist nicht mehr hinterlegt</h1>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          Der Link gehört zu einem Bauvorhaben, das auf diesem Gerät nicht angelegt ist. Fragen Sie
          beim Bauherrn nach einem neuen Link.
        </p>
      </main>
    );
  }

  const gewerk = daten.gewerke.find((g) => g.id === id);
  if (!gewerk) {
    return (
      <main id="inhalt" className="mx-auto w-full max-w-xl px-4 py-12">
        <h1 className="text-xl font-semibold">Dieser Termin ist nicht mehr hinterlegt</h1>
        <p className="mt-2 leading-relaxed text-muted-foreground">
          Vermutlich ist der Link veraltet. Fragen Sie beim Bauherrn nach einem neuen.
        </p>
      </main>
    );
  }

  return (
    <ErfassungAnbieter daten={daten}>
      <Termin daten={daten} gewerk={gewerk} />
    </ErfassungAnbieter>
  );
}

function Termin({ daten, gewerk }: { daten: Projektdaten; gewerk: Gewerk }) {
  const heute = useHeute();
  const { terminBestaetigen, terminAbsagen } = useAktionen();
  const { standEintragen, fotoHinzufuegen } = useErfassung();
  const [absageOffen, setAbsageOffen] = useState(false);
  const [grund, setGrund] = useState('');

  const vorleistungen = vorgaengerVon(daten, gewerk.id);
  const offeneVorleistungen = vorleistungen.filter((v) => v.status !== 'fertig');
  const bereit = offeneVorleistungen.length === 0;

  return (
    <>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <span className="text-sm font-semibold">MeinBaulotse</span>
          <span className="text-sm text-muted-foreground">{daten.projekt.name}</span>
        </div>
      </header>

      <main id="inhalt" className="mx-auto grid w-full max-w-xl gap-6 px-4 py-6">
        <div>
          <p className="text-sm text-muted-foreground">Ihr Termin</p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight">{gewerk.name}</h1>
          {gewerk.betrieb ? (
            <p className="mt-1 text-base text-muted-foreground">{gewerk.betrieb}</p>
          ) : null}
        </div>

        <Card>
          <CardContent className="grid gap-1 p-4 sm:p-5">
            <p className="zahl text-lg font-semibold">
              {alsDatumMitWochentag(gewerk.start)} bis {alsDatumMitWochentag(gewerk.ende)}
            </p>
            <p className="zahl text-sm text-muted-foreground">
              {alsArbeitstage(arbeitstageZwischen(gewerk.start, gewerk.ende))} eingeplant
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Statusmarke status={gewerk.status} />
              <Herkunftsmarke
                herkunft={gewerk.herkunft}
                notiz={gewerk.herkunftNotiz}
                zeitpunkt={gewerk.letzteMeldung}
              />
            </div>
          </CardContent>
        </Card>

        {/*
          Der eigentliche Grund für diese Seite. Nur lesbar: der Betrieb kann den
          Stand der Vorleistung nicht ändern, aber er muss ihn sehen können.
        */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Können Sie anfangen?
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {vorleistungen.length === 0 ? (
              <p className="text-sm leading-relaxed">
                Sie brauchen keine Vorleistung. Der Termin hängt an nichts anderem.
              </p>
            ) : (
              <>
                <p className={bereitSatz(bereit)}>
                  {bereit
                    ? 'Ja. Alle Vorarbeiten sind fertig gemeldet.'
                    : offeneVorleistungen.length === 1
                      ? `Noch nicht. ${offeneVorleistungen[0]?.name} ist noch nicht fertig.`
                      : 'Noch nicht. Zwei Vorarbeiten sind noch offen.'}
                </p>
                <ul className="grid gap-2">
                  {vorleistungen.map((vorleistung) => (
                    <li key={vorleistung.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Statuspunkt status={vorleistung.status} />
                      <span className="text-sm font-medium">{vorleistung.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {STATUSTEXT[vorleistung.status]}
                      </span>
                      <span className="zahl text-sm text-muted-foreground">
                        bis {alsTagUndMonat(vorleistung.ende)}
                        {vorleistung.wartezeitTage
                          ? `, danach ${alsKalendertage(vorleistung.wartezeitTage)} Wartezeit`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            size="lg"
            className="min-h-14 text-base"
            onClick={() => terminBestaetigen(gewerk.id)}
          >
            <CalendarCheck aria-hidden className="size-5" />
            Termin bestätigen
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="min-h-14 text-base"
            onClick={() => setAbsageOffen(true)}
          >
            <CalendarX aria-hidden className="size-5" />
            Termin geht nicht
          </Button>
        </div>

        {gewerk.status === 'bestaetigt' ? (
          <p className="inline-flex items-center gap-2 text-sm text-status-bestaetigt">
            <Check aria-hidden className="size-4" />
            Danke. Der Bauherr sieht Ihre Zusage.
          </p>
        ) : null}

        <section aria-labelledby="melden" className="grid gap-3 border-t border-border pt-6">
          <h2 id="melden" className="text-base font-semibold">
            Etwas melden
          </h2>
          {gewerk.fortschrittProzent > 0 ? (
            <div className="flex max-w-xs items-center gap-2">
              <Progress value={gewerk.fortschrittProzent} aria-label="Fortschritt" />
              <span className="zahl shrink-0 text-sm text-muted-foreground">
                {gewerk.fortschrittProzent} %
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => standEintragen(gewerk.id)}>
              <PhoneCall aria-hidden className="size-4" />
              Stand melden
            </Button>
            <Button variant="outline" onClick={() => fotoHinzufuegen(gewerk.id)}>
              <ImagePlus aria-hidden className="size-4" />
              Foto hochladen
            </Button>
          </div>
          <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
            Der Bauherr sieht das sofort. Sie sehen hier nur Ihr eigenes Gewerk und den Stand der
            Vorarbeit — nicht den ganzen Bauzeitenplan.
          </p>
        </section>

        <section className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          <p>
            Demo: So sähe die Seite aus, die ein Betrieb per Link bekommt.{' '}
            <Link href="/projekt" className="text-primary hover:underline">
              Zurück zur Bauherrenansicht
            </Link>
          </p>
          <Rollenumschalter className="mt-3" />
        </section>
      </main>

      <Dialog open={absageOffen} onOpenChange={setAbsageOffen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Termin geht nicht</DialogTitle>
            <DialogDescription>
              Der Termin bleibt im Plan stehen, bis ein neuer abgestimmt ist. Der Bauherr meldet
              sich bei Ihnen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="absage-grund">Woran liegt es</Label>
            <Input
              id="absage-grund"
              value={grund}
              onChange={(ereignis) => setGrund(ereignis.target.value)}
              placeholder="Material kommt erst nächste Woche"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbsageOffen(false)}>
              Abbrechen
            </Button>
            <Button
              onClick={() => {
                terminAbsagen(gewerk.id, grund.trim() || `Absage am ${alsTagUndMonat(heute)}`);
                setGrund('');
                setAbsageOffen(false);
              }}
            >
              Absage senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Grün, wenn losgelegt werden kann; sonst der Ton für „wartet auf Vorleistung". */
function bereitSatz(bereit: boolean): string {
  return bereit
    ? 'text-sm font-medium leading-relaxed text-status-fertig'
    : 'text-sm font-medium leading-relaxed text-status-blockiert';
}

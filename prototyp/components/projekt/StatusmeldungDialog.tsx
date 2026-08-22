'use client';

import { useState } from 'react';
import { Herkunftsmarke } from '@/components/Marken';
import { Button } from '@/components/ui/button';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STATUSTEXT } from '@/lib/data';
import { alsTagUndMonat } from '@/lib/datum';
import { useAktionen, useRolle } from '@/lib/store';
import { useHeute } from '@/lib/useHeute';
import type { Herkunft, Projektdaten, Rolle, Status } from '@/lib/types';

const STATUSAUSWAHL: Status[] = ['geplant', 'bestaetigt', 'laeuft', 'verzoegert', 'blockiert', 'fertig'];

/**
 * Die Herkunft wird nicht ausgewählt, sondern folgt aus der Rolle.
 *
 * Das ist der Kern der Kennzeichnung: Wer nach einem Telefonat einträgt, kann
 * die Meldung nicht als Zusage des Betriebs ausgeben. Der Unterschied
 * entscheidet später, worauf man sich berufen kann.
 */
function herkunftAusRolle(rolle: Rolle): Herkunft {
  if (rolle === 'gewerk') return 'gewerk_bestaetigt';
  if (rolle === 'gu') return 'gu_gemeldet';
  return 'bauherr_eingetragen';
}

/**
 * Wird nur gezeichnet, solange das Formular offen ist. Dadurch beginnt jeder
 * Aufruf mit dem tatsächlichen Stand des Gewerks statt mit dem, was beim
 * letzten Mal im Formular stand.
 */
export function StatusmeldungDialog({
  daten,
  gewerkId,
  onSchliessen,
}: {
  daten: Projektdaten;
  /** Fest vorgegebenes Gewerk. Fehlt es, wird eines ausgewählt. */
  gewerkId?: string;
  onSchliessen: () => void;
}) {
  const rolle = useRolle();
  const heute = useHeute();
  const { statusMelden } = useAktionen();
  const herkunft = herkunftAusRolle(rolle);

  const vorauswahl =
    gewerkId ??
    daten.gewerke.find((g) => g.start <= heute && g.ende >= heute && g.status !== 'fertig')?.id ??
    daten.gewerke.find((g) => g.status !== 'fertig')?.id ??
    daten.gewerke[0]?.id ??
    '';

  const [ziel, setZiel] = useState(vorauswahl);
  const gewerk = daten.gewerke.find((g) => g.id === ziel);

  const [status, setStatus] = useState<Status>(gewerk?.status ?? 'laeuft');
  const [fortschritt, setFortschritt] = useState(gewerk?.fortschrittProzent ?? 0);
  const [quelle, setQuelle] = useState(`Telefonat am ${alsTagUndMonat(heute)}`);

  function waehleGewerk(neu: string) {
    setZiel(neu);
    const treffer = daten.gewerke.find((g) => g.id === neu);
    setStatus(treffer?.status ?? 'laeuft');
    setFortschritt(treffer?.fortschrittProzent ?? 0);
  }

  function eintragen() {
    if (!gewerk) return;
    statusMelden({
      gewerkId: gewerk.id,
      status,
      fortschrittProzent: fortschritt,
      herkunft,
      ...(herkunft === 'bauherr_eingetragen' && quelle.trim() ? { notiz: quelle.trim() } : {}),
    });
    onSchliessen();
  }

  return (
    <Dialog open onOpenChange={(zustand) => (!zustand ? onSchliessen() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stand eintragen</DialogTitle>
          <DialogDescription>
            {herkunft === 'bauherr_eingetragen'
              ? 'Sie tragen stellvertretend für den Betrieb ein. Die Meldung wird entsprechend gekennzeichnet.'
              : 'Ihre Meldung wird mit Ihrer Rolle und dem Zeitpunkt festgehalten.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {gewerkId ? (
            <p className="font-medium">{gewerk?.name}</p>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="meldung-gewerk">Welches Gewerk</Label>
              <Select value={ziel} onValueChange={waehleGewerk}>
                <SelectTrigger id="meldung-gewerk">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {daten.gewerke.map((kandidat) => (
                    <SelectItem key={kandidat.id} value={kandidat.id}>
                      {kandidat.nummer}. {kandidat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="meldung-status">Wie ist der Stand</Label>
            <Select value={status} onValueChange={(wert) => setStatus(wert as Status)}>
              <SelectTrigger id="meldung-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSAUSWAHL.map((kandidat) => (
                  <SelectItem key={kandidat} value={kandidat}>
                    {STATUSTEXT[kandidat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {status !== 'geplant' && status !== 'fertig' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="meldung-fortschritt">
                Wie weit ist es · <span className="zahl">{fortschritt} Prozent</span>
              </Label>
              <input
                id="meldung-fortschritt"
                type="range"
                min={0}
                max={100}
                step={5}
                value={fortschritt}
                onChange={(ereignis) => setFortschritt(Number(ereignis.target.value))}
                className="h-11 w-full accent-[var(--primary)]"
              />
            </div>
          ) : null}

          {herkunft === 'bauherr_eingetragen' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="meldung-quelle">Woher wissen Sie das</Label>
              <Input
                id="meldung-quelle"
                value={quelle}
                onChange={(ereignis) => setQuelle(ereignis.target.value)}
                placeholder={`Telefonat am ${alsTagUndMonat(heute)}`}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Zwei Sekunden Aufwand. Später weiß niemand mehr, ob eine Angabe geraten oder
                abgestimmt war — außer, es steht hier.
              </p>
            </div>
          ) : null}

          <div className="rounded-md border border-border bg-muted p-3">
            <p className="text-xs text-muted-foreground">So wird die Meldung gekennzeichnet:</p>
            <Herkunftsmarke
              herkunft={herkunft}
              notiz={herkunft === 'bauherr_eingetragen' ? quelle.trim() || undefined : undefined}
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onSchliessen}>
            Abbrechen
          </Button>
          <Button onClick={eintragen} disabled={!gewerk}>
            Eintragen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

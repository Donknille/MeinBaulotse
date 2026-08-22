'use client';

import { useState } from 'react';
import Image from 'next/image';
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
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PLATZHALTERBILDER } from '@/lib/stammdaten';
import { useAktionen, useRolle } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Herkunft, Projektdaten, Rolle } from '@/lib/types';

function herkunftAusRolle(rolle: Rolle): Herkunft {
  if (rolle === 'gewerk') return 'gewerk_bestaetigt';
  if (rolle === 'gu') return 'gu_gemeldet';
  return 'bauherr_eingetragen';
}

/**
 * Ein Foto zum Tagebuch hinzufügen.
 *
 * Statt einer Kamera gibt es im Prototyp eine Handvoll Platzhalter. Was
 * getestet werden soll, ist nicht das Hochladen, sondern ob der Eintrag
 * drumherum verständlich ist: wozu er gehört und woher er stammt.
 */
/** Wird nur gezeichnet, solange das Formular offen ist — dann ist es leer. */
export function FotoDialog({
  daten,
  gewerkId,
  onSchliessen,
}: {
  daten: Projektdaten;
  gewerkId?: string;
  onSchliessen: () => void;
}) {
  const rolle = useRolle();
  const { fotoAnlegen } = useAktionen();
  const herkunft = herkunftAusRolle(rolle);

  const [ziel, setZiel] = useState(gewerkId ?? daten.gewerke[0]?.id ?? '');
  const [titel, setTitel] = useState('');
  const [notiz, setNotiz] = useState('');
  const [bild, setBild] = useState(PLATZHALTERBILDER[0]?.datei ?? '');

  function hinzufuegen() {
    if (!titel.trim()) return;
    fotoAnlegen({
      titel: titel.trim(),
      bildUrl: bild,
      ...(ziel ? { gewerkId: ziel } : {}),
      ...(notiz.trim() ? { notiz: notiz.trim() } : {}),
      herkunft,
    });
    onSchliessen();
  }

  return (
    <Dialog open onOpenChange={(zustand) => (!zustand ? onSchliessen() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Foto hinzufügen</DialogTitle>
          <DialogDescription>
            Im Prototyp stehen Platzhalter statt der Kamera zur Verfügung.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="foto-titel">Was ist zu sehen</Label>
            <Input
              id="foto-titel"
              value={titel}
              onChange={(ereignis) => setTitel(ereignis.target.value)}
              placeholder="Leitungen im Erdgeschoss"
            />
          </div>

          {gewerkId ? null : (
            <div className="grid gap-1.5">
              <Label htmlFor="foto-gewerk">Gehört zu</Label>
              <Select value={ziel} onValueChange={setZiel}>
                <SelectTrigger id="foto-gewerk">
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
            <Label htmlFor="foto-notiz">Notiz für später</Label>
            <Textarea
              id="foto-notiz"
              value={notiz}
              onChange={(ereignis) => setNotiz(ereignis.target.value)}
              placeholder="Für später, falls jemand in die Wand bohren will."
            />
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Platzhalterbild</legend>
            <div className="flex flex-wrap gap-2">
              {PLATZHALTERBILDER.map((kandidat) => (
                <button
                  key={kandidat.datei}
                  type="button"
                  onClick={() => setBild(kandidat.datei)}
                  aria-pressed={bild === kandidat.datei}
                  title={kandidat.name}
                  className={cn(
                    'relative size-16 overflow-hidden rounded-md border-2',
                    bild === kandidat.datei ? 'border-primary' : 'border-border',
                  )}
                >
                  <Image src={kandidat.datei} alt={kandidat.name} fill sizes="64px" className="object-cover" />
                </button>
              ))}
            </div>
          </fieldset>

          <div className="rounded-md border border-border bg-muted p-3">
            <p className="text-xs text-muted-foreground">So wird der Eintrag gekennzeichnet:</p>
            <Herkunftsmarke herkunft={herkunft} className="mt-1" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onSchliessen}>
            Abbrechen
          </Button>
          <Button onClick={hinzufuegen} disabled={!titel.trim()}>
            Zum Tagebuch hinzufügen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

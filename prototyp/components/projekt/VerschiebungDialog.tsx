'use client';

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { alsDatum, alsKalendertage, alsTagUndMonat, alsVerschiebung, kalendertageZwischen } from '@/lib/datum';
import type { Planaenderung } from '@/lib/planung';
import type { Gewerk } from '@/lib/types';

export interface Verschiebungsvorschlag {
  gewerk: Gewerk;
  alterStart: string;
  aenderung: Planaenderung;
}

/**
 * Die Vorschau vor der Übernahme.
 *
 * Sie ist der eigentliche Zweck der ganzen Balkenansicht: Nicht „ziehen und
 * sehen, was passiert", sondern vorher in Klartext lesen, was passieren würde.
 * Erst die Bestätigung ändert etwas; Abbrechen lässt den Plan, wie er war.
 */
/** Der erste Satz der Begründung, ohne Schlusspunkt — als Beisatz verwendbar. */
function kurzerGrund(grund: string | undefined): string {
  return grund ? (grund.split('.')[0] ?? '').trim() : '';
}

export function VerschiebungDialog({
  vorschlag,
  onAbbrechen,
  onUebernehmen,
}: {
  vorschlag: Verschiebungsvorschlag | null;
  onAbbrechen: () => void;
  onUebernehmen: (vorschlag: Verschiebungsvorschlag) => void;
}) {
  if (!vorschlag) return null;

  const { gewerk, alterStart, aenderung } = vorschlag;
  const neu = aenderung.gewerke.find((g) => g.id === gewerk.id) as Gewerk;
  const verschiebungPlanende = kalendertageZwischen(aenderung.altesPlanende, aenderung.neuesPlanende);
  const betroffene = aenderung.betroffene
    .map((id) => aenderung.gewerke.find((g) => g.id === id))
    .filter((g): g is Gewerk => g !== undefined)
    .sort((a, b) => a.nummer - b.nummer);

  const ohneWirkung = neu.start === alterStart;
  const begrenzer = aenderung.begrenztDurch
    ? aenderung.gewerke.find((g) => g.id === aenderung.begrenztDurch)
    : undefined;

  return (
    <Dialog open onOpenChange={(offen) => (!offen ? onAbbrechen() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {gewerk.name} verschieben von {alsTagUndMonat(alterStart)} auf{' '}
            {alsTagUndMonat(neu.start)}
          </DialogTitle>
          <DialogDescription>
            Noch ist nichts geändert. Das würde passieren:
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 text-sm leading-relaxed">
          {begrenzer ? (
            <p className="rounded-md border border-border bg-muted p-3">
              Früher geht es nicht: {begrenzer.name} muss vorher fertig sein. Der Termin rückt
              deshalb auf den {alsDatum(neu.start)}.
            </p>
          ) : null}

          {ohneWirkung ? (
            <p>Am Termin ändert sich dadurch nichts.</p>
          ) : (
            <>
              <p>
                {betroffene.length === 0
                  ? 'Kein weiteres Gewerk hängt daran.'
                  : `Dadurch verschieben sich ${betroffene.length} weitere Gewerke.`}
              </p>

              {gewerk.wartezeitTage ? (
                <p>
                  Die Wartezeit danach bleibt unverändert:{' '}
                  {alsKalendertage(gewerk.wartezeitTage)}
                  {kurzerGrund(gewerk.wartezeitGrund) ? ` ${kurzerGrund(gewerk.wartezeitGrund)}` : ''}.
                </p>
              ) : null}

              <p className="zahl">
                {verschiebungPlanende === 0 ? (
                  <>
                    Voraussichtliche Fertigstellung: {alsDatum(aenderung.neuesPlanende)},
                    unverändert.
                  </>
                ) : (
                  <>
                    Neue voraussichtliche Fertigstellung:{' '}
                    <span className="font-semibold">{alsDatum(aenderung.neuesPlanende)}</span> statt{' '}
                    {alsDatum(aenderung.altesPlanende)}, also{' '}
                    {alsVerschiebung(verschiebungPlanende)}.
                  </>
                )}
              </p>

              {betroffene.length > 0 ? (
                <p className="text-muted-foreground">
                  Betroffen: {betroffene.map((g) => g.name).join(', ')}
                </p>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onAbbrechen}>
            Abbrechen
          </Button>
          <Button onClick={() => onUebernehmen(vorschlag)} disabled={ohneWirkung}>
            Verschieben und übernehmen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

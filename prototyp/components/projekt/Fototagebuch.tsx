'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Herkunftsmarke } from '@/components/Marken';
import { alsDatumMitWochentag, type IsoDatum } from '@/lib/datum';
import type { Fotoeintrag, Projektdaten } from '@/lib/types';

/**
 * Das Fototagebuch, chronologisch absteigend.
 *
 * Der Nutzen zeigt sich erst Jahre später: wer wissen will, wo hinter dem Putz
 * eine Leitung liegt, findet es hier oder nirgends.
 */
export function Fototagebuch({
  daten,
  eintraege,
  ueberschriftId,
}: {
  daten: Projektdaten;
  eintraege?: Fotoeintrag[];
  ueberschriftId?: string;
}) {
  const fotos = eintraege ?? daten.fotos;

  if (fotos.length === 0) {
    return (
      <p className="max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
        Noch keine Fotos. Halten Sie den Baufortschritt fest, besonders alles, was später hinter
        Putz oder Estrich verschwindet. Das hilft bei Rückfragen und bei jeder Bohrung in zehn
        Jahren.
      </p>
    );
  }

  return (
    <ul
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-labelledby={ueberschriftId}
    >
      {fotos.map((foto) => (
        <li key={foto.id} className="overflow-hidden rounded-lg border border-border">
          <div className="relative aspect-[4/3] bg-muted">
            <Image
              src={foto.bildUrl}
              alt={foto.titel}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover"
            />
          </div>
          <div className="grid gap-1 p-3">
            <p className="zahl text-xs text-muted-foreground">{alsDatumMitWochentag(foto.datum as IsoDatum)}</p>
            <p className="font-medium leading-snug">{foto.titel}</p>
            {foto.gewerkId ? <Gewerkverweis daten={daten} gewerkId={foto.gewerkId} /> : null}
            {foto.notiz ? (
              <p className="text-sm leading-relaxed text-muted-foreground">{foto.notiz}</p>
            ) : null}
            <Herkunftsmarke herkunft={foto.herkunft} className="mt-0.5" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Gewerkverweis({ daten, gewerkId }: { daten: Projektdaten; gewerkId: string }) {
  const gewerk = daten.gewerke.find((g) => g.id === gewerkId);
  if (!gewerk) return null;
  return (
    <Link href={`/projekt/gewerk/${gewerk.id}`} className="text-sm text-primary hover:underline">
      {gewerk.name}
    </Link>
  );
}

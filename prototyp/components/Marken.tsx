'use client';

import { CircleDashed, PhoneCall, ShieldCheck, UserRound } from 'lucide-react';
import { alsDatum } from '@/lib/datum';
import { herkunftsText, STATUSTEXT } from '@/lib/data';
import { cn } from '@/lib/utils';
import type { Herkunft, Status } from '@/lib/types';

/*
 * Statusfarben und Herkunftskennzeichnung.
 *
 * Die Klassennamen stehen ausgeschrieben in Tabellen. Zusammengesetzte Namen
 * wie `bg-status-${status}` findet Tailwind beim Durchsuchen des Quelltexts
 * nicht, und die Farbe fehlt dann genau im gebauten Stand.
 */

const PUNKTFARBE: Record<Status, string> = {
  geplant: 'bg-status-geplant',
  bestaetigt: 'bg-status-bestaetigt',
  laeuft: 'bg-status-laeuft',
  fertig: 'bg-status-fertig',
  verzoegert: 'bg-status-verzoegert',
  blockiert: 'bg-status-blockiert',
};

const TEXTFARBE: Record<Status, string> = {
  geplant: 'text-muted-foreground',
  bestaetigt: 'text-status-bestaetigt',
  laeuft: 'text-status-laeuft',
  fertig: 'text-status-fertig',
  verzoegert: 'text-status-verzoegert',
  blockiert: 'text-status-blockiert',
};

export function Statuspunkt({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-3 shrink-0 rounded-full', PUNKTFARBE[status], className)}
    />
  );
}

export function Statusmarke({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', TEXTFARBE[status], className)}>
      <Statuspunkt status={status} />
      {STATUSTEXT[status]}
    </span>
  );
}

const HERKUNFTSSYMBOL: Record<Herkunft, typeof ShieldCheck> = {
  gewerk_bestaetigt: ShieldCheck,
  bauherr_eingetragen: PhoneCall,
  gu_gemeldet: UserRound,
  geplant: CircleDashed,
};

/**
 * Woher die Angabe stammt. Steht an jeder Statusmeldung und jedem Foto, klein
 * und unaufdringlich, aber nie weggelassen: der Unterschied zwischen „der
 * Betrieb hat zugesagt" und „so habe ich es verstanden" entscheidet später,
 * worauf man sich berufen kann.
 */
export function Herkunftsmarke({
  herkunft,
  notiz,
  zeitpunkt,
  className,
}: {
  herkunft: Herkunft;
  notiz?: string | undefined;
  zeitpunkt?: string | undefined;
  className?: string;
}) {
  const Symbol = HERKUNFTSSYMBOL[herkunft];
  const datum = zeitpunkt ? alsDatum(zeitpunkt.slice(0, 10)) : null;

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground', className)}>
      <Symbol aria-hidden className="size-3.5 shrink-0 translate-y-0.5" />
      <span>{herkunftsText(herkunft)}</span>
      {datum ? <span className="zahl">· {datum}</span> : null}
      {notiz ? <span className="italic">· {notiz}</span> : null}
    </span>
  );
}

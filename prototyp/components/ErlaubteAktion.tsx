'use client';

import type { ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { darf, type Recht, type Rechtekontext } from '@/lib/rechte';

/**
 * Eine Schaltfläche, die ein Recht kennt.
 *
 * Fehlt das Recht, verschwindet sie nicht — sie bleibt sichtbar, ist
 * deaktiviert und erklärt im Tooltip, wer stattdessen zuständig ist.
 * Ausgeblendete Funktionen verwirren, erklärte Grenzen schaffen Verständnis.
 *
 * Technisch bleibt der Knopf dabei ein echter Knopf mit `aria-disabled`
 * statt `disabled`: ein wirklich deaktivierter Knopf nimmt weder Fokus noch
 * Zeigerereignisse an, und dann bekäme ausgerechnet die Erklärung niemand zu
 * sehen.
 */
export function ErlaubteAktion({
  recht,
  kontext,
  children,
  onClick,
  ...rest
}: ButtonProps & { recht: Recht; kontext: Rechtekontext; children: ReactNode }) {
  const pruefung = darf(recht, kontext);

  if (pruefung.erlaubt) {
    return (
      <Button onClick={onClick} {...rest}>
        {children}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...rest}
          aria-disabled
          onClick={(ereignis) => ereignis.preventDefault()}
          className={rest.className}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{pruefung.erklaerung}</TooltipContent>
    </Tooltip>
  );
}

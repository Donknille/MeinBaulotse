'use client';

import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Erklärungen an deaktivierten Schaltflächen brauchen einen gemeinsamen
 * Anbieter. Er steht ganz außen, damit jede Seite ihn hat.
 */
export function Anbieter({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
      {children}
    </TooltipProvider>
  );
}

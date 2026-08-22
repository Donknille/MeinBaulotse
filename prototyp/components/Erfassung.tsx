'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { FotoDialog } from '@/components/projekt/FotoDialog';
import { StatusmeldungDialog } from '@/components/projekt/StatusmeldungDialog';
import type { Recht } from '@/lib/rechte';
import type { Projektdaten, Rolle } from '@/lib/types';

interface Erfassung {
  /** Öffnet die Statusmeldung, wahlweise für ein bestimmtes Gewerk. */
  standEintragen: (gewerkId?: string) => void;
  /** Öffnet das Formular für einen Fototagebuch-Eintrag. */
  fotoHinzufuegen: (gewerkId?: string) => void;
}

const ErfassungKontext = createContext<Erfassung | null>(null);

/**
 * Die beiden Erfassungsformulare liegen einmal im Rahmen und werden von überall
 * geöffnet.
 *
 * Das ist die Voraussetzung für die Vorgabe, stellvertretendes Eintragen sei in
 * jeder Betriebsart mit einem Klick erreichbar: sonst müsste jede Seite ihr
 * eigenes Formular mitbringen, und irgendeine hätte keins.
 */
export function ErfassungAnbieter({
  daten,
  children,
}: {
  daten: Projektdaten;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<{ offen: boolean; gewerkId?: string }>({ offen: false });
  const [foto, setFoto] = useState<{ offen: boolean; gewerkId?: string }>({ offen: false });

  const wert = useMemo<Erfassung>(
    () => ({
      standEintragen: (gewerkId) => setStatus({ offen: true, ...(gewerkId ? { gewerkId } : {}) }),
      fotoHinzufuegen: (gewerkId) => setFoto({ offen: true, ...(gewerkId ? { gewerkId } : {}) }),
    }),
    [],
  );

  return (
    <ErfassungKontext.Provider value={wert}>
      {children}
      {/* Erst montieren, wenn geöffnet: dann steht im Formular der aktuelle
          Stand und nicht der vom letzten Mal. */}
      {status.offen ? (
        <StatusmeldungDialog
          daten={daten}
          {...(status.gewerkId ? { gewerkId: status.gewerkId } : {})}
          onSchliessen={() => setStatus({ offen: false })}
        />
      ) : null}
      {foto.offen ? (
        <FotoDialog
          daten={daten}
          {...(foto.gewerkId ? { gewerkId: foto.gewerkId } : {})}
          onSchliessen={() => setFoto({ offen: false })}
        />
      ) : null}
    </ErfassungKontext.Provider>
  );
}

export function useErfassung(): Erfassung {
  const kontext = useContext(ErfassungKontext);
  if (!kontext) {
    throw new Error('useErfassung braucht den ErfassungAnbieter im Rahmen darüber.');
  }
  return kontext;
}

/**
 * Welches Recht eine Statusmeldung braucht: ein Betrieb meldet für sich selbst,
 * alle anderen melden für jemanden.
 */
export function meldungsrecht(rolle: Rolle): Recht {
  return rolle === 'gewerk' ? 'status_melden' : 'status_stellvertretend_melden';
}

/*
 * Der Zustand des Prototyps.
 *
 * Je Betriebsart gibt es genau ein Projekt. Es wird beim ersten Betreten aus
 * den Demo-Daten gerechnet und danach im lokalen Speicher des Geräts gehalten
 * — damit bleibt eine Verschiebung auch nach dem Neuladen stehen, und die
 * Daten verlassen das Gerät trotzdem nie.
 *
 * Der Store ruft ausschließlich Funktionen aus `lib/data/` auf. Er kennt keine
 * Rechenregel und keine Formulierung, nur die Reihenfolge der Schritte.
 */

'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { IsoDatum } from './datum';
import {
  entscheidungAbschliessen,
  entscheidungOeffnen,
  fotoAnlegen,
  gewerkBearbeiten,
  planUebernehmen,
  planVorschau,
  statusMelden,
  terminAbsagen,
  terminBestaetigen,
  type Fotomeldung,
  type Gewerkfelder,
  type Statusmeldung,
} from './data';
import type { Planaenderung } from './planung';
import { erzeugeProjektdaten } from './seed';
import type { Betriebsmodus, Projektdaten, Rolle } from './types';

interface Sitzung {
  /** Die gewählte Betriebsart. `null` heißt: noch auf der Startseite. */
  modus: Betriebsmodus | null;
  /** Die Perspektive, aus der gerade geschaut wird. */
  rolle: Rolle;
  /** Nur für die Rolle „Gewerk": welches Gewerk. */
  eigenesGewerkId: string | null;
  /** Ein Projekt je Betriebsart. */
  projekte: Partial<Record<Betriebsmodus, Projektdaten>>;
}

interface Aktionen {
  modusWaehlen: (modus: Betriebsmodus) => void;
  rolleWechseln: (rolle: Rolle, eigenesGewerkId?: string) => void;
  demoZuruecksetzen: () => void;

  planVerschieben: (gewerkId: string, aenderung: Planaenderung) => void;
  vorschau: (gewerkId: string, neuerStart: IsoDatum) => Planaenderung | null;

  statusMelden: (meldung: Omit<Statusmeldung, 'akteur'>) => void;
  terminBestaetigen: (gewerkId: string) => void;
  terminAbsagen: (gewerkId: string, grund: string) => void;
  entscheidungAbschliessen: (entscheidungId: string) => void;
  entscheidungOeffnen: (entscheidungId: string) => void;
  fotoAnlegen: (meldung: Omit<Fotomeldung, 'erfasstVon'>) => void;
  gewerkBearbeiten: (gewerkId: string, felder: Gewerkfelder) => void;
}

type Store = Sitzung & Aktionen;

const AUSGANGSLAGE: Sitzung = {
  modus: null,
  rolle: 'bauherr',
  eigenesGewerkId: null,
  projekte: {},
};

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      /** Führt eine Schreibfunktion auf dem aktiven Projekt aus. */
      const aendere = (schritt: (daten: Projektdaten) => Projektdaten) => {
        const { modus, projekte } = get();
        if (!modus) return;
        const daten = projekte[modus];
        if (!daten) return;
        set({ projekte: { ...projekte, [modus]: schritt(daten) } });
      };

      return {
        ...AUSGANGSLAGE,

        modusWaehlen: (modus) => {
          const { projekte } = get();
          set({
            modus,
            rolle: 'bauherr',
            eigenesGewerkId: null,
            projekte: projekte[modus]
              ? projekte
              : { ...projekte, [modus]: erzeugeProjektdaten(modus) },
          });
        },

        rolleWechseln: (rolle, eigenesGewerkId) => {
          set({ rolle, eigenesGewerkId: rolle === 'gewerk' ? (eigenesGewerkId ?? null) : null });
        },

        demoZuruecksetzen: () => {
          const { modus } = get();
          set({
            projekte: modus ? { [modus]: erzeugeProjektdaten(modus) } : {},
            rolle: 'bauherr',
            eigenesGewerkId: null,
          });
        },

        vorschau: (gewerkId, neuerStart) => {
          const daten = aktivesProjektAus(get());
          return daten ? planVorschau(daten, gewerkId, neuerStart) : null;
        },

        planVerschieben: (gewerkId, aenderung) =>
          aendere((daten) => planUebernehmen(daten, gewerkId, aenderung, get().rolle)),

        statusMelden: (meldung) =>
          aendere((daten) => statusMelden(daten, { ...meldung, akteur: get().rolle })),

        terminBestaetigen: (gewerkId) => aendere((daten) => terminBestaetigen(daten, gewerkId)),

        terminAbsagen: (gewerkId, grund) => aendere((daten) => terminAbsagen(daten, gewerkId, grund)),

        entscheidungAbschliessen: (entscheidungId) =>
          aendere((daten) => entscheidungAbschliessen(daten, entscheidungId, get().rolle)),

        entscheidungOeffnen: (entscheidungId) =>
          aendere((daten) => entscheidungOeffnen(daten, entscheidungId, get().rolle)),

        fotoAnlegen: (meldung) =>
          aendere((daten) => fotoAnlegen(daten, { ...meldung, erfasstVon: get().rolle })),

        gewerkBearbeiten: (gewerkId, felder) =>
          aendere((daten) => gewerkBearbeiten(daten, gewerkId, felder, get().rolle)),
      };
    },
    {
      name: 'meinbaulotse-prototyp',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Der lokale Speicher wird schon beim Laden des Moduls gelesen. Wer
      // etwas davon zeigt, wartet vorher `useNachMontage` ab.
      partialize: ({ modus, rolle, eigenesGewerkId, projekte }) => ({
        modus,
        rolle,
        eigenesGewerkId,
        projekte,
      }),
    },
  ),
);

function aktivesProjektAus(zustand: Sitzung): Projektdaten | null {
  return zustand.modus ? (zustand.projekte[zustand.modus] ?? null) : null;
}

// --- Selektoren -----------------------------------------------------------
// Komponenten greifen ausschließlich über diese Haken auf den Store zu, nie
// über `useStore` selbst.

const LEER: never[] = [];

export const useModus = () => useStore((z) => z.modus);
export const useRolle = () => useStore((z) => z.rolle);
export const useEigenesGewerkId = () => useStore((z) => z.eigenesGewerkId);
export const useProjektdaten = () => useStore((z) => aktivesProjektAus(z));
export const useProjekt = () => useStore((z) => aktivesProjektAus(z)?.projekt ?? null);
export const useGewerke = () => useStore((z) => aktivesProjektAus(z)?.gewerke ?? LEER);

/**
 * Die Aktionen wechseln ihre Identität nie. `useShallow` sorgt dafür, dass das
 * bei jedem Durchlauf neu gebaute Objekt trotzdem nicht als Änderung zählt.
 */
export function useAktionen(): Aktionen {
  return useStore(
    useShallow((z) => ({
      modusWaehlen: z.modusWaehlen,
      rolleWechseln: z.rolleWechseln,
      demoZuruecksetzen: z.demoZuruecksetzen,
      planVerschieben: z.planVerschieben,
      vorschau: z.vorschau,
      statusMelden: z.statusMelden,
      terminBestaetigen: z.terminBestaetigen,
      terminAbsagen: z.terminAbsagen,
      entscheidungAbschliessen: z.entscheidungAbschliessen,
      entscheidungOeffnen: z.entscheidungOeffnen,
      fotoAnlegen: z.fotoAnlegen,
      gewerkBearbeiten: z.gewerkBearbeiten,
    })),
  );
}

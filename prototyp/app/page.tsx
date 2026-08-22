'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, HardHat, PhoneCall, Users } from 'lucide-react';
import { Rollenumschalter } from '@/components/Rollenumschalter';
import { useAktionen } from '@/lib/store';
import type { Betriebsmodus } from '@/lib/types';

interface Auswahlkarte {
  modus: Betriebsmodus;
  symbol: typeof Users;
  titel: string;
  lage: string;
  folge: string;
}

/*
 * Kein Marketingtext. Der Nutzer soll sich in einer der drei Beschreibungen
 * wiedererkennen und dann wissen, was ihn erwartet.
 */
const KARTEN: Auswahlkarte[] = [
  {
    modus: 'begleitet',
    symbol: Users,
    titel: 'Ein Generalunternehmer baut mein Haus',
    lage: 'Ein Unternehmen hat den Auftrag für alles und stimmt die Betriebe untereinander ab. Sie erfahren oft erst hinterher, was passiert ist und warum es länger dauert.',
    folge:
      'Sie sehen den Stand und treffen die Entscheidungen, die von Ihnen gebraucht werden. Den Terminplan führt Ihr Generalunternehmer.',
  },
  {
    modus: 'selbst',
    symbol: HardHat,
    titel: 'Ich koordiniere die Gewerke selbst',
    lage: 'Sie beauftragen 15 bis 25 Betriebe einzeln. Verzögert sich einer, kippt die ganze Kette, weil Handwerker nicht auf Abruf bereitstehen.',
    folge:
      'Sie führen den Plan. Sie verschieben einen Termin und sehen vorher, was das für alles Folgende bedeutet. Die Betriebe bekommen einen Link auf ihren eigenen Termin.',
  },
  {
    modus: 'stellvertretend',
    symbol: PhoneCall,
    titel: 'Ich koordiniere selbst, meine Handwerker machen aber nicht mit',
    lage: 'Der Normalfall. Handwerksbetriebe benutzen keine zusätzliche App. Sie melden sich telefonisch oder gar nicht.',
    folge:
      'Sie tragen alles stellvertretend ein, mit einer kurzen Angabe, woher die Information stammt. Das dauert zwei Sekunden und macht den Eintrag später belastbar.',
  },
];

export default function Startseite() {
  const { modusWaehlen } = useAktionen();
  const router = useRouter();

  function starte(modus: Betriebsmodus) {
    modusWaehlen(modus);
    router.push('/projekt');
  }

  return (
    <main id="inhalt" className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:py-16">
      <p className="text-sm font-medium text-muted-foreground">MeinBaulotse</p>
      <h1 className="mt-2 max-w-[20ch] text-3xl font-semibold leading-tight sm:text-4xl">
        Sie bauen einmal. Wir kennen den Ablauf.
      </h1>
      <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-muted-foreground">
        MeinBaulotse zeigt Ihnen, wo Ihr Hausbau steht: was gerade läuft, was als Nächstes kommt und
        was von Ihnen gebraucht wird. Und es rechnet Ihnen vor, was passiert, wenn sich ein Termin
        verschiebt — bevor Sie ihn verschieben.
      </p>

      <h2 className="mt-10 text-sm font-medium">In welcher Situation sind Sie?</h2>

      <div className="mt-3 grid gap-3">
        {KARTEN.map((karte) => {
          const Symbol = karte.symbol;
          return (
            <button
              key={karte.modus}
              type="button"
              onClick={() => starte(karte.modus)}
              className="group grid gap-2 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/50 sm:p-5"
            >
              <span className="flex items-start gap-3">
                <Symbol aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <span className="text-lg font-semibold leading-snug">{karte.titel}</span>
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground sm:pl-8">
                {karte.lage}
              </span>
              <span className="text-sm leading-relaxed sm:pl-8">{karte.folge}</span>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary sm:pl-8">
                Beispielprojekt öffnen
                <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-6 max-w-[62ch] text-sm leading-relaxed text-muted-foreground">
        Das ist eine Demo mit einem erfundenen Beispielprojekt. Alles, was Sie hier eintragen,
        bleibt im Speicher dieses Browsers und verlässt das Gerät nicht. Mit
        &bdquo;Demo zurücksetzen&ldquo; ist es wieder weg.
      </p>

      <section className="mt-10 rounded-lg border border-dashed border-border p-4">
        <h2 className="text-sm font-medium">Demo-Werkzeug</h2>
        <p className="mt-1 max-w-[62ch] text-sm text-muted-foreground">
          Dieselben Daten aus einer anderen Perspektive ansehen: als Bauleiter, der den Plan führt,
          oder als Betrieb, der nur seinen eigenen Termin sieht. Im fertigen Produkt gibt es diesen
          Umschalter nicht — dort hat jeder seinen eigenen Zugang.
        </p>
        <Rollenumschalter className="mt-3" beiFehlenderBetriebsart="selbst" />
      </section>
    </main>
  );
}

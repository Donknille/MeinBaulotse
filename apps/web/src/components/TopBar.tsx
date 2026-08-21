/**
 * Die Kopfzeile, für alle angemeldeten Ansichten dieselbe.
 *
 * Sie ist aus drei Beobachtungen auf einem 375 px breiten Bildschirm
 * entstanden:
 *
 * 1. **Die Planansicht hatte gar keine Navigation.** Kein Weg zurück zur
 *    Liste, kein Rollenwechsel, kein Abmelden. Im Browser rettet der
 *    Zurück-Knopf; als installierte PWA (`display: standalone`) gibt es den
 *    nicht, und die Ansicht war eine Sackgasse.
 * 2. **Die Kopfzeile brach um und kollidierte mit dem Wortzeichen.** Drei
 *    Elemente nebeneinander passen auf 375 px nicht in eine Zeile. Jetzt
 *    umbricht sie geordnet: Marke oben, Bedienung darunter.
 * 3. **Die Tippziele waren 36 und 40 px hoch.** Unter 44 px trifft ein Daumen
 *    unzuverlässig. Beide sind jetzt 44.
 *
 * Auf dem Rechner bleibt alles in einer Zeile — dort war nie etwas kaputt.
 */

import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from './ui';
import { forgetDemoAccess, readDemoSession } from '../lib/demo-auth';
import { signOut } from '../lib/supabase';
import { Topmark } from '../routes/SignIn';

export function TopBar({ back }: { back?: { to: string; label: string } }) {
  // Im Testzugang steht hier, aus wessen Sicht man gerade schaut. Ohne diesen
  // Hinweis verwechselt man beim Vergleichen der Rollen unweigerlich, wer man
  // gerade ist.
  const demo = readDemoSession();

  return (
    <div className="flex flex-wrap items-center gap-x-4">
      {back === undefined ? (
        <span className="flex min-h-11 items-center gap-3 text-charcoal">
          <Topmark size={22} />
          <span className="text-body font-medium">MeinBaulotse</span>
        </span>
      ) : (
        <Link
          to={back.to}
          className="-ml-1 flex min-h-11 items-center gap-1.5 pr-2 pl-1 text-body text-steel transition-colors duration-[var(--motion-micro)] hover:text-charcoal"
        >
          <ChevronLeft size={18} aria-hidden />
          {back.label}
        </Link>
      )}

      <span className="ms-auto flex items-center gap-1">
        {demo !== null ? (
          <Link
            to="/demo"
            className="flex min-h-11 items-center px-2 text-body text-steel underline underline-offset-4"
          >
            {demo.label} · Rolle wechseln
          </Link>
        ) : null}
        <Button
          variant="ghost"
          onClick={() => {
            forgetDemoAccess();
            void signOut();
          }}
        >
          Abmelden
        </Button>
      </span>
    </div>
  );
}

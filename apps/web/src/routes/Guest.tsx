/**
 * Die Abstimmungsseite — Abschnitt 5.5.
 *
 *     Baustelle Musterweg 4
 *
 *     Für den Innenputz ist der 12.–21.05. eingetragen.
 *     Passt das?
 *
 *     [ Passt ]   [ Anderer Termin ]   [ Antworten ]
 *
 *     „Kein Login, keine App, unter zehn Sekunden erledigt, in der Sprache des
 *      Empfängers."
 *
 * Diese vier Bedingungen erklären jede Entscheidung auf dieser Seite:
 *
 * - **Kein Login.** Der Token steht im Fragment der Adresse (`…#<token>`).
 *   Fragmente sendet kein Browser an einen Server — er landet also in keinem
 *   Zugriffsprotokoll und in keinem Referrer. Die Seite liest ihn aus
 *   `location.hash` und schickt ihn im Anfragekörper mit.
 * - **Keine App.** Eine einzige Seite, kein Router darunter, keine
 *   Anmeldemaske davor. Sie hängt in `App.tsx` außerhalb der Anmeldeprüfung.
 * - **Unter zehn Sekunden.** Der erste Vorgang, der eine Antwort braucht,
 *   steht ganz oben und ausgeschrieben. Alles Weitere ist eine Liste darunter,
 *   die niemand ansehen muss.
 * - **In seiner Sprache.** Die Sprache steht am Token, nicht am Browser: Der
 *   Bauherr weiß, wen er einlädt, und ein deutsches Handy mit polnischem
 *   Besitzer ist auf einer Baustelle der Normalfall.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, CalendarClock, Loader2, Send } from 'lucide-react';
import type { GuestTask, GuestView } from '@meinbaulotse/shared';
import { Button, Card } from '../components/ui';
import { formatGuestRange, stringsFor, type GuestStrings } from '../lib/guest-i18n';

/** Der Token lebt nur im Speicher dieser Seite — nirgends sonst. */
function tokenFromHash(): string {
  return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api/v1/guest${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const fehler = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(fehler?.error ?? `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export function Guest() {
  const [token] = useState(tokenFromHash);
  const [view, setView] = useState<GuestView | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [name, setName] = useState('');
  const [firma, setFirma] = useState('');
  const [gegenvorschlag, setGegenvorschlag] = useState<string | null>(null);
  // Was gerade beantwortet wurde. Ohne diese Rückmeldung sieht der Polier nach
  // seinem Tipp dieselbe Seite wie davor und tippt noch einmal — „unter zehn
  // Sekunden erledigt" heißt auch: Man muss merken, dass man fertig ist.
  const [erledigt, setErledigt] = useState<string | null>(null);

  const oeffnen = useCallback(
    async (vorstellung?: { name: string; company: string }) => {
      if (token === '') {
        setFehler('kein-token');
        return;
      }
      setLaeuft(true);
      try {
        setView(await post<GuestView>('/open', { token, ...vorstellung }));
        setFehler(null);
      } catch (error) {
        setFehler(error instanceof Error ? error.message : 'unbekannt');
      } finally {
        setLaeuft(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void oeffnen();
  }, [oeffnen]);

  const texte = stringsFor(view?.locale ?? 'de');

  if (fehler !== null && view === null) {
    return (
      <Rahmen>
        <p className="text-body-lg text-charcoal">{texte.expired}</p>
      </Rahmen>
    );
  }

  if (view === null) {
    return (
      <Rahmen>
        <p className="text-body text-steel">{texte.loading}</p>
      </Rahmen>
    );
  }

  // Wer bist du? Genau einmal, und nur, wenn es noch niemand gesagt hat.
  if (view.needsIntroduction) {
    return (
      <Rahmen kopf={`${texte.site} ${view.siteLine ?? view.projectName}`}>
        <h1 className="display-title text-heading-md text-charcoal">{texte.whoAreYou}</h1>
        <label className="flex flex-col gap-2">
          <span className="text-body font-medium text-charcoal">{texte.yourName}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            className="h-14 w-full rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white px-3 text-body-lg text-charcoal"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-body font-medium text-charcoal">{texte.company}</span>
          <input
            value={firma}
            onChange={(event) => setFirma(event.target.value)}
            autoComplete="organization"
            className="h-14 w-full rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white px-3 text-body-lg text-charcoal"
          />
        </label>
        <Button
          variant="primary"
          size="field"
          disabled={laeuft}
          onClick={() => void oeffnen({ name: name.trim(), company: firma.trim() })}
        >
          {texte.continue}
        </Button>
      </Rahmen>
    );
  }

  // Zuerst das, was noch niemand beantwortet hat. Ein Vorgang, bei dem schon
  // zwei Angaben im Raum stehen, wartet auf den Bauherrn, nicht auf den Gast —
  // er bleibt beantwortbar, steht aber hinten an.
  const offen = [...view.tasks.filter((task) => task.canConfirm)].sort(
    (links, rechts) =>
      Number(links.confirmation === 'disputed') - Number(rechts.confirmation === 'disputed'),
  );
  const erster = offen[0];

  async function handeln(pfad: string, koerper: unknown): Promise<void> {
    setLaeuft(true);
    try {
      const name = erster?.name ?? null;
      setView(await post<GuestView>(pfad, { token, ...(koerper as object) }));
      setGegenvorschlag(null);
      setErledigt(name);
    } catch (error) {
      setFehler(error instanceof Error ? error.message : 'unbekannt');
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <Rahmen kopf={`${texte.site} ${view.siteLine ?? view.projectName}`}>
      {erledigt !== null ? (
        <div className="flex flex-col gap-4">
          <span className="flex items-center gap-2 text-body-xl font-medium text-charcoal">
            <Check size={22} className="text-vivid-green" aria-hidden />
            {texte.thanks}
          </span>
          <p className="text-body text-steel">
            {erledigt} — {texte.ownerSees}
          </p>
          <Button variant="primary" size="field" onClick={() => setErledigt(null)}>
            {texte.continue}
          </Button>
        </div>
      ) : erster === undefined ? (
        <p className="text-body-lg text-charcoal">{texte.nothingOpen}</p>
      ) : gegenvorschlag === erster.id ? (
        <Gegenvorschlag
          task={erster}
          texte={texte}
          locale={view.locale}
          laeuft={laeuft}
          abbrechen={() => setGegenvorschlag(null)}
          senden={(start, end, note) =>
            void handeln(`/tasks/${erster.id}/counter`, { start, end, note })
          }
        />
      ) : (
        <>
          {/* Der eine Vorgang, um den es geht — ausgeschrieben, nicht in einer
              Liste. Wer zehn Sekunden Zeit hat, liest keine Tabelle. */}
          <div className="flex flex-col gap-2">
            <h1 className="display-title text-heading-md text-charcoal">{erster.name}</h1>
            <p className="text-body-xl text-charcoal">
              {formatGuestRange(erster.start, erster.end, view.locale)}
            </p>
            <p className="text-body-lg text-steel">{texte.question}</p>
          </div>

          <div className="flex flex-col gap-3">
            <Button
              variant="primary"
              size="field"
              disabled={laeuft}
              onClick={() => void handeln(`/tasks/${erster.id}/confirm`, {})}
            >
              {laeuft ? (
                <Loader2 size={20} className="animate-spin" aria-hidden />
              ) : (
                <Check size={20} aria-hidden />
              )}
              {texte.confirm}
            </Button>
            <Button size="field" disabled={laeuft} onClick={() => setGegenvorschlag(erster.id)}>
              <CalendarClock size={20} aria-hidden />
              {texte.counter}
            </Button>
          </div>
          <p className="text-caption text-steel">{texte.ownerSees}</p>
        </>
      )}

      {/* Alles Weitere darunter, klein: Wer nur den einen Termin bestätigen
          wollte, ist oben schon fertig. */}
      {view.tasks.length > 1 ? (
        <ul className="mt-2 flex flex-col border-t border-ash pt-2">
          {view.tasks
            .filter((task) => task.id !== erster?.id)
            .slice(0, 12)
            .map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-ash py-3 last:border-b-0"
              >
                <span className="text-body text-charcoal">{task.name}</span>
                <span className="text-caption text-steel">
                  {formatGuestRange(task.start, task.end, view.locale)} ·{' '}
                  {zustand(task, texte)}
                </span>
              </li>
            ))}
        </ul>
      ) : null}

      {fehler !== null ? <p className="text-caption text-alarm-red">{fehler}</p> : null}
    </Rahmen>
  );
}

function zustand(task: GuestTask, texte: GuestStrings): string {
  switch (task.confirmation) {
    case 'mutual':
      return texte.confirmed;
    case 'disputed':
      return texte.twoDates;
    case 'counterparty_stated':
      return texte.statedByCompany;
    default:
      return texte.statedByOwner;
  }
}

function Gegenvorschlag({
  task,
  texte,
  locale,
  laeuft,
  abbrechen,
  senden,
}: {
  task: GuestTask;
  texte: GuestStrings;
  locale: GuestView['locale'];
  laeuft: boolean;
  abbrechen: () => void;
  senden: (start: string, end: string, note: string) => void;
}) {
  const [start, setStart] = useState(task.start ?? '');
  const [ende, setEnde] = useState(task.end ?? '');
  const [grund, setGrund] = useState('');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="display-title text-heading-md text-charcoal">{task.name}</h1>
        {/* Der eingetragene Termin bleibt sichtbar. Der Gegenvorschlag tritt
            neben ihn, nicht an seine Stelle — das ist der ganze Unterschied
            zwischen „zwei Angaben" und „geändert". */}
        <p className="text-body text-steel">
          {formatGuestRange(task.start, task.end, locale)}
        </p>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-body font-medium text-charcoal">{texte.newStart}</span>
        <input
          type="date"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          className="h-14 w-full rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white px-3 text-body-lg text-charcoal"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-body font-medium text-charcoal">{texte.newEnd}</span>
        <input
          type="date"
          value={ende}
          onChange={(event) => setEnde(event.target.value)}
          className="h-14 w-full rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white px-3 text-body-lg text-charcoal"
        />
      </label>
      <label className="flex flex-col gap-2">
        <span className="text-body font-medium text-charcoal">{texte.reason}</span>
        <input
          value={grund}
          onChange={(event) => setGrund(event.target.value)}
          className="h-14 w-full rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white px-3 text-body-lg text-charcoal"
        />
      </label>

      <div className="flex flex-col gap-3">
        <Button
          variant="primary"
          size="field"
          disabled={laeuft || start === '' || ende === '' || ende < start}
          onClick={() => senden(start, ende, grund.trim())}
        >
          <Send size={20} aria-hidden />
          {texte.send}
        </Button>
        <Button size="field" onClick={abbrechen}>
          {texte.cancel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Ein eigener Rahmen statt der `TopBar`.
 *
 * Die Kopfzeile der Anwendung trägt Abmelden, Rollenwechsel und den Weg zur
 * Projektliste — drei Angebote, die für einen Gast entweder nicht existieren
 * oder ihn wegführen von dem, wofür er hier ist.
 */
function Rahmen({ kopf, children }: { kopf?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[30rem] flex-col justify-center gap-6 px-4 py-10">
      {kopf === undefined ? null : (
        <p className="text-caption tracking-wide text-steel uppercase">{kopf}</p>
      )}
      <Card className="flex flex-col gap-6">{children}</Card>
      <p className="text-center text-caption text-fog">MeinBaulotse</p>
    </main>
  );
}

/**
 * Die Lotsenkarte — Abschnitt 5.2 der Spezifikation, Abschnitt 9.9 der CI.
 *
 * Das Blatt beantwortet vier Fragen in dieser Reihenfolge: was hier passiert,
 * worauf du achten kannst, was du den GU fragen solltest, was typischerweise
 * schiefgeht. Erst danach kommen Fotoaufträge und Quellen.
 *
 * Zwei Gestaltungsentscheidungen kommen unmittelbar aus dem CI und sind keine
 * Geschmacksfrage:
 *
 * - **Die Fragen an den GU haben je einen Kopieren-Knopf.** Sie sind wörtlich
 *   verwendbar formuliert, damit sie direkt in eine Nachricht wandern. Ohne
 *   den Knopf tippt sie niemand ab, und dann ist der ganze Abschnitt Zierrat.
 * - **Die Quellen stehen am Fuß und nicht hinter einem Aufklapper.** Die
 *   Herkunft einer Aussage ist Teil der Aussage. Was man wegklappen kann, ist
 *   eine Fußnote; das hier ist die Grundlage.
 *
 * Die Rückmeldung am Ende hat zwei Knöpfe und keine Skala von eins bis fünf.
 * „War das hilfreich" ist die einzige Metrik, die für die Redaktion zählt, und
 * eine Skala beantwortet sie schlechter als ein Ja oder Nein.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { BookOpen, Camera, Check, Copy, HardHat, Quote, TriangleAlert, X } from 'lucide-react';
import { LEGAL_NOTE, type ChecklistUpdateRequest, type GuideCardView } from '@meinbaulotse/shared';
import { Button } from './ui';
import { ApiError } from '../lib/api';
import { formatRange } from '../lib/format';

/**
 * Was das Blatt zum Arbeiten braucht. Als Schnittstelle und nicht als direkter
 * Zugriff auf `api`, damit die Ansicht im Styleguide ohne Anmeldung und ohne
 * Datenbank steht — so wie die Planansicht auch.
 */
export interface GuideCardHandlers {
  /**
   * Öffnen *ist* die Rückmeldung „gesehen" — deshalb gibt es hier kein reines
   * Laden. Ein zweiter Aufruf wäre eine zweite Gelegenheit zu scheitern, ohne
   * eine zweite Auskunft.
   */
  markRead: (taskId: string, feedback: { helpful?: boolean | null }) => Promise<GuideCardView>;
  setChecklistItem: (
    taskId: string,
    sourceKey: string,
    change: ChecklistUpdateRequest,
  ) => Promise<GuideCardView>;
}

export function GuideCardSheet({
  taskId,
  referenceYear,
  handlers,
  onClose,
}: {
  taskId: string;
  referenceYear: number;
  handlers: GuideCardHandlers;
  onClose: () => void;
}) {
  const titleId = useId();
  const [view, setView] = useState<GuideCardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Öffnen ist bereits die Rückmeldung „gesehen". Deshalb wird nicht geladen
  // und danach gemeldet, sondern in einem Zug: Ein zweiter Aufruf wäre eine
  // zweite Gelegenheit zu scheitern, ohne eine zweite Auskunft.
  useEffect(() => {
    let abgebrochen = false;
    handlers
      .markRead(taskId, {})
      .then((next) => {
        if (!abgebrochen) setView(next);
      })
      .catch((cause: unknown) => {
        if (abgebrochen) return;
        setError(
          cause instanceof ApiError
            ? cause.message
            : 'Diese Lotsenkarte ließ sich gerade nicht laden.',
        );
      });
    return () => {
      abgebrochen = true;
    };
  }, [handlers, taskId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = useCallback(
    async (marke: string, aktion: () => Promise<GuideCardView>): Promise<void> => {
      setBusy(marke);
      setError(null);
      try {
        setView(await aktion());
      } catch (cause) {
        setError(
          cause instanceof ApiError ? cause.message : 'Das ließ sich gerade nicht speichern.',
        );
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-charcoal/30 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-[44rem] overflow-y-auto rounded-t-[var(--radius-large)] bg-canvas-white p-5 shadow-[var(--shadow-sheet)] sm:rounded-[var(--radius-large)] sm:p-6"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {/* Lavender trägt in diesem Produkt genau eine Bedeutung: Wissen
                und Dokumentation (CI 3.5). */}
            <BookOpen size={20} className="mt-1 shrink-0 text-lavender" aria-hidden />
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="text-subheading font-medium text-charcoal">
                {view?.card.title ?? 'Lotsenkarte'}
              </h2>
              {view !== null ? (
                <p className="text-caption text-steel">
                  {view.taskName}
                  {view.taskStart !== null
                    ? ` · ${formatRange(view.taskStart, view.taskEnd, referenceYear)}`
                    : ''}
                </p>
              ) : null}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Schließen">
            <X size={18} aria-hidden />
          </Button>
        </div>

        {error !== null ? (
          <p className="mb-4 rounded-[var(--radius-card)] bg-soft-red px-3 py-2 text-body text-alarm-red">
            {error}
          </p>
        ) : null}

        {view === null ? (
          error === null ? (
            <p className="py-8 text-body text-steel">Einen Moment.</p>
          ) : null
        ) : (
          <GuideCardBody view={view} busy={busy} run={run} handlers={handlers} />
        )}
      </div>
    </div>
  );
}

function GuideCardBody({
  view,
  busy,
  run,
  handlers,
}: {
  view: GuideCardView;
  busy: string | null;
  run: (marke: string, aktion: () => Promise<GuideCardView>) => Promise<void>;
  handlers: GuideCardHandlers;
}) {
  const { card } = view;

  return (
    <div className="flex flex-col gap-7">
      {/* Fließtext höchstens 68 Zeichen breit (CI 4.5). Darüber verliert das
          Auge beim Zeilenwechsel die Spur. */}
      <div className="max-w-[68ch] whitespace-pre-line text-body-lg text-charcoal">
        {card.whatsHappening}
      </div>

      {card.expertRecommended && card.expertReason !== null ? (
        <ExpertHint reason={card.expertReason} />
      ) : null}

      {card.watchFor.length > 0 ? (
        <Section title="Worauf du achten kannst" icon={<Check size={18} aria-hidden />}>
          <ul className="flex flex-col gap-1">
            {view.checklist.map((entry) => {
              const item = card.watchFor.find((w) => w.key === entry.sourceKey);
              return (
                <ChecklistRow
                  key={entry.sourceKey}
                  text={entry.text}
                  why={item?.why ?? null}
                  done={entry.isDone}
                  editable={view.canEditChecklist}
                  busy={busy === `check:${entry.sourceKey}`}
                  onToggle={() =>
                    run(`check:${entry.sourceKey}`, () =>
                      handlers.setChecklistItem(view.taskId, entry.sourceKey, {
                        isDone: !entry.isDone,
                      }),
                    )
                  }
                />
              );
            })}
          </ul>
        </Section>
      ) : null}

      {card.questionsForContractor.length > 0 ? (
        <Section title="Fragen an den Generalunternehmer" icon={<Quote size={18} aria-hidden />}>
          {/* Eingebetteter Block ohne Rand (CI 9.9): Die Fragen sind Zitate
              zum Mitnehmen, keine Aufzählung. */}
          <div className="flex flex-col gap-3 rounded-[var(--radius-large)] bg-paper-mist p-4">
            {card.questionsForContractor.map((entry) => (
              <QuestionRow
                key={entry.key}
                question={entry.question}
                whyItMatters={entry.whyItMatters}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {card.commonProblems.length > 0 ? (
        <Section
          title="Was hier typischerweise schiefgeht"
          icon={<TriangleAlert size={18} aria-hidden />}
        >
          <ul className="flex flex-col gap-3">
            {card.commonProblems.map((entry) => (
              <li key={entry.key} className="max-w-[68ch] text-body-lg text-charcoal">
                {entry.problem}
                {entry.howToSpot !== null ? (
                  <span className="mt-0.5 block text-body text-steel">
                    Erkennbar: {entry.howToSpot}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {card.photoPrompts.length > 0 ? (
        <Section title="Jetzt fotografieren" icon={<Camera size={18} aria-hidden />}>
          <ul className="flex flex-col gap-3">
            {card.photoPrompts.map((entry) => (
              <li key={entry.key} className="max-w-[68ch] text-body-lg text-charcoal">
                {entry.what}
                {entry.why !== null ? (
                  <span className="mt-0.5 block text-body text-steel">{entry.why}</span>
                ) : null}
              </li>
            ))}
          </ul>
          {/* Kein Kameraknopf: Die Erfassung kommt mit AP 5. Ein Knopf, der
              nichts öffnet, wäre ein Versprechen, das die Anwendung nicht
              hält. */}
        </Section>
      ) : null}

      <footer className="flex flex-col gap-4 border-t border-ash pt-5">
        {card.legalNote ? <p className="text-caption italic text-steel">{LEGAL_NOTE}</p> : null}

        <div className="flex flex-col gap-1">
          <p className="text-caption font-medium text-lavender">Worauf sich das stützt</p>
          <ul className="flex flex-col gap-0.5">
            {card.sources.map((source) => (
              <li key={source.title} className="text-caption text-steel">
                {source.title}
                {source.note !== null ? ` · ${source.note}` : ''}
              </li>
            ))}
          </ul>
        </div>

        <Helpful
          helpful={view.helpful}
          busy={busy === 'helpful'}
          onAnswer={(answer) =>
            run('helpful', () => handlers.markRead(view.taskId, { helpful: answer }))
          }
        />
      </footer>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-subheading font-semibold text-charcoal">
        <span className="text-lavender">{icon}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Der Hinweis auf eine Fachprüfung.
 *
 * Er ist keine Warnung, sondern ein Sachverhalt mit einem nächsten Schritt
 * (CI 11.4) — und er benennt offen die Grenze des Produkts: MeinBaulotse
 * ersetzt keinen Bausachverständigen (Spezifikation 1.4). Der Kostenrahmen
 * steht dabei, weil eine Empfehlung ohne Preis keine Entscheidungshilfe ist.
 */
function ExpertHint({ reason }: { reason: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-large)] bg-soft-violet p-4">
      <h3 className="flex items-center gap-2 text-body-lg font-medium text-charcoal">
        <HardHat size={18} className="text-lavender" aria-hidden />
        Hier lohnt sich ein Blick vom Fach
      </h3>
      <p className="max-w-[68ch] text-body text-charcoal">{reason}</p>
      <p className="max-w-[68ch] text-body text-steel">
        Wir können nicht beurteilen, ob etwas fachlich richtig ausgeführt ist. Ein
        Bausachverständiger kann das. Einzeltermine kosten ab rund 500 €, eine durchgehende
        Begleitung 1.500 bis 3.500 €.
      </p>
      <p className="text-caption text-steel">
        Adressen findest du beim{' '}
        <a className="underline" href="https://www.vpb.de" target="_blank" rel="noreferrer">
          Verband Privater Bauherren
        </a>{' '}
        und beim{' '}
        <a className="underline" href="https://www.bsb-ev.de" target="_blank" rel="noreferrer">
          Bauherren-Schutzbund
        </a>
        .
      </p>
    </section>
  );
}

function ChecklistRow({
  text,
  why,
  done,
  editable,
  busy,
  onToggle,
}: {
  text: string;
  why: string | null;
  done: boolean;
  editable: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const content = (
    <>
      <span
        aria-hidden
        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-input)] border ${
          done ? 'border-vivid-green bg-vivid-green text-canvas-white' : 'border-smoke'
        }`}
      >
        {done ? <Check size={16} /> : null}
      </span>
      <span className="flex flex-col gap-0.5 text-left">
        <span className={`text-body-lg ${done ? 'text-steel line-through' : 'text-charcoal'}`}>
          {text}
        </span>
        {why !== null ? <span className="text-body text-steel">{why}</span> : null}
      </span>
    </>
  );

  if (!editable) {
    // Wer nicht haken darf, sieht die Liste trotzdem — sie ist Wissen, kein
    // Werkzeug. Nur der Anschein von Bedienbarkeit fällt weg.
    return <li className="flex max-w-[68ch] items-start gap-3 py-2">{content}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={done}
        // 44 px Mindesthöhe: bedienbar mit Handschuhen (CI 6).
        className="flex min-h-11 w-full max-w-[68ch] items-start gap-3 rounded-[var(--radius-card)] px-1 py-2 text-left transition-colors duration-[var(--motion-micro)] hover:bg-paper-mist disabled:opacity-45"
      >
        {content}
      </button>
    </li>
  );
}

function QuestionRow({
  question,
  whyItMatters,
}: {
  question: string;
  whyItMatters: string | null;
}) {
  const [kopiert, setKopiert] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(question);
      setKopiert(true);
      window.setTimeout(() => setKopiert(false), 2000);
    } catch {
      // Ohne Zwischenablage bleibt die Frage lesbar und markierbar. Eine
      // Fehlermeldung für einen Bequemlichkeitsknopf wäre unverhältnismäßig.
      setKopiert(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex max-w-[62ch] flex-col gap-0.5">
        <p className="text-body-lg text-charcoal">{question}</p>
        {whyItMatters !== null ? <p className="text-body text-steel">{whyItMatters}</p> : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void copy()}
        aria-label={`Frage kopieren: ${question}`}
      >
        {kopiert ? (
          <>
            <Check size={16} aria-hidden /> Kopiert
          </>
        ) : (
          <>
            <Copy size={16} aria-hidden /> Kopieren
          </>
        )}
      </Button>
    </div>
  );
}

function Helpful({
  helpful,
  busy,
  onAnswer,
}: {
  helpful: boolean | null;
  busy: boolean;
  onAnswer: (answer: boolean) => void;
}) {
  if (helpful !== null) {
    return (
      <p className="text-body text-steel">
        {helpful
          ? 'Danke. Das hilft uns, die richtigen Karten zu schreiben.'
          : 'Danke. Wir sehen uns diese Karte noch einmal an.'}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-body text-charcoal">War das hilfreich?</span>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => onAnswer(true)}>
        Ja
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => onAnswer(false)}>
        Nein
      </Button>
    </div>
  );
}

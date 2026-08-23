/**
 * Die Lotsenkarte als Vollbildblatt — Abschnitt 5.2 der Spezifikation,
 * Gestaltung nach CI 9.9.
 *
 * Die Reihenfolge der Abschnitte ist inhaltlich und nicht verhandelbar:
 *
 *   Was passiert       →  Orientierung zuerst, in zwei bis drei Sätzen
 *   Worauf du achten   →  was der Bauherr selbst kann, zum Abhaken
 *   Fragen an den GU   →  wörtlich verwendbar, mit Kopieren-Knopf
 *   Was oft schiefgeht →  erst jetzt die schlechte Nachricht (CI 10.2)
 *   Jetzt fotografieren
 *   Fachprüfung        →  wenn hier eine sinnvoll ist, mit Begründung
 *   Quellen            →  am Fuß, offen, nicht hinter einem Aufklapper
 *
 * Zwei Entscheidungen, die man dem Blatt ansehen soll:
 *
 * - **Jede Aussage trägt ihre Begründung.** „Randdämmstreifen prüfen" ist eine
 *   Anweisung, der man folgt oder nicht. Mit dem „sonst überträgt der Estrich
 *   Schall" dahinter wird daraus eine Auskunft, mit der jemand selbst
 *   entscheiden kann. Deshalb steht das Warum überall daneben, nie darunter
 *   versteckt.
 * - **Die Quellen stehen offen da.** Die Herkunft einer Aussage ist Teil der
 *   Aussage — an dieser Stelle hängt die Glaubwürdigkeit des ganzen Produkts
 *   (Spezifikation 6.3).
 */

import { useEffect, useId, useState } from 'react';
import { Camera, Check, Copy, HelpCircle, TriangleAlert, X } from 'lucide-react';
import type { ChecklistItemDto, GuideCardView } from '@meinbaulotse/shared';
import { Button } from './ui';

export function GuideCardSheet({
  view,
  onClose,
  onRate,
  onToggle,
  fulfilledPrompts,
  onCapture,
}: {
  view: GuideCardView;
  onClose: () => void;
  onRate: (helpful: boolean | null) => Promise<void>;
  onToggle: (item: ChecklistItemDto, isDone: boolean) => Promise<void>;
  /** Welche Fotoaufträge dieser Karte schon erfüllt sind. */
  fulfilledPrompts?: readonly string[];
  /** Öffnet die Schnellerfassung für einen bestimmten Fotoauftrag. */
  onCapture?: (promptKey: string) => void;
}) {
  const titleId = useId();
  const [helpful, setHelpful] = useState<boolean | null>(view.read?.helpful ?? null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const { card } = view;

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
        className="max-h-[92dvh] w-full max-w-[40rem] overflow-y-auto rounded-t-[var(--radius-large)] bg-canvas-white p-5 sm:rounded-[var(--radius-large)] sm:p-6"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2 text-caption text-lavender">
              <HelpCircle size={16} aria-hidden />
              Lotsenkarte
            </p>
            <h2 id={titleId} className="text-heading-sm font-medium text-charcoal">
              {card.title}
            </h2>
            <p className="text-caption text-steel">Zum Vorgang „{view.taskName}"</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Schließen">
            <X size={18} aria-hidden />
          </Button>
        </div>

        {/* Fließtext auf 68 Zeichen begrenzt (CI 4.5). */}
        <div className="flex max-w-[68ch] flex-col gap-7">
          <section className="flex flex-col gap-2">
            <h3 className="text-subheading font-medium text-charcoal">Was passiert</h3>
            {card.whatsHappening.split('\n\n').map((absatz, index) => (
              <p key={index} className="text-body-lg leading-relaxed text-charcoal">
                {absatz}
              </p>
            ))}
          </section>

          {card.watchFor.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-subheading font-medium text-charcoal">
                Worauf du achten kannst
              </h3>
              <p className="text-caption text-steel">
                {view.canCheck
                  ? 'Abgehakt bleibt abgehakt — die Liste gehört zum Vorgang, nicht zu diesem Besuch.'
                  : 'Ohne Fachkenntnis prüfbar. Abhaken darf in diesem Bauvorhaben, wer die Dokumentation führt.'}
              </p>
              <ul className="flex flex-col">
                {card.watchFor.map((point, index) => (
                  <Punkt
                    key={index}
                    text={point.text}
                    why={point.why}
                    item={view.checklist.find((entry) => entry.sortOrder === index)}
                    canCheck={view.canCheck}
                    onToggle={onToggle}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {card.questionsForContractor.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-subheading font-medium text-charcoal">Fragen an den GU</h3>
              <p className="text-caption text-steel">
                Wörtlich verwendbar. Der Knopf legt die Frage in die Zwischenablage.
              </p>
              {/* Eingebetteter Block ohne Rand, CI 9.9. */}
              <div className="flex flex-col gap-3 rounded-[var(--radius-large)] bg-paper-mist p-4">
                {card.questionsForContractor.map((frage, index) => (
                  <Frage key={index} question={frage.question} why={frage.whyItMatters} />
                ))}
              </div>
            </section>
          ) : null}

          {card.commonProblems.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-subheading font-medium text-charcoal">Was hier oft schiefgeht</h3>
              <ul className="flex flex-col">
                {card.commonProblems.map((problem, index) => (
                  <li key={index} className="border-b border-ash py-2.5 last:border-b-0">
                    <p className="text-body-lg text-charcoal">{problem.problem}</p>
                    <p className="text-body text-steel">Woran du es erkennst: {problem.howToSpot}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {card.photoPrompts.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-subheading font-medium text-charcoal">
                <Camera size={18} className="text-lavender" aria-hidden />
                Jetzt fotografieren
              </h3>
              <ul className="flex flex-col">
                {card.photoPrompts.map((prompt, index) => {
                  // Der Schlüssel hängt an der Karte, nicht am Vorgang: So
                  // bleibt ein Auftrag erfüllt, auch wenn der Vorgang später
                  // umbenannt oder neu angelegt wird.
                  const key = `${card.key}#${index}`;
                  const erfuellt = fulfilledPrompts?.includes(key) === true;
                  return (
                    <li
                      key={index}
                      className="flex items-start justify-between gap-3 border-b border-ash py-2.5 last:border-b-0"
                    >
                      <div className="flex flex-1 flex-col gap-0.5">
                        <p
                          className={`text-body-lg ${erfuellt ? 'text-steel line-through' : 'text-charcoal'}`}
                        >
                          {prompt.what}
                        </p>
                        <p className="text-body text-steel">{prompt.why}</p>
                      </div>
                      {erfuellt ? (
                        <span className="flex shrink-0 items-center gap-1 text-caption text-vivid-green">
                          <Check size={14} aria-hidden />
                          Erfasst
                        </span>
                      ) : onCapture === undefined ? null : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0 text-lavender"
                          onClick={() => onCapture(key)}
                        >
                          <Camera size={16} aria-hidden />
                          <span className="hidden sm:inline">Erfassen</span>
                          <span className="sr-only sm:hidden">
                            Foto erfassen: {prompt.what}
                          </span>
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {card.expertRecommended ? (
            <section className="flex flex-col gap-2 rounded-[var(--radius-large)] bg-soft-violet p-4">
              <h3 className="flex items-center gap-2 text-subheading font-medium text-charcoal">
                <TriangleAlert size={18} className="text-lavender" aria-hidden />
                Hier ist eine Fachprüfung sinnvoll
              </h3>
              <p className="text-body leading-relaxed text-charcoal">{card.expertReason}</p>
              <p className="text-caption text-steel">
                MeinBaulotse ersetzt keinen Bausachverständigen. Eine durchgehende Baubegleitung
                kostet üblicherweise 1.500 bis 3.500 €, ein Einzeltermin ab rund 500 €. Anlaufstellen
                sind der Verband Privater Bauherren und der Bauherren-Schutzbund.
              </p>
            </section>
          ) : null}

          {card.sources.length > 0 ? (
            <section className="flex flex-col gap-1 border-t border-ash pt-4">
              <h3 className="text-caption font-medium text-steel">Woher das kommt</h3>
              <ul className="flex flex-col gap-1">
                {card.sources.map((quelle, index) => (
                  <li key={index} className="text-caption text-steel">
                    <span className="text-graphite">{quelle.reference}</span> — {quelle.note}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-caption text-fog">
                Fassung {card.version} der Karte „{card.key}".
              </p>
            </section>
          ) : null}

          {/* CI 9.9: zwei Knöpfe, keine Skala von eins bis fünf. */}
          <section className="flex flex-wrap items-center gap-3 border-t border-ash pt-4">
            <span className="text-body text-charcoal">War das hilfreich?</span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                aria-pressed={helpful === true}
                className={helpful === true ? 'border-vivid-green text-vivid-green' : ''}
                onClick={() => {
                  const next = helpful === true ? null : true;
                  setHelpful(next);
                  void onRate(next);
                }}
              >
                Ja
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-pressed={helpful === false}
                className={helpful === false ? 'border-graphite text-graphite' : ''}
                onClick={() => {
                  const next = helpful === false ? null : false;
                  setHelpful(next);
                  void onRate(next);
                }}
              >
                Nein
              </Button>
            </div>
            {helpful !== null ? (
              <span className="text-caption text-steel">
                Danke. Das entscheidet, welche Karten wir als Nächstes überarbeiten.
              </span>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Ein Punkt der Checkliste: Aussage, Begründung, Haken. */
function Punkt({
  text,
  why,
  item,
  canCheck,
  onToggle,
}: {
  text: string;
  why: string;
  item: ChecklistItemDto | undefined;
  canCheck: boolean;
  onToggle: (item: ChecklistItemDto, isDone: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const done = item?.isDone === true;

  const inhalt = (
    <>
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-input)] border ${
          done ? 'border-vivid-green bg-vivid-green text-canvas-white' : 'border-pebble'
        }`}
      >
        {done ? <Check size={14} /> : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className={`text-body-lg ${done ? 'text-steel line-through' : 'text-charcoal'}`}>
          {text}
        </span>
        <span className="text-body text-steel">{why}</span>
      </span>
    </>
  );

  return (
    <li className="border-b border-ash last:border-b-0">
      {canCheck && item !== undefined ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onToggle(item, !done).finally(() => setBusy(false));
          }}
          aria-pressed={done}
          className="flex w-full items-start gap-3 py-2.5 text-left transition-colors duration-[var(--motion-micro)] hover:bg-paper-mist disabled:opacity-60"
        >
          {inhalt}
        </button>
      ) : (
        <div className="flex items-start gap-3 py-2.5">{inhalt}</div>
      )}
    </li>
  );
}

/** Eine Frage an den GU, mit Kopieren-Knopf (CI 9.9). */
function Frage({ question, why }: { question: string; why: string }) {
  const [kopiert, setKopiert] = useState(false);

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <p className="text-body-lg text-charcoal">{question}</p>
        <p className="text-body text-steel">{why}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Frage kopieren: ${question}`}
        onClick={() => {
          // Ohne Zwischenablage — etwa ohne HTTPS — passiert nichts, und der
          // Knopf sagt es nicht. Die Frage steht daneben und lässt sich
          // markieren; ein Fehlerhinweis wäre hier lauter als die Sache.
          void navigator.clipboard?.writeText(question).then(
            () => {
              setKopiert(true);
              setTimeout(() => setKopiert(false), 2000);
            },
            () => undefined,
          );
        }}
      >
        {kopiert ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
        <span className="sr-only">Kopieren</span>
      </Button>
    </div>
  );
}

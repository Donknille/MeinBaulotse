/**
 * Eine Entscheidung ansehen und pflegen — Abschnitt 3.2 der Spezifikation.
 *
 * Das Blatt beantwortet in dieser Reihenfolge: bis wann, warum so früh, worum
 * es geht, was die Möglichkeiten unterscheidet, was man später bereut. Erst
 * ganz unten steht, was du damit tun kannst.
 *
 * Die Reihenfolge ist der ganze Punkt. Ein Bauherr, der zum ersten Mal baut,
 * weiß nicht, dass Fliesen acht Wochen Lieferzeit haben — er braucht den
 * Grund vor der Frist, sonst liest er die Frist als Bürokratie.
 *
 * **Keine Produktempfehlungen und keine Verweise auf Anbieter.** Die
 * Entscheidungshilfe beschreibt Unterschiede, sie wählt nicht aus. Alles
 * andere würde die Neutralität zerstören, die das ganze Produkt trägt.
 */

import { useEffect, useId, useState } from 'react';
import { Scale, X } from 'lucide-react';
import type { Calendar } from '@meinbaulotse/schedule';
import {
  decisionInPlainWords,
  type DecisionDto,
  type DecisionStatus,
  type DecisionUpdateRequest,
} from '@meinbaulotse/shared';
import { Button, Field, Select } from './ui';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { remainingWorkdays, urgencyOf } from '../lib/decisions';

/** Die Zustände aus Abschnitt 3.2, in der Sprache des Bauherrn. */
export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  offen: 'Offen',
  in_bemusterung: 'In Bemusterung',
  entschieden: 'Entschieden',
  beauftragt: 'Beauftragt',
  hinfaellig: 'Hinfällig',
};

const STATUS_ORDER: readonly DecisionStatus[] = [
  'offen',
  'in_bemusterung',
  'entschieden',
  'beauftragt',
  'hinfaellig',
];

export function DecisionSheet({
  decision,
  calendar,
  canWrite,
  onClose,
  onSave,
}: {
  decision: DecisionDto;
  calendar: Calendar;
  canWrite: boolean;
  onClose: () => void;
  onSave: (change: DecisionUpdateRequest) => Promise<void>;
}) {
  const titleId = useId();
  const [status, setStatus] = useState<DecisionStatus>(decision.status);
  const [note, setNote] = useState(decision.decidedNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const remaining = remainingWorkdays(decision, calendar);
  const urgency = urgencyOf(decision, calendar);

  async function submit(): Promise<void> {
    const change: DecisionUpdateRequest = {};
    if (status !== decision.status) change.status = status;
    if (note.trim() !== (decision.decidedNote ?? '')) {
      change.decidedNote = note.trim() === '' ? null : note.trim();
    }
    if (Object.keys(change).length === 0) {
      onClose();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(change);
      onClose();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Das ließ sich gerade nicht speichern.');
    } finally {
      setBusy(false);
    }
  }

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
        className="max-h-[92dvh] w-full max-w-[40rem] overflow-y-auto rounded-t-[var(--radius-large)] bg-canvas-white p-5 shadow-[var(--shadow-sheet)] sm:rounded-[var(--radius-large)] sm:p-6"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {/* Tangerine heißt in diesem Produkt „kümmer dich drum" (CI 3.5). */}
            <Scale size={20} className="mt-1 shrink-0 text-tangerine" aria-hidden />
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="text-subheading font-medium text-charcoal">
                {decision.title}
              </h2>
              <p className="text-caption text-steel">
                {decision.blocksTaskName === null
                  ? 'Ohne Bezug zu einem Vorgang'
                  : `Blockiert „${decision.blocksTaskName}"`}
                {decision.blocksTaskStart === null
                  ? ''
                  : ` · Beginn ${formatDate(decision.blocksTaskStart)}`}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Schließen">
            <X size={18} aria-hidden />
          </Button>
        </div>

        <div className="flex flex-col gap-6">
          {/* 1. Bis wann — und warum so früh. Der Grund steht direkt daneben,
                sonst liest sich die Frist wie Bürokratie. */}
          <section
            className={`flex flex-col gap-1 rounded-[var(--radius-large)] p-4 ${
              urgency === 'verstrichen'
                ? 'bg-soft-red'
                : urgency === 'knapp'
                  ? 'bg-soft-amber'
                  : 'bg-paper-mist'
            }`}
          >
            <p className="text-body-xl font-medium text-charcoal">
              {decision.dueDate === null
                ? 'Noch ohne Frist'
                : `${formatDate(decision.dueDate)} · ${decisionInPlainWords(remaining)}`}
            </p>
            <p className="max-w-[68ch] text-body text-charcoal">
              {decision.leadTimeDays} Werktage vor dem Beginn.
              {decision.reason === null ? '' : ` ${decision.reason}`}
            </p>
          </section>

          {decision.description !== null ? (
            <p className="max-w-[68ch] text-body-lg text-charcoal">{decision.description}</p>
          ) : null}

          {/* 2. Die Entscheidungshilfe: drei Fragen, drei Antworten. */}
          <div className="flex flex-col gap-5">
            <HelpBlock title="Worum es geht" text={decision.help.whatItIsAbout} />
            <HelpBlock
              title="Was die Möglichkeiten unterscheidet"
              text={decision.help.whatDistinguishes}
            />
            <HelpBlock title="Was man später bereut" text={decision.help.whatPeopleRegret} />
          </div>

          {/* 3. Erst zum Schluss: was du damit tust. */}
          <footer className="flex flex-col gap-4 border-t border-ash pt-5">
            {error !== null ? (
              <p className="rounded-[var(--radius-card)] bg-soft-red px-3 py-2 text-body text-alarm-red">
                {error}
              </p>
            ) : null}

            {canWrite ? (
              <>
                <Field
                  label="Wo stehst du damit?"
                  hint={
                    '\u201EEntschieden\u201C heißt: Die Wahl steht. \u201EBeauftragt\u201C heißt: Es ist bestellt.'
                  }
                >
                  <Select
                    value={status}
                    onChange={(event) => setStatus(event.target.value as DecisionStatus)}
                  >
                    {STATUS_ORDER.map((entry) => (
                      <option key={entry} value={entry}>
                        {DECISION_STATUS_LABEL[entry]}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Notiz" hint="Wofür du dich entschieden hast, und warum.">
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                    className="w-full rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white px-3 py-2 text-body-lg text-charcoal placeholder:text-fog"
                    placeholder="Feinsteinzeug 60×120, matt, Musterhaus Nord"
                  />
                </Field>

                <div className="flex gap-3">
                  <Button
                    variant="primary"
                    size="field"
                    disabled={busy}
                    onClick={() => void submit()}
                  >
                    Speichern
                  </Button>
                  <Button variant="ghost" size="field" onClick={onClose}>
                    Abbrechen
                  </Button>
                </div>
              </>
            ) : (
              // Auch die Fehlanzeige trägt den nächsten Schritt (CI 11.4).
              <p className="text-body text-steel">
                Stand: {DECISION_STATUS_LABEL[decision.status]}. Entscheidungen pflegt der Bauherr.
              </p>
            )}

            {decision.decidedNote !== null && !canWrite ? (
              <p className="max-w-[68ch] text-body text-charcoal">{decision.decidedNote}</p>
            ) : null}
          </footer>
        </div>
      </div>
    </div>
  );
}

function HelpBlock({ title, text }: { title: string; text: string | undefined }) {
  if (text === undefined || text === '') return null;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-body-lg font-semibold text-charcoal">{title}</h3>
      <p className="max-w-[68ch] text-body-lg text-charcoal">{text}</p>
    </section>
  );
}

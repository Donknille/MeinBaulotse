/**
 * Eine Entscheidung ansehen und treffen — Abschnitt 3.2 der Spezifikation.
 *
 * Das Blatt beantwortet vier Fragen in dieser Reihenfolge:
 *
 *   Bis wann?      →  die Frist, im Klartext und mit dem Vorgang dahinter
 *   Worum geht es? →  die Entscheidungshilfe: was die Optionen unterscheidet
 *   Was jetzt?     →  Stand, Notiz, geschätzte Kosten
 *
 * Die Frist steht oben, weil sie der Grund ist, warum das Blatt überhaupt
 * aufgeht. Sie steht aber **nicht** als Warnung da: „Noch 4 Werktage" ist eine
 * Auskunft, mit der jemand handeln kann; ein rotes Ausrufezeichen ist es nicht.
 *
 * Keine Produktempfehlungen, keine Bezugsquellen, keine Marken. Das würde die
 * Neutralität zerstören, die das ganze Produkt trägt.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import { CalendarClock, X } from 'lucide-react';
import {
  decisionDueInPlainWords,
  type DecisionDto,
  type DecisionUpdateRequest,
  type ProjectSchedule,
} from '@meinbaulotse/shared';
import { Button, Field, Pill, Select, TextInput } from './ui';
import { ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import { calendarOf, decisionState, DECISION_STATUS_LABEL } from '../lib/decisions';

/** Die Stände, die ein Mensch von Hand setzt, in der Reihenfolge des Ablaufs. */
const STATUSES = ['offen', 'in_bemusterung', 'entschieden', 'beauftragt', 'hinfaellig'] as const;

export function DecisionSheet({
  decision,
  schedule,
  onClose,
  onSave,
}: {
  decision: DecisionDto;
  schedule: ProjectSchedule;
  onClose: () => void;
  onSave: (change: DecisionUpdateRequest) => Promise<void>;
}) {
  const titleId = useId();
  const darfPflegen = schedule.permissions.includes('decision.write');
  const referenceYear = Number(schedule.project.plannedStart.slice(0, 4));
  const state = decisionState(decision, calendarOf(schedule.project));

  const [status, setStatus] = useState<string>(decision.status);
  const [note, setNote] = useState(decision.decidedNote ?? '');
  const [kosten, setKosten] = useState(
    decision.estimatedCostCents === null ? '' : String(Math.round(decision.estimatedCostCents / 100)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function collect(): DecisionUpdateRequest | null {
    const change: Record<string, unknown> = {};
    if (status !== decision.status) change['status'] = status;
    if (note !== (decision.decidedNote ?? '')) change['decidedNote'] = note === '' ? null : note;

    const vorherEuro =
      decision.estimatedCostCents === null ? '' : String(Math.round(decision.estimatedCostCents / 100));
    if (kosten !== vorherEuro) {
      change['estimatedCostCents'] = kosten === '' ? null : Math.round(Number(kosten) * 100);
    }

    return Object.keys(change).length === 0 ? null : (change as DecisionUpdateRequest);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const change = collect();
    if (change === null) {
      onClose();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(change);
      onClose();
    } catch (fehler) {
      setError(
        fehler instanceof ApiError ? fehler.message : 'Das hat nicht geklappt. Versuch es erneut.',
      );
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
        className="max-h-[92dvh] w-full max-w-[36rem] overflow-y-auto rounded-t-[var(--radius-large)] bg-canvas-white p-5 sm:rounded-[var(--radius-large)] sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="flex items-center gap-2 text-caption text-steel">
              <CalendarClock size={16} aria-hidden />
              Entscheidung
            </p>
            <h2 id={titleId} className="text-subheading font-medium text-charcoal">
              {decision.title}
            </h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Schließen">
            <X size={18} aria-hidden />
          </Button>
        </div>

        <div className="flex max-w-[68ch] flex-col gap-6">
          {/* Die Frist, und warum es sie gibt. */}
          <section className="flex flex-col gap-2 rounded-[var(--radius-large)] bg-paper-mist p-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-body-xl font-medium text-charcoal">
                {decision.dueDate === null
                  ? 'Ohne Frist'
                  : `Bis ${formatDate(decision.dueDate, referenceYear)}`}
              </span>
              <Pill tone={state.isOverdue || state.isUrgent ? 'amber' : 'neutral'}>
                {DECISION_STATUS_LABEL[decision.status]}
              </Pill>
            </div>
            <p className="text-body text-steel">
              {decisionDueInPlainWords(state.isSettled ? null : state.remainingWorkdays)}
            </p>
            {decision.blocksTaskName !== null ? (
              <p className="text-caption text-steel">
                {/* Kein Satzpunkt hinter dem Datum: `formatDate` liefert im
                    laufenden Jahr „02.10." — mit eigenem Punkt am Ende. */}
                Die Frist liegt {decision.leadTimeDays} Werktage vor „{decision.blocksTaskName}"
                {decision.blocksTaskStart === null
                  ? '. '
                  : `, geplant ab ${formatDate(decision.blocksTaskStart, referenceYear)} `}
                Verschiebt sich der Vorgang, verschiebt sich diese Frist mit.
              </p>
            ) : null}
          </section>

          {decision.description !== null ? (
            <p className="text-body-lg leading-relaxed text-charcoal">{decision.description}</p>
          ) : null}

          {decision.helpText !== null ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-body font-medium text-charcoal">Was du wissen solltest</h3>
              <p className="text-body leading-relaxed text-steel">{decision.helpText}</p>
            </section>
          ) : null}

          {!darfPflegen ? (
            // Fehlanzeige mit Grund statt gesperrter Felder.
            <p className="border-t border-ash pt-4 text-body text-steel">
              Entscheidungen pflegt in diesem Bauvorhaben der Bauherr. Du siehst sie mit, damit du
              weißt, worauf dein Vorgang wartet.
            </p>
          ) : (
            <form className="flex flex-col gap-4 border-t border-ash pt-4" onSubmit={(e) => void submit(e)}>
              <Field
                label="Stand"
                hint={
                  '„Entschieden“ heißt: Die Wahl steht. „Beauftragt“ heißt: Sie ist bestellt.'
                }
              >
                <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                  {STATUSES.map((wert) => (
                    <option key={wert} value={wert}>
                      {DECISION_STATUS_LABEL[wert]}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="Notiz"
                hint="Was ihr euch überlegt habt. Steht später in der Bauakte neben der Entscheidung."
              >
                <TextInput
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Feinsteinzeug 60 × 120, Fugenfarbe grau"
                />
              </Field>

              <Field label="Geschätzte Kosten" hint="Ganze Euro, ohne Nachkommastellen. Freiwillig.">
                <TextInput
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={kosten}
                  onChange={(event) => setKosten(event.target.value)}
                  placeholder="4800"
                />
              </Field>

              {error !== null ? <p className="text-body text-alarm-red">{error}</p> : null}

              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" size="field" disabled={busy}>
                  {busy ? 'Wird gespeichert' : 'Speichern'}
                </Button>
                <Button type="button" variant="ghost" size="field" onClick={onClose}>
                  Abbrechen
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

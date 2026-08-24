/**
 * Einen Vorgang ändern: verschieben oder Fortschritt melden.
 *
 * Bis hierher war der Plan ein Bild an der Wand. Dieses Blatt ist die erste
 * Stelle, an der jemand etwas hineinschreibt — und deshalb trennt es
 * konsequent, was es trennen muss:
 *
 * - **Verschieben** ist eine Absicht. „Nicht vor dem 26.05." Die Folgevorgänge
 *   ziehen nach, der Endtermin rechnet sich neu, und ohne Grund geht es nicht:
 *   „12.05. → 26.05." beantwortet keine Frage, „…, Lieferzeit" fast alle.
 * - **Fortschritt** ist eine Tatsache. Was wirklich passiert ist, überschreibt
 *   die Rechnung, statt sie zu beschränken.
 *
 * Auf dem Telefon fährt das Blatt von unten ein und sitzt am unteren Rand, in
 * Daumenreichweite (CI 9.9 und 10.1). Am Rechner steht es mittig.
 *
 * Was jemand darf, entscheidet weiterhin die Datenbank. Die Rechte hier
 * blenden nur aus, was ohnehin abgewiesen würde — sie ersetzen keine Policy.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import type {
  ProjectSchedule,
  ScheduledTaskDto,
  ShiftPreview,
  TaskUpdateRequest,
} from '@meinbaulotse/shared';
import { shiftEffectInPlainWords } from '@meinbaulotse/shared';
import { Button, Field, Select, TextInput } from './ui';
import { ApiError } from '../lib/api';
import { formatDate, formatRange, STATUS_LABEL } from '../lib/format';
import { calendarOf, overdueDecisionFor } from '../lib/decisions';

/** Dieselben Werte wie `mbl.schedule_change_reason`, in der Sprache der Baustelle. */
const REASONS = [
  ['lieferzeit', 'Lieferzeit'],
  ['witterung', 'Witterung'],
  ['kapazitaet', 'Kapazität beim Gewerk'],
  ['vorgewerk_verzug', 'Vorgewerk in Verzug'],
  ['planungsaenderung', 'Planungsänderung'],
  ['bauherren_entscheidung', 'Entscheidung des Bauherrn'],
  ['behoerde', 'Behörde'],
  ['mangelbeseitigung', 'Mängelbeseitigung'],
  ['nachtrag', 'Nachtrag'],
  ['sonstiges', 'Sonstiges'],
] as const;

/** Nur die Zustände, die ein Mensch von Hand meldet. */
const STATUSES = ['terminiert', 'laeuft', 'fertig', 'verschoben', 'entfallen'] as const;

export function TaskSheet({
  task,
  schedule,
  onClose,
  onSave,
  onPreview,
}: {
  task: ScheduledTaskDto;
  schedule: ProjectSchedule;
  onClose: () => void;
  onSave: (change: TaskUpdateRequest) => Promise<void>;
  /**
   * Fehlt sie, wird ohne Vorschau gespeichert. Das ist der Zustand vor AP 4
   * und für den Styleguide der richtige — dort gibt es keinen Server, der
   * rechnen könnte.
   */
  onPreview?: (change: TaskUpdateRequest) => Promise<ShiftPreview>;
}) {
  const darfPlanen = schedule.permissions.includes('task.schedule');
  const referenceYear = Number(schedule.project.plannedStart.slice(0, 4));
  const titleId = useId();

  // Steht zu diesem Vorgang eine Frist offen, die verstrichen ist, ist der
  // Grund für eine Verschiebung wahrscheinlich genau die — und genau das
  // verlangt die Abnahme von AP 3: Eine überfällige Entscheidung wird „als
  // möglicher Verzugsgrund angeboten". Angeboten, nicht behauptet: Die Auswahl
  // bleibt änderbar.
  const offeneEntscheidung = overdueDecisionFor(
    task.id,
    schedule.decisions,
    calendarOf(schedule.project),
  );

  const [earliestStart, setEarliestStart] = useState(task.earliestStart ?? '');
  const [reason, setReason] = useState<string>(
    offeneEntscheidung === null ? 'lieferzeit' : 'bauherren_entscheidung',
  );
  const [reasonText, setReasonText] = useState('');
  const [status, setStatus] = useState<string>(task.status);
  const [actualStart, setActualStart] = useState(task.actualStart ?? '');
  const [actualEnd, setActualEnd] = useState(task.actualEnd ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zwei Schritte statt einem: erst zeigen, was mitzieht, dann schreiben
  // (Abschnitt 3.5, Punkt 6). Solange `vorschau` null ist, steht das Formular
  // da; danach der Vorschlag.
  const [vorschau, setVorschau] = useState<ShiftPreview | null>(null);
  const [entkoppelt, setEntkoppelt] = useState<readonly string[]>([]);

  // Ein Blatt, das sich nicht mit Escape schließen lässt, fühlt sich wie eine
  // Falle an — besonders auf dem Rechner.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** Nur senden, was sich geändert hat — sonst steht in der Historie Rauschen. */
  function collect(): TaskUpdateRequest | null {
    const change: Record<string, unknown> = {};
    const vorher = {
      earliestStart: task.earliestStart ?? '',
      actualStart: task.actualStart ?? '',
      actualEnd: task.actualEnd ?? '',
    };

    if (earliestStart !== vorher.earliestStart) {
      change['earliestStart'] = earliestStart === '' ? null : earliestStart;
      change['reason'] = reason;
      if (reasonText.trim() !== '') change['reasonText'] = reasonText.trim();
    }
    if (actualStart !== vorher.actualStart) {
      change['actualStart'] = actualStart === '' ? null : actualStart;
    }
    if (actualEnd !== vorher.actualEnd) change['actualEnd'] = actualEnd === '' ? null : actualEnd;
    if (status !== task.status) change['status'] = status;
    if (entkoppelt.length > 0) change['decouple'] = [...entkoppelt];

    return Object.keys(change).length === 0 ? null : (change as TaskUpdateRequest);
  }

  /** Holt den Vorschlag — beim Weiterklicken und nach jedem Haken. */
  async function hole(naechsteEntkopplung: readonly string[]): Promise<void> {
    const change = collect();
    if (change === null || onPreview === undefined) return;

    setBusy(true);
    setError(null);
    try {
      const naechste = await onPreview({
        ...change,
        ...(naechsteEntkopplung.length === 0 ? {} : { decouple: [...naechsteEntkopplung] }),
      });
      setEntkoppelt(naechsteEntkopplung);
      setVorschau(naechste);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Das ließ sich gerade nicht durchrechnen.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const change = collect();
    if (change === null) {
      onClose();
      return;
    }

    // Eine Verschiebung geht über die Vorschau. Alles andere — ein gemeldeter
    // Ist-Termin, ein Statuswechsel — zieht nichts nach und braucht keine.
    const verschiebt = change.earliestStart !== undefined;
    if (verschiebt && onPreview !== undefined && vorschau === null) {
      await hole(entkoppelt);
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
        className="max-h-[92dvh] w-full max-w-[34rem] overflow-y-auto rounded-t-[var(--radius-large)] bg-canvas-white p-5 sm:rounded-[var(--radius-large)]"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-subheading font-medium text-charcoal">
              {task.name}
            </h2>
            <p className="text-caption text-steel">
              {formatRange(task.currentStart, task.currentEnd, referenceYear)}
              {task.tradeName !== null ? ` · ${task.tradeName}` : ''}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Schließen">
            <X size={18} aria-hidden />
          </Button>
        </div>

        {vorschau !== null ? (
          <Vorschlag
            preview={vorschau}
            busy={busy}
            error={error}
            referenceYear={referenceYear}
            onToggle={(taskId) =>
              void hole(
                entkoppelt.includes(taskId)
                  ? entkoppelt.filter((eintrag) => eintrag !== taskId)
                  : [...entkoppelt, taskId],
              )
            }
            onBack={() => {
              setVorschau(null);
              setError(null);
            }}
            onConfirm={(event) => void submit(event)}
          />
        ) : !darfPlanen ? (
          // Fehlanzeige mit Grund, nicht mit gesperrten Feldern: Ein Formular,
          // das man ausfüllen kann und das dann abgewiesen wird, ist schlimmer
          // als keins.
          <p className="text-body text-steel">
            Termine ändern darf in diesem Bauvorhaben nur, wer dafür berechtigt ist. Das entscheidet
            der Bauherr.
          </p>
        ) : (
          <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
            <fieldset className="flex flex-col gap-3">
              <legend className="mb-2 text-body font-medium text-charcoal">Verschieben</legend>
              {/* Ohne diesen Satz trägt man eine Verschiebung ein, klickt
                  Speichern — und nichts passiert. Ein gemeldeter Ist-Beginn
                  ist eine Tatsache; er überschreibt die Rechnung, und eine
                  Beschränkung kann daran nichts ändern. Genau darüber bin ich
                  beim Testen selbst gestolpert. */}
              {task.actualStart !== null ? (
                <p className="text-caption text-tangerine">
                  Dieser Vorgang hat am {formatDate(task.actualStart, referenceYear)} begonnen. Ein
                  gemeldeter Beginn zählt mehr als jede Planung — verschieben lässt er sich erst,
                  wenn du ihn unten wieder herausnimmst.
                </p>
              ) : null}
              <Field
                label="Nicht vor"
                hint={
                  task.earliestStart === null
                    ? 'Die Folgevorgänge ziehen nach, der Endtermin rechnet sich neu.'
                    : `Von Hand verschoben. Feld leeren nimmt die Verschiebung zurück.`
                }
              >
                <TextInput
                  type="date"
                  value={earliestStart}
                  onChange={(event) => setEarliestStart(event.target.value)}
                />
              </Field>

              {earliestStart !== (task.earliestStart ?? '') ? (
                <>
                  <Field
                    label="Grund"
                    hint={
                      offeneEntscheidung === null
                        ? 'Steht später in der Historie neben der Verschiebung.'
                        : `Die Frist für \u201E${offeneEntscheidung.title}\u201C ist verstrichen. Deshalb steht der Grund schon da; du kannst ihn ändern.`
                    }
                  >
                    <Select value={reason} onChange={(event) => setReason(event.target.value)}>
                      {REASONS.map(([wert, text]) => (
                        <option key={wert} value={wert}>
                          {text}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Notiz" hint="Freiwillig.">
                    <TextInput
                      value={reasonText}
                      onChange={(event) => setReasonText(event.target.value)}
                      placeholder="Fenster kommen zwei Wochen später"
                    />
                  </Field>
                </>
              ) : null}
            </fieldset>

            <fieldset className="flex flex-col gap-3 border-t border-ash pt-5">
              <legend className="mb-2 text-body font-medium text-charcoal">
                Was wirklich passiert ist
              </legend>
              <Field label="Stand">
                <Select value={status} onChange={(event) => setStatus(event.target.value)}>
                  {STATUSES.map((wert) => (
                    <option key={wert} value={wert}>
                      {STATUS_LABEL[wert]}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Ist-Beginn">
                  <TextInput
                    type="date"
                    value={actualStart}
                    onChange={(event) => setActualStart(event.target.value)}
                  />
                </Field>
                <Field label="Ist-Ende">
                  <TextInput
                    type="date"
                    value={actualEnd}
                    onChange={(event) => setActualEnd(event.target.value)}
                  />
                </Field>
              </div>
              <p className="text-caption text-steel">
                Gemeldete Termine überschreiben die Rechnung — sie sind das, was war, nicht das, was
                geplant ist.
              </p>
            </fieldset>

            {error !== null ? <p className="text-body text-alarm-red">{error}</p> : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Abbrechen
              </Button>
              <Button type="submit" variant="primary" size="field" disabled={busy}>
                {busy
                  ? 'Wird gerechnet.'
                  : earliestStart !== (task.earliestStart ?? '') && onPreview !== undefined
                    ? 'Weiter: was zieht mit?'
                    : 'Speichern und neu rechnen'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Der Vorschlag: was mitzieht, was es kostet, und was stehen bleiben soll.
 *
 * Die Reihenfolge folgt derselben Regel wie überall — erst die Folge für das
 * Ganze, dann die Einzelheiten. Wer zuerst neun Zeilen liest und dann erfährt,
 * dass der Endtermin kippt, hat die neun Zeilen umsonst gelesen.
 */
function Vorschlag({
  preview,
  busy,
  error,
  referenceYear,
  onToggle,
  onBack,
  onConfirm,
}: {
  preview: ShiftPreview;
  busy: boolean;
  error: string | null;
  referenceYear: number;
  onToggle: (taskId: string) => void;
  onBack: () => void;
  onConfirm: (event: FormEvent) => void;
}) {
  const kippt = preview.effectWorkdays > 0;

  return (
    <form className="flex flex-col gap-5" onSubmit={onConfirm}>
      {/* 1. Was es das Ganze kostet. */}
      <section
        className={`flex flex-col gap-1 rounded-[var(--radius-large)] p-4 ${
          kippt ? 'bg-soft-amber' : 'bg-paper-mist'
        }`}
      >
        <p className="text-body-lg font-medium text-charcoal">
          {shiftEffectInPlainWords(preview.effectWorkdays)}
        </p>
        <p className="text-body text-steel">
          {formatDate(preview.computedEndBefore, referenceYear)} →{' '}
          {formatDate(preview.computedEndAfter, referenceYear)}
        </p>
      </section>

      {/* 2. Was mitzieht — und was stehen bleiben darf. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body font-medium text-charcoal">
          {preview.affected.length === 0
            ? 'Es zieht nichts mit.'
            : `Das zieht mit · ${preview.affected.length} ${
                preview.affected.length === 1 ? 'Vorgang' : 'Vorgänge'
              }`}
        </legend>
        <p className="text-caption text-steel">
          Hak ab, was trotzdem stehen bleibt. Der Vorgang behält seinen Termin, und er überlappt
          dann mit seinem Vorgänger.
        </p>

        <ul className="flex flex-col">
          {preview.affected.map((eintrag) => (
            <ZeileImVorschlag
              key={eintrag.taskId}
              name={eintrag.name}
              von={eintrag.fromStart}
              nach={eintrag.toStart}
              referenceYear={referenceYear}
              bleibt={false}
              busy={busy}
              onToggle={() => onToggle(eintrag.taskId)}
            />
          ))}
          {preview.decoupled.map((eintrag) => (
            <ZeileImVorschlag
              key={eintrag.taskId}
              name={eintrag.name}
              von={null}
              nach={null}
              referenceYear={referenceYear}
              bleibt
              busy={busy}
              onToggle={() => onToggle(eintrag.taskId)}
            />
          ))}
        </ul>
      </fieldset>

      {/* 3. Was die Entkopplung in den Daten bedeutet — vorher, nicht hinterher. */}
      {preview.overlaps.length > 0 ? (
        <p className="rounded-[var(--radius-card)] bg-paper-mist px-3 py-2 text-caption text-steel">
          {preview.overlaps
            .map(
              (eintrag) =>
                `„${eintrag.successorName}" überlappt dann ${eintrag.workdays} Werktage mit „${eintrag.predecessorName}".`,
            )
            .join(' ')}
        </p>
      ) : null}

      {/* 4. Und was sich für dich ändert: die Fristen. */}
      {preview.decisions.length > 0 ? (
        <section className="flex flex-col gap-1 border-t border-ash pt-4">
          <h3 className="text-body font-medium text-charcoal">Diese Fristen wandern mit</h3>
          <ul className="flex flex-col gap-0.5">
            {preview.decisions.map((eintrag) => (
              <li key={eintrag.id} className="text-caption text-steel">
                {eintrag.title}: {formatDate(eintrag.fromDueDate, referenceYear)} →{' '}
                {formatDate(eintrag.toDueDate, referenceYear)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error !== null ? <p className="text-body text-alarm-red">{error}</p> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
          Zurück
        </Button>
        <Button type="submit" variant="primary" size="field" disabled={busy}>
          {busy ? 'Wird gerechnet.' : 'Verschieben'}
        </Button>
      </div>
    </form>
  );
}

function ZeileImVorschlag({
  name,
  von,
  nach,
  referenceYear,
  bleibt,
  busy,
  onToggle,
}: {
  name: string;
  von: string | null;
  nach: string | null;
  referenceYear: number;
  bleibt: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="border-b border-ash last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={bleibt}
        className="flex min-h-11 w-full items-start gap-3 py-2 text-left transition-colors duration-[var(--motion-micro)] hover:bg-paper-mist disabled:opacity-45"
      >
        <span
          aria-hidden
          className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[var(--radius-input)] border ${
            bleibt ? 'border-vivid-green bg-vivid-green text-canvas-white' : 'border-smoke'
          }`}
        >
          {bleibt ? <Check size={14} /> : null}
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-body-lg text-charcoal">{name}</span>
          <span className="flex items-center gap-1.5 text-caption text-steel">
            {bleibt ? (
              'bleibt stehen'
            ) : (
              <>
                {formatDate(von, referenceYear)}
                <ArrowRight size={12} aria-hidden />
                {formatDate(nach, referenceYear)}
              </>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

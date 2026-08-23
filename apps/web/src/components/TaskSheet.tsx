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
import { BookOpen, X } from 'lucide-react';
import type {
  ProjectSchedule,
  ScheduledTaskDto,
  SchedulePreview,
  TaskUpdateRequest,
} from '@meinbaulotse/shared';
import { Button, Field, Select, TextInput } from './ui';
import { ApiError } from '../lib/api';
import { formatDate, formatRange, STATUS_LABEL } from '../lib/format';
import { calendarOf, ueberfaelligeEntscheidungenZu } from '../lib/decisions';

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
  onOpenGuide,
  onPreview,
}: {
  task: ScheduledTaskDto;
  schedule: ProjectSchedule;
  onClose: () => void;
  onSave: (change: TaskUpdateRequest) => Promise<void>;
  /** Führt zur Lotsenkarte, sofern es zu diesem Vorgang eine gibt. */
  onOpenGuide?: () => void;
  /**
   * Rechnet vor, was die Verschiebung nach sich zöge (Abschnitt 3.5.6).
   * Fehlt sie, gibt es keinen Vorschlag — so wie im Styleguide.
   */
  onPreview?: (change: TaskUpdateRequest) => Promise<SchedulePreview>;
}) {
  const darfPlanen = schedule.permissions.includes('task.schedule');
  // Eine verstrichene Entscheidungsfrist zu diesem Vorgang ist der wahr-
  // scheinlichste Grund für seine Verschiebung — und der einzige, den die
  // Anwendung selbst kennt. Sie bietet ihn an, statt ihn zu behaupten
  // (Abnahme AP 3: „als möglicher Verzugsgrund angeboten").
  const offeneFristen = ueberfaelligeEntscheidungenZu(
    task.id,
    schedule.decisions,
    calendarOf(schedule.project),
  );
  const referenceYear = Number(schedule.project.plannedStart.slice(0, 4));
  const titleId = useId();

  const [earliestStart, setEarliestStart] = useState(task.earliestStart ?? '');
  const [reason, setReason] = useState<string>('lieferzeit');
  const [reasonText, setReasonText] = useState('');
  const [status, setStatus] = useState<string>(task.status);
  const [actualStart, setActualStart] = useState(task.actualStart ?? '');
  const [actualEnd, setActualEnd] = useState(task.actualEnd ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

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

    return Object.keys(change).length === 0 ? null : (change as TaskUpdateRequest);
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

        {/* Der Weg zur Karte steht oben, vor den Feldern: Wer ein Blatt zu
            einem Vorgang öffnet, will oft erst wissen, worum es überhaupt
            geht — und nicht sofort ein Datum eintragen. */}
        {onOpenGuide !== undefined && task.guideCardKey !== null ? (
          <Button
            variant="outline"
            size="sm"
            className="mb-4 w-full justify-start text-lavender sm:w-auto"
            onClick={onOpenGuide}
          >
            <BookOpen size={16} aria-hidden />
            Was passiert hier?
          </Button>
        ) : null}

        {!darfPlanen ? (
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
              {offeneFristen.length > 0 ? (
                <p className="text-caption text-steel">
                  Zu diesem Vorgang ist eine Frist verstrichen:{' '}
                  {offeneFristen.map((d) => `„${d.title}"`).join(', ')}. Falls das der Grund ist,
                  wähl unten „Entscheidung des Bauherrn" — dann steht es später so in der Historie.
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
                  <Field label="Grund" hint="Steht später in der Historie neben der Verschiebung.">
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

            {/* Der Vorschlag aus Abschnitt 3.5.6: was daran hängt, **bevor**
                gespeichert wird. Eine Verschiebung um drei Tage, die sieben
                Gewerke nachzieht, ist eine andere Entscheidung als eine, die
                im Puffer verschwindet — und das sieht man dem Plan nicht an. */}
            {preview !== null ? (
              <div className="flex flex-col gap-2 rounded-[var(--radius-large)] bg-paper-mist p-4">
                {preview.tasks.length === 0 ? (
                  <p className="text-body text-charcoal">
                    Das zieht nichts nach. Der Vorgang bleibt, wo er ist.
                  </p>
                ) : (
                  <>
                    <p className="text-body font-medium text-charcoal">
                      Das zieht {preview.tasks.length === 1 ? 'einen Vorgang' : `${preview.tasks.length} Vorgänge`} nach
                      {preview.endShiftWorkdays === 0
                        ? ' — der Endtermin bleibt.'
                        : preview.endShiftWorkdays > 0
                          ? `, und der Endtermin wandert um ${preview.endShiftWorkdays} Werktage nach hinten.`
                          : `, und der Endtermin rückt um ${Math.abs(preview.endShiftWorkdays)} Werktage vor.`}
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {preview.tasks.slice(0, 6).map((entry) => (
                        <li key={entry.id} className="text-caption text-steel">
                          {entry.name}: {formatDate(entry.fromStart, referenceYear)} →{' '}
                          {formatDate(entry.toStart, referenceYear)}
                        </li>
                      ))}
                      {preview.tasks.length > 6 ? (
                        <li className="text-caption text-steel">
                          und {preview.tasks.length - 6} weitere
                        </li>
                      ) : null}
                    </ul>
                    {preview.decisions.length > 0 ? (
                      <p className="text-caption text-tangerine">
                        {preview.decisions.length === 1
                          ? 'Eine Entscheidungsfrist wandert mit: '
                          : `${preview.decisions.length} Entscheidungsfristen wandern mit: `}
                        {preview.decisions.map((entry) => entry.title).join(', ')}.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                Abbrechen
              </Button>
              {onPreview !== undefined ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || previewBusy}
                  onClick={() => {
                    const change = collect();
                    if (change === null) {
                      setError('Trag zuerst ein, was sich ändern soll.');
                      return;
                    }
                    setPreviewBusy(true);
                    setError(null);
                    onPreview(change)
                      .then(setPreview)
                      .catch((fehler: unknown) =>
                        setError(
                          fehler instanceof ApiError
                            ? fehler.message
                            : 'Die Vorschau ließ sich nicht rechnen.',
                        ),
                      )
                      .finally(() => setPreviewBusy(false));
                  }}
                >
                  {previewBusy ? 'Wird gerechnet.' : 'Was zieht das nach?'}
                </Button>
              ) : null}
              <Button type="submit" variant="primary" size="field" disabled={busy}>
                {busy ? 'Wird gerechnet.' : 'Speichern und neu rechnen'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

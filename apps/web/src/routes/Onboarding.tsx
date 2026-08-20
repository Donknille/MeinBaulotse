import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import type { OnboardingRequest } from '@meinbaulotse/shared';
import { Button, Card, Field, Select, TextInput } from '../components/ui';
import { FEDERAL_STATE_LABEL } from '../lib/format';
import { api, ApiError } from '../lib/api';
import { Topmark } from './SignIn';

/**
 * Fünf Fragen, eine je Ansicht.
 *
 * Mehr wird nicht gefragt. Alles Weitere ergibt sich aus der Ablaufvorlage —
 * und was man nicht fragt, kann man auch nicht falsch beantworten.
 */

type Answers = {
  name: string;
  buildType: OnboardingRequest['buildType'];
  hasBasement: boolean | null;
  plannedStart: string;
  federalState: OnboardingRequest['federalState'] | '';
  contractType: OnboardingRequest['contractType'] | '';
};

const BUILD_TYPES: { value: OnboardingRequest['buildType']; label: string; note?: string }[] = [
  { value: 'efh_massiv', label: 'Einfamilienhaus, massiv gebaut' },
  {
    value: 'efh_fertighaus',
    label: 'Fertighaus',
    note: 'Der Ablauf ist derzeit auf Massivbau zugeschnitten. Du kannst ihn danach anpassen.',
  },
  {
    value: 'sanierung',
    label: 'Sanierung im Bestand',
    note: 'Der Ablauf ist derzeit auf Neubau zugeschnitten. Du kannst ihn danach anpassen.',
  },
  { value: 'sonstiges', label: 'Etwas anderes' },
];

export function Onboarding() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>({
    name: '',
    buildType: 'efh_massiv',
    hasBasement: null,
    plannedStart: '',
    federalState: '',
    contractType: '',
  });

  const create = useMutation({
    mutationFn: (payload: OnboardingRequest) => api.createProject(payload),
    onSuccess: (result) => navigate(`/projekt/${result.projectId}`),
  });

  const steps = [
    {
      title: 'Wie soll dein Projekt heißen?',
      help: 'Die Adresse der Baustelle reicht völlig.',
      valid: answers.name.trim().length >= 2,
      body: (
        <Field label="Projektname">
          <TextInput
            autoFocus
            value={answers.name}
            placeholder="Musterweg 4"
            onChange={(event) => setAnswers({ ...answers, name: event.target.value })}
          />
        </Field>
      ),
    },
    {
      title: 'Wie wird gebaut?',
      help: 'Daraus ergibt sich, welche Gewerke in welcher Reihenfolge kommen.',
      valid: true,
      body: (
        <div className="flex flex-col gap-2">
          {BUILD_TYPES.map((option) => (
            <Choice
              key={option.value}
              selected={answers.buildType === option.value}
              onSelect={() => setAnswers({ ...answers, buildType: option.value })}
              label={option.label}
              {...(option.note === undefined ? {} : { note: option.note })}
            />
          ))}
        </div>
      ),
    },
    {
      title: 'Wird unterkellert?',
      help: 'Ein Keller kostet rund vier Wochen Bauzeit und vier eigene Vorgänge.',
      valid: answers.hasBasement !== null,
      body: (
        <div className="flex flex-col gap-2">
          <Choice
            selected={answers.hasBasement === true}
            onSelect={() => setAnswers({ ...answers, hasBasement: true })}
            label="Ja, mit Keller"
          />
          <Choice
            selected={answers.hasBasement === false}
            onSelect={() => setAnswers({ ...answers, hasBasement: false })}
            label="Nein, Bodenplatte"
          />
        </div>
      ),
    },
    {
      title: 'Wann geht es los?',
      help: 'Der geplante Baubeginn. Verschiebt er sich später, rechnen wir alles mit.',
      valid: /^\d{4}-\d{2}-\d{2}$/.test(answers.plannedStart),
      body: (
        <Field label="Geplanter Baubeginn">
          <TextInput
            type="date"
            value={answers.plannedStart}
            onChange={(event) => setAnswers({ ...answers, plannedStart: event.target.value })}
          />
        </Field>
      ),
    },
    {
      title: 'Wo wird gebaut?',
      help: 'Das Bundesland bestimmt die Feiertage — und die verschieben Termine.',
      valid: answers.federalState !== '',
      body: (
        <Field label="Bundesland">
          <Select
            value={answers.federalState}
            onChange={(event) =>
              setAnswers({
                ...answers,
                federalState: event.target.value as OnboardingRequest['federalState'],
              })
            }
          >
            <option value="">Bitte wählen</option>
            {Object.entries(FEDERAL_STATE_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      ),
    },
    {
      title: 'Wer baut?',
      help: 'Ein Generalunternehmer übernimmt alles, bei Einzelgewerken beauftragst du selbst.',
      valid: answers.contractType !== '',
      body: (
        <div className="flex flex-col gap-2">
          <Choice
            selected={answers.contractType === 'verbraucherbauvertrag'}
            onSelect={() => setAnswers({ ...answers, contractType: 'verbraucherbauvertrag' })}
            label="Ein Generalunternehmer"
            note="In der Regel ein Verbraucherbauvertrag nach § 650i BGB."
          />
          <Choice
            selected={answers.contractType === 'einzelgewerke'}
            onSelect={() => setAnswers({ ...answers, contractType: 'einzelgewerke' })}
            label="Einzelgewerke, die ich selbst beauftrage"
          />
          <Choice
            selected={answers.contractType === 'sonstiges'}
            onSelect={() => setAnswers({ ...answers, contractType: 'sonstiges' })}
            label="Etwas anderes"
          />
        </div>
      ),
    },
  ];

  const current = steps[step]!;
  const isLast = step === steps.length - 1;

  function next() {
    if (!isLast) {
      setStep(step + 1);
      return;
    }
    create.mutate({
      name: answers.name.trim(),
      buildType: answers.buildType,
      hasBasement: answers.hasBasement === true,
      plannedStart: answers.plannedStart,
      federalState: answers.federalState as OnboardingRequest['federalState'],
      contractType: answers.contractType as OnboardingRequest['contractType'],
    });
  }

  return (
    <main className="dotted-canvas min-h-dvh px-4 py-10">
      <div className="mx-auto flex w-full max-w-[34rem] flex-col gap-6">
        <div className="flex items-center gap-3 text-charcoal">
          <Topmark size={22} />
          <span className="text-body font-medium">MeinBaulotse</span>
        </div>

        {/* Fortschritt als Punkte, nicht als Prozentbalken. */}
        <div className="flex items-center gap-1.5" aria-label={`Frage ${step + 1} von ${steps.length}`}>
          {steps.map((_, index) => (
            <span
              key={index}
              className={`h-1 flex-1 rounded-[var(--radius-pill)] ${
                index <= step ? 'bg-charcoal' : 'bg-ash'
              }`}
              aria-hidden
            />
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="display-title text-heading-lg text-charcoal">{current.title}</h1>
          <p className="text-body-lg text-steel">{current.help}</p>
        </div>

        <Card className="flex flex-col gap-4">{current.body}</Card>

        {create.isError ? (
          <p className="text-body text-alarm-red">
            {create.error instanceof ApiError ? create.error.message : 'Das hat nicht geklappt.'}{' '}
            Versuch es bitte noch einmal.
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={16} aria-hidden />
              Zurück
            </Button>
          ) : (
            <span />
          )}
          <Button
            variant="primary"
            size="field"
            disabled={!current.valid || create.isPending}
            onClick={next}
          >
            {create.isPending ? 'Plan wird gebaut …' : isLast ? 'Plan erstellen' : 'Weiter'}
          </Button>
        </div>
      </div>
    </main>
  );
}

function Choice({
  selected,
  onSelect,
  label,
  note,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  note?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex min-h-14 flex-col items-start gap-1 rounded-[var(--radius-button)] border px-4 py-3 text-left transition-colors duration-[var(--motion-micro)] ${
        selected
          ? 'border-midnight-ink bg-paper-mist'
          : 'border-ash bg-canvas-white hover:bg-paper-mist'
      }`}
    >
      <span className="text-body-lg font-medium text-charcoal">{label}</span>
      {note !== undefined ? <span className="text-caption text-steel">{note}</span> : null}
    </button>
  );
}

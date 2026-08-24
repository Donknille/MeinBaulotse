/**
 * Mängel — Arbeitspaket 8, „Mängelverfolgung mit Fristen und Eskalationsstufen".
 *
 * Die Liste ist nach Dringlichkeit sortiert und nicht nach Datum: offene vor
 * erledigten, wesentliche vor geringfügigen, die ältesten Fristen zuerst. Wer
 * sie öffnet, sieht oben, was drängt.
 *
 * Zwei Dinge stehen bewusst nebeneinander und nicht übereinander:
 *
 * - **Die Schwere.** Nur ein wesentlicher Mangel sperrt eine Zahlung. Das steht
 *   an der Zeile, damit niemand raten muss, warum eine Rate nicht freigebbar
 *   ist.
 * - **Die Eskalation.** Was der Bauherr getan hat, und was der Kalender
 *   nahelegt. Die beiden auseinanderzuhalten ist der Unterschied zwischen einer
 *   Erinnerung und einer Behauptung — und die vorgeschlagene Stufe steht als
 *   Satz da, nicht als Zahl: „Eskalationsstufe 2" sagt einem Bauherren nichts.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Plus } from 'lucide-react';
import {
  DEFECT_ESCALATION_STEPS,
  type DefectDto,
  type ProjectSchedule,
} from '@meinbaulotse/shared';
import { Button, Card, EmptyState, Field, Pill, Select, TextInput } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { ApiError, api } from '../lib/api';
import { formatDate } from '../lib/format';
import { todayIso } from '../lib/progress';

const STATUS_LABEL: Record<DefectDto['status'], string> = {
  offen: 'Offen',
  in_bearbeitung: 'In Arbeit',
  behoben_gemeldet: 'Behoben gemeldet',
  behoben: 'Behoben',
  abgelehnt: 'Abgelehnt',
};

export function Defects() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState(false);
  const heute = todayIso();

  const liste = useQuery({
    queryKey: ['defects', projectId, heute],
    queryFn: () => api.defects(projectId!, heute),
    enabled: projectId !== undefined,
  });

  const plan = useQuery({
    queryKey: ['schedule', projectId],
    queryFn: () => api.schedule(projectId!),
    enabled: projectId !== undefined,
  });

  const erfassen = useMutation({
    mutationFn: (defect: Parameters<typeof api.createDefect>[1]) =>
      api.createDefect(projectId!, defect),
    onSuccess: (antwort) => {
      queryClient.setQueryData(['defects', projectId, heute], antwort);
      setNeu(false);
    },
  });

  const aendern = useMutation({
    mutationFn: ({
      defectId,
      change,
    }: {
      defectId: string;
      change: Parameters<typeof api.updateDefect>[2];
    }) => api.updateDefect(projectId!, defectId, change),
    onSuccess: (antwort) => queryClient.setQueryData(['defects', projectId, heute], antwort),
  });

  const defects = liste.data?.defects ?? [];
  const darfErfassen = plan.data?.permissions.includes('defect.write') ?? false;
  const darfAbhaken = plan.data?.permissions.includes('defect.resolve') ?? false;

  return (
    <main className="mx-auto flex w-full max-w-[46rem] flex-col gap-6 px-4 py-8 sm:px-6">
      <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="display-title text-heading-lg text-charcoal">Mängel</h1>
          <p className="text-body text-steel">
            {defects.length === 0
              ? 'Noch nichts erfasst.'
              : `${defects.filter((eintrag) => eintrag.status !== 'behoben').length} offen von ${defects.length}`}
          </p>
        </div>
        {darfErfassen && !neu ? (
          <Button variant="primary" size="field" onClick={() => setNeu(true)}>
            <Plus size={20} aria-hidden />
            Mangel erfassen
          </Button>
        ) : null}
      </header>

      {neu ? (
        <NeuerMangel
          tasks={plan.data?.tasks ?? []}
          busy={erfassen.isPending}
          fehler={erfassen.error instanceof ApiError ? erfassen.error.message : null}
          abbrechen={() => setNeu(false)}
          speichern={(defect) => erfassen.mutate(defect)}
        />
      ) : null}

      {aendern.error instanceof ApiError ? (
        <p className="text-body text-alarm-red">{aendern.error.message}</p>
      ) : null}

      {liste.isPending ? (
        <p className="text-body text-steel">Wird geladen.</p>
      ) : defects.length === 0 ? (
        <EmptyState text="Hier stehen später die Dinge, die nicht in Ordnung sind — mit Frist und mit dem, was daraus folgt. Ein Mangel ohne Frist ist eine Beschwerde." />
      ) : (
        <ul className="flex flex-col gap-3">
          {defects.map((mangel) => (
            <li key={mangel.id}>
              <Mangel
                mangel={mangel}
                darfAbhaken={darfAbhaken}
                busy={aendern.isPending}
                onChange={(change) => aendern.mutate({ defectId: mangel.id, change })}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Mangel({
  mangel,
  darfAbhaken,
  busy,
  onChange,
}: {
  mangel: DefectDto;
  darfAbhaken: boolean;
  busy: boolean;
  onChange: (change: Parameters<typeof api.updateDefect>[2]) => void;
}) {
  const erledigt = mangel.status === 'behoben' || mangel.status === 'abgelehnt';

  return (
    <Card className={`flex flex-col gap-2 ${erledigt ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-body-lg font-medium text-charcoal">{mangel.title}</h2>
        <Pill tone={mangel.severity === 'wesentlich' ? 'red' : 'neutral'}>
          {mangel.severity === 'wesentlich' ? 'Wesentlich' : 'Geringfügig'}
        </Pill>
        <Pill tone={erledigt ? 'green' : mangel.status === 'behoben_gemeldet' ? 'amber' : 'neutral'}>
          {STATUS_LABEL[mangel.status]}
        </Pill>
      </div>

      {mangel.description === null ? null : (
        <p className="text-body whitespace-pre-wrap text-charcoal">{mangel.description}</p>
      )}

      <p className="text-caption text-steel">
        {[
          mangel.locationText,
          mangel.taskName,
          mangel.tradeName,
          mangel.deadline === null ? null : `Frist ${formatDate(mangel.deadline)}`,
          mangel.reportedBy === null ? null : `gemeldet von ${mangel.reportedBy}`,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {/* Was der Kalender nahelegt — als Satz, nicht als Zahl. */}
      {!erledigt && mangel.suggestedEscalation > mangel.escalationLevel ? (
        <p className="flex items-start gap-2 rounded-[var(--radius-card)] bg-soft-amber p-3 text-body text-charcoal">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-tangerine" aria-hidden />
          {DEFECT_ESCALATION_STEPS[mangel.suggestedEscalation]}
        </p>
      ) : null}

      {mangel.severity === 'wesentlich' && !erledigt ? (
        <p className="text-caption text-tangerine">
          Solange dieser Mangel offen ist, lässt sich die zugehörige Rate nicht in voller Höhe
          freigeben.
        </p>
      ) : null}

      {erledigt ? null : (
        <div className="mt-1 flex flex-wrap gap-2">
          {mangel.status !== 'behoben_gemeldet' ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onChange({ status: 'behoben_gemeldet' })}
            >
              Als behoben melden
            </Button>
          ) : null}
          {darfAbhaken ? (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() => onChange({ status: 'behoben' })}
            >
              <Check size={16} aria-hidden />
              Nachgesehen, behoben
            </Button>
          ) : null}
          {darfAbhaken && mangel.suggestedEscalation > mangel.escalationLevel ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onChange({ escalationLevel: mangel.suggestedEscalation })}
            >
              Erledigt, weiter zur nächsten Stufe
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function NeuerMangel({
  tasks,
  busy,
  fehler,
  abbrechen,
  speichern,
}: {
  tasks: ProjectSchedule['tasks'];
  busy: boolean;
  fehler: string | null;
  abbrechen: () => void;
  speichern: (defect: Parameters<typeof api.createDefect>[1]) => void;
}) {
  const [titel, setTitel] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [ort, setOrt] = useState('');
  const [schwere, setSchwere] = useState<'geringfuegig' | 'wesentlich'>('geringfuegig');
  const [vorgang, setVorgang] = useState('');
  const [frist, setFrist] = useState('');

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-body font-medium text-charcoal">Mangel erfassen</h2>

      <Field label="Was ist nicht in Ordnung?">
        <TextInput
          value={titel}
          onChange={(event) => setTitel(event.target.value)}
          placeholder="Kellerwand feucht an der Nordseite"
        />
      </Field>

      <Field label="Beschreibung" hint="Was man sieht, nicht was man vermutet.">
        <textarea
          value={beschreibung}
          onChange={(event) => setBeschreibung(event.target.value)}
          rows={3}
          className="w-full rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white px-3 py-2 text-body-lg text-charcoal"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Wo genau?">
          <TextInput
            value={ort}
            onChange={(event) => setOrt(event.target.value)}
            placeholder="Keller, Nordwand, links vom Fenster"
          />
        </Field>

        <Field
          label="Wie schwer?"
          hint="Nur ein wesentlicher Mangel sperrt die zugehörige Zahlung."
        >
          <Select
            value={schwere}
            onChange={(event) => setSchwere(event.target.value as typeof schwere)}
          >
            <option value="geringfuegig">Geringfügig</option>
            <option value="wesentlich">Wesentlich</option>
          </Select>
        </Field>

        <Field label="Zu welchem Vorgang?">
          <Select value={vorgang} onChange={(event) => setVorgang(event.target.value)}>
            <option value="">Ohne Vorgang</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Frist zur Beseitigung" hint="Ein Mangel ohne Frist ist eine Beschwerde.">
          <TextInput
            type="date"
            value={frist}
            onChange={(event) => setFrist(event.target.value)}
          />
        </Field>
      </div>

      {fehler === null ? null : <p className="text-body text-alarm-red">{fehler}</p>}

      <div className="flex gap-2">
        <Button
          variant="primary"
          size="field"
          disabled={busy || titel.trim().length < 3}
          onClick={() =>
            speichern({
              title: titel.trim(),
              severity: schwere,
              ...(beschreibung.trim() === '' ? {} : { description: beschreibung.trim() }),
              ...(ort.trim() === '' ? {} : { locationText: ort.trim() }),
              ...(vorgang === '' ? {} : { taskId: vorgang }),
              ...(frist === '' ? {} : { deadline: frist }),
            })
          }
        >
          Erfassen
        </Button>
        <Button size="field" onClick={abbrechen}>
          Abbrechen
        </Button>
      </div>
    </Card>
  );
}

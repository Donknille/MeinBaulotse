/**
 * Mängel — die Ansicht zur Leiter aus `apps/api/src/defects.ts`.
 *
 * Der ganze Wert steht in einem Satz je Mangel: **Was ist jetzt dran?** Ein
 * Bauherr, der einen Riss sieht, weiß nicht, dass er ihn schriftlich anzeigen
 * und dann eine Frist setzen muss, bevor daraus irgendein Recht wird. Diese
 * Seite sagt es ihm — an der Stelle, an der er ohnehin steht.
 *
 * Was sie **nicht** sagt: ob es ein Mangel ist. Das entscheidet ein
 * Sachverständiger, und wo es darauf ankommt, steht das auch da.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Camera, CircleAlert, Plus, ScrollText } from 'lucide-react';
import type { DefectDto, DefectStatus } from '@meinbaulotse/shared';
import { Button, Card, Field, FieldGroup, Pill } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { api, type DefectEventDto } from '../lib/api';
import { formatDate } from '../lib/format';

const STATUS_LABEL: Record<DefectStatus, string> = {
  offen: 'Offen',
  anerkannt: 'Vom Unternehmen anerkannt',
  behoben_gemeldet: 'Als behoben gemeldet',
  behoben: 'Behoben',
  // CI 11.2: nicht „strittig" in der Oberfläche, sondern die Sache benennen.
  strittig: 'Zwei Angaben',
  zurueckgestellt: 'Zurückgestellt',
};

export function Defects() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [neu, setNeu] = useState(false);
  const [offen, setOffen] = useState<string | null>(null);

  const plan = useQuery({
    queryKey: ['schedule', projectId],
    queryFn: () => api.schedule(projectId!),
    enabled: projectId !== undefined,
  });

  const defects = useQuery({
    queryKey: ['defects', projectId],
    queryFn: () => api.defects(projectId!),
    enabled: projectId !== undefined,
  });

  const auffrischen = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['defects', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['money', projectId] });
  };

  const anlegen = useMutation({
    mutationFn: (body: { title: string; description?: string; locationText?: string; severity: 'geringfuegig' | 'wesentlich'; taskId?: string }) =>
      api.createDefect(projectId!, body),
    onSuccess: () => {
      setNeu(false);
      auffrischen();
    },
  });

  const aendern = useMutation({
    mutationFn: ({ id, change }: { id: string; change: Parameters<typeof api.updateDefect>[2] }) =>
      api.updateDefect(projectId!, id, change),
    onSuccess: auffrischen,
  });

  const liste = defects.data ?? [];
  const laufend = liste.filter((mangel) => mangel.status !== 'behoben' && mangel.status !== 'zurueckgestellt');
  const erledigt = liste.filter((mangel) => mangel.status === 'behoben' || mangel.status === 'zurueckgestellt');
  const darfErfassen = plan.data?.project.role === 'owner' || plan.data?.project.role === 'co_owner'
    || plan.data?.project.role === 'expert';

  return (
    <main className="mx-auto flex w-full max-w-[52rem] flex-col gap-6 px-4 py-6 sm:px-6">
      <TopBar
        back={{ to: `/projekt/${projectId ?? ''}`, label: plan.data?.project.name ?? 'Zurück' }}
      />

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-caption text-steel">Mängel</p>
          <h1 className="display-title text-heading-lg text-charcoal">
            {laufend.length === 0 ? 'Nichts offen' : `${laufend.length} offen`}
          </h1>
        </div>
        {darfErfassen ? (
          <Button variant="primary" size="field" onClick={() => setNeu(true)}>
            <Plus size={18} aria-hidden />
            Mangel erfassen
          </Button>
        ) : null}
      </header>

      {neu ? (
        <Erfassen
          tasks={(plan.data?.tasks ?? []).map((task) => ({ id: task.id, name: task.name }))}
          busy={anlegen.isPending}
          onCancel={() => setNeu(false)}
          onSave={(body) => anlegen.mutate(body)}
        />
      ) : null}

      {defects.isPending ? <p className="text-body text-steel">…</p> : null}

      {!defects.isPending && liste.length === 0 && !neu ? (
        <Card className="flex flex-col gap-2">
          <p className="text-body-lg text-charcoal">Hier steht noch nichts.</p>
          <p className="text-body text-steel">
            Was dir auffällt, gehört hierher — auch wenn du nicht sicher bist, ob es ein Mangel
            ist. Festhalten kostet nichts, später beweisen schon.
          </p>
        </Card>
      ) : null}

      <ul className="flex flex-col gap-4">
        {laufend.map((mangel) => (
          <li key={mangel.id}>
            <Mangel
              mangel={mangel}
              offen={offen === mangel.id}
              projectId={projectId!}
              busy={aendern.isPending}
              onToggle={() => setOffen(offen === mangel.id ? null : mangel.id)}
              onChange={(change) => aendern.mutate({ id: mangel.id, change })}
            />
          </li>
        ))}
      </ul>

      {erledigt.length > 0 ? (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-body text-steel">
            Erledigt · {erledigt.length}
          </summary>
          <ul className="mt-3 flex flex-col gap-2">
            {erledigt.map((mangel) => (
              <li key={mangel.id}>
                <Card className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                  <span className="text-body text-charcoal">{mangel.title}</span>
                  <span className="text-caption text-steel">{STATUS_LABEL[mangel.status]}</span>
                </Card>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </main>
  );
}

function Mangel({
  mangel,
  offen,
  projectId,
  busy,
  onToggle,
  onChange,
}: {
  mangel: DefectDto;
  offen: boolean;
  projectId: string;
  busy: boolean;
  onToggle: () => void;
  onChange: (change: Parameters<typeof api.updateDefect>[2]) => void;
}) {
  const [frist, setFrist] = useState(mangel.deadline ?? '');

  const verlauf = useQuery({
    queryKey: ['defect-events', projectId, mangel.id],
    queryFn: () => api.defectEvents(projectId, mangel.id),
    enabled: offen,
  });

  return (
    <Card className="flex flex-col gap-4">
      <button type="button" onClick={onToggle} className="flex flex-col gap-2 text-left">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-lg font-medium text-charcoal">{mangel.title}</span>
          {mangel.severity === 'wesentlich' ? (
            <Pill tone="amber">Wesentlich</Pill>
          ) : null}
          <Pill tone={mangel.status === 'strittig' ? 'amber' : 'neutral'}>
            {STATUS_LABEL[mangel.status]}
          </Pill>
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-steel">
          <span>{mangel.step.title}</span>
          {mangel.taskName === null ? null : <span>{mangel.taskName}</span>}
          {mangel.locationText === null ? null : <span>{mangel.locationText}</span>}
          {mangel.deadline === null ? null : (
            <span className="inline-flex items-center gap-1">
              <CalendarClock size={13} aria-hidden />
              Frist {formatDate(mangel.deadline)}
            </span>
          )}
          {mangel.photoCount === 0 ? null : (
            <span className="inline-flex items-center gap-1">
              <Camera size={13} aria-hidden />
              {mangel.photoCount}
            </span>
          )}
        </p>
      </button>

      {/* Der nächste Schritt steht immer da, nicht erst nach dem Aufklappen.
          Er ist der Grund, warum es diese Seite gibt. */}
      <div className="flex items-start gap-2 rounded-[var(--radius-card)] bg-paper-mist p-3">
        <CircleAlert size={18} className="mt-0.5 shrink-0 text-charcoal" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-body font-medium text-charcoal">{mangel.step.next}</p>
          {offen ? <p className="text-body text-steel">{mangel.step.detail}</p> : null}
          {offen && mangel.step.reference !== null ? (
            <p className="text-caption text-steel">{mangel.step.reference}</p>
          ) : null}
        </div>
      </div>

      {offen ? (
        <div className="flex flex-col gap-4">
          {mangel.description === null ? null : (
            <p className="text-body text-steel">{mangel.description}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {mangel.escalationLevel === 0 ? (
              <Button disabled={busy} onClick={() => onChange({ reportedToContractor: true })}>
                Als angezeigt festhalten
              </Button>
            ) : null}
            {mangel.status !== 'behoben' ? (
              <Button disabled={busy} onClick={() => onChange({ status: 'behoben' })}>
                Als behoben festhalten
              </Button>
            ) : null}
            {mangel.status !== 'strittig' ? (
              <Button disabled={busy} onClick={() => onChange({ status: 'strittig' })}>
                Wir sind uns nicht einig
              </Button>
            ) : null}
          </div>

          <Field
            label="Frist zur Beseitigung"
            hint="Ohne Frist entsteht kein Recht. Zwei bis drei Wochen sind üblich."
          >
            <div className="flex gap-2">
              <input
                type="date"
                value={frist}
                onChange={(event) => setFrist(event.target.value)}
                className="h-11 flex-1 rounded-[var(--radius-input)] border border-pebble px-3 text-body"
              />
              <Button
                disabled={busy || frist === '' || frist === mangel.deadline}
                onClick={() => onChange({ deadline: frist })}
              >
                Eintragen
              </Button>
            </div>
          </Field>

          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-caption text-steel">
              <ScrollText size={14} aria-hidden />
              Verlauf
            </p>
            <ul className="flex flex-col gap-1">
              {(verlauf.data ?? []).map((eintrag: DefectEventDto) => (
                <li key={eintrag.id} className="text-caption text-steel">
                  {formatDate(eintrag.createdAt.slice(0, 10))} · {beschreibung(eintrag)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function beschreibung(eintrag: DefectEventDto): string {
  const wer = eintrag.actorName === null ? '' : ` (${eintrag.actorName})`;
  switch (eintrag.action) {
    case 'erfasst':
      return `Festgehalten${wer}`;
    case 'stand':
      return `Stand: ${STATUS_LABEL[(eintrag.newStatus ?? 'offen') as DefectStatus]}${wer}`;
    case 'frist':
      return `Frist: ${eintrag.note ?? '—'}${wer}`;
    case 'stufe':
      return `Nächster Schritt erreicht${wer}`;
    default:
      return `${eintrag.note ?? eintrag.action}${wer}`;
  }
}

function Erfassen({
  tasks,
  busy,
  onCancel,
  onSave,
}: {
  tasks: { id: string; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onSave: (body: {
    title: string;
    description?: string;
    locationText?: string;
    severity: 'geringfuegig' | 'wesentlich';
    taskId?: string;
  }) => void;
}) {
  const [titel, setTitel] = useState('');
  const [text, setText] = useState('');
  const [ort, setOrt] = useState('');
  const [schwere, setSchwere] = useState<'geringfuegig' | 'wesentlich'>('geringfuegig');
  const [vorgang, setVorgang] = useState('');

  return (
    <Card className="flex flex-col gap-4">
      <Field label="Was ist dir aufgefallen?" hint="Beschreib, was du siehst — nicht, was du vermutest.">
        <input
          value={titel}
          onChange={(event) => setTitel(event.target.value)}
          placeholder="Risse in der Bodenplatte"
          className="h-12 w-full rounded-[var(--radius-input)] border border-pebble px-3 text-body-lg"
        />
      </Field>

      <Field label="Wo genau?">
        <input
          value={ort}
          onChange={(event) => setOrt(event.target.value)}
          placeholder="Keller, Südwestecke"
          className="h-12 w-full rounded-[var(--radius-input)] border border-pebble px-3 text-body"
        />
      </Field>

      <Field label="Mehr dazu">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          className="w-full rounded-[var(--radius-input)] border border-pebble p-3 text-body"
        />
      </Field>

      <FieldGroup
        label="Wie schwer?"
        hint="Wesentlich heißt: Das würde ich so nicht abnehmen. Nur solche Mängel sperren eine Zahlung."
      >
        <div className="flex gap-2">
          <Button
            variant={schwere === 'geringfuegig' ? 'primary' : 'outline'}
            onClick={() => setSchwere('geringfuegig')}
          >
            Geringfügig
          </Button>
          <Button
            variant={schwere === 'wesentlich' ? 'primary' : 'outline'}
            onClick={() => setSchwere('wesentlich')}
          >
            Wesentlich
          </Button>
        </div>
      </FieldGroup>

      <Field label="Gehört zu welchem Vorgang?">
        <select
          value={vorgang}
          onChange={(event) => setVorgang(event.target.value)}
          className="h-12 w-full rounded-[var(--radius-input)] border border-pebble px-3 text-body"
        >
          <option value="">Keinem bestimmten</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="field"
          disabled={busy || titel.trim().length < 3}
          onClick={() =>
            onSave({
              title: titel.trim(),
              severity: schwere,
              ...(text.trim() === '' ? {} : { description: text.trim() }),
              ...(ort.trim() === '' ? {} : { locationText: ort.trim() }),
              ...(vorgang === '' ? {} : { taskId: vorgang }),
            })
          }
        >
          Festhalten
        </Button>
        <Button variant="ghost" size="field" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </Card>
  );
}

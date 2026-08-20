/**
 * Projektdaten: Name und geschuldeter Fertigstellungstermin.
 *
 * Der geschuldete Termin ist die einzige Angabe hier, die rechnet: Aus ihm
 * ergibt sich die Abweichung, und damit die Aussage, die den Bauherren
 * eigentlich interessiert. Deshalb steht er nicht in einem Untermenü.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Field, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { FEDERAL_STATE_LABEL, formatDate } from '../lib/format';
import { useProject } from './ProjectLayout';

const BUILD_TYPE_LABEL: Record<string, string> = {
  efh_massiv: 'Einfamilienhaus, massiv',
  efh_fertighaus: 'Fertighaus',
  sanierung: 'Sanierung',
  sonstiges: 'Sonstiges',
};

const CONTRACT_TYPE_LABEL: Record<string, string> = {
  verbraucherbauvertrag: 'Verbraucherbauvertrag mit einem Generalunternehmer',
  einzelgewerke: 'Einzelgewerke, selbst vergeben',
  sonstiges: 'Sonstiges',
};

export function ProjectSettings() {
  const { projectId, full, can } = useProject();
  const project = full.project;
  const queryClient = useQueryClient();

  const [name, setName] = useState(project.name);
  const [contractual, setContractual] = useState(project.contractualCompletion ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mayEdit = can('contract.write');

  const save = useMutation({
    mutationFn: () =>
      api.patchProject(projectId, {
        name: name.trim(),
        contractualCompletion: contractual === '' ? null : contractual,
      }),
    onSuccess: async () => {
      setSaved(true);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['schedule', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (cause: unknown) => {
      setSaved(false);
      setError(
        cause instanceof ApiError
          ? [cause.message, cause.hint].filter(Boolean).join(' ')
          : 'Das hat nicht geklappt.',
      );
    },
  });

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="display-title text-heading-lg text-charcoal">Projekt</h1>
        <p className="max-w-[34rem] text-body text-steel">
          Was hier steht, hast du beim Anlegen beantwortet. Ändern lässt sich der Name und der
          Termin, den dein Vertrag nennt.
        </p>
      </header>

      <Card className="flex flex-col gap-5">
        <Field label="Name des Bauvorhabens">
          <TextInput
            value={name}
            disabled={!mayEdit}
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
          />
        </Field>

        <Field
          label="Vertraglich geschuldete Fertigstellung"
          hint="Steht im Bauvertrag. Daraus rechnen wir die Abweichung — ohne ihn bleibt sie leer."
        >
          <TextInput
            type="date"
            value={contractual}
            disabled={!mayEdit}
            onChange={(event) => {
              setContractual(event.target.value);
              setSaved(false);
            }}
          />
        </Field>

        {mayEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              size="field"
              disabled={save.isPending || name.trim().length < 2}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Wird gespeichert …' : 'Speichern'}
            </Button>
            {saved ? <span className="text-body text-vivid-green">Gespeichert.</span> : null}
            {error !== null ? <span className="text-body text-alarm-red">{error}</span> : null}
          </div>
        ) : (
          <p className="text-body text-steel">
            Vertragsdaten pflegt der Bauherr. In dieser Rolle liest du sie nur.
          </p>
        )}
      </Card>

      <Card tone="muted" className="flex flex-col gap-3">
        <h2 className="text-subheading font-medium text-charcoal">Aus dem Onboarding</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Line label="Bauweise" value={BUILD_TYPE_LABEL[project.buildType] ?? project.buildType} />
          <Line label="Keller" value={project.hasBasement ? 'mit Keller' : 'ohne Keller'} />
          <Line label="Baubeginn" value={formatDate(project.plannedStart)} />
          <Line
            label="Bundesland"
            value={`${FEDERAL_STATE_LABEL[project.federalState] ?? project.federalState} — bestimmt den Feiertagskalender`}
          />
          <Line
            label="Vergabe"
            value={CONTRACT_TYPE_LABEL[project.contractType] ?? project.contractType}
          />
          <Line label="Deine Rolle" value={project.role} />
        </dl>
        <p className="text-caption text-fog">
          Bauweise, Keller, Baubeginn und Bundesland stecken im gerechneten Plan. Sie hier zu
          ändern hieße, den Plan neu anzulegen — dafür legst du besser ein neues Projekt an.
        </p>
      </Card>
    </>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-steel">{label}</dt>
      <dd className="text-body-lg text-charcoal">{value}</dd>
    </div>
  );
}

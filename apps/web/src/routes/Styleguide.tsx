/**
 * Lebende Gegenprobe zu `meinbaulotse-ci.md`.
 *
 * Was im Dokument steht und hier nicht erscheint, ist nicht umgesetzt.
 */

import { CalendarDays, Camera, ClipboardList, Scale } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Pill,
  SectionPill,
  Select,
  TextInput,
} from '../components/ui';
import { ConfirmationChip, PhaseBar, TaskRow } from '../components/schedule';
import { PlanView } from '../components/PlanView';
import { PLAN_FIXTURE } from './plan-fixture';
import type { PhaseProgress, ScheduledTaskDto } from '@meinbaulotse/shared';

const PHASES: PhaseProgress[] = [
  {
    key: 'vorbereitung',
    name: 'Vorbereitung und Vertrag',
    ordinal: 1,
    taskCount: 3,
    firstStart: '2026-04-01',
    lastEnd: '2026-04-16',
  },
  {
    key: 'gruendung',
    name: 'Gründung und Keller',
    ordinal: 2,
    taskCount: 8,
    firstStart: '2026-04-08',
    lastEnd: '2026-05-20',
  },
  {
    key: 'rohbau',
    name: 'Rohbau',
    ordinal: 3,
    taskCount: 4,
    firstStart: '2026-05-13',
    lastEnd: '2026-06-12',
  },
  {
    key: 'dach_huelle',
    name: 'Dach und Gebäudehülle',
    ordinal: 4,
    taskCount: 4,
    firstStart: '2026-06-15',
    lastEnd: '2026-06-29',
  },
  {
    key: 'rohinstallation',
    name: 'Rohinstallationen',
    ordinal: 5,
    taskCount: 4,
    firstStart: '2026-06-30',
    lastEnd: '2026-07-16',
  },
  {
    key: 'ausbau',
    name: 'Innenausbau',
    ordinal: 6,
    taskCount: 4,
    firstStart: '2026-07-17',
    lastEnd: '2026-09-08',
  },
  {
    key: 'endausbau',
    name: 'Endausbau',
    ordinal: 7,
    taskCount: 7,
    firstStart: '2026-07-29',
    lastEnd: '2026-10-13',
  },
  {
    key: 'aussenanlagen',
    name: 'Außenanlagen',
    ordinal: 8,
    taskCount: 1,
    firstStart: '2026-06-30',
    lastEnd: '2026-07-13',
  },
  {
    key: 'abnahme',
    name: 'Abnahme und Übergabe',
    ordinal: 9,
    taskCount: 3,
    firstStart: '2026-10-14',
    lastEnd: '2026-10-19',
  },
];

function task(overrides: Partial<ScheduledTaskDto>): ScheduledTaskDto {
  return {
    id: crypto.randomUUID(),
    name: 'Estrich',
    phaseKey: 'ausbau',
    tradeCode: 'estrich',
    tradeName: 'Estrich',
    sortOrder: 10,
    isMilestone: false,
    isWait: false,
    durationDays: 3,
    durationUnit: 'werktage',
    currentStart: '2026-07-31',
    currentEnd: '2026-08-04',
    earliestStart: null,
    baselineStart: '2026-07-31',
    baselineEnd: '2026-08-04',
    actualStart: null,
    actualEnd: null,
    status: 'terminiert',
    confirmation: 'self_stated',
    totalFloatDays: 0,
    isCritical: true,
    ...overrides,
  };
}

export function Styleguide() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-16 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="display-title text-display text-charcoal">Gestaltungssystem</h1>
        <p className="max-w-[34rem] text-body-lg text-steel">
          Gegenprobe zu meinbaulotse-ci.md. Kanten statt Schatten, dichte Typografie, vier Akzente
          mit je einer Bedeutung. Rot ist rationiert.
        </p>
      </header>

      <Section title="Typografie">
        <p className="display-title text-display text-charcoal">Display 48 · Satoshi 500</p>
        <p className="display-title text-heading-lg text-charcoal">Heading 36 · Satoshi 500</p>
        <p className="text-heading text-charcoal">Heading 30 · Inter</p>
        <p className="text-heading-sm text-charcoal">Heading 24 · Inter</p>
        <p className="text-subheading text-charcoal">Subheading 20 · Inter</p>
        <p className="text-body-lg text-charcoal">Body 16 — die kanonische Fließtextgröße.</p>
        <p className="text-body text-steel">Body 14 — für dichte Daten und Tabellen.</p>
        <p className="text-caption text-fog">Caption 11 — Mikrobeschriftungen.</p>
        <p className="text-body-lg">
          Zahlen laufen tabellarisch: <span className="font-medium">01.04.2026</span> ·{' '}
          <span className="font-medium">11.11.2026</span> ·{' '}
          <span className="font-medium">30.09.2026</span>
        </p>
      </Section>

      <Section title="Farbe">
        <div className="flex flex-wrap gap-2">
          <Swatch name="Charcoal" className="bg-charcoal" />
          <Swatch name="Steel" className="bg-steel" />
          <Swatch name="Fog" className="bg-fog" />
          <Swatch name="Ash" className="bg-ash" dark />
          <Swatch name="Paper Mist" className="bg-paper-mist" dark />
        </div>
        <div className="flex flex-wrap gap-2">
          <Swatch name="Blau · Termine" className="bg-electric-blue" />
          <Swatch name="Grün · Einigkeit" className="bg-vivid-green" />
          <Swatch name="Tangerine · kümmern" className="bg-tangerine" />
          <Swatch name="Lavender · Wissen" className="bg-lavender" />
          <Swatch name="Rot · heute handeln" className="bg-alarm-red" />
        </div>
        <p className="max-w-[34rem] text-body text-steel">
          Rot erscheint an genau zwei Stellen: eine Entscheidungsfrist ist überschritten, oder ein
          wesentlicher Mangel ist offen. „Zwei Angaben" und Verschiebungen sind Tangerine — ein
          Sachverhalt, kein Alarm.
        </p>
      </Section>

      <Section title="Knöpfe">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Plan erstellen</Button>
          <Button variant="outline">Ansehen</Button>
          <Button variant="ghost">Abbrechen</Button>
          <Button variant="danger">Zurückziehen</Button>
          <Button variant="primary" disabled>
            Nicht möglich
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm">
            Klein 36
          </Button>
          <Button variant="outline" size="md">
            Standard 44
          </Button>
          <Button variant="primary" size="field">
            Feldaktion 56
          </Button>
        </div>
        <p className="text-body text-steel">
          Feldaktionen sind 56 Pixel hoch — die Spezifikation verlangt Bedienbarkeit mit
          Handschuhen.
        </p>
      </Section>

      <Section title="Felder">
        <div className="grid max-w-[34rem] gap-4">
          <Field label="Projektname" hint="Die Adresse der Baustelle reicht.">
            <TextInput placeholder="Musterweg 4" />
          </Field>
          <Field label="Bundesland">
            <Select defaultValue="BY">
              <option value="BY">Bayern</option>
              <option value="NI">Niedersachsen</option>
            </Select>
          </Field>
          <Field label="Baubeginn" error="Bitte gib ein Datum an, damit wir rechnen können.">
            <TextInput type="date" />
          </Field>
        </div>
      </Section>

      <Section title="Bestätigungsgrad">
        <div className="flex flex-wrap gap-2">
          <ConfirmationChip value="self_stated" />
          <ConfirmationChip value="counterparty_stated" />
          <ConfirmationChip value="mutual" confirmedOn="12.05." />
          <ConfirmationChip value="disputed" />
        </div>
        <p className="max-w-[34rem] text-body text-steel">
          Der gefüllte Punkt bedeutet: beide Seiten sind sich einig. Diese Füllung funktioniert auch
          in Graustufen — etwa im gedruckten PDF der Bauakte.
        </p>
      </Section>

      <Section title="Merkmalspillen">
        <div className="flex flex-wrap items-center gap-4">
          <SectionPill tone="blue" icon={<CalendarDays size={18} />}>
            Diese Woche
          </SectionPill>
          <SectionPill tone="amber" icon={<Scale size={18} />}>
            Du musst entscheiden
          </SectionPill>
          <SectionPill tone="violet" icon={<Camera size={18} />}>
            Jetzt fotografieren
          </SectionPill>
          <SectionPill tone="violet" icon={<ClipboardList size={18} />}>
            Lotsenkarte
          </SectionPill>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="neutral">Neutral</Pill>
          <Pill tone="blue">Termin</Pill>
          <Pill tone="green">Fertig</Pill>
          <Pill tone="amber">In 4 Werktagen fällig</Pill>
          <Pill tone="violet">Wissen</Pill>
          <Pill tone="red">Überfällig</Pill>
        </div>
      </Section>

      <Section title="Phasenleiste">
        <Card>
          <PhaseBar phases={PHASES} currentKey="ausbau" />
        </Card>
      </Section>

      <Section title="Vorgangszeilen">
        <Card className="py-0">
          <ul>
            <TaskRow task={task({})} referenceYear={2026} />
            <TaskRow
              task={task({
                name: 'Trocknung bis Belegreife',
                tradeCode: null,
                isWait: true,
                durationUnit: 'kalendertage',
                durationDays: 35,
                currentStart: '2026-08-05',
                currentEnd: '2026-09-08',
              })}
              referenceYear={2026}
            />
            <TaskRow
              task={task({
                name: 'Innentüren',
                tradeCode: 'tischler',
                totalFloatDays: 35,
                isCritical: false,
                confirmation: 'mutual',
                currentStart: '2026-07-29',
                currentEnd: '2026-07-31',
              })}
              referenceYear={2026}
            />
            <TaskRow
              task={task({
                name: 'Abnahme und Übergabe',
                tradeCode: null,
                isMilestone: true,
                durationDays: 0,
                confirmation: 'disputed',
                currentStart: '2026-10-16',
                currentEnd: '2026-10-16',
              })}
              referenceYear={2026}
            />
          </ul>
        </Card>
      </Section>

      {/* Der Fortschritt ist die erste Frage an eine Vorgangsliste — „was ist
          durch?" — und stand vorher nirgends. Vier Zustaende, vier Formen,
          jede mit Text fuer alles, was nicht sehen kann. */}
      <Section title="Fortschritt in der Zeile">
        <Card className="py-0">
          <ul>
            <TaskRow
              task={task({
                name: 'Bodenplatte',
                tradeCode: 'rohbau',
                tradeName: 'Rohbau',
                status: 'fertig',
                confirmation: 'mutual',
                actualStart: '2026-07-31',
                actualEnd: '2026-08-04',
              })}
              referenceYear={2026}
            />
            <TaskRow
              task={task({
                name: 'Erdgeschoss-Mauerwerk',
                tradeCode: 'rohbau',
                tradeName: 'Rohbau',
                status: 'abgenommen',
                confirmation: 'mutual',
                actualStart: '2026-07-31',
                actualEnd: '2026-08-04',
              })}
              referenceYear={2026}
            />
            <TaskRow
              task={task({
                name: 'Dachstuhl',
                tradeCode: 'zimmerer',
                tradeName: 'Zimmerer',
                status: 'laeuft',
                actualStart: '2026-07-31',
              })}
              referenceYear={2026}
            />
            <TaskRow
              task={task({
                name: 'Kaminanschluss',
                tradeCode: 'ofenbau',
                tradeName: 'Ofenbau',
                status: 'entfallen',
              })}
              referenceYear={2026}
            />
          </ul>
        </Card>
      </Section>

      <Section title="Karten und leere Zustände">
        <div className="grid gap-2 sm:grid-cols-2">
          <Card>
            <p className="text-body-lg font-medium text-charcoal">Standardkarte</p>
            <p className="text-body text-steel">Weiß, 1 px Ash, 12 px Radius, kein Schatten.</p>
          </Card>
          <Card tone="muted">
            <p className="text-body-lg font-medium text-charcoal">Eingebettete Fläche</p>
            <p className="text-body text-steel">Paper Mist, 16 px Radius, ohne Rand.</p>
          </Card>
        </div>
        <Card>
          <EmptyState
            text="Noch keine Verschiebungen. Wenn sich ein Termin ändert, steht er hier — mit Grund und Auswirkung auf den Endtermin."
            action={<Button variant="outline">Terminplan ansehen</Button>}
          />
        </Card>
      </Section>

      <Section title="Planübersicht">
        <p className="max-w-[34rem] text-body text-steel">
          Dieselbe Ansicht wie im Projekt, mit fester Datenlage: Baustart 01.04.2026 in Bayern,
          geschuldet der 30.09.2026. Erzeugt aus der Ablaufvorlage und dem Berechnungskern, nicht
          von Hand geschrieben.
        </p>
        <div className="flex flex-col gap-10 rounded-[var(--radius-large)] border border-ash p-6">
          <PlanView schedule={PLAN_FIXTURE} />
        </div>
      </Section>

      <Section title="Tonalität">
        <div className="grid max-w-[46rem] gap-2">
          <Wording wrong="quittiert" right="abgestimmt" />
          <Wording wrong="strittig" right="zwei Angaben" />
          <Wording wrong="Fehler" right="Das hat nicht geklappt" />
          <Wording wrong="Beweisakte" right="Bauakte" />
          <Wording wrong="überfällig seit 3 Tagen" right="seit 3 Werktagen offen" />
        </div>
        <p className="max-w-[34rem] text-caption text-steel">
          Hinweis auf eine Gesetzesstelle, keine Rechtsberatung.
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-heading-sm font-medium text-charcoal">{title}</h2>
      {children}
    </section>
  );
}

function Swatch({ name, className, dark }: { name: string; className: string; dark?: boolean }) {
  return (
    <div
      className={`flex h-20 w-40 items-end rounded-[var(--radius-card)] border border-ash p-3 ${className}`}
    >
      <span className={`text-caption font-medium ${dark ? 'text-charcoal' : 'text-canvas-white'}`}>
        {name}
      </span>
    </div>
  );
}

function Wording({ wrong, right }: { wrong: string; right: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-ash py-2 text-body last:border-b-0">
      <span className="w-56 text-fog line-through">{wrong}</span>
      <span className="font-medium text-charcoal">{right}</span>
    </div>
  );
}

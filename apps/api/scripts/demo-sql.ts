/**
 * Schreibt die Demolage als SQL-Skript für ein Supabase-Projekt.
 *
 * `pnpm demo:seed` braucht eine Verbindung von deinem Rechner aus. Für das
 * Vorführen im Betrieb ist das ein Umweg: Dort gibt es den SQL-Editor im
 * Supabase-Dashboard, und der will eine Datei zum Einfügen. Genau die entsteht
 * hier — dieselbe Vorlage, derselbe Berechnungskern, nur ohne Verbindung.
 *
 * Zwei Eigenschaften, auf die es ankommt:
 *
 * 1. **Wiederholbar.** Alle Kennungen sind fest, jedes `insert` endet auf
 *    `on conflict do nothing`. Ein zweiter Lauf ändert nichts und bricht nicht
 *    ab. Das ist keine Bequemlichkeit: `schedule_change` ist append-only, ein
 *    Aufräumen per `delete` gibt es nicht.
 * 2. **Es schreibt als Bauherr, nicht als Datenbankeigentümer.** Das Skript
 *    setzt den JWT-Claim und wechselt auf die Rolle `authenticated`. Damit
 *    laufen dieselben Policies wie im Betrieb, und die Historie nennt einen
 *    Verursacher statt einer Leerstelle.
 *
 * Es entstehen **zwei** Bauvorhaben, und der Unterschied ist Absicht. An einem
 * einzigen Projekt bleiben ganze Teile der Oberfläche unsichtbar: Die
 * Phasenleiste steht am Anfang, weil der Bau erst beginnt; die Abweichung ist
 * rot, weil es nur den einen Fall gibt; jeder Vorgang trägt dasselbe Grau.
 * Das zweite Bauvorhaben ist deshalb der Gegenentwurf zum ersten — anderes
 * Bundesland, kein Keller, Baustart in der Vergangenheit, ein Vertragstermin
 * mit Luft und Bestätigungsgrade in allen vier Sorten.
 *
 * Aufruf: `pnpm demo:sql`
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSchedule,
  criticalPath,
  EFH_MASSIV_UNTERKELLERT,
  instantiateTemplate,
  workdayOffset,
  type Calendar,
} from '@meinbaulotse/schedule';
import { DEMO_IDENTITIES } from '../src/demo.js';

/** Ein Bauvorhaben der Demolage, so weit es sich vom Rest unterscheidet. */
interface ProjectDefinition {
  readonly id: string;
  readonly name: string;
  readonly federalState: 'BY' | 'NI';
  readonly catholicMunicipality: boolean;
  readonly contractType: 'verbraucherbauvertrag' | 'einzelgewerke';
  readonly hasBasement: boolean;
  readonly memberId: { readonly bauherr: string; readonly gu: string };
  /** Baustart in Kalendertagen ab heute, dann vor auf den nächsten Montag. */
  readonly startsInDays: number;
  /** Der geschuldete Termin, sobald der Plan gerechnet ist. */
  readonly contractualEnd: (start: string, computedEnd: string, calendar: Calendar) => string;
  /**
   * Bestätigungsgrade streuen statt überall `self_stated`. Nur so zeigt die
   * Planansicht alle vier Farben nebeneinander.
   */
  readonly scatterConfirmation: boolean;
  /**
   * Ist-Termine und Status für alles setzen, was heute schon vorbei ist oder
   * läuft. Die Ansicht zeigt beides noch nicht — die Daten sollen aber
   * stimmen, sobald sie es tut.
   */
  readonly trackProgress: boolean;
  /** Kennungsbereich der Vorgänge und Abhängigkeiten. Muss sich nicht überschneiden. */
  readonly idOffset: number;
  /** Ein Satz für den Kopf des Abschnitts. */
  readonly note: string;
}

const PROJECTS: readonly ProjectDefinition[] = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Musterhaus Sonnenweg',
    federalState: 'BY',
    catholicMunicipality: true,
    contractType: 'verbraucherbauvertrag',
    hasBasement: true,
    memberId: {
      bauherr: 'bbbbbbbb-0000-4000-8000-000000000001',
      gu: 'bbbbbbbb-0000-4000-8000-000000000002',
    },
    startsInDays: 28,
    // Ein halbes Jahr ab Baustart, rund gegriffen wie im Vertrag. Der
    // gerechnete Plan reißt ihn — damit oben eine echte Abweichung steht und
    // nicht die beruhigende Null.
    contractualEnd: (start) => plusDays(start, 180),
    scatterConfirmation: false,
    trackProgress: false,
    idOffset: 0,
    note: 'Der Bau beginnt erst. Der Vertragstermin ist knapp, der Plan reißt ihn.',
  },
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000002',
    name: 'Stadthaus Ahornweg',
    federalState: 'NI',
    catholicMunicipality: false,
    contractType: 'einzelgewerke',
    hasBasement: false,
    memberId: {
      bauherr: 'bbbbbbbb-0000-4000-8000-000000000003',
      gu: 'bbbbbbbb-0000-4000-8000-000000000004',
    },
    startsInDays: -56,
    // Zwanzig Werktage hinter dem errechneten Ende: Dann steht oben „20
    // Werktage früher" in Grün. Die Oberfläche wählt den Ton allein am
    // Vorzeichen (`deviationWorkdays > 0 ? 'warn' : 'ok'`).
    contractualEnd: (_start, computedEnd, calendar) => workdayOffset(computedEnd, 20, calendar),
    scatterConfirmation: true,
    trackProgress: true,
    idOffset: 100,
    note: 'Seit acht Wochen auf der Baustelle. Der Plan liegt vor dem Vertragstermin.',
  },
];

/** Feste Kennungen statt `gen_random_uuid()`: nur so ist das Skript wiederholbar. */
function taskId(project: ProjectDefinition, index: number): string {
  return `cccccccc-0000-4000-8000-${String(project.idOffset + index + 1).padStart(12, '0')}`;
}

function dependencyId(project: ProjectDefinition, index: number): string {
  return `dddddddd-0000-4000-8000-${String(project.idOffset + index + 1).padStart(12, '0')}`;
}

const TODAY = new Date().toISOString().slice(0, 10);

/** Baustart: `offsetDays` Kalendertage ab heute, dann vor auf den nächsten Montag. */
function plannedStart(offsetDays: number): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + offsetDays);
  while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

function plusDays(isoDate: string, days: number): string {
  const day = new Date(`${isoDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** SQL-Literal. Hochkommata verdoppeln, `null` bleibt `null`. */
function lit(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Ein paar Bestätigungsgrade streuen, damit alle vier Sorten im Bild sind —
 * dieselbe Streuung wie in der Styleguide-Vorlage
 * (`apps/web/scripts/make-plan-fixture.ts`).
 */
function confirmationFor(index: number): string {
  if (index % 7 === 0) return 'mutual';
  if (index % 11 === 0) return 'disputed';
  if (index % 5 === 0) return 'counterparty_stated';
  return 'self_stated';
}

/** Was heute vorbei ist, ist fertig; was angefangen hat, läuft. */
function progressFor(
  start: string,
  end: string,
): { status: string; actualStart: string | null; actualEnd: string | null } {
  if (end < TODAY) return { status: 'fertig', actualStart: start, actualEnd: end };
  if (start <= TODAY) return { status: 'laeuft', actualStart: start, actualEnd: null };
  return { status: 'terminiert', actualStart: null, actualEnd: null };
}

const bauherr = DEMO_IDENTITIES.bauherr;
const gu = DEMO_IDENTITIES.gu;

const claims = JSON.stringify({
  sub: bauherr.userId,
  role: 'authenticated',
  email: bauherr.email,
});

interface RenderedProject {
  readonly definition: ProjectDefinition;
  readonly start: string;
  readonly computedEnd: string;
  readonly contractualEnd: string;
  readonly taskCount: number;
  readonly dependencyCount: number;
  readonly sql: string;
}

function render(project: ProjectDefinition, ordinal: number): RenderedProject {
  const start = plannedStart(project.startsInDays);
  const calendar: Calendar = {
    federalState: project.federalState,
    catholicMunicipality: project.catholicMunicipality,
  };

  const plan = instantiateTemplate(EFH_MASSIV_UNTERKELLERT, { hasBasement: project.hasBasement });
  const schedule = computeSchedule({
    tasks: plan.tasks,
    dependencies: plan.dependencies,
    calendar,
    projectStart: start,
  });
  const contractualEnd = project.contractualEnd(start, schedule.projectEnd, calendar);
  const floats = criticalPath({
    tasks: plan.tasks,
    dependencies: plan.dependencies,
    calendar,
    schedule,
    floatsAgainst: 'plan',
    contractualEnd,
  });

  // Die Abhängigkeiten der Vorlage zeigen auf die Kennungen der Vorgänge, nicht
  // auf ihre Codes. Beide sind hier gleich, aber darauf verlässt sich das Skript
  // nicht — es schlägt über dieselbe Kennung nach wie `onboarding.ts`.
  const sqlIdByPlanId = new Map(plan.tasks.map((task, index) => [task.id, taskId(project, index)]));

  const taskRows = plan.tasks.map((task, index) => {
    const scheduled = schedule.tasks.get(task.id)!;
    const float = floats.floats.get(task.id);
    const trade =
      task.tradeCode === undefined
        ? 'null'
        : `(select id from public.trade where code = ${lit(task.tradeCode)} and project_id is null)`;
    const confirmation = project.scatterConfirmation ? confirmationFor(index) : 'self_stated';
    const progress = project.trackProgress
      ? progressFor(scheduled.start, scheduled.end)
      : { status: 'terminiert', actualStart: null, actualEnd: null };
    return (
      `  (${lit(taskId(project, index))}, ${lit(project.id)}, ${trade}, ${lit(task.name)}, ` +
      `${lit(task.phaseKey)}, ${lit(task.code)}, ${lit(task.sortOrder)}, ` +
      `${lit(task.isMilestone ?? false)}, ${lit(task.isWait ?? false)}, ` +
      `${lit(task.durationDays)}, ${lit(task.durationUnit ?? 'werktage')}::mbl.duration_unit, ` +
      `${lit(scheduled.start)}, ${lit(scheduled.end)}, ${lit(scheduled.start)}, ${lit(scheduled.end)}, ` +
      `${lit(progress.actualStart)}, ${lit(progress.actualEnd)}, ` +
      `${lit(progress.status)}::mbl.task_status, ${lit(confirmation)}::mbl.confirmation, ` +
      `${lit(float?.totalFloatDays ?? null)}, ${lit(float?.isCritical ?? false)})`
    );
  });

  const dependencyRows = plan.dependencies.map((dependency, index) => {
    const predecessor = sqlIdByPlanId.get(dependency.predecessorId)!;
    const successor = sqlIdByPlanId.get(dependency.successorId)!;
    return (
      `  (${lit(dependencyId(project, index))}, ${lit(project.id)}, ${lit(predecessor)}, ${lit(successor)}, ` +
      `${lit(dependency.type ?? 'FS')}::mbl.dependency_type, ${lit(dependency.lagDays ?? 0)}, ` +
      `${lit(dependency.lagUnit ?? 'werktage')}::mbl.duration_unit)`
    );
  });

  const meta = JSON.stringify({
    template: EFH_MASSIV_UNTERKELLERT.key,
    hasBasement: project.hasBasement,
    taskCount: plan.tasks.length,
  });

  const sql = `-- ===========================================================================
-- Bauvorhaben ${ordinal} von ${PROJECTS.length}: ${project.name}
--
-- ${project.note}
-- Baustart ${start}, errechnetes Ende ${schedule.projectEnd},
-- geschuldet ${contractualEnd}, ${plan.tasks.length} Vorgänge.
-- ===========================================================================

insert into public.project (
  id, name, federal_state, catholic_municipality, build_type, contract_type,
  has_basement, plan_template_key, planned_start, contractual_completion, created_by
)
values (
  ${lit(project.id)}, ${lit(project.name)}, ${lit(project.federalState)}::mbl.federal_state,
  ${lit(project.catholicMunicipality)}, 'efh_massiv'::mbl.build_type,
  ${lit(project.contractType)}::mbl.contract_type, ${lit(project.hasBasement)},
  ${lit(EFH_MASSIV_UNTERKELLERT.key)}, ${lit(start)}, ${lit(contractualEnd)},
  ${lit(bauherr.userId)}
)
on conflict do nothing;

-- Die Beteiligten. Der Bauherr zuerst: Erst mit seiner Zeile greift sein
-- Schreibrecht, und erst dadurch darf er den Generalunternehmer eintragen.

insert into public.project_member (
  id, project_id, user_id, role, display_name, company, email, accepted_at
)
values (
  ${lit(project.memberId.bauherr)}, ${lit(project.id)}, ${lit(bauherr.userId)},
  'owner'::mbl.member_role, ${lit(bauherr.displayName)}, ${lit(bauherr.company)},
  ${lit(bauherr.email)}, now()
)
on conflict do nothing;

insert into public.project_member (
  id, project_id, user_id, role, display_name, company, email, accepted_at
)
values (
  ${lit(project.memberId.gu)}, ${lit(project.id)}, ${lit(gu.userId)},
  'contractor'::mbl.member_role, ${lit(gu.displayName)}, ${lit(gu.company)},
  ${lit(gu.email)}, now()
)
on conflict do nothing;

-- Die Vorgänge, fertig gerechnet. Termine und Puffer kommen aus
-- packages/schedule — hier steht nur das Ergebnis. Der Trigger
-- task_log_change schreibt zu jeder Zeile einen Eintrag in schedule_change.

insert into public.task (
  id, project_id, trade_id, name, phase_key, template_task_code, sort_order,
  is_milestone, is_wait, duration_days, duration_unit,
  baseline_start, baseline_end, current_start, current_end,
  actual_start, actual_end,
  status, confirmation, total_float_days, is_critical
)
values
${taskRows.join(',\n')}
on conflict do nothing;

-- Die Abhängigkeiten zwischen den Vorgängen.

insert into public.dependency (
  id, project_id, predecessor_id, successor_id, type, lag_days, lag_unit
)
values
${dependencyRows.join(',\n')}
on conflict do nothing;

-- Der Protokolleintrag zum Projektstart, wie ihn das Onboarding schreibt.

insert into public.audit_log (project_id, actor_channel, action, entity_type, entity_id, meta)
select ${lit(project.id)}, 'import'::mbl.actor_channel, 'project.created', 'project',
       ${lit(project.id)}, ${lit(meta)}::jsonb
where not exists (
  select 1 from public.audit_log
  where project_id = ${lit(project.id)} and action = 'project.created'
);
`;

  return {
    definition: project,
    start,
    computedEnd: schedule.projectEnd,
    contractualEnd,
    taskCount: plan.tasks.length,
    dependencyCount: plan.dependencies.length,
    sql,
  };
}

const rendered = PROJECTS.map((project, index) => render(project, index + 1));

const overview = rendered
  .map(
    (entry) =>
      `--   ${entry.definition.name} — Baustart ${entry.start}, ` +
      `${entry.taskCount} Vorgänge, geschuldet ${entry.contractualEnd}`,
  )
  .join('\n');

const projectIds = rendered.map((entry) => lit(entry.definition.id)).join(', ');

const sql = `-- MeinBaulotse — Demolage für den Testzugang
--
-- Erzeugt von apps/api/scripts/demo-sql.ts. Nicht von Hand bearbeiten;
-- für einen neuen Baustart \`pnpm demo:sql\` erneut aufrufen.
--
-- Einzufügen im Supabase-Dashboard unter SQL Editor → New query → Run.
-- Voraussetzung: Die Migrationen aus supabase/migrations sind eingespielt.
--
-- Das Skript ist wiederholbar. Es legt an, was fehlt, und lässt stehen, was da
-- ist. Gelöscht wird nichts — \`schedule_change\` ist append-only. Wer es ein
-- zweites Mal laufen lässt, bekommt also das, was ihm noch fehlt, und behält
-- alles Übrige unverändert.
--
-- Zwei Bauvorhaben, beide mit demselben Bauherrn und demselben GU:
${overview}

-- ---------------------------------------------------------------------------
-- 1. Die beiden Demo-Nutzer.
--
-- Bewusst nur Kennung und Adresse: Diese Nutzer melden sich nie über Supabase
-- Auth an, sondern über den Testzugang der Anwendung (/demo). Die Zeilen
-- existieren, weil project_member.user_id auf auth.users verweist.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email)
values
  (${lit(bauherr.userId)}, ${lit(bauherr.email)}),
  (${lit(gu.userId)}, ${lit(gu.email)})
on conflict do nothing;

-- Auf Supabase hat auth.users mehr Spalten als die lokale Nachbildung. Wo es
-- sie gibt, werden sie gefüllt, damit die Zeilen im Dashboard sauber aussehen.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'users' and column_name = 'aud'
  ) then
    update auth.users
       set aud = 'authenticated',
           role = 'authenticated',
           email_confirmed_at = coalesce(email_confirmed_at, now())
     where id in (${lit(bauherr.userId)}, ${lit(gu.userId)});
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Ab hier schreibt der Bauherr, nicht der Datenbankeigentümer.
--
-- Damit greifen dieselben Policies wie im Betrieb, und die Historie in
-- schedule_change nennt ihn als Verursacher.
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', ${lit(claims)}, false);
select set_config('role', 'authenticated', false);
select set_config('app.actor_channel', 'import', false);

${rendered.map((entry) => entry.sql).join('\n')}
-- ---------------------------------------------------------------------------
-- Gegenprobe.
-- ---------------------------------------------------------------------------

select p.name                                                                  as bauvorhaben,
       (select count(*) from public.project_member m where m.project_id = p.id) as beteiligte,
       (select count(*) from public.task t        where t.project_id = p.id)    as vorgaenge,
       (select count(*) from public.dependency d  where d.project_id = p.id)    as abhaengigkeiten,
       (select max(t.current_end) from public.task t where t.project_id = p.id) as errechnetes_ende,
       p.contractual_completion                                                 as geschuldet
  from public.project p
 where p.id in (${projectIds})
 order by p.planned_start;

reset role;
`;

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', '..', '..', 'docs', 'demo-seed.sql');
writeFileSync(target, sql, 'utf8');

console.log(`Skript geschrieben: ${target}`);
for (const entry of rendered) {
  console.log(
    `  ${entry.definition.name}: ${entry.taskCount} Vorgänge, ` +
      `${entry.dependencyCount} Abhängigkeiten, Baustart ${entry.start}, ` +
      `Ende ${entry.computedEnd}, geschuldet ${entry.contractualEnd}.`,
  );
}

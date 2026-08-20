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
  type Calendar,
} from '@meinbaulotse/schedule';
import { DEMO_IDENTITIES } from '../src/demo.js';

const PROJECT_NAME = 'Musterhaus Sonnenweg';
const PROJECT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEMBER_ID = {
  bauherr: 'bbbbbbbb-0000-4000-8000-000000000001',
  gu: 'bbbbbbbb-0000-4000-8000-000000000002',
};

/** Feste Kennungen statt `gen_random_uuid()`: nur so ist das Skript wiederholbar. */
function taskId(index: number): string {
  return `cccccccc-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function dependencyId(index: number): string {
  return `dddddddd-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function plannedStart(): string {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 28);
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

const START = plannedStart();
const CONTRACTUAL_END = plusDays(START, 180);
const calendar: Calendar = { federalState: 'BY', catholicMunicipality: true };

const plan = instantiateTemplate(EFH_MASSIV_UNTERKELLERT, { hasBasement: true });
const schedule = computeSchedule({
  tasks: plan.tasks,
  dependencies: plan.dependencies,
  calendar,
  projectStart: START,
});
const floats = criticalPath({
  tasks: plan.tasks,
  dependencies: plan.dependencies,
  calendar,
  schedule,
  floatsAgainst: 'plan',
  contractualEnd: CONTRACTUAL_END,
});

// Die Abhängigkeiten der Vorlage zeigen auf die Kennungen der Vorgänge, nicht
// auf ihre Codes. Beide sind hier gleich, aber darauf verlässt sich das Skript
// nicht — es schlägt über dieselbe Kennung nach wie `onboarding.ts`.
const sqlIdByPlanId = new Map(plan.tasks.map((task, index) => [task.id, taskId(index)]));

const bauherr = DEMO_IDENTITIES.bauherr;
const gu = DEMO_IDENTITIES.gu;

const claims = JSON.stringify({
  sub: bauherr.userId,
  role: 'authenticated',
  email: bauherr.email,
});

const taskRows = plan.tasks.map((task, index) => {
  const scheduled = schedule.tasks.get(task.id)!;
  const float = floats.floats.get(task.id);
  const trade =
    task.tradeCode === undefined
      ? 'null'
      : `(select id from public.trade where code = ${lit(task.tradeCode)} and project_id is null)`;
  return (
    `  (${lit(taskId(index))}, ${lit(PROJECT_ID)}, ${trade}, ${lit(task.name)}, ` +
    `${lit(task.phaseKey)}, ${lit(task.code)}, ${lit(task.sortOrder)}, ` +
    `${lit(task.isMilestone ?? false)}, ${lit(task.isWait ?? false)}, ` +
    `${lit(task.durationDays)}, ${lit(task.durationUnit ?? 'werktage')}::mbl.duration_unit, ` +
    `${lit(scheduled.start)}, ${lit(scheduled.end)}, ${lit(scheduled.start)}, ${lit(scheduled.end)}, ` +
    `'terminiert'::mbl.task_status, 'self_stated'::mbl.confirmation, ` +
    `${lit(float?.totalFloatDays ?? null)}, ${lit(float?.isCritical ?? false)})`
  );
});

const dependencyRows = plan.dependencies.map((dependency, index) => {
  const predecessor = sqlIdByPlanId.get(dependency.predecessorId)!;
  const successor = sqlIdByPlanId.get(dependency.successorId)!;
  return (
    `  (${lit(dependencyId(index))}, ${lit(PROJECT_ID)}, ${lit(predecessor)}, ${lit(successor)}, ` +
    `${lit(dependency.type ?? 'FS')}::mbl.dependency_type, ${lit(dependency.lagDays ?? 0)}, ` +
    `${lit(dependency.lagUnit ?? 'werktage')}::mbl.duration_unit)`
  );
});

const sql = `-- MeinBaulotse — Demolage für den Testzugang
--
-- Erzeugt von apps/api/scripts/demo-sql.ts. Nicht von Hand bearbeiten;
-- für einen neuen Baustart \`pnpm demo:sql\` erneut aufrufen.
--
-- Einzufügen im Supabase-Dashboard unter SQL Editor → New query → Run.
-- Voraussetzung: Die Migrationen aus supabase/migrations sind eingespielt.
--
-- Das Skript ist wiederholbar. Es legt an, was fehlt, und lässt stehen, was da
-- ist. Gelöscht wird nichts — \`schedule_change\` ist append-only.
--
-- Baustart ${START}, geschuldet ${CONTRACTUAL_END}, ${plan.tasks.length} Vorgänge.

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

-- ---------------------------------------------------------------------------
-- 3. Das Bauvorhaben.
-- ---------------------------------------------------------------------------

insert into public.project (
  id, name, federal_state, catholic_municipality, build_type, contract_type,
  has_basement, plan_template_key, planned_start, contractual_completion, created_by
)
values (
  ${lit(PROJECT_ID)}, ${lit(PROJECT_NAME)}, 'BY'::mbl.federal_state, true,
  'efh_massiv'::mbl.build_type, 'verbraucherbauvertrag'::mbl.contract_type, true,
  ${lit(EFH_MASSIV_UNTERKELLERT.key)}, ${lit(START)}, ${lit(CONTRACTUAL_END)},
  ${lit(bauherr.userId)}
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Die Beteiligten.
--
-- Der Bauherr zuerst: Erst mit seiner Zeile greift sein Schreibrecht, und erst
-- dadurch darf er den Generalunternehmer eintragen.
-- ---------------------------------------------------------------------------

insert into public.project_member (
  id, project_id, user_id, role, display_name, company, email, accepted_at
)
values (
  ${lit(MEMBER_ID.bauherr)}, ${lit(PROJECT_ID)}, ${lit(bauherr.userId)},
  'owner'::mbl.member_role, ${lit(bauherr.displayName)}, ${lit(bauherr.company)},
  ${lit(bauherr.email)}, now()
)
on conflict do nothing;

insert into public.project_member (
  id, project_id, user_id, role, display_name, company, email, accepted_at
)
values (
  ${lit(MEMBER_ID.gu)}, ${lit(PROJECT_ID)}, ${lit(gu.userId)},
  'contractor'::mbl.member_role, ${lit(gu.displayName)}, ${lit(gu.company)},
  ${lit(gu.email)}, now()
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. Die Vorgänge, fertig gerechnet.
--
-- Termine und Puffer kommen aus packages/schedule — hier steht nur das
-- Ergebnis. Der Trigger task_log_change schreibt zu jeder Zeile einen Eintrag
-- in schedule_change.
-- ---------------------------------------------------------------------------

insert into public.task (
  id, project_id, trade_id, name, phase_key, template_task_code, sort_order,
  is_milestone, is_wait, duration_days, duration_unit,
  baseline_start, baseline_end, current_start, current_end,
  status, confirmation, total_float_days, is_critical
)
values
${taskRows.join(',\n')}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. Die Abhängigkeiten zwischen den Vorgängen.
-- ---------------------------------------------------------------------------

insert into public.dependency (
  id, project_id, predecessor_id, successor_id, type, lag_days, lag_unit
)
values
${dependencyRows.join(',\n')}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Der Protokolleintrag zum Projektstart, wie ihn das Onboarding schreibt.
-- ---------------------------------------------------------------------------

insert into public.audit_log (project_id, actor_channel, action, entity_type, entity_id, meta)
select ${lit(PROJECT_ID)}, 'import'::mbl.actor_channel, 'project.created', 'project',
       ${lit(PROJECT_ID)}, ${lit(JSON.stringify({ template: EFH_MASSIV_UNTERKELLERT.key, hasBasement: true, taskCount: plan.tasks.length }))}::jsonb
where not exists (
  select 1 from public.audit_log
  where project_id = ${lit(PROJECT_ID)} and action = 'project.created'
);

-- ---------------------------------------------------------------------------
-- 8. Gegenprobe.
-- ---------------------------------------------------------------------------

select
  (select name from public.project where id = ${lit(PROJECT_ID)})                       as bauvorhaben,
  (select count(*) from public.project_member where project_id = ${lit(PROJECT_ID)})    as beteiligte,
  (select count(*) from public.task where project_id = ${lit(PROJECT_ID)})              as vorgaenge,
  (select count(*) from public.dependency where project_id = ${lit(PROJECT_ID)})        as abhaengigkeiten,
  (select max(current_end) from public.task where project_id = ${lit(PROJECT_ID)})      as errechnetes_ende;

reset role;
`;

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', '..', '..', 'docs', 'demo-seed.sql');
writeFileSync(target, sql, 'utf8');

console.log(`Skript geschrieben: ${target}`);
console.log(
  `  ${plan.tasks.length} Vorgänge, ${plan.dependencies.length} Abhängigkeiten, ` +
    `Baustart ${START}, Ende ${schedule.projectEnd}, geschuldet ${CONTRACTUAL_END}.`,
);

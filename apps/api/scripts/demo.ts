/**
 * Legt die Demolage an: zwei feste Nutzer, ein durchgerechnetes Projekt, beide
 * Rollen darin.
 *
 * Das Skript ist wiederholbar, aber es überschreibt nichts. Steht die Demolage
 * schon, wird sie gemeldet und höchstens die Mitgliedschaft des GU ergänzt.
 *
 * Löschen wäre auch gar nicht möglich: An einem Projekt hängt seine
 * `schedule_change`-Historie, und die ist append-only — der Trigger weist ein
 * `delete` ab. Für einen frischen Plan setzt du die lokale Datenbank zurück
 * (`pnpm db:reset`) und rufst das Skript danach erneut auf.
 *
 * Wer welche Rolle bekommt, folgt der Rechtematrix aus Abschnitt 2.1 der
 * Spezifikation: Das Projekt gehört dem **Bauherrn** (`owner`), der
 * Generalunternehmer ist `contractor`. Deshalb legt hier auch der Bauherr das
 * Projekt an — der GU dürfte es gar nicht.
 *
 * Aufruf: `pnpm demo:seed`
 */

import '../src/env.js';
import {
  closePool,
  withAdminTx,
  withUserTx,
  type JwtClaims,
  type Transaction,
} from '@meinbaulotse/db';
import { DEMO_IDENTITIES, demoLoginKey, type DemoIdentity } from '../src/demo.js';
import { createProjectFromAnswers } from '../src/onboarding.js';

const PROJECT_NAME = 'Musterhaus Sonnenweg';

function claimsFor(identity: DemoIdentity): JwtClaims {
  return { sub: identity.userId, email: identity.email, name: identity.displayName };
}

/**
 * Der Baustart liegt vier Wochen voraus und fällt auf einen Montag — so sieht
 * der Plan aus wie ein Plan und nicht wie eine Nachlese.
 */
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

async function ensureUsers(): Promise<void> {
  await withAdminTx(async (tx) => {
    for (const identity of Object.values(DEMO_IDENTITIES)) {
      await tx.query(
        `insert into auth.users (id, email) values ($1, $2)
         on conflict do nothing`,
        [identity.userId, identity.email],
      );
    }
  });
}

/**
 * Trägt den GU als `contractor` ein, falls er noch nicht drinsteht. Erlaubt ist
 * das dem Bauherrn über `member.invite` — genau die Policy, die später auch die
 * echte Einladung tragen wird.
 */
async function ensureContractor(tx: Transaction, projectId: string): Promise<void> {
  const gu = DEMO_IDENTITIES.gu;
  const present = await tx.query(
    'select 1 from project_member where project_id = $1 and user_id = $2 and revoked_at is null',
    [projectId, gu.userId],
  );
  if (present.rowCount !== null && present.rowCount > 0) return;

  await tx.query(
    `insert into project_member (project_id, user_id, role, display_name, company, email, accepted_at)
     values ($1, $2, 'contractor', $3, $4, $5, now())`,
    [projectId, gu.userId, gu.displayName, gu.company, gu.email],
  );
}

async function main(): Promise<void> {
  const bauherr = DEMO_IDENTITIES.bauherr;
  const gu = DEMO_IDENTITIES.gu;

  try {
    await ensureUsers();
  } catch (error) {
    console.error(
      'Die Demo-Nutzer ließen sich nicht anlegen.\n' +
        'Gegen ein Supabase-Projekt ist das erwartbar: Lege die beiden Nutzer dort\n' +
        'unter Authentication → Users von Hand an (Auto Confirm), und zwar mit genau\n' +
        'diesen Kennungen und Adressen:\n' +
        `  ${bauherr.userId}  ${bauherr.email}\n` +
        `  ${gu.userId}  ${gu.email}\n`,
    );
    throw error;
  }

  const start = plannedStart();

  const outcome = await withUserTx(claimsFor(bauherr), async (tx) => {
    const existing = await tx.query<{ id: string }>(
      'select id from project where name = $1 and created_by = $2 limit 1',
      [PROJECT_NAME, bauherr.userId],
    );
    const known = existing.rows[0];
    if (known !== undefined) {
      await ensureContractor(tx, known.id);
      return { created: null };
    }

    const created = await createProjectFromAnswers(tx, claimsFor(bauherr), {
      name: PROJECT_NAME,
      buildType: 'efh_massiv',
      hasBasement: true,
      plannedStart: start,
      federalState: 'BY',
      contractType: 'verbraucherbauvertrag',
      // Knapp gerechnet: Der Plan läuft dem Vertrag um gut zwei Wochen davon.
      // So zeigt das Cockpit eine echte Abweichung und nicht die beruhigende Null,
      // an der sich nichts prüfen lässt.
      contractualCompletion: plusDays(start, 180),
      catholicMunicipality: true,
    });

    await ensureContractor(tx, created.projectId);
    return { created };
  });

  const key = demoLoginKey();
  const created = outcome.created;

  if (created === null) {
    console.log(`\nDie Demolage „${PROJECT_NAME}" steht bereits — nichts angefasst.`);
    console.log('  Für einen frischen Plan: pnpm db:reset && pnpm demo:seed');
  } else {
    console.log(`\nDemolage steht: „${PROJECT_NAME}"`);
    console.log(`  Baustart ${start}, ${created.taskCount} Vorgänge, Ende ${created.computedEnd}`);
    console.log(
      `  Abweichung zum Vertrag: ${
        created.deviationWorkdays === null ? '—' : `${created.deviationWorkdays} Werktage`
      }`,
    );
  }

  console.log(`  ${bauherr.label}: ${bauherr.displayName} (owner)`);
  console.log(`  ${gu.label}: ${gu.displayName} (contractor)`);

  if (key === null) {
    console.log('\nFür die Anmeldung fehlt noch DEMO_LOGIN_KEY in der .env — siehe docs/DEMO.md.');
  } else {
    console.log(`\nAnmelden unter:  http://localhost:5173/demo?key=${encodeURIComponent(key)}`);
  }
}

main()
  .then(() => closePool())
  .catch(async (error: unknown) => {
    await closePool();
    console.error(error);
    process.exit(1);
  });

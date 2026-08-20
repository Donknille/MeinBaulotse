/**
 * Verträge zwischen Web und API.
 *
 * Ein Zod-Schema je Anfrage und Antwort, geteilt von beiden Seiten. Damit
 * kann die Oberfläche nicht auf Felder zugreifen, die die API nicht liefert,
 * und die API keine Eingaben annehmen, die die Oberfläche nie sendet.
 */

import { z } from 'zod';
import { FEDERAL_STATES } from '@meinbaulotse/schedule';
import { memberRole } from './roles.js';

export { memberRole };

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT erwartet');

export const federalState = z.enum(FEDERAL_STATES);
export const buildType = z.enum(['efh_massiv', 'efh_fertighaus', 'sanierung', 'sonstiges']);
export const contractType = z.enum(['verbraucherbauvertrag', 'einzelgewerke', 'sonstiges']);
export const durationUnit = z.enum(['werktage', 'kalendertage']);
export const taskStatus = z.enum([
  'geplant',
  'terminiert',
  'bestaetigt',
  'laeuft',
  'fertig',
  'abgenommen',
  'verschoben',
  'entfallen',
]);
export const confirmationLevel = z.enum([
  'self_stated',
  'counterparty_stated',
  'mutual',
  'disputed',
]);

/**
 * Die fünf Onboarding-Fragen aus der Abnahme von AP 1.
 * Mehr wird nicht gefragt — alles Weitere ergibt sich aus der Ablaufvorlage.
 */
export const onboardingRequest = z.object({
  /** Frage 0, nicht gezählt: Wie soll das Projekt heißen? */
  name: z.string().trim().min(2).max(120),
  /** Frage 1: Bauweise */
  buildType,
  /** Frage 2: Keller ja oder nein */
  hasBasement: z.boolean(),
  /** Frage 3: geplanter Baustart */
  plannedStart: isoDate,
  /** Frage 4: Bundesland — bestimmt den Feiertagskalender */
  federalState,
  /** Frage 5: Generalunternehmer oder Einzelgewerke */
  contractType,
  /** Optional, aus dem Vertrag: geschuldeter Fertigstellungstermin */
  contractualCompletion: isoDate.optional(),
  /** Überwiegend katholische Gemeinde — betrifft drei Feiertage */
  catholicMunicipality: z.boolean().optional(),
});
export type OnboardingRequest = z.infer<typeof onboardingRequest>;

export const projectSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  federalState,
  buildType,
  contractType,
  hasBasement: z.boolean(),
  plannedStart: isoDate,
  contractualCompletion: isoDate.nullable(),
  /** Die eigene Rolle in diesem Projekt. */
  role: memberRole,
  /** Die eigene Mitgliedszeile — Bezugspunkt für Bestätigungen. */
  memberId: z.string().uuid().nullable(),
  /**
   * Was der Anrufer in diesem Projekt darf, gelesen aus `role_permission`.
   * Die Oberfläche blendet danach Knöpfe ein und aus; die Entscheidung selbst
   * trifft weiterhin die Datenbank.
   */
  permissions: z.array(z.string()),
  /** Nur gesetzt für `trade`: das Gewerk, auf das die Sicht beschränkt ist. */
  tradeId: z.string().uuid().nullable(),
});
export type ProjectSummary = z.infer<typeof projectSummary>;

export const scheduledTask = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phaseKey: z.string(),
  tradeCode: z.string().nullable(),
  tradeName: z.string().nullable(),
  sortOrder: z.number().int(),
  isMilestone: z.boolean(),
  isWait: z.boolean(),
  durationDays: z.number().int(),
  durationUnit,
  currentStart: isoDate.nullable(),
  currentEnd: isoDate.nullable(),
  baselineStart: isoDate.nullable(),
  baselineEnd: isoDate.nullable(),
  actualStart: isoDate.nullable(),
  actualEnd: isoDate.nullable(),
  status: taskStatus,
  confirmation: confirmationLevel,
  totalFloatDays: z.number().int().nullable(),
  isCritical: z.boolean(),
});
export type ScheduledTaskDto = z.infer<typeof scheduledTask>;

export const phaseProgress = z.object({
  key: z.string(),
  name: z.string(),
  ordinal: z.number().int(),
  taskCount: z.number().int(),
  firstStart: isoDate.nullable(),
  lastEnd: isoDate.nullable(),
});
export type PhaseProgress = z.infer<typeof phaseProgress>;

export const projectSchedule = z.object({
  project: projectSummary,
  phases: z.array(phaseProgress),
  tasks: z.array(scheduledTask),
  /** Errechnetes Ende aus der Vorwärtsrechnung. */
  computedEnd: isoDate.nullable(),
  /** Vertraglich geschuldetes Ende, sofern erfasst. */
  contractualEnd: isoDate.nullable(),
  /** Positiv bedeutet: später fertig als geschuldet. */
  deviationWorkdays: z.number().int().nullable(),
});
export type ProjectSchedule = z.infer<typeof projectSchedule>;

export const apiError = z.object({
  error: z.string(),
  /** Was der Nutzer als Nächstes tun kann — nie eine Fehlermeldung ohne Ausweg. */
  hint: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiError>;

/** Klartext für den Gesamtpuffer, wie in Abschnitt 3.6 der Spezifikation. */
export function floatInPlainWords(totalFloatDays: number | null): string {
  if (totalFloatDays === null) return 'Puffer noch nicht berechnet.';
  if (totalFloatDays < 0) {
    return `Dieser Termin liegt ${Math.abs(totalFloatDays)} Werktage hinter dem geschuldeten Ende.`;
  }
  if (totalFloatDays === 0) {
    return 'Kein Puffer. Jeder Tag Verzug ist ein Tag später fertig.';
  }
  if (totalFloatDays === 1) {
    return 'Darf sich um einen Werktag verschieben, ohne dass der Endtermin kippt.';
  }
  return `Darf sich um ${totalFloatDays} Werktage verschieben, ohne dass der Endtermin kippt.`;
}

// ---------------------------------------------------------------------------
// Beteiligte
// ---------------------------------------------------------------------------

export const projectMember = z.object({
  id: z.string().uuid(),
  role: memberRole,
  displayName: z.string().nullable(),
  company: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  tradeId: z.string().uuid().nullable(),
  tradeCode: z.string().nullable(),
  tradeName: z.string().nullable(),
  invitedAt: z.string(),
  acceptedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  /** Bist du das selbst? Die eigene Zeile lässt sich nicht entfernen. */
  isSelf: z.boolean(),
  /** Hat diese Person ein Konto, oder hängt sie an einem Gast-Link? */
  hasAccount: z.boolean(),
});
export type ProjectMemberDto = z.infer<typeof projectMember>;

export const memberInviteRequest = z
  .object({
    role: memberRole,
    displayName: z.string().trim().min(2).max(120),
    company: z.string().trim().max(160).optional(),
    email: z.string().trim().email('Diese E-Mail-Adresse sieht nicht vollständig aus.').optional(),
    phone: z.string().trim().max(40).optional(),
    /** Pflicht für `trade`: ohne Gewerk gäbe es keinen Ausschnitt. */
    tradeId: z.string().uuid().optional(),
  })
  .refine((value) => value.role !== 'trade' || value.tradeId !== undefined, {
    message: 'Ein Einzelgewerk braucht ein Gewerk — sonst wüssten wir nicht, was es sehen darf.',
    path: ['tradeId'],
  })
  // `owner` gibt es genau einmal, und diese Zeile entsteht beim Anlegen des
  // Projekts. Wer das Projekt übergeben will, lädt einen `co_owner` ein.
  .refine((value) => value.role !== 'owner', {
    message: 'Ein Projekt hat genau einen Bauherrn. Lad einen zweiten Bauherrn ein.',
    path: ['role'],
  });
export type MemberInviteRequest = z.infer<typeof memberInviteRequest>;

export const memberUpdateRequest = z
  .object({
    role: memberRole.optional(),
    displayName: z.string().trim().min(2).max(120).optional(),
    company: z.string().trim().max(160).nullable().optional(),
    email: z.string().trim().email().nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    tradeId: z.string().uuid().nullable().optional(),
  })
  .refine((value) => value.role !== 'owner', {
    message: 'Der Bauherr steht fest. Wer übergeben will, legt einen zweiten Bauherrn an.',
    path: ['role'],
  });
export type MemberUpdateRequest = z.infer<typeof memberUpdateRequest>;

// ---------------------------------------------------------------------------
// Vorgänge ändern
// ---------------------------------------------------------------------------

/** Die Gründe aus `mbl.schedule_change_reason`, unverändert. */
export const changeReason = z.enum([
  'witterung',
  'lieferzeit',
  'kapazitaet',
  'planungsaenderung',
  'bauherren_entscheidung',
  'vorgewerk_verzug',
  'behoerde',
  'mangelbeseitigung',
  'nachtrag',
  'planinitialisierung',
  'sonstiges',
]);
export type ChangeReason = z.infer<typeof changeReason>;

export const taskPatchRequest = z
  .object({
    /** Neuer Beginn. Das Ende ergibt sich aus der Dauer, nie umgekehrt. */
    currentStart: isoDate.optional(),
    durationDays: z.number().int().min(0).max(999).optional(),
    actualStart: isoDate.nullable().optional(),
    actualEnd: isoDate.nullable().optional(),
    status: taskStatus.optional(),
    confirmation: confirmationLevel.optional(),
    reasonCode: changeReason.optional(),
    reasonText: z.string().trim().max(500).optional(),
  })
  // Kein Schalter für „ohne Fortpflanzung": Die Folgevorgänge wandern immer
  // mit. Ein Bauablauf, in dem sich der Estrich verschiebt und die Fliesen
  // stehen bleiben, ist keiner. Die Einzelentkopplung aus Abschnitt 3.5 ist
  // etwas anderes — sie hängt an der einzelnen Anordnungsbeziehung, nicht an
  // einem Häkchen bei der Verschiebung, und kommt mit ihr.
  .refine(
    (value) =>
      value.currentStart !== undefined ||
      value.durationDays !== undefined ||
      value.actualStart !== undefined ||
      value.actualEnd !== undefined ||
      value.status !== undefined ||
      value.confirmation !== undefined,
    { message: 'Es ist nichts zu ändern.' },
  );
export type TaskPatchRequest = z.infer<typeof taskPatchRequest>;

/** Was eine Änderung im Plan angerichtet hat — Grundlage der Rückmeldung. */
export const shiftedTask = z.object({
  id: z.string().uuid(),
  name: z.string(),
  fromStart: isoDate.nullable(),
  toStart: isoDate.nullable(),
  fromEnd: isoDate.nullable(),
  toEnd: isoDate.nullable(),
});
export type ShiftedTask = z.infer<typeof shiftedTask>;

export const taskPatchResult = z.object({
  task: scheduledTask,
  /**
   * Die mitgewanderten Vorgänge, ohne den geänderten selbst — und nur die,
   * die der Anrufer auch lesen darf. Ein Einzelgewerk erfährt, **dass** sein
   * Termin den Ablauf bewegt, aber nicht, welche fremden Vorgänge das sind.
   */
  shifted: z.array(shiftedTask),
  /** Wie viele Vorgänge insgesamt mitgewandert sind, auch die unsichtbaren. */
  shiftedCount: z.number().int(),
  computedEndBefore: isoDate.nullable(),
  computedEndAfter: isoDate.nullable(),
  /** Positiv: das Bauende rutscht nach hinten. */
  endShiftWorkdays: z.number().int(),
});
export type TaskPatchResult = z.infer<typeof taskPatchResult>;

// ---------------------------------------------------------------------------
// Änderungshistorie
// ---------------------------------------------------------------------------

export const scheduleChangeEntry = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  taskName: z.string().nullable(),
  field: z.string(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  actorRole: memberRole.nullable(),
  actorName: z.string().nullable(),
  actorChannel: z.enum(['app', 'guest_link', 'import', 'system']),
  reasonCode: changeReason.nullable(),
  reasonText: z.string().nullable(),
  createdAt: z.string(),
});
export type ScheduleChangeEntry = z.infer<typeof scheduleChangeEntry>;

// ---------------------------------------------------------------------------
// Stammdaten
// ---------------------------------------------------------------------------

export const tradeOption = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
});
export type TradeOption = z.infer<typeof tradeOption>;

export const projectPatchRequest = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  contractualCompletion: isoDate.nullable().optional(),
});
export type ProjectPatchRequest = z.infer<typeof projectPatchRequest>;

/**
 * Wortwahl für die Änderungsgründe. Steht hier und nicht in der Oberfläche,
 * weil API und Web denselben Text brauchen — der Wochenbericht nennt ihn
 * ebenso wie die Zeile im Verlauf.
 */
export const CHANGE_REASON_LABEL: Record<ChangeReason, string> = {
  witterung: 'Witterung',
  lieferzeit: 'Lieferzeit',
  kapazitaet: 'Kapazität',
  planungsaenderung: 'Planungsänderung',
  bauherren_entscheidung: 'Entscheidung des Bauherrn',
  vorgewerk_verzug: 'Verzug im Vorgewerk',
  behoerde: 'Behörde',
  mangelbeseitigung: 'Mangelbeseitigung',
  nachtrag: 'Nachtrag',
  planinitialisierung: 'Plan angelegt',
  sonstiges: 'Sonstiges',
};

/**
 * Die Auswirkung einer Verschiebung als Satz — nie als nackte Zahl.
 * Abschnitt 11.4 des Gestaltungssystems: jede schlechte Nachricht trägt einen
 * nächsten Schritt.
 */
export function endShiftInPlainWords(workdays: number, affected: number): string {
  const mit =
    affected === 0
      ? 'Kein anderer Vorgang wandert mit.'
      : affected === 1
        ? 'Ein Folgevorgang wandert mit.'
        : `${affected} Folgevorgänge wandern mit.`;

  if (workdays === 0) return `${mit} Der Endtermin bleibt, wie er war.`;
  if (workdays > 0) {
    return `${mit} Das Bauende rutscht um ${workdays} Werktage nach hinten.`;
  }
  return `${mit} Das Bauende rückt um ${Math.abs(workdays)} Werktage nach vorn.`;
}

// ---------------------------------------------------------------------------
// Entscheidungen (Abschnitt 3.2)
// ---------------------------------------------------------------------------

export const decisionStatus = z.enum([
  'offen',
  'in_bemusterung',
  'entschieden',
  'beauftragt',
  'hinfaellig',
]);
export type DecisionStatus = z.infer<typeof decisionStatus>;

export const DECISION_STATUS_LABEL: Record<DecisionStatus, string> = {
  offen: 'Offen',
  in_bemusterung: 'In Bemusterung',
  entschieden: 'Entschieden',
  beauftragt: 'Beauftragt',
  hinfaellig: 'Hinfällig',
};

export const decisionDto = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  helpText: z.string().nullable(),
  blocksTaskId: z.string().uuid().nullable(),
  blocksTaskName: z.string().nullable(),
  blocksTaskStart: isoDate.nullable(),
  leadTimeDays: z.number().int(),
  leadTimeUnit: durationUnit,
  dueDate: isoDate.nullable(),
  status: decisionStatus,
  decidedAt: z.string().nullable(),
  decidedNote: z.string().nullable(),
  estimatedCostCents: z.number().int().nullable(),
  /** Verbleibende Werktage bis zur Frist, gegen heute gerechnet. */
  remainingWorkdays: z.number().int().nullable(),
  isOverdue: z.boolean(),
});
export type DecisionDto = z.infer<typeof decisionDto>;

export const decisionPatchRequest = z.object({
  status: decisionStatus.optional(),
  decidedNote: z.string().trim().max(2000).nullable().optional(),
  estimatedCostCents: z.number().int().min(0).nullable().optional(),
});
export type DecisionPatchRequest = z.infer<typeof decisionPatchRequest>;

/**
 * Die Frist als Satz. Eine Zahl allein sagt dem Bauherrn nichts darüber, ob
 * er heute handeln muss — Abschnitt 11.4 des Gestaltungssystems.
 */
export function decisionDueInPlainWords(
  remainingWorkdays: number | null,
  isOverdue: boolean,
): string {
  if (remainingWorkdays === null) return 'Diese Entscheidung hängt an keinem Termin.';
  if (isOverdue) {
    const late = Math.abs(remainingWorkdays);
    return late === 0
      ? 'Heute ist der letzte Tag. Danach wird es eng.'
      : `Diese Frist liegt ${late} Werktage zurück. Sprich den GU an, bevor er es tut.`;
  }
  if (remainingWorkdays === 0) return 'Heute ist der letzte Tag.';
  if (remainingWorkdays === 1) return 'Noch ein Werktag.';
  if (remainingWorkdays <= 10) return `Noch ${remainingWorkdays} Werktage — das wird knapp.`;
  return `Noch ${remainingWorkdays} Werktage Zeit.`;
}

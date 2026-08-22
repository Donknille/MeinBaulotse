/**
 * Verträge zwischen Web und API.
 *
 * Ein Zod-Schema je Anfrage und Antwort, geteilt von beiden Seiten. Damit
 * kann die Oberfläche nicht auf Felder zugreifen, die die API nicht liefert,
 * und die API keine Eingaben annehmen, die die Oberfläche nie sendet.
 */

import { z } from 'zod';
import { addDays, compareDates, FEDERAL_STATES } from '@meinbaulotse/schedule';

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT erwartet');

export const federalState = z.enum(FEDERAL_STATES);
export const buildType = z.enum(['efh_massiv', 'efh_fertighaus', 'sanierung', 'sonstiges']);
export const contractType = z.enum(['verbraucherbauvertrag', 'einzelgewerke', 'sonstiges']);
export const memberRole = z.enum(['owner', 'co_owner', 'contractor', 'trade', 'expert', 'viewer']);
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
/**
 * Warum sich ein Termin verschoben hat.
 *
 * Ein Grund ist Pflicht, sobald jemand von Hand verschiebt — nicht aus
 * Bürokratie, sondern weil die Historie sonst wertlos ist: „12.05. → 26.05."
 * beantwortet keine einzige Frage, „12.05. → 26.05., Lieferzeit" beantwortet
 * fast alle. Dieselben Werte wie `mbl.schedule_change_reason`.
 */
export const scheduleChangeReason = z.enum([
  'witterung',
  'lieferzeit',
  'kapazitaet',
  'planungsaenderung',
  'bauherren_entscheidung',
  'vorgewerk_verzug',
  'behoerde',
  'mangelbeseitigung',
  'nachtrag',
  'sonstiges',
]);
export type ScheduleChangeReason = z.infer<typeof scheduleChangeReason>;

/**
 * Was sich an einem Vorgang ändern lässt.
 *
 * Drei verschiedene Aussagen, bewusst getrennt gehalten:
 *
 * - `earliestStart` — **eine Absicht.** „Nicht vor diesem Tag." Der Vorgang
 *   kann trotzdem später liegen, wenn ein Vorgänger ihn schiebt.
 * - `actualStart`/`actualEnd` — **eine Tatsache.** Sie überschreiben die
 *   Rechnung, statt sie zu beschränken.
 * - `status` — **eine Einschätzung.** Sie ändert keinen Termin.
 *
 * `null` löscht den jeweiligen Wert; ein fehlendes Feld lässt ihn stehen. Das
 * ist der Unterschied zwischen „ich nehme die Verschiebung zurück" und „ich
 * sage dazu nichts".
 */
export const taskUpdateRequest = z
  .object({
    earliestStart: isoDate.nullable().optional(),
    actualStart: isoDate.nullable().optional(),
    actualEnd: isoDate.nullable().optional(),
    status: taskStatus.optional(),
    reason: scheduleChangeReason.optional(),
    reasonText: z.string().trim().max(500).optional(),
  })
  .refine(
    (value) =>
      value.earliestStart !== undefined ||
      value.actualStart !== undefined ||
      value.actualEnd !== undefined ||
      value.status !== undefined,
    { message: 'Es gibt nichts zu ändern.' },
  )
  .refine((value) => value.earliestStart === undefined || value.reason !== undefined, {
    message: 'Für eine Verschiebung brauchen wir den Grund.',
    path: ['reason'],
  });
export type TaskUpdateRequest = z.infer<typeof taskUpdateRequest>;

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
  role: memberRole,
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
  /** Von Hand gesetzt: nicht früher als. `null` heißt: frei gerechnet. */
  earliestStart: isoDate.nullable(),
  /**
   * Die Lotsenkarte zu diesem Vorgang, sofern es eine gibt.
   *
   * Nur die Kennung, nicht der Inhalt: Eine Planansicht mit 38 Vorgängen würde
   * sonst zwölf vollständige Karten mitschleppen, von denen der Nutzer keine
   * liest. Der Inhalt kommt beim Öffnen.
   */
  guideCardId: z.string().uuid().nullable(),
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
  /**
   * Was der Fragende in diesem Projekt darf. Kommt aus `role_permission` in
   * der Datenbank, nicht aus einer Konstante im Code — die Oberfläche zeigt
   * damit dieselbe Matrix an, die die RLS durchsetzt.
   *
   * Nur zur Darstellung. Autorisiert wird weiterhin ausschließlich in der
   * Datenbank; wer diese Liste fälscht, kommt an keiner Policy vorbei.
   */
  permissions: z.array(z.string()),
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

// -- Wissensschicht ----------------------------------------------------------
//
// Die Lotsenkarte aus Abschnitt 3.1. Jedes Feld trägt seinen eigenen Zweck,
// deshalb ist sie kein Freitextblock: `watch_for` wird zur Checkliste,
// `questions_for_contractor` bekommt einen Kopieren-Knopf, `photo_prompts`
// werden später zu Fotoaufträgen. Ein Fließtext könnte davon nichts.

export const guideCardWatchItem = z.object({
  /** Stabil je Karte. Trägt den Haken in der Checkliste. */
  key: z.string(),
  text: z.string(),
  why: z.string().nullable(),
});
export type GuideCardWatchItem = z.infer<typeof guideCardWatchItem>;

export const guideCardQuestion = z.object({
  key: z.string(),
  question: z.string(),
  whyItMatters: z.string().nullable(),
});
export type GuideCardQuestion = z.infer<typeof guideCardQuestion>;

export const guideCardProblem = z.object({
  key: z.string(),
  problem: z.string(),
  howToSpot: z.string().nullable(),
});
export type GuideCardProblem = z.infer<typeof guideCardProblem>;

export const guideCardPhotoPrompt = z.object({
  key: z.string(),
  what: z.string(),
  why: z.string().nullable(),
  /** Ab welchem Vorgang das Motiv verdeckt ist. */
  beforeTaskCode: z.string().nullable(),
});
export type GuideCardPhotoPrompt = z.infer<typeof guideCardPhotoPrompt>;

export const guideCardSource = z.object({
  title: z.string(),
  note: z.string().nullable(),
});
export type GuideCardSource = z.infer<typeof guideCardSource>;

export const guideCard = z.object({
  id: z.string().uuid(),
  key: z.string(),
  version: z.number().int(),
  title: z.string(),
  phaseKey: z.string(),
  tradeCode: z.string().nullable(),
  whatsHappening: z.string(),
  watchFor: z.array(guideCardWatchItem),
  questionsForContractor: z.array(guideCardQuestion),
  commonProblems: z.array(guideCardProblem),
  photoPrompts: z.array(guideCardPhotoPrompt),
  /** Ob hier eine Fachprüfung sinnvoll ist — mit Begründung, nie ohne. */
  expertRecommended: z.boolean(),
  expertReason: z.string().nullable(),
  /** Trägt die Karte eine Gesetzesstelle, gilt der feste Zusatz aus CI 11.3. */
  legalNote: z.boolean(),
  sources: z.array(guideCardSource),
});
export type GuideCardDto = z.infer<typeof guideCard>;

export const checklistEntry = z.object({
  sourceKey: z.string(),
  text: z.string(),
  isDone: z.boolean(),
  doneAt: z.string().nullable(),
  note: z.string().nullable(),
});
export type ChecklistEntry = z.infer<typeof checklistEntry>;

export const guideCardView = z.object({
  card: guideCard,
  taskId: z.string().uuid(),
  taskName: z.string(),
  taskStart: isoDate.nullable(),
  taskEnd: isoDate.nullable(),
  /** Für jede Zeile aus `watchFor` genau ein Eintrag, auch die ungehakten. */
  checklist: z.array(checklistEntry),
  /** `null`, solange niemand die Karte geöffnet hat. */
  readAt: z.string().nullable(),
  /** `null` heißt: gelesen, aber nicht bewertet. */
  helpful: z.boolean().nullable(),
  /**
   * Ob der Fragende Haken setzen darf. Nur zur Darstellung — durchgesetzt wird
   * es in der Policy `checklist_item_insert`.
   */
  canEditChecklist: z.boolean(),
});
export type GuideCardView = z.infer<typeof guideCardView>;

export const guideCardFeedbackRequest = z.object({
  /** `null` nimmt eine Bewertung zurück, ohne den Gelesen-Stand zu löschen. */
  helpful: z.boolean().nullable().optional(),
});
export type GuideCardFeedbackRequest = z.infer<typeof guideCardFeedbackRequest>;

export const checklistUpdateRequest = z.object({
  isDone: z.boolean(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type ChecklistUpdateRequest = z.infer<typeof checklistUpdateRequest>;

/**
 * Wann eine Lotsenkarte in den Blick rückt (Abschnitt 3.1): sieben Tage vor
 * Beginn, während der Ausführung und beim Abschluss.
 *
 * Gezählt wird in **Kalendertagen**, nicht in Werktagen. Die Vorlaufzeit einer
 * Entscheidung hängt an der Arbeitsleistung eines Betriebs und zählt deshalb
 * Werktage. Wissen zu lesen hängt an nichts davon — ein Bauherr liest auch am
 * Sonntag.
 */
export const GUIDE_CARD_LEAD_DAYS = 7;

export type GuideCardTiming = 'spaeter' | 'bald' | 'laeuft' | 'abschluss' | 'vorbei';

export function guideCardTiming(
  task: { currentStart: string | null; currentEnd: string | null },
  today: string,
): GuideCardTiming {
  const start = task.currentStart;
  const end = task.currentEnd ?? start;
  if (start === null || end === null) return 'spaeter';

  if (compareDates(today, start) < 0) {
    return compareDates(today, addDays(start, -GUIDE_CARD_LEAD_DAYS)) < 0 ? 'spaeter' : 'bald';
  }
  if (compareDates(today, end) <= 0) return 'laeuft';
  return compareDates(today, addDays(end, GUIDE_CARD_LEAD_DAYS)) <= 0 ? 'abschluss' : 'vorbei';
}

/** Rückt die Karte gerade in den Blick? */
export function isGuideCardDue(
  task: { currentStart: string | null; currentEnd: string | null },
  today: string,
): boolean {
  const timing = guideCardTiming(task, today);
  return timing === 'bald' || timing === 'laeuft' || timing === 'abschluss';
}

/** Der feste Zusatz aus CI 11.3. Wird nie verkürzt und nie ausgeblendet. */
export const LEGAL_NOTE = 'Hinweis auf eine Gesetzesstelle, keine Rechtsberatung.';

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

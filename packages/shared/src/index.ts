/**
 * Verträge zwischen Web und API.
 *
 * Ein Zod-Schema je Anfrage und Antwort, geteilt von beiden Seiten. Damit
 * kann die Oberfläche nicht auf Felder zugreifen, die die API nicht liefert,
 * und die API keine Eingaben annehmen, die die Oberfläche nie sendet.
 */

import { z } from 'zod';
import { addDays, compareDates, daysBetween, FEDERAL_STATES } from '@meinbaulotse/schedule';

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
    /**
     * Vorgänge, die trotz der Verschiebung stehen bleiben sollen
     * (Abschnitt 3.5, Punkt 6).
     *
     * Entkoppeln löscht keine Beziehung. Es schreibt zwei Aussagen fest, die
     * beide stimmen: Der Vorgang bleibt, wo er ist, und die beiden überlappen
     * sich jetzt. Was das im Einzelnen heißt, sagt die Vorschau vorher.
     */
    decouple: z.array(z.string().uuid()).max(64).optional(),
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

// -- Verschieben und Fortpflanzung -------------------------------------------
//
// Abschnitt 3.5, Punkt 6: Betroffene Folgevorgänge werden als **Vorschlag**
// angezeigt und sind einzeln entkoppelbar. Deshalb gibt es zwei Wege zur
// selben Änderung: einen, der nur rechnet, und einen, der schreibt. Beide
// nehmen denselben Körper entgegen — sonst zeigte die Vorschau etwas anderes,
// als hinterher passiert.

export const proposedTaskChange = z.object({
  taskId: z.string().uuid(),
  name: z.string(),
  fromStart: isoDate,
  fromEnd: isoDate,
  toStart: isoDate,
  toEnd: isoDate,
  /** Werktage, um die sich der Anfang verschiebt. Positiv heißt später. */
  shiftWorkdays: z.number().int(),
  isCritical: z.boolean(),
});
export type ProposedTaskChange = z.infer<typeof proposedTaskChange>;

/** Eine Entscheidungsfrist, die mitwandert. */
export const proposedDecisionChange = z.object({
  id: z.string().uuid(),
  title: z.string(),
  fromDueDate: isoDate.nullable(),
  toDueDate: isoDate.nullable(),
});
export type ProposedDecisionChange = z.infer<typeof proposedDecisionChange>;

/**
 * Was eine Entkopplung in den Daten bedeutet: Die beiden Vorgänge überlappen
 * sich jetzt. Das steht so in der Vorschau, damit niemand es hinterher als
 * Fehler entdeckt.
 */
export const proposedOverlap = z.object({
  predecessorName: z.string(),
  successorName: z.string(),
  /** Werktage Überlappung. Immer positiv. */
  workdays: z.number().int(),
});
export type ProposedOverlap = z.infer<typeof proposedOverlap>;

export const shiftPreview = z.object({
  taskId: z.string().uuid(),
  taskName: z.string(),
  /** Der ausgelöste Vorgang. `null`, wenn er sich gar nicht bewegt. */
  trigger: proposedTaskChange.nullable(),
  affected: z.array(proposedTaskChange),
  /**
   * Was auf Wunsch stehen bleibt — mit Namen, nicht nur mit Kennung. Eine
   * Liste aus Kennungen zwingt die Oberfläche, die Namen anderswo zu suchen,
   * und der entkoppelte Vorgang steht per Definition nicht mehr in `affected`.
   */
  decoupled: z.array(z.object({ taskId: z.string().uuid(), name: z.string() })),
  decisions: z.array(proposedDecisionChange),
  overlaps: z.array(proposedOverlap),
  computedEndBefore: isoDate,
  computedEndAfter: isoDate,
  /** Werktage, um die sich der prognostizierte Endtermin verschiebt. */
  effectWorkdays: z.number().int(),
});
export type ShiftPreview = z.infer<typeof shiftPreview>;

/**
 * Klartext für die Auswirkung einer Verschiebung auf den Endtermin.
 *
 * Auch die schlechte Nachricht trägt eine Zahl und keinen Vorwurf (CI 11.4).
 */
export function shiftEffectInPlainWords(effectWorkdays: number): string {
  if (effectWorkdays === 0) return 'Der Endtermin bleibt, wie er ist.';
  const tage =
    Math.abs(effectWorkdays) === 1 ? '1 Werktag' : `${Math.abs(effectWorkdays)} Werktage`;
  return effectWorkdays > 0
    ? `Der Endtermin verschiebt sich um ${tage} nach hinten.`
    : `Der Endtermin rückt um ${tage} nach vorn.`;
}

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
  /**
   * Überwiegend katholische Gemeinde. Steht hier, weil die Oberfläche mit
   * demselben Feiertagskalender rechnen muss wie der Server — sonst zeigt sie
   * „noch 4 Werktage", wo die API 3 gerechnet hat.
   */
  catholicMunicipality: z.boolean(),
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
  /** Wann und von wem abgestimmt — „Abgestimmt am 12.05." braucht beides. */
  confirmedAt: z.string().nullable(),
  confirmedBy: z.string().nullable(),
  /**
   * Der abweichende Termin der Gegenseite (Abschnitt 3.4, `disputed`).
   *
   * Er steht **neben** dem eingetragenen, nicht an seiner Stelle. Genau das
   * ist der Unterschied zwischen „zwei Angaben" und „der GU hat den Termin
   * geändert": Solange beide dastehen, entscheidet der Bauherr, welcher gilt.
   */
  counterStart: isoDate.nullable(),
  counterEnd: isoDate.nullable(),
  counterNote: z.string().nullable(),
  counterBy: z.string().nullable(),
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

// -- Entscheidungen ----------------------------------------------------------
//
// Abschnitt 3.2: Jede Bauherren-Entscheidung hängt an einem Vorgang und einer
// Vorlaufzeit. Verschiebt sich der Vorgang, verschiebt sich die Frist mit.
//
// Der Zustandsfluss ist bewusst kurz: offen → in Bemusterung → entschieden →
// beauftragt. „Hinfällig" steht daneben, nicht dahinter — eine Entscheidung
// kann sich erledigen, ohne getroffen worden zu sein.

export const decisionStatus = z.enum([
  'offen',
  'in_bemusterung',
  'entschieden',
  'beauftragt',
  'hinfaellig',
]);
export type DecisionStatus = z.infer<typeof decisionStatus>;

/** Die drei Fragen aus Abschnitt 3.2, einzeln beantwortet statt als Fließtext. */
export const decisionHelp = z.object({
  whatItIsAbout: z.string().optional(),
  whatDistinguishes: z.string().optional(),
  whatPeopleRegret: z.string().optional(),
});
export type DecisionHelpDto = z.infer<typeof decisionHelp>;

export const decision = z.object({
  id: z.string().uuid(),
  templateKey: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  /** Warum die Vorlaufzeit so lang ist. Ohne den Grund ist eine Frist eine Behauptung. */
  reason: z.string().nullable(),
  help: decisionHelp,
  blocksTaskId: z.string().uuid().nullable(),
  blocksTaskName: z.string().nullable(),
  /** Beginn des blockierten Vorgangs — die Bezugsgröße der Frist. */
  blocksTaskStart: isoDate.nullable(),
  leadTimeDays: z.number().int(),
  leadTimeUnit: durationUnit,
  /** Gerechnet, nie von Hand gesetzt. `null`, solange der Vorgang keinen Termin hat. */
  dueDate: isoDate.nullable(),
  status: decisionStatus,
  decidedAt: z.string().nullable(),
  decidedNote: z.string().nullable(),
  estimatedCostCents: z.number().int().nullable(),
});
export type DecisionDto = z.infer<typeof decision>;

export const decisionUpdateRequest = z
  .object({
    status: decisionStatus.optional(),
    decidedNote: z.string().trim().max(1000).nullable().optional(),
    estimatedCostCents: z.number().int().min(0).nullable().optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.decidedNote !== undefined ||
      value.estimatedCostCents !== undefined,
    { message: 'Es gibt nichts zu ändern.' },
  );
export type DecisionUpdateRequest = z.infer<typeof decisionUpdateRequest>;

/** Eine Entscheidung, die noch aussteht. Getroffene zählen nicht mehr mit. */
export function isDecisionOpen(entry: Pick<DecisionDto, 'status'>): boolean {
  return entry.status === 'offen' || entry.status === 'in_bemusterung';
}

/**
 * Klartext für die Restlaufzeit einer Entscheidungsfrist.
 *
 * Wortwahl nach CI 11.2: nicht „überfällig seit 3 Tagen", sondern „seit 3
 * Werktagen offen". Dieselbe Datenlage, ein anderer Ton — und es stimmt auch
 * genauer, denn offen ist sie, überfällig wird sie erst durch die Folgen.
 */
export function decisionInPlainWords(remainingWorkdays: number | null): string {
  if (remainingWorkdays === null) return 'Frist noch nicht berechnet.';
  if (remainingWorkdays < 0) {
    const tage =
      Math.abs(remainingWorkdays) === 1
        ? 'einem Werktag'
        : `${Math.abs(remainingWorkdays)} Werktagen`;
    return `seit ${tage} offen`;
  }
  if (remainingWorkdays === 0) return 'heute fällig';
  if (remainingWorkdays === 1) return 'noch 1 Werktag';
  return `noch ${remainingWorkdays} Werktage`;
}

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
  /**
   * Die Entscheidungen dieses Bauvorhabens, nach Frist sortiert.
   *
   * Anders als die Lotsenkarten kommen sie vollständig mit: Es sind vierzehn
   * kurze Datensätze, und das Cockpit braucht sie sofort — „was du entscheiden
   * musst" ist keine Ansicht, die man erst öffnet.
   */
  decisions: z.array(decision),
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

// -- Wochenbericht -----------------------------------------------------------
//
// Abschnitt 3.11. Sechs Blöcke, Montag früh. Die Spezifikation nennt ihn den
// Retention-Anker, und das ist keine Übertreibung: Es ist die einzige Stelle,
// an der das Produkt von sich aus etwas sagt, statt darauf zu warten, dass
// jemand nachsieht.

export const weeklyReportTask = z.object({
  taskId: z.string().uuid(),
  name: z.string(),
  tradeName: z.string().nullable(),
  start: isoDate,
  end: isoDate,
  /** Beginnt der Vorgang in diesem Zeitraum? */
  starts: z.boolean(),
  /** Endet er darin? */
  ends: z.boolean(),
  /** Die Kurzfassung der Lotsenkarte: ein Satz, nicht der ganze Text. */
  guideCard: z.object({ id: z.string().uuid(), title: z.string(), summary: z.string() }).nullable(),
});

export const weeklyReportDecision = z.object({
  id: z.string().uuid(),
  title: z.string(),
  blocksTaskName: z.string().nullable(),
  dueDate: isoDate,
  remainingWorkdays: z.number().int(),
  isOverdue: z.boolean(),
});

/** Eine Handlung, nicht ein bewegter Vorgang — siehe `weekly-report.ts`. */
export const weeklyReportShift = z.object({
  at: z.string(),
  reasonCode: z.string().nullable(),
  reasonText: z.string().nullable(),
  actorRole: z.string().nullable(),
  /** Werktage, um die sich der Endtermin dadurch verschoben hat. */
  effectWorkdays: z.number().int().nullable(),
  taskNames: z.array(z.string()),
});

export const weeklyReportPhotoPrompt = z.object({
  taskId: z.string().uuid(),
  taskName: z.string(),
  key: z.string(),
  what: z.string(),
  why: z.string().nullable(),
});

export const weeklyReport = z.object({
  projectId: z.string().uuid(),
  projectName: z.string(),
  /** Der Stichtag, auf den der Bericht blickt. */
  generatedFor: isoDate,
  thisWeek: z.array(weeklyReportTask),
  decisions: z.array(weeklyReportDecision),
  shifted: z.array(weeklyReportShift),
  forecast: z.object({
    contractualEnd: isoDate.nullable(),
    computedEnd: isoDate.nullable(),
    deviationWorkdays: z.number().int().nullable(),
  }),
  photoPrompts: z.array(weeklyReportPhotoPrompt),
  /**
   * Block sechs aus Abschnitt 3.11. Steht offen als „noch nicht da", statt
   * stillschweigend zu fehlen — ein weggelassener Block sieht aus wie „nichts
   * zu zahlen".
   */
  money: z.object({ available: z.boolean(), note: z.string() }),
});
export type WeeklyReport = z.infer<typeof weeklyReport>;

/**
 * Der Bericht als Fließtext.
 *
 * Steht hier und nicht in der Oberfläche, weil ihn zwei Seiten brauchen: die
 * Cockpit-Ansicht und — sobald ein Mailversand eingerichtet ist — die
 * Montagsmail. Zwei Fassungen desselben Berichts würden auseinanderlaufen, und
 * die eine davon läse niemand gegen.
 *
 * Bewusst reiner Text: Er ist die Grundlage, aus der eine Mail entsteht, und
 * er bleibt lesbar, wenn das HTML unterwegs verlorengeht.
 */
export function renderWeeklyReportAsText(report: WeeklyReport): string {
  const zeilen: string[] = [
    `MeinBaulotse — Wochenbericht für ${report.projectName}`,
    `Stand ${report.generatedFor}`,
    '',
  ];

  const block = (titel: string, inhalt: readonly string[], leer: string): void => {
    zeilen.push(titel, '-'.repeat(titel.length));
    zeilen.push(...(inhalt.length === 0 ? [leer] : inhalt));
    zeilen.push('');
  };

  block(
    'Diese Woche auf der Baustelle',
    report.thisWeek.map((eintrag) => {
      const wann = eintrag.starts && eintrag.ends ? 'läuft' : eintrag.starts ? 'beginnt' : 'endet';
      const karte =
        eintrag.guideCard === null
          ? ''
          : `
    ${eintrag.guideCard.summary}`;
      return `  ${eintrag.name} (${wann} ${eintrag.starts ? eintrag.start : eintrag.end})${karte}`;
    }),
    '  Diese Woche steht nichts an.',
  );

  block(
    'Was du entscheiden musst',
    report.decisions.map(
      (eintrag) =>
        `  ${eintrag.title} — ${eintrag.dueDate}, ${decisionInPlainWords(eintrag.remainingWorkdays)}`,
    ),
    '  Nichts offen. Alle Fristen sind erledigt oder liegen weiter vorn.',
  );

  block(
    'Was sich verschoben hat',
    report.shifted.map((eintrag) => {
      const wirkung =
        eintrag.effectWorkdays === null || eintrag.effectWorkdays === 0
          ? 'ohne Auswirkung auf den Endtermin'
          : `${eintrag.effectWorkdays > 0 ? '+' : ''}${eintrag.effectWorkdays} Werktage auf den Endtermin`;
      const grund = eintrag.reasonCode === null ? 'ohne Grund' : eintrag.reasonCode;
      return `  ${eintrag.taskNames.join(', ')} — ${grund}, ${wirkung}`;
    }),
    '  Seit der letzten Woche hat sich nichts verschoben.',
  );

  const { forecast } = report;
  block(
    'Prognose',
    [
      `  Errechnetes Ende: ${forecast.computedEnd ?? 'noch offen'}`,
      `  Geschuldet:       ${forecast.contractualEnd ?? 'nicht erfasst'}`,
      forecast.deviationWorkdays === null
        ? '  Abweichung:       lässt sich ohne Vertragstermin nicht sagen'
        : `  Abweichung:       ${forecast.deviationWorkdays} Werktage`,
    ],
    '',
  );

  block(
    'Fotos, die jetzt fällig sind',
    report.photoPrompts.map((eintrag) => `  ${eintrag.what} (${eintrag.taskName})`),
    '  Nichts, was diese Woche verdeckt wird.',
  );

  block('Geld', report.money.available ? [] : [`  ${report.money.note}`], '');

  return zeilen.join('\n');
}

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

// -- Erfassung und Tagebuch --------------------------------------------------
//
// Abschnitt 3.8. Der Nutzer sieht ein Fotoalbum; was hier an Feldern steht,
// bekommt er größtenteils nie zu Gesicht. Sie sind trotzdem da, weil sich die
// Frage „war das an dem Tag wirklich so" hinterher nicht mehr nachrüsten lässt.

/**
 * Das Wetter eines Tages, wie es die nächstgelegene DWD-Station gemessen hat.
 *
 * Mit dem Eintrag eingefroren, samt Station und Entfernung. Ohne die beiden
 * wäre die Angabe eine Behauptung: „12 Grad, Regen" sagt nichts darüber, ob
 * die Messung von der Baustelle oder aus achtzig Kilometern Entfernung stammt.
 */
export const weatherObservation = z.object({
  date: isoDate,
  /** Kennung der DWD-Station, mit der sich die Messung nachschlagen lässt. */
  stationId: z.string().nullable(),
  stationName: z.string().nullable(),
  /** Luftlinie zwischen Baustelle und Station, in Metern. */
  distanceMeters: z.number().int().nullable(),
  temperatureMinC: z.number().nullable(),
  temperatureMaxC: z.number().nullable(),
  /** Niederschlagssumme des Tages in Millimetern. */
  precipitationMm: z.number().nullable(),
  /** Stärkste Böe in km/h — die Zahl, an der Kranarbeiten scheitern. */
  windGustKmh: z.number().nullable(),
  /** dry | fog | rain | sleet | snow | hail | thunderstorm */
  condition: z.string().nullable(),
  /** Woher die Werte stammen, für die Nachprüfbarkeit in der Bauakte. */
  source: z.string(),
});
export type WeatherObservation = z.infer<typeof weatherObservation>;

/**
 * Ein Foto oder Anhang.
 *
 * Drei Zeitangaben, drei verschiedene Fragen — siehe die Spalten-Kommentare in
 * `0010_diary.sql`. Die Oberfläche zeigt eine Abweichung an, statt sie zu
 * glätten: Ein Foto, das laut Kamera vom Dienstag stammt und laut Nutzer vom
 * Donnerstag, ist keine Panne, sondern eine Auskunft.
 */
export const mediaDto = z.object({
  id: z.string().uuid(),
  storagePath: z.string(),
  mime: z.string(),
  bytes: z.number().int(),
  sha256: z.string(),
  exifTakenAt: z.string().nullable(),
  exifLat: z.number().nullable(),
  exifLon: z.number().nullable(),
  capturedAt: z.string().nullable(),
  statedDate: isoDate.nullable(),
  taskId: z.string().uuid().nullable(),
  taskName: z.string().nullable(),
  photoPromptKey: z.string().nullable(),
  caption: z.string().nullable(),
  createdAt: z.string(),
});
export type MediaDto = z.infer<typeof mediaDto>;

export const diaryEntryDto = z.object({
  id: z.string().uuid(),
  entryDate: isoDate,
  body: z.string(),
  authorName: z.string().nullable(),
  authorRole: memberRole.nullable(),
  weather: weatherObservation.nullable(),
  taskIds: z.array(z.string().uuid()),
  taskNames: z.array(z.string()),
  media: z.array(mediaDto),
  /** Versiegelt heißt: nur noch zurückziehbar, nicht mehr änderbar. */
  sealedAt: z.string().nullable(),
  chainIndex: z.number().int().nullable(),
  contentHash: z.string().nullable(),
  retractedAt: z.string().nullable(),
  retractionReason: z.string().nullable(),
  /** Wie lange sich der Eintrag noch ändern lässt, in Minuten. */
  editableForMinutes: z.number().int().nullable(),
  createdAt: z.string(),
  /** Ob der Anrufer ihn ändern darf — Verfasser und noch nicht versiegelt. */
  canEdit: z.boolean(),
});
export type DiaryEntryDto = z.infer<typeof diaryEntryDto>;

export const diaryEntryCreateRequest = z.object({
  entryDate: isoDate,
  body: z.string().max(20_000).default(''),
  taskIds: z.array(z.string().uuid()).max(50).default([]),
  /**
   * Ob das Wetter nachgeschlagen werden soll. Standard ja; die Erfassung im
   * Funkloch schaltet es aus, wenn der Tag zu lange her ist.
   */
  withWeather: z.boolean().default(true),
});
export type DiaryEntryCreateRequest = z.infer<typeof diaryEntryCreateRequest>;

export const diaryEntryUpdateRequest = z.object({
  body: z.string().max(20_000).optional(),
  entryDate: isoDate.optional(),
  taskIds: z.array(z.string().uuid()).max(50).optional(),
  /** Zurückziehen. Der Eintrag bleibt sichtbar und trägt den Grund. */
  retract: z.string().min(3).max(500).optional(),
});
export type DiaryEntryUpdateRequest = z.infer<typeof diaryEntryUpdateRequest>;

/**
 * Was der Browser meldet, **nachdem** er die Datei selbst hochgeladen hat.
 *
 * Die Bytes gehen nie durch diese API (Abschnitt 6.1). Hier kommt nur an, wo
 * sie liegen und was sie belegen — und die Prüfsumme, die beides verbindet.
 */
export const mediaRegisterRequest = z.object({
  storagePath: z.string().min(1).max(500),
  mime: z.string().min(3).max(120),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Prüfsumme als 64 Hexziffern erwartet'),
  diaryEntryId: z.string().uuid().nullish(),
  taskId: z.string().uuid().nullish(),
  photoPromptKey: z.string().max(60).nullish(),
  caption: z.string().max(500).nullish(),
  /** Aus der Datei gelesen, nicht behauptet. Fehlt sie, bleibt sie leer. */
  exifTakenAt: z.string().datetime({ offset: true }).nullish(),
  exifLat: z.number().min(-90).max(90).nullish(),
  exifLon: z.number().min(-180).max(180).nullish(),
  /** Uhrzeit des Geräts beim Auslösen — die Antwort im Flugmodus. */
  capturedAt: z.string().datetime({ offset: true }).nullish(),
  statedDate: isoDate.nullish(),
});
export type MediaRegisterRequest = z.infer<typeof mediaRegisterRequest>;

/** Ein Fotoauftrag aus der Lotsenkarte, mit seinem Erfüllungsstand. */
export const photoPromptStatus = z.object({
  taskId: z.string().uuid(),
  taskName: z.string(),
  taskStart: isoDate.nullable(),
  key: z.string(),
  what: z.string(),
  why: z.string().nullable(),
  /** Wie viele Fotos diesen Auftrag erfüllen. Null heißt offen. */
  fulfilledBy: z.number().int(),
  /**
   * Dringend, weil das Motiv gleich verdeckt ist. Ein Leitungsverlauf vor dem
   * Estrich ist eine Woche lang fotografierbar und danach nie wieder.
   */
  urgent: z.boolean(),
});
export type PhotoPromptStatus = z.infer<typeof photoPromptStatus>;

export const diaryChainCheck = z.object({
  /** Prüfsumme des jüngsten versiegelten Eintrags — der Kopf der Kette. */
  headHash: z.string().nullable(),
  sealedCount: z.number().int(),
  openCount: z.number().int(),
  intact: z.boolean(),
  /** Nur die Fundstellen. Eine heile Kette liefert eine leere Liste. */
  breaks: z.array(
    z.object({
      chainIndex: z.number().int(),
      entryId: z.string().uuid(),
      entryDate: isoDate,
      reason: z.string(),
    }),
  ),
});
export type DiaryChainCheck = z.infer<typeof diaryChainCheck>;

/**
 * Das Wetter in einem Satz, wie es im Tagebuch steht.
 *
 * Kein Fließtext aus Zahlen: Was zählt, sind die zwei bis drei Angaben, die
 * eine Verzögerung erklären. Frost, Dauerregen und Sturm sind Verzugsgründe,
 * Luftdruck ist keiner.
 */
export function weatherInPlainWords(weather: WeatherObservation | null): string {
  if (weather === null) return 'Wetter nicht erfasst.';

  const teile: string[] = [];
  if (weather.temperatureMinC !== null && weather.temperatureMaxC !== null) {
    teile.push(
      `${Math.round(weather.temperatureMinC)} bis ${Math.round(weather.temperatureMaxC)} °C`,
    );
  }
  if (weather.precipitationMm !== null && weather.precipitationMm > 0) {
    teile.push(`${weather.precipitationMm.toFixed(1).replace('.', ',')} mm Niederschlag`);
  }
  if (weather.windGustKmh !== null && weather.windGustKmh >= 50) {
    teile.push(`Böen bis ${Math.round(weather.windGustKmh)} km/h`);
  }
  const lage = WEATHER_CONDITION[weather.condition ?? ''];
  if (lage !== undefined) teile.push(lage);

  if (teile.length === 0) return 'Wetter nicht erfasst.';
  return `${teile.join(', ')}.`;
}

const WEATHER_CONDITION: Record<string, string> = {
  dry: 'trocken',
  fog: 'Nebel',
  rain: 'Regen',
  sleet: 'Schneeregen',
  snow: 'Schnee',
  hail: 'Hagel',
  thunderstorm: 'Gewitter',
};

/**
 * Frost und Dauerregen sind der häufigste Verzugsgrund im Rohbau — und der
 * einzige, den niemand zu vertreten hat. Steht er im Tagebuch, ist er später
 * belegt statt behauptet.
 */
export function weatherStoppedWork(weather: WeatherObservation | null): string | null {
  if (weather === null) return null;
  if (weather.temperatureMinC !== null && weather.temperatureMinC < -5) {
    return 'Bei unter minus fünf Grad ruhen Beton- und Mauerarbeiten in der Regel.';
  }
  if (weather.precipitationMm !== null && weather.precipitationMm >= 20) {
    return 'Über 20 mm Niederschlag an einem Tag — Erdarbeiten stehen dann meist still.';
  }
  if (weather.windGustKmh !== null && weather.windGustKmh >= 60) {
    return 'Ab etwa 60 km/h Böen wird der Kranbetrieb eingestellt.';
  }
  return null;
}

// -- Abstimmung ohne Konto ---------------------------------------------------
//
// Abschnitt 5.5. Die ganze Ansicht ist ein Satz und drei Knöpfe:
//
//     Für den Innenputz ist der 12.–21.05. eingetragen. Passt das?
//     [ Passt ]   [ Anderer Termin ]   [ Antworten ]
//
// Wer sie benutzt, steht auf einer Baustelle und hat das Handy in der Hand.
// Alles, was hier an Feldern steht, muss diesen einen Vorgang überstehen.

export const guestScope = z.enum([
  'confirm:task',
  'report:progress',
  'view:trade',
  'view:project',
]);
export type GuestScope = z.infer<typeof guestScope>;

/** Die fünf Sprachen aus Abschnitt 2.3. */
export const guestLocale = z.enum(['de', 'pl', 'ro', 'tr', 'en']);
export type GuestLocale = z.infer<typeof guestLocale>;

export const guestTask = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tradeName: z.string().nullable(),
  start: isoDate.nullable(),
  end: isoDate.nullable(),
  status: taskStatus,
  confirmation: confirmationLevel,
  /** Der abweichende Termin, falls einer im Raum steht. */
  counterStart: isoDate.nullable(),
  counterEnd: isoDate.nullable(),
  counterNote: z.string().nullable(),
  counterBy: z.string().nullable(),
  actualStart: isoDate.nullable(),
  actualEnd: isoDate.nullable(),
  /** Ob dieser Gast diesen Vorgang gerade bestätigen kann. */
  canConfirm: z.boolean(),
});
export type GuestTask = z.infer<typeof guestTask>;

export const guestView = z.object({
  projectName: z.string(),
  /** Adresse der Baustelle, soweit erfasst — sie steht als Überschrift. */
  siteLine: z.string().nullable(),
  memberName: z.string().nullable(),
  company: z.string().nullable(),
  role: memberRole,
  locale: guestLocale,
  scopes: z.array(guestScope),
  /** Ob Name und Firma noch gefragt werden — nur beim ersten Mal. */
  needsIntroduction: z.boolean(),
  expiresAt: z.string(),
  tasks: z.array(guestTask),
});
export type GuestView = z.infer<typeof guestView>;

/** Der Token steckt im Körper, nie in der Adresse (Abschnitt 6.4). */
const guestToken = z.string().min(20).max(200);

export const guestOpenRequest = z.object({
  token: guestToken,
  name: z.string().max(120).optional(),
  company: z.string().max(120).optional(),
});
export type GuestOpenRequest = z.infer<typeof guestOpenRequest>;

export const guestConfirmRequest = z.object({ token: guestToken });
export type GuestConfirmRequest = z.infer<typeof guestConfirmRequest>;

export const guestCounterRequest = z.object({
  token: guestToken,
  start: isoDate,
  end: isoDate,
  note: z.string().max(500).optional(),
  reason: scheduleChangeReason.optional(),
});
export type GuestCounterRequest = z.infer<typeof guestCounterRequest>;

export const guestProgressRequest = z.object({
  token: guestToken,
  actualStart: isoDate.nullish(),
  actualEnd: isoDate.nullish(),
});
export type GuestProgressRequest = z.infer<typeof guestProgressRequest>;

// -- Gast-Links verwalten (Bauherrenseite) -----------------------------------

export const guestLinkSummary = z.object({
  id: z.string().uuid(),
  memberId: z.string().uuid(),
  displayName: z.string().nullable(),
  company: z.string().nullable(),
  role: memberRole,
  tradeName: z.string().nullable(),
  scopes: z.array(guestScope),
  locale: guestLocale,
  boundEmail: z.string().nullable(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  useCount: z.number().int(),
  claimedName: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type GuestLinkSummary = z.infer<typeof guestLinkSummary>;

export const guestLinkCreateRequest = z.object({
  role: z.enum(['contractor', 'trade', 'viewer']),
  displayName: z.string().min(1).max(120),
  company: z.string().max(120).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(40).optional(),
  tradeCode: z.string().max(40).optional(),
  scopes: z.array(guestScope).min(1),
  locale: guestLocale.default('de'),
  /** Standardablauf 180 Tage (Abschnitt 2.3). */
  daysValid: z.number().int().min(1).max(730).default(180),
});
export type GuestLinkCreateRequest = z.infer<typeof guestLinkCreateRequest>;

export const guestLinkCreated = z.object({
  link: guestLinkSummary,
  /**
   * Der Klartext-Token. Er verlässt den Server **genau einmal**; danach steht
   * in der Datenbank nur noch sein Hash. Wer ihn verliert, bekommt einen neuen
   * Link — nicht denselben zurück.
   */
  url: z.string(),
});
export type GuestLinkCreated = z.infer<typeof guestLinkCreated>;

/**
 * Was ein Bestätigungsgrad im Klartext heißt (Abschnitt 3.4).
 *
 * Die Wortwahl ist die halbe Miete: *abgestimmt* statt quittiert, *zwei
 * Angaben* statt strittig. Dieselbe Datenlage, ein anderer Ton — und der
 * entscheidet, ob der Bauherr zum Telefon greift oder zum Anwalt.
 */
export function confirmationInPlainWords(
  level: z.infer<typeof confirmationLevel>,
  confirmedAt?: string | null,
): string {
  switch (level) {
    case 'self_stated':
      return 'Von dir eingetragen';
    case 'counterparty_stated':
      return 'Vom Unternehmen genannt';
    case 'mutual':
      return confirmedAt === undefined || confirmedAt === null
        ? 'Abgestimmt'
        : `Abgestimmt am ${confirmedAt.slice(8, 10)}.${confirmedAt.slice(5, 7)}.`;
    case 'disputed':
      return 'Zwei Angaben';
  }
}

// -- Frag den Lotsen ---------------------------------------------------------
//
// Abschnitt 3.7. Der Assistent steht hinter der Redaktion, nicht davor: Ohne
// die Wissensschicht darunter halluziniert er (Abschnitt 9, Punkt 4). Was
// hier an Feldern steht, dient deshalb weniger dem Gespräch als der
// Nachvollziehbarkeit — welche Karten die Antwort trägt und welche Leitplanke
// gegriffen hat.

export const assistantGuardrail = z.enum(['recht', 'mangel', 'kosten']);
export type AssistantGuardrail = z.infer<typeof assistantGuardrail>;

export const assistantMessageDto = z.object({
  id: z.string().uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  /** Die Lotsenkarten, auf denen diese Antwort steht. */
  citedCards: z.array(z.object({ id: z.string().uuid(), key: z.string(), title: z.string() })),
  guardrails: z.array(assistantGuardrail),
  createdAt: z.string(),
});
export type AssistantMessageDto = z.infer<typeof assistantMessageDto>;

export const assistantThreadDto = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  createdAt: z.string(),
  messages: z.array(assistantMessageDto),
});
export type AssistantThreadDto = z.infer<typeof assistantThreadDto>;

export const assistantAskRequest = z.object({
  threadId: z.string().uuid().nullish(),
  question: z.string().min(3).max(2000),
});
export type AssistantAskRequest = z.infer<typeof assistantAskRequest>;

/** Was der Assistent gerade kann — und was ihn gegebenenfalls aufhält. */
export const assistantStatus = z.object({
  available: z.boolean(),
  /** Warum nicht, falls nicht. Immer mit einem nächsten Schritt. */
  reason: z.string().nullable(),
  /** Verbleibende Fragen in dieser Stunde. */
  questionsLeftThisHour: z.number().int(),
  /** Anteil des Monatsdeckels, der schon verbraucht ist, in Prozent. */
  budgetUsedPercent: z.number().int(),
});
export type AssistantStatus = z.infer<typeof assistantStatus>;

/**
 * Die Einstiegsfragen.
 *
 * Ein leeres Eingabefeld ist die häufigste Sackgasse einer Chat-Oberfläche:
 * Wer nicht weiß, was er fragen kann, fragt nichts. Diese vier stehen deshalb
 * als Knöpfe da — und jede ist eine, die ein Bauherr wirklich hat.
 */
export const ASSISTANT_STARTERS: readonly string[] = [
  'Was passiert diese Woche auf meiner Baustelle?',
  'Worauf muss ich beim nächsten Vorgang achten?',
  'Welche Entscheidung ist gerade am dringendsten?',
  'Was bedeutet der Verzug für meinen Endtermin?',
];

// -- Mängel, Geld, Vertragsspiegel -------------------------------------------
//
// Abschnitt 3.9 und 3.10. Drei Themen, die eine einzige Zeile verbindet:
// „Freigabe erst möglich, wenn alle referenzierten Vorgänge fertig oder
// abgenommen sind und kein offener Mangel mit Schwere wesentlich daran hängt."

export const defectSeverity = z.enum(['geringfuegig', 'wesentlich']);
export type DefectSeverity = z.infer<typeof defectSeverity>;

export const defectStatus = z.enum([
  'offen',
  'in_bearbeitung',
  'behoben_gemeldet',
  'behoben',
  'abgelehnt',
]);
export type DefectStatus = z.infer<typeof defectStatus>;

export const defectDto = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  locationText: z.string().nullable(),
  severity: defectSeverity,
  status: defectStatus,
  taskId: z.string().uuid().nullable(),
  taskName: z.string().nullable(),
  tradeName: z.string().nullable(),
  reportedAt: z.string(),
  reportedBy: z.string().nullable(),
  deadline: isoDate.nullable(),
  escalationLevel: z.number().int(),
  /** Was jetzt dran wäre — aus der Frist gerechnet, nicht gespeichert. */
  suggestedEscalation: z.number().int(),
  resolvedAt: z.string().nullable(),
  reservedAtHandover: z.boolean(),
  mediaCount: z.number().int(),
});
export type DefectDto = z.infer<typeof defectDto>;

export const defectCreateRequest = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(4000).optional(),
  locationText: z.string().max(200).optional(),
  severity: defectSeverity.default('geringfuegig'),
  taskId: z.string().uuid().nullish(),
  deadline: isoDate.nullish(),
});
export type DefectCreateRequest = z.infer<typeof defectCreateRequest>;

export const defectUpdateRequest = z.object({
  status: defectStatus.optional(),
  severity: defectSeverity.optional(),
  deadline: isoDate.nullish(),
  escalationLevel: z.number().int().min(0).max(3).optional(),
  reservedAtHandover: z.boolean().optional(),
});
export type DefectUpdateRequest = z.infer<typeof defectUpdateRequest>;

export const paymentStatus = z.enum(['offen', 'faellig', 'freigegeben', 'teilfreigabe', 'bezahlt']);
export type PaymentStatus = z.infer<typeof paymentStatus>;

/** Was einer vollen Freigabe im Weg steht — mit Namen, nicht als Ja/Nein. */
export const paymentBlocker = z.object({
  kind: z.enum(['task', 'defect']),
  label: z.string(),
});

export const paymentMilestoneDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  triggerText: z.string().nullable(),
  pct: z.number().nullable(),
  amountCents: z.number().int(),
  requiresTaskIds: z.array(z.string().uuid()),
  requiresTaskNames: z.array(z.string()),
  isRetention: z.boolean(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  status: paymentStatus,
  releasedAt: z.string().nullable(),
  releasedBy: z.string().nullable(),
  paidAt: isoDate.nullable(),
  withheldCents: z.number().int(),
  withheldReason: z.string().nullable(),
  /** Leer heißt: Diese Rate ließe sich jetzt freigeben. */
  blockers: z.array(paymentBlocker),
});
export type PaymentMilestoneDto = z.infer<typeof paymentMilestoneDto>;

export const paymentUpdateRequest = z.object({
  status: paymentStatus.optional(),
  invoiceNumber: z.string().max(80).nullish(),
  invoiceDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  paidAt: isoDate.nullish(),
  withheldCents: z.number().int().min(0).optional(),
  withheldReason: z.string().max(500).nullish(),
});
export type PaymentUpdateRequest = z.infer<typeof paymentUpdateRequest>;

export const contractFinding = z.object({
  ruleKey: z.string(),
  severity: z.enum(['hinweis', 'warnung']),
  message: z.string(),
  legalReference: z.string().nullable(),
  dismissedAt: z.string().nullable(),
});
export type ContractFinding = z.infer<typeof contractFinding>;

export const contractUpdateRequest = z.object({
  contractType: contractType.optional(),
  contractualCompletion: isoDate.nullish(),
  buildDurationDays: z.number().int().min(0).nullish(),
  contractSumCents: z.number().int().min(0).nullish(),
  securityPct: z.number().min(0).max(100).nullish(),
  contractSignedOn: isoDate.nullish(),
  buildingDescriptionComplete: z.boolean().nullish(),
});
export type ContractUpdateRequest = z.infer<typeof contractUpdateRequest>;

export const financingDto = z.object({
  loanAmountCents: z.number().int().nullable(),
  ownFundsCents: z.number().int().nullable(),
  commitmentRateBp: z.number().int().nullable(),
  commitmentFreeMonths: z.number().int().nullable(),
  loanGrantedOn: isoDate.nullable(),
  bankName: z.string().nullable(),
});
export type FinancingDto = z.infer<typeof financingDto>;

export const loanDrawdownDto = z.object({
  id: z.string().uuid(),
  amountCents: z.number().int(),
  requestedAt: isoDate,
  paidAt: isoDate.nullable(),
  note: z.string().nullable(),
});
export type LoanDrawdownDto = z.infer<typeof loanDrawdownDto>;

export const commitmentInterestDto = z.object({
  totalCents: z.number().int(),
  chargeableFrom: isoDate.nullable(),
  undrawnAtEndCents: z.number().int(),
  costPerFurtherMonthCents: z.number().int(),
  /** Was der errechnete Verzug gegenüber dem Vertragstermin zusätzlich kostet. */
  delayCostCents: z.number().int().nullable(),
  segments: z.array(
    z.object({
      from: isoDate,
      to: isoDate,
      undrawnCents: z.number().int(),
      days: z.number().int(),
      interestCents: z.number().int(),
    }),
  ),
});
export type CommitmentInterestDto = z.infer<typeof commitmentInterestDto>;

export const contractMirror = z.object({
  contractType,
  contractualCompletion: isoDate.nullable(),
  buildDurationDays: z.number().int().nullable(),
  contractSumCents: z.number().int().nullable(),
  securityPct: z.number().nullable(),
  contractSignedOn: isoDate.nullable(),
  buildingDescriptionComplete: z.boolean().nullable(),
  /** Summe aller Abschläge in Prozent — die Zahl aus § 650m Abs. 1 BGB. */
  paymentPlanPct: z.number(),
  changeOrderSumCents: z.number().int(),
  findings: z.array(contractFinding),
  payments: z.array(paymentMilestoneDto),
  financing: financingDto.nullable(),
  drawdowns: z.array(loanDrawdownDto),
  interest: commitmentInterestDto.nullable(),
});
export type ContractMirror = z.infer<typeof contractMirror>;

/**
 * Der feste Zusatz an jedem Hinweis (Abschnitt 3.9, letzte Zeile).
 *
 * Er steht als Konstante hier und nicht als Textbaustein in fünf Regeln: So
 * kann keine Regel ihn vergessen, und wer ihn ändert, ändert ihn überall.
 */
export const LEGAL_HINT_SUFFIX = 'Hinweis auf eine Gesetzesstelle, keine Rechtsberatung.';

/**
 * Was als Nächstes zu tun ist, wenn eine Frist zur Mängelbeseitigung läuft.
 *
 * Vier Stufen, und jede ist ein Satz statt einer Zahl: „Eskalationsstufe 2"
 * sagt einem Bauherren nichts, „die Frist ist verstrichen — jetzt schriftlich
 * eine letzte Nachfrist setzen" sagt ihm alles.
 */
export const DEFECT_ESCALATION_STEPS: readonly string[] = [
  'Gemeldet. Das Unternehmen weiß Bescheid.',
  'Frist gesetzt. Bis dahin passiert erst einmal nichts weiter.',
  'Die Frist ist verstrichen. Jetzt schriftlich eine letzte Nachfrist setzen — mit Datum.',
  'Auch die Nachfrist ist vorbei. Jetzt zählt der Einbehalt, und ein Anwalt ist das Geld wert.',
];

/**
 * Welche Stufe die Frist nahelegt.
 *
 * Gerechnet, nicht gespeichert: Was der Bauherr tatsächlich getan hat, steht in
 * `escalationLevel`. Was dran wäre, ergibt sich aus dem Kalender — und die
 * beiden auseinanderzuhalten ist der Unterschied zwischen einer Erinnerung und
 * einer Behauptung.
 */
export function suggestedEscalation(
  deadline: string | null,
  status: DefectStatus,
  today: string,
): number {
  if (status === 'behoben' || status === 'abgelehnt') return 0;
  if (deadline === null) return 0;
  if (compareDates(today, deadline) <= 0) return 1;
  // `daysBetween` aus dem Berechnungskern statt `new Date`: Dieselbe Regel wie
  // dort — eine Frist, die je nach Zeitzone des Browsers einen Tag früher
  // verstreicht, ist keine Frist.
  return daysBetween(deadline, today) > 14 ? 3 : 2;
}

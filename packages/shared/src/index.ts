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

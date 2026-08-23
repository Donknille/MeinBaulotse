/**
 * Verträge zwischen Web und API.
 *
 * Ein Zod-Schema je Anfrage und Antwort, geteilt von beiden Seiten. Damit
 * kann die Oberfläche nicht auf Felder zugreifen, die die API nicht liefert,
 * und die API keine Eingaben annehmen, die die Oberfläche nie sendet.
 */

import { z } from 'zod';
import { FEDERAL_STATES } from '@meinbaulotse/schedule';

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
export type ConfirmationLevel = z.infer<typeof confirmationLevel>;

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
  /**
   * Überwiegend katholische Gemeinde — betrifft drei Feiertage.
   *
   * Steht hier, damit die Oberfläche denselben Kalender rechnen kann wie der
   * Server. Ohne diese Angabe zählt sie in Bayern drei Werktage zu viel.
   */
  catholicMunicipality: z.boolean(),
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
  actualStart: isoDate.nullable(),
  actualEnd: isoDate.nullable(),
  status: taskStatus,
  confirmation: confirmationLevel,
  totalFloatDays: z.number().int().nullable(),
  isCritical: z.boolean(),
  /**
   * Schlüssel der Lotsenkarte zu diesem Vorgang, sofern es eine gibt.
   *
   * Nur der Schlüssel, nicht die Karte: Die Planansicht braucht die Auskunft
   * „hierzu gibt es etwas zu lesen", und 38 vollständige Karten in jeder
   * Antwort wären ein Vielfaches der Nutzlast für einen Knopf.
   */
  guideCardKey: z.string().nullable(),
  /**
   * Ob der Fragende diese Karte schon offen hatte.
   *
   * Steht hier, damit die Einblendung wieder verschwindet. Eine Aufforderung,
   * die auch nach dem Lesen stehen bleibt, erzieht zum Wegsehen — und das ist
   * genau das Gegenteil dessen, wofür die Wissensschicht da ist.
   */
  guideCardRead: z.boolean(),
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

export const decision = z.object({
  id: z.string().uuid(),
  templateKey: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  /** Die Entscheidungshilfe: was die Optionen unterscheidet, was man bereut. */
  helpText: z.string().nullable(),
  blocksTaskId: z.string().uuid().nullable(),
  blocksTaskName: z.string().nullable(),
  blocksTaskStart: isoDate.nullable(),
  leadTimeDays: z.number().int(),
  leadTimeUnit: durationUnit,
  /**
   * Abgeleitet aus dem Beginn des blockierten Vorgangs, nicht selbst gesetzt.
   * Verschiebt sich der Vorgang, wandert dieses Datum mit.
   */
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

/** Gilt eine Entscheidung als erledigt? */
export function decisionIsSettled(status: DecisionStatus): boolean {
  return status === 'entschieden' || status === 'beauftragt' || status === 'hinfaellig';
}

export const projectMember = z.object({
  id: z.string().uuid(),
  role: memberRole,
  displayName: z.string().nullable(),
  company: z.string().nullable(),
  email: z.string().nullable(),
  tradeName: z.string().nullable(),
  /** Ob dieses Mitglied ein Konto hat oder nur über einen Link hereinkommt. */
  hasAccount: z.boolean(),
  /** Ob für dieses Mitglied ein gültiger Abstimmungslink besteht. */
  hasGuestLink: z.boolean(),
});
export type ProjectMemberDto = z.infer<typeof projectMember>;

export const projectSchedule = z.object({
  project: projectSummary,
  /** Wer an diesem Bauvorhaben beteiligt ist. */
  members: z.array(projectMember),
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
   * Die Entscheidungen des Bauvorhabens mit ihren Fristen.
   *
   * Sie stehen im Plan und nicht hinter einer eigenen Abfrage, weil sie zum
   * Plan gehören: Eine Verschiebung, die eine Frist reißt, muss in derselben
   * Antwort sichtbar werden wie die Verschiebung selbst.
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

/**
 * Was eine Verschiebung nach sich zieht — **bevor** sie gespeichert wird.
 *
 * Abschnitt 3.5.6: „Betroffene Folgevorgänge als Vorschlag anzeigen." Wer
 * einen Termin schiebt, soll vorher sehen, was daran hängt: sieben Vorgänge
 * und zehn Tage am Ende sind eine andere Entscheidung als ein Vorgang mit
 * Puffer.
 */
export const schedulePreviewTask = z.object({
  id: z.string().uuid(),
  name: z.string(),
  fromStart: isoDate.nullable(),
  toStart: isoDate.nullable(),
  fromEnd: isoDate.nullable(),
  toEnd: isoDate.nullable(),
  /** Verschiebung in Kalendertagen. Positiv heißt später. */
  shiftDays: z.number().int(),
});
export type SchedulePreviewTask = z.infer<typeof schedulePreviewTask>;

export const schedulePreviewDecision = z.object({
  id: z.string().uuid(),
  title: z.string(),
  fromDueDate: isoDate.nullable(),
  toDueDate: isoDate.nullable(),
});
export type SchedulePreviewDecision = z.infer<typeof schedulePreviewDecision>;

export const schedulePreview = z.object({
  /** Der Vorgang, den jemand anfassen will. */
  taskId: z.string().uuid(),
  /** Alle Vorgänge, die sich dadurch bewegen — der angefasste eingeschlossen. */
  tasks: z.array(schedulePreviewTask),
  /** Fristen, die mitwandern. */
  decisions: z.array(schedulePreviewDecision),
  previousEnd: isoDate.nullable(),
  computedEnd: isoDate.nullable(),
  /** Wie viele Werktage der Endtermin wandert. Positiv heißt später. */
  endShiftWorkdays: z.number().int(),
  /** Positiv heißt: später fertig als geschuldet. */
  deviationWorkdays: z.number().int().nullable(),
});
export type SchedulePreview = z.infer<typeof schedulePreview>;

// ---------------------------------------------------------------------------
// Wochenbericht (Abschnitt 3.11)
// ---------------------------------------------------------------------------

/**
 * Der Retention-Anker des Produkts: Montagmorgen, sechs Blöcke, in dieser
 * Reihenfolge. Sie ist dieselbe wie im Cockpit und aus demselben Grund —
 * erst wo ihr steht, dann was kommt, dann was **du** tun musst, dann erst,
 * was schiefgeht.
 */
export const weeklyReportTask = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tradeName: z.string().nullable(),
  start: isoDate.nullable(),
  end: isoDate.nullable(),
  isWait: z.boolean(),
  isMilestone: z.boolean(),
  /** Kurzfassung der Lotsenkarte, sofern es eine gibt. */
  guideCardTitle: z.string().nullable(),
  guideCardSummary: z.string().nullable(),
});
export type WeeklyReportTask = z.infer<typeof weeklyReportTask>;

export const weeklyReportDecision = z.object({
  id: z.string().uuid(),
  title: z.string(),
  dueDate: isoDate.nullable(),
  remainingWorkdays: z.number().int().nullable(),
  blocksTaskName: z.string().nullable(),
});
export type WeeklyReportDecision = z.infer<typeof weeklyReportDecision>;

export const weeklyReportChange = z.object({
  taskName: z.string().nullable(),
  field: z.string(),
  from: isoDate.nullable(),
  to: isoDate.nullable(),
  reason: z.string().nullable(),
  reasonText: z.string().nullable(),
  actorRole: memberRole.nullable(),
  changedAt: z.string(),
});
export type WeeklyReportChange = z.infer<typeof weeklyReportChange>;

export const weeklyReportPhoto = z.object({
  taskName: z.string(),
  what: z.string(),
  why: z.string(),
});
export type WeeklyReportPhoto = z.infer<typeof weeklyReportPhoto>;

export const weeklyReport = z.object({
  project: z.object({ id: z.string().uuid(), name: z.string() }),
  /** Der Montag, für den der Bericht gilt. */
  weekStart: isoDate,
  weekEnd: isoDate,
  phase: z.object({ name: z.string(), ordinal: z.number().int(), total: z.number().int() }).nullable(),
  /** 1. Diese Woche auf der Baustelle. */
  thisWeek: z.array(weeklyReportTask),
  /** 2. Was du entscheiden musst. */
  decisions: z.array(weeklyReportDecision),
  /** 3. Was sich verschoben hat — seit dem letzten Bericht. */
  changes: z.array(weeklyReportChange),
  /** 4. Prognose. */
  forecast: z.object({
    computedEnd: isoDate.nullable(),
    contractualEnd: isoDate.nullable(),
    deviationWorkdays: z.number().int().nullable(),
  }),
  /** 5. Fotos, die jetzt fällig sind. */
  photos: z.array(weeklyReportPhoto),
  /**
   * 6. Geld — nächste fällige Zahlung und ihre Voraussetzung.
   *
   * `null`, solange es keinen Zahlungsplan gibt. Ein leerer Block mit
   * Überschrift wäre ein Versprechen, das der Bericht nicht hält.
   */
  money: z
    .object({
      name: z.string(),
      amountCents: z.number().int().nullable(),
      dueDate: isoDate.nullable(),
      requirement: z.string(),
      releasable: z.boolean(),
    })
    .nullable(),
});
export type WeeklyReport = z.infer<typeof weeklyReport>;

// ---------------------------------------------------------------------------
// Tagebuch und Fotos (Abschnitt 3.8)
// ---------------------------------------------------------------------------

export const mediaItem = z.object({
  id: z.string().uuid(),
  storagePath: z.string(),
  mime: z.string(),
  bytes: z.number().int(),
  sha256: z.string(),
  /** Was die Kamera sagt. */
  exifTakenAt: z.string().nullable(),
  exifLat: z.number().nullable(),
  exifLon: z.number().nullable(),
  /** Was der Mensch sagt. Weicht es ab, wird das gezeigt, nicht versteckt. */
  statedDate: isoDate.nullable(),
  caption: z.string().nullable(),
  photoPromptKey: z.string().nullable(),
  taskId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type MediaItemDto = z.infer<typeof mediaItem>;

export const diaryEntry = z.object({
  id: z.string().uuid(),
  entryDate: isoDate,
  body: z.string(),
  authorName: z.string().nullable(),
  authorRole: memberRole.nullable(),
  weather: z.record(z.string(), z.unknown()).nullable(),
  weatherSource: z.enum(['dwd', 'manuell', 'keine']),
  taskIds: z.array(z.string().uuid()),
  /** Gesetzt heißt: versiegelt, unveränderlich, Teil der Kette. */
  lockedAt: z.string().nullable(),
  contentHash: z.string().nullable(),
  retractedAt: z.string().nullable(),
  retractionReason: z.string().nullable(),
  /** Ob der Fragende diesen Eintrag noch ändern darf. */
  editable: z.boolean(),
  media: z.array(mediaItem),
  createdAt: z.string(),
});
export type DiaryEntryDto = z.infer<typeof diaryEntry>;

export const diaryCreateRequest = z.object({
  entryDate: isoDate,
  body: z.string().trim().min(1).max(5000),
  taskIds: z.array(z.string().uuid()).max(20).optional(),
  /** Frei erfasst; die amtliche Quelle steht in `weatherSource`. */
  weather: z
    .object({
      temperatureC: z.number().min(-60).max(60).optional(),
      condition: z.string().trim().max(80).optional(),
      note: z.string().trim().max(200).optional(),
    })
    .optional(),
});
export type DiaryCreateRequest = z.infer<typeof diaryCreateRequest>;

export const diaryUpdateRequest = z
  .object({
    body: z.string().trim().min(1).max(5000).optional(),
    taskIds: z.array(z.string().uuid()).max(20).optional(),
    /** Zurückziehen. Der Eintrag bleibt sichtbar und trägt den Grund. */
    retractionReason: z.string().trim().min(3).max(500).optional(),
  })
  .refine(
    (value) =>
      value.body !== undefined ||
      value.taskIds !== undefined ||
      value.retractionReason !== undefined,
    { message: 'Es gibt nichts zu ändern.' },
  );
export type DiaryUpdateRequest = z.infer<typeof diaryUpdateRequest>;

/**
 * Ein hochgeladenes Foto anmelden.
 *
 * Die Datei selbst geht nie durch den Anwendungsserver (Abschnitt 6.1): Sie
 * liegt schon im Ablagedienst, wenn diese Anfrage kommt. Hier werden nur die
 * Angaben dazu festgehalten — darunter die Prüfsumme, die der Browser aus dem
 * Original gerechnet hat.
 */
export const mediaCreateRequest = z.object({
  storagePath: z.string().trim().min(1).max(500),
  mime: z.string().trim().min(3).max(100),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Prüfsumme als 64 Hexzeichen erwartet'),
  exifTakenAt: z.string().datetime().nullable().optional(),
  exifLat: z.number().min(-90).max(90).nullable().optional(),
  exifLon: z.number().min(-180).max(180).nullable().optional(),
  statedDate: isoDate.optional(),
  caption: z.string().trim().max(300).optional(),
  photoPromptKey: z.string().trim().max(120).optional(),
  taskId: z.string().uuid().optional(),
  diaryEntryId: z.string().uuid().optional(),
});
export type MediaCreateRequest = z.infer<typeof mediaCreateRequest>;

export const diaryChainEntry = z.object({
  entryId: z.string().uuid(),
  entryDate: isoDate,
  lockedAt: z.string(),
  ok: z.boolean(),
  reason: z.string().nullable(),
});

export const diaryChainResult = z.object({
  /** Die Prüfsumme des letzten versiegelten Eintrags — der Kopf der Kette. */
  headHash: z.string().nullable(),
  sealedCount: z.number().int(),
  intact: z.boolean(),
  entries: z.array(diaryChainEntry),
});
export type DiaryChainResult = z.infer<typeof diaryChainResult>;

// ---------------------------------------------------------------------------
// Gast-Zugang (Abschnitt 2.3 und 5.5)
// ---------------------------------------------------------------------------

export const guestScope = z.enum(['confirm:task', 'report:progress', 'view:trade', 'view:project']);
export const guestLocale = z.enum(['de', 'en', 'pl', 'ro', 'tr']);
export type GuestLocale = z.infer<typeof guestLocale>;

export const guestTaskView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  tradeName: z.string().nullable(),
  start: isoDate.nullable(),
  end: isoDate.nullable(),
  confirmation: confirmationLevel,
  isWait: z.boolean(),
  /** Was dieser Gast zuletzt geantwortet hat. */
  myAnswer: z.enum(['bestaetigt', 'gegenvorschlag']).nullable(),
});
export type GuestTaskView = z.infer<typeof guestTaskView>;

export const guestSession = z.object({
  projectName: z.string(),
  displayName: z.string().nullable(),
  role: memberRole,
  scopes: z.array(z.string()),
  locale: guestLocale,
  tasks: z.array(guestTaskView),
});
export type GuestSession = z.infer<typeof guestSession>;

/**
 * Die Antwort auf „Passt das?".
 *
 * Ein Gegenvorschlag nennt einen Termin. Ohne Termin wäre es kein Vorschlag,
 * sondern nur ein Nein — und damit könnte der Bauherr nichts anfangen.
 */
export const guestAnswerRequest = z.discriminatedUnion('agree', [
  z.object({ agree: z.literal(true) }),
  z.object({
    agree: z.literal(false),
    start: isoDate,
    end: isoDate.optional(),
    note: z.string().trim().max(500).optional(),
  }),
]);
export type GuestAnswerRequest = z.infer<typeof guestAnswerRequest>;

/** Der Token steht genau einmal in einer Antwort — danach nur noch sein Hash. */
export const guestTokenCreated = z.object({
  /** Die Kennung des Links — damit sperren lässt, wer ihn angelegt hat. */
  id: z.string().uuid(),
  token: z.string(),
  memberId: z.string().uuid(),
  displayName: z.string().nullable(),
  role: memberRole,
  scopes: z.array(z.string()),
  expiresAt: z.string(),
});
export type GuestTokenCreated = z.infer<typeof guestTokenCreated>;

export const guestTokenCreateRequest = z.object({
  memberId: z.string().uuid(),
  locale: guestLocale.optional(),
  sentTo: z.string().trim().max(200).optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});
export type GuestTokenCreateRequest = z.infer<typeof guestTokenCreateRequest>;

export const apiError = z.object({
  error: z.string(),
  /** Was der Nutzer als Nächstes tun kann — nie eine Fehlermeldung ohne Ausweg. */
  hint: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiError>;

/**
 * Klartext für eine Entscheidungsfrist.
 *
 * „noch 4 Werktage" ist eine Auskunft, „überfällig" wäre ein Vorwurf. Auch die
 * verstrichene Frist bekommt deshalb einen nächsten Schritt statt eines
 * Ausrufezeichens (CI 11.4).
 */
export function decisionDueInPlainWords(remainingWorkdays: number | null): string {
  if (remainingWorkdays === null) return 'Ohne Termin am Vorgang gibt es noch keine Frist.';
  if (remainingWorkdays < 0) {
    const tage = Math.abs(remainingWorkdays);
    return `Seit ${tage === 1 ? 'einem Werktag' : `${tage} Werktagen`} offen. Je später die Entscheidung fällt, desto enger wird es für den Vorgang.`;
  }
  if (remainingWorkdays === 0) return 'Heute ist der letzte Tag ohne Auswirkung auf den Termin.';
  if (remainingWorkdays === 1) return 'Noch ein Werktag.';
  return `Noch ${remainingWorkdays} Werktage.`;
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

// ---------------------------------------------------------------------------
// Wissensschicht (Abschnitt 3.1 und 5.2)
// ---------------------------------------------------------------------------

/**
 * Jede Aussage der Lotsenkarte trägt ihre Begründung mit.
 *
 * Das ist keine Formsache: „Randdämmstreifen prüfen" ist eine Anweisung, der
 * ein Laie folgt oder nicht. „Randdämmstreifen prüfen, sonst überträgt der
 * Estrich Schall" ist eine Auskunft, mit der er selbst entscheiden kann.
 */
export const guidePoint = z.object({ text: z.string(), why: z.string() });
export const guideQuestion = z.object({ question: z.string(), whyItMatters: z.string() });
export const guideProblem = z.object({ problem: z.string(), howToSpot: z.string() });
export const guidePhotoPrompt = z.object({ what: z.string(), why: z.string() });
export const guideSource = z.object({ reference: z.string(), note: z.string() });

export const guideCard = z.object({
  id: z.string().uuid(),
  key: z.string(),
  version: z.number().int(),
  title: z.string(),
  phaseKey: z.string(),
  tradeCode: z.string().nullable(),
  whatsHappening: z.string(),
  watchFor: z.array(guidePoint),
  questionsForContractor: z.array(guideQuestion),
  commonProblems: z.array(guideProblem),
  photoPrompts: z.array(guidePhotoPrompt),
  expertRecommended: z.boolean(),
  expertReason: z.string().nullable(),
  sources: z.array(guideSource),
});
export type GuideCardDto = z.infer<typeof guideCard>;

export const checklistItem = z.object({
  id: z.string().uuid(),
  text: z.string(),
  why: z.string().nullable(),
  sortOrder: z.number().int(),
  isDone: z.boolean(),
  doneAt: z.string().nullable(),
  note: z.string().nullable(),
});
export type ChecklistItemDto = z.infer<typeof checklistItem>;

export const guideCardView = z.object({
  card: guideCard,
  taskId: z.string().uuid(),
  taskName: z.string(),
  /** Die Checkliste entsteht aus `watchFor` und gehört ab dann dem Projekt. */
  checklist: z.array(checklistItem),
  /** `null` heißt: noch nie geöffnet. */
  read: z
    .object({ readAt: z.string(), helpful: z.boolean().nullable() })
    .nullable(),
  /** Ob der Fragende abhaken darf. Autorisiert wird trotzdem in der Datenbank. */
  canCheck: z.boolean(),
});
export type GuideCardView = z.infer<typeof guideCardView>;

/**
 * „War das hilfreich?" — die einzige Metrik, die für die Redaktion zählt
 * (Abschnitt 5.2). Zwei Knöpfe, keine Skala von eins bis fünf.
 */
export const guideFeedbackRequest = z.object({ helpful: z.boolean().nullable() });
export type GuideFeedbackRequest = z.infer<typeof guideFeedbackRequest>;

export const checklistUpdateRequest = z
  .object({
    isDone: z.boolean().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => value.isDone !== undefined || value.note !== undefined, {
    message: 'Es gibt nichts zu ändern.',
  });
export type ChecklistUpdateRequest = z.infer<typeof checklistUpdateRequest>;

/**
 * Ab wann eine Karte von selbst in den Blick rückt: sieben Tage vor Beginn
 * (Abschnitt 3.1). Gerechnet wird in Kalendertagen, denn es geht um
 * Vorbereitungszeit des Bauherrn und nicht um Arbeitstage auf der Baustelle.
 */
export const GUIDE_CARD_LEAD_DAYS = 7;

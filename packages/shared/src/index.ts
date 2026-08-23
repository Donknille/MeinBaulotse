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
/**
 * Eine Abhängigkeit lösen oder wieder verbinden.
 *
 * Der Grund ist Pflicht, aus demselben Grund wie bei einer Verschiebung: Wer
 * eine Abhängigkeit löst, greift in die Bauablauflogik ein, und in vier
 * Wochen weiß niemand mehr, warum der Maler vor dem Estrich dran war.
 */
/**
 * Die Anfrage an die Vorschau.
 *
 * Wie `taskUpdateRequest`, aber **ohne** Begründungspflicht. Eine Vorschau
 * schreibt nichts; sie beantwortet die Frage „was passiert dann?". Wer erst
 * begründen muss, um die Folgen zu sehen, begründet, bevor er sie kennt —
 * und genau darum geht es bei einer Vorschau.
 */
export const schedulePreviewRequest = z
  .object({
    earliestStart: isoDate.nullable().optional(),
    actualStart: isoDate.nullable().optional(),
    actualEnd: isoDate.nullable().optional(),
  })
  .refine(
    (value) =>
      value.earliestStart !== undefined
      || value.actualStart !== undefined
      || value.actualEnd !== undefined,
    { message: 'Es gibt nichts vorzurechnen.' },
  );
export type SchedulePreviewRequest = z.infer<typeof schedulePreviewRequest>;

export const decoupleRequest = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type DecoupleRequest = z.infer<typeof decoupleRequest>;

export const dependencyDto = z.object({
  id: z.string().uuid(),
  predecessorId: z.string().uuid(),
  predecessorName: z.string(),
  successorId: z.string().uuid(),
  successorName: z.string(),
  type: z.enum(['FS', 'SS', 'FF']),
  lagDays: z.number().int(),
  decoupledAt: z.string().nullable(),
  decoupledReason: z.string().nullable(),
});
export type DependencyDto = z.infer<typeof dependencyDto>;

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
/**
 * Eine Abhängigkeit, die diesen Vorgang mitzieht — und die sich lösen lässt.
 *
 * Abschnitt 3.5, Punkt 6: „Betroffene Folgevorgänge als Vorschlag anzeigen,
 * einzeln entkoppelbar." Ohne diese Angabe wüsste die Oberfläche nicht,
 * **welche** Kante sie zum Lösen anbieten soll — und „irgendeine lösen" wäre
 * schlimmer als gar nichts.
 */
export const previewDependency = z.object({
  id: z.string().uuid(),
  predecessorId: z.string().uuid(),
  predecessorName: z.string(),
  type: z.enum(['FS', 'SS', 'FF']),
  lagDays: z.number().int(),
});
export type PreviewDependency = z.infer<typeof previewDependency>;

export const schedulePreviewTask = z.object({
  id: z.string().uuid(),
  name: z.string(),
  fromStart: isoDate.nullable(),
  toStart: isoDate.nullable(),
  fromEnd: isoDate.nullable(),
  toEnd: isoDate.nullable(),
  /** Verschiebung in Kalendertagen. Positiv heißt später. */
  shiftDays: z.number().int(),
  /**
   * Über welche Kanten dieser Vorgang mitgezogen wird.
   *
   * Leer beim angefassten Vorgang selbst — der bewegt sich, weil jemand ihn
   * bewegt, nicht weil etwas ihn zieht.
   */
  viaDependencies: z.array(previewDependency),
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
  /**
   * Die Aufbewahrungserinnerung aus Abschnitt 6.5.
   *
   * „Aufbewahrung bis 5 Jahre nach Abnahme wegen Gewährleistung, danach
   * Erinnerung statt stiller Löschung." Das Entscheidende ist das letzte
   * Wort: Wer nach fünf Jahren feststellt, dass seine Akte weg ist, hat sie
   * genau dann verloren, als er sie vielleicht gebraucht hätte. Also erinnern
   * und den Bauherrn entscheiden lassen.
   */
  retention: z
    .object({
      acceptedOn: isoDate,
      /** Wie viele Jahre seit der Abnahme vergangen sind. */
      years: z.number().int(),
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

// -- Frag den Lotsen (Abschnitt 3.7) -----------------------------------------

/**
 * Die Anfrage trägt eine Frage und sonst nichts.
 *
 * Das ist Absicht und steht so in 6.4: „Der Kontextaufbau ist serverseitig und
 * nicht vom Client steuerbar." Ein Feld, mit dem der Client sagen könnte,
 * welche Daten in den Kontext gehören, wäre genau die Steuerung, die es nicht
 * geben soll — und der kürzeste Weg zu einem Kontext mit fremden Daten darin.
 */
export const lotseAskRequest = z.object({
  question: z.string().trim().min(3).max(2000),
  conversationId: z.string().uuid().optional(),
});
export type LotseAskRequest = z.infer<typeof lotseAskRequest>;

export const lotseGuardrail = z.enum(['recht', 'mangel', 'kosten']);
export type LotseGuardrail = z.infer<typeof lotseGuardrail>;

export const lotseConversation = z.object({
  id: z.string().uuid(),
  title: z.string(),
  updatedAt: z.string(),
});
export type LotseConversation = z.infer<typeof lotseConversation>;

/**
 * Die Hinweise kommen getrennt vom Antworttext.
 *
 * Sie sind nicht angehängter Fließtext, sondern eigene Bausteine: Die
 * Oberfläche setzt sie abgesetzt, damit erkennbar bleibt, was das Produkt
 * sagt und was das Modell. Der Zusatz „Hinweis auf eine Gesetzesstelle, keine
 * Rechtsberatung" wird nach CI 11.3 nie verkürzt und nie eingeklappt.
 */
export const lotseHint = z.object({
  kind: lotseGuardrail,
  title: z.string(),
  text: z.string(),
  reference: z.string().optional(),
});
export type LotseHint = z.infer<typeof lotseHint>;

export const lotseCardRef = z.object({ key: z.string(), title: z.string() });
export type LotseCardRef = z.infer<typeof lotseCardRef>;

/**
 * Karten und Hinweise hängen am Beitrag, nicht an der Antwort des Augenblicks.
 *
 * Sonst wären sie beim nächsten Öffnen des Gesprächs weg — und der Satz
 * „Hinweis auf eine Gesetzesstelle, keine Rechtsberatung" wird nach CI 11.3
 * nie ausgeblendet. Ein Hinweis, der nur bis zum Neuladen steht, ist genau
 * das: ausgeblendet.
 */
export const lotseMessage = z.object({
  id: z.string().uuid(),
  role: z.enum(['frage', 'antwort']),
  text: z.string(),
  cards: z.array(lotseCardRef),
  hints: z.array(lotseHint),
  createdAt: z.string(),
});
export type LotseMessage = z.infer<typeof lotseMessage>;

export const lotseAnswer = z.object({
  conversationId: z.string().uuid(),
  message: lotseMessage,
});
export type LotseAnswer = z.infer<typeof lotseAnswer>;

// -- Mängel, Geld, Vertragsspiegel (Abschnitt 3.9 und 3.10) ------------------

export const defectSeverity = z.enum(['geringfuegig', 'wesentlich']);
export type DefectSeverity = z.infer<typeof defectSeverity>;

/**
 * `strittig` hält fest, dass zwei Seiten es unterschiedlich sehen, ohne zu
 * entscheiden, wer recht hat — dieselbe Haltung wie „zwei Angaben" bei den
 * Terminen (CI 11.2).
 */
export const defectStatus = z.enum([
  'offen',
  'anerkannt',
  'behoben_gemeldet',
  'behoben',
  'strittig',
  'zurueckgestellt',
]);
export type DefectStatus = z.infer<typeof defectStatus>;

/**
 * Eine Stufe der Mängelleiter — mit dem, was jetzt dran ist.
 *
 * Der Grund, warum das im Vertrag steht und nicht nur in der Oberfläche: Der
 * nächste Schritt ist der eigentliche Inhalt. Ein Bauherr weiß nicht, dass
 * ohne Fristsetzung aus einem Mangel kein Recht wird.
 */
export const defectStep = z.object({
  level: z.number().int(),
  title: z.string(),
  next: z.string(),
  detail: z.string(),
  reference: z.string().nullable(),
});
export type DefectStep = z.infer<typeof defectStep>;

export const defectDto = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  taskName: z.string().nullable(),
  tradeId: z.string().uuid().nullable(),
  tradeName: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  locationText: z.string().nullable(),
  severity: defectSeverity,
  reportedAt: z.string(),
  deadline: isoDate.nullable(),
  status: defectStatus,
  escalationLevel: z.number().int(),
  resolvedAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  reservedAtHandover: z.boolean(),
  reportedByName: z.string().nullable(),
  photoCount: z.number().int(),
  step: defectStep,
});
export type DefectDto = z.infer<typeof defectDto>;

export const defectCreateRequest = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional(),
  locationText: z.string().trim().max(200).optional(),
  severity: defectSeverity.optional(),
  taskId: z.string().uuid().optional(),
  tradeId: z.string().uuid().optional(),
  deadline: isoDate.optional(),
});
export type DefectCreateRequest = z.infer<typeof defectCreateRequest>;

export const defectUpdateRequest = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  locationText: z.string().trim().max(200).optional(),
  severity: defectSeverity.optional(),
  status: defectStatus.optional(),
  deadline: isoDate.nullable().optional(),
  escalationLevel: z.number().int().min(0).max(4).optional(),
  /** Setzt die Stufe auf „angezeigt", ohne dass jemand eine Zahl wählen muss. */
  reportedToContractor: z.boolean().optional(),
  reservedAtHandover: z.boolean().optional(),
  note: z.string().trim().max(2000).optional(),
});
export type DefectUpdateRequest = z.infer<typeof defectUpdateRequest>;

export const paymentStatus = z.enum([
  'geplant',
  'faellig',
  'freigegeben',
  'teilfreigabe',
  'bezahlt',
]);
export type PaymentStatus = z.infer<typeof paymentStatus>;

/**
 * Was einer Freigabe im Weg steht — als Liste, nicht als Wahrheitswert.
 *
 * Abschnitt 3.10: „Sonst zeigt die Oberfläche, was fehlt." Eine Sperre ohne
 * Begründung ist für den Bauherrn dasselbe wie ein Fehler.
 */
export const paymentBlocker = z.object({ kind: z.string(), label: z.string() });
export type PaymentBlocker = z.infer<typeof paymentBlocker>;

export const paymentMilestoneDto = z.object({
  id: z.string().uuid(),
  name: z.string(),
  pct: z.number().nullable(),
  amountCents: z.number().nullable(),
  requiresTaskIds: z.array(z.string().uuid()),
  invoiceNumber: z.string().nullable(),
  invoiceDate: isoDate.nullable(),
  dueDate: isoDate.nullable(),
  status: paymentStatus,
  releasedAt: z.string().nullable(),
  paidAt: z.string().nullable(),
  withheldCents: z.number().nullable(),
  withheldReason: z.string().nullable(),
  blockers: z.array(paymentBlocker),
});
export type PaymentMilestoneDto = z.infer<typeof paymentMilestoneDto>;

export const paymentCreateRequest = z.object({
  name: z.string().trim().min(2).max(120),
  pct: z.number().min(0).max(100).optional(),
  amountCents: z.number().int().min(0).optional(),
  requiresTaskIds: z.array(z.string().uuid()).optional(),
  dueDate: isoDate.optional(),
  sortOrder: z.number().int().optional(),
});
export type PaymentCreateRequest = z.infer<typeof paymentCreateRequest>;

export const paymentReleaseRequest = z.object({
  withheldCents: z.number().int().min(0).optional(),
  withheldReason: z.string().trim().min(3).max(500).optional(),
});
export type PaymentReleaseRequest = z.infer<typeof paymentReleaseRequest>;

export const changeOrderStatus = z.enum([
  'angefragt',
  'vereinbart',
  'abgelehnt',
  'zurueckgezogen',
]);
export type ChangeOrderStatus = z.infer<typeof changeOrderStatus>;

export const changeOrderDto = z.object({
  id: z.string().uuid(),
  title: z.string(),
  triggerText: z.string().nullable(),
  bgbBasis: z.string().nullable(),
  amountCents: z.number().nullable(),
  daysImpact: z.number().int().nullable(),
  status: changeOrderStatus,
  requestedAt: z.string(),
  agreedAt: z.string().nullable(),
});
export type ChangeOrderDto = z.infer<typeof changeOrderDto>;

export const changeOrderCreateRequest = z.object({
  title: z.string().trim().min(3).max(200),
  triggerText: z.string().trim().max(2000).optional(),
  bgbBasis: z.string().trim().max(200).optional(),
  amountCents: z.number().int().optional(),
  daysImpact: z.number().int().optional(),
  status: changeOrderStatus.optional(),
});
export type ChangeOrderCreateRequest = z.infer<typeof changeOrderCreateRequest>;

export const loanDrawdownDto = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  amountCents: z.number(),
  requestedAt: isoDate,
  paidAt: isoDate.nullable(),
});
export type LoanDrawdownDto = z.infer<typeof loanDrawdownDto>;

export const moneyView = z.object({
  contractSumCents: z.number().nullable(),
  releasedCents: z.number(),
  payments: z.array(paymentMilestoneDto),
  changeOrders: z.array(changeOrderDto),
  drawdowns: z.array(loanDrawdownDto),
  loan: z
    .object({
      totalCents: z.number(),
      drawnCents: z.number(),
      interestPct: z.number().nullable(),
      freeMonths: z.number().int().nullable(),
      commitmentInterestCents: z.number().nullable(),
      commitmentDays: z.number().int().nullable(),
    })
    .nullable(),
});
export type MoneyView = z.infer<typeof moneyView>;

/**
 * Der feste Zusatz an jedem Hinweis des Vertragsspiegels (CI 11.3).
 *
 * Er steht hier und nicht in den einzelnen Texten, damit er nicht bei einem
 * vergessen werden kann. Verkürzt, ausgeblendet oder hinter einen Aufklapper
 * gelegt wird er nie.
 */
export const LEGAL_DISCLAIMER = 'Hinweis auf eine Gesetzesstelle, keine Rechtsberatung.';

export const contractFindingDto = z.object({
  id: z.string().uuid(),
  ruleKey: z.string(),
  severity: z.string(),
  message: z.string(),
  legalReference: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  dismissedReason: z.string().nullable(),
});
export type ContractFindingDto = z.infer<typeof contractFindingDto>;

export const contractMirror = z.object({
  contractType: z.string(),
  contractSumCents: z.number().nullable(),
  contractualCompletion: isoDate.nullable(),
  securityPct: z.number().nullable(),
  findings: z.array(contractFindingDto),
  descriptionItems: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      present: z.boolean(),
      note: z.string().nullable(),
      reviewed: z.boolean(),
    }),
  ),
});
export type ContractMirror = z.infer<typeof contractMirror>;

export const contractUpdateRequest = z.object({
  contractSumCents: z.number().int().min(0).nullable().optional(),
  contractualCompletion: isoDate.nullable().optional(),
  securityPct: z.number().min(0).max(100).nullable().optional(),
  loanTotalCents: z.number().int().min(0).nullable().optional(),
  commitmentInterestPct: z.number().min(0).max(20).nullable().optional(),
  commitmentFreeMonths: z.number().int().min(0).max(60).nullable().optional(),
  descriptionItems: z
    .array(z.object({ key: z.string(), present: z.boolean(), note: z.string().max(500).optional() }))
    .optional(),
});
export type ContractUpdateRequest = z.infer<typeof contractUpdateRequest>;

// -- Beteiligte einladen (Abschnitt 2.2) -------------------------------------

/**
 * `email` ist nicht zwingend, und das ist der Kern der Sache.
 *
 * Ein Mitbauherr, ein Generalunternehmer, ein Sachverständiger arbeiten in
 * der Anwendung und brauchen ein Konto — die Einladung geht an ihre Adresse.
 * Ein Einzelgewerk soll gar keins brauchen (Leitsatz 1.6.2); für es wird nur
 * die Zeile angelegt, und es bekommt einen Abstimmungslink.
 *
 * Eine Maske, die für beide eine Adresse verlangte, verlangte sie dem
 * Fliesenleger ab, der keine benutzt.
 */
export const memberInviteRequest = z.object({
  displayName: z.string().trim().min(2).max(120),
  role: memberRole,
  company: z.string().trim().max(160).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(60).optional(),
  /** Nur bei `trade`: welches Gewerk. */
  tradeCode: z.string().trim().max(60).optional(),
});
export type MemberInviteRequest = z.infer<typeof memberInviteRequest>;

// -- Bauakte (Abschnitt 5.6) -------------------------------------------------

/**
 * Ein Ereignis in der Chronologie.
 *
 * Fünf Quellen, ein Strang: Vorgänge, Terminänderungen, Tagebucheinträge,
 * Mängel, Zahlungen. Das ist der Punkt einer Akte — was am selben Tag
 * passiert ist, steht am selben Tag, und nicht in fünf Kapiteln, zwischen
 * denen der Leser hin- und herblättern muss.
 */
export const dossierEvent = z.object({
  kind: z.enum(['vorgang', 'aenderung', 'tagebuch', 'mangel', 'zahlung']),
  date: isoDate,
  title: z.string(),
  detail: z.string(),
  /** Bei Vorgängen: der Bestätigungsgrad, optisch zu unterscheiden. */
  confirmation: z.string().optional(),
  status: z.string().optional(),
  severity: z.string().optional(),
  isWait: z.boolean().optional(),
  actor: z.string().nullable().optional(),
  channel: z.string().optional(),
  /** Bei Tagebucheinträgen: versiegelt, mit Prüfsumme. */
  sealed: z.boolean().optional(),
  hash: z.string().nullable().optional(),
  retracted: z.boolean().optional(),
  mediaIds: z.array(z.string().uuid()),
});
export type DossierEvent = z.infer<typeof dossierEvent>;

/**
 * Die Fotos der Akte sind dieselben wie überall — `mediaItem`.
 *
 * Eine eigene, kleinere Form wäre schnell geschrieben und hätte eine zweite
 * Ansicht nötig gemacht: Das Bauteil, das ein Foto darstellt, gibt es schon,
 * samt der Regel, dass eine abweichende Aufnahmezeit angezeigt und nicht
 * versteckt wird. Genau die will man in einer Akte nicht verlieren.
 */
export const dossierPhoto = mediaItem;
export type DossierPhoto = z.infer<typeof dossierPhoto>;

export const dossier = z.object({
  project: z.object({
    id: z.string().uuid(),
    name: z.string(),
    address: z.string(),
    federalState: z.string(),
    buildType: z.string(),
    contractType: z.string(),
    hasBasement: z.boolean(),
    plannedStart: isoDate,
    contractualCompletion: isoDate.nullable(),
    contractSumCents: z.number().nullable(),
    securityPct: z.number().nullable(),
  }),
  period: z.object({ from: isoDate, to: isoDate }),
  members: z.array(
    z.object({
      displayName: z.string().nullable(),
      company: z.string().nullable(),
      role: z.string(),
      tradeName: z.string().nullable(),
      email: z.string().nullable(),
    }),
  ),
  /** Die Prüfsumme der Tagebuchkette — sie gehört aufs Deckblatt. */
  chain: z.object({
    headHash: z.string().nullable(),
    sealedCount: z.number().int(),
    intact: z.boolean(),
  }),
  events: z.array(dossierEvent),
  photos: z.array(dossierPhoto),
  createdAt: z.string(),
});
export type Dossier = z.infer<typeof dossier>;

import type { IsoDate } from './civil-date.js';

export type TaskId = string;

/**
 * Arbeitsvorgänge zählen in Werktagen, technologische Wartezeiten in
 * Kalendertagen. Die beiden werden nirgends vermischt.
 */
export type DurationUnit = 'werktage' | 'kalendertage';

/** Anordnungsbeziehungen nach DIN 69900. */
export type DependencyType = 'FS' | 'SS' | 'FF';

export interface ScheduleTask {
  id: TaskId;
  /**
   * Dauer **einschließlich** des Starttags. Vier Werktage ab Montag enden am
   * Donnerstag. Meilensteine haben die Dauer 0.
   */
  durationDays: number;
  /** Standard `werktage`. */
  durationUnit?: DurationUnit;
  isMilestone?: boolean;
  /**
   * Technologische Wartezeit — Trocknung, Aushärtung. Läuft in Kalendertagen,
   * darf an Wochenenden und Feiertagen beginnen und enden und ist nicht
   * verkürzbar.
   */
  isWait?: boolean;
  /** Für Betriebsferien des ausführenden Gewerks. */
  tradeCode?: string;
  /** Gemeldeter Ist-Beginn. Überschreibt die Rechnung. */
  actualStart?: IsoDate;
  /** Gemeldetes Ist-Ende. Überschreibt die Rechnung. */
  actualEnd?: IsoDate;
  /** Anfangsbeschränkung: nicht früher als. */
  earliestStart?: IsoDate;
}

export interface ScheduleDependency {
  predecessorId: TaskId;
  successorId: TaskId;
  /** Standard `FS`. */
  type?: DependencyType;
  /** Standard 0. Negative Werte ziehen den Nachfolger vor. */
  lagDays?: number;
  /** Standard `werktage`. */
  lagUnit?: DurationUnit;
}

export interface ScheduledTask {
  id: TaskId;
  start: IsoDate;
  end: IsoDate;
  /** Frühester Anfang aus der Vorwärtsrechnung. */
  earlyStart: IsoDate;
  /** Frühestes Ende aus der Vorwärtsrechnung. */
  earlyFinish: IsoDate;
  isWait: boolean;
  isMilestone: boolean;
  durationDays: number;
  durationUnit: DurationUnit;
  /** True, sobald ein Ist-Termin die Rechnung überschrieben hat. */
  pinned: boolean;
}

export interface ScheduleResult {
  tasks: ReadonlyMap<TaskId, ScheduledTask>;
  /** Topologische Reihenfolge, in der gerechnet wurde. */
  order: readonly TaskId[];
  projectStart: IsoDate;
  /** Spätestes Ende aller Vorgänge. */
  projectEnd: IsoDate;
}

export interface FloatResult {
  taskId: TaskId;
  lateStart: IsoDate;
  lateFinish: IsoDate;
  /** Gesamtpuffer in **Werktagen**. Negativ bedeutet: Endtermin ist gerissen. */
  totalFloatDays: number;
  isCritical: boolean;
}

export interface CriticalPathResult {
  floats: ReadonlyMap<TaskId, FloatResult>;
  critical: readonly TaskId[];
  /** Bezugsende der Rückwärtsrechnung. */
  targetEnd: IsoDate;
  /**
   * Abweichung zwischen errechnetem und geschuldetem Ende, in Werktagen.
   * Positiv bedeutet: später fertig als geschuldet.
   */
  deviationWorkdays: number;
}

/**
 * Beschriftungen für Rollen und Rechte.
 *
 * Hier steht **nur**, wie etwas heißt — nicht, wer was darf. Welche Rechte an
 * einer Rolle hängen, kommt aus `role_permission` in der Datenbank und erreicht
 * die Oberfläche über `schedule.permissions`. Wer die Matrix ändert, ändert die
 * Seed-Migration; diese Datei bleibt davon unberührt.
 *
 * Die Reihenfolge unten ist die der Rechtematrix aus Abschnitt 2.2 der
 * Spezifikation. Sie bestimmt, in welcher Folge die Zeilen erscheinen.
 */

import type { ProjectSummary } from '@meinbaulotse/shared';

export const ROLE_LABEL: Record<ProjectSummary['role'], string> = {
  owner: 'Bauherr',
  co_owner: 'Zweiter Bauherr',
  contractor: 'Generalunternehmer',
  trade: 'Gewerk',
  expert: 'Baubegleiter',
  viewer: 'Mitleser',
};

/** Ein Satz in der zweiten Person: Was diese Rolle im Projekt tut. */
export const ROLE_DESCRIPTION: Record<ProjectSummary['role'], string> = {
  owner: 'Dir gehört dieses Bauvorhaben. Du entscheidest, du gibst frei.',
  co_owner: 'Du führst das Bauvorhaben gemeinsam mit dem Bauherrn.',
  contractor: 'Du führst aus und meldest Termine. Entschieden wird beim Bauherrn.',
  trade: 'Du siehst deine eigenen Vorgänge und meldest dazu zurück.',
  expert: 'Du begleitest fachlich: prüfen, erfassen, vorschlagen.',
  viewer: 'Du liest mit.',
};

interface PermissionLabel {
  permission: string;
  /** Was die Rolle damit tun kann, in der zweiten Person. */
  can: string;
  /** Dasselbe als Fehlanzeige, für die Zeilen ohne Recht. */
  cannot: string;
  /**
   * Vorschlagsrechte erscheinen nur, wenn die Rolle sie hat. Dem Bauherrn zu
   * sagen, er dürfe nicht *vorschlagen*, dass ein Mangel behoben ist, wäre
   * richtig und trotzdem unsinnig: Er setzt ihn direkt.
   */
  onlyWhenHeld?: boolean;
}

const PERMISSION_LABELS: readonly PermissionLabel[] = [
  {
    permission: 'task.write',
    can: 'Vorgänge anlegen und löschen',
    cannot: 'Vorgänge anlegen oder löschen',
  },
  { permission: 'task.schedule', can: 'Termine ändern', cannot: 'Termine ändern' },
  { permission: 'task.confirm', can: 'Termine bestätigen', cannot: 'Termine bestätigen' },
  {
    permission: 'task.progress',
    can: 'Ist-Beginn und Ist-Ende melden',
    cannot: 'Ist-Beginn und Ist-Ende melden',
  },
  { permission: 'diary.write', can: 'Tagebucheinträge schreiben', cannot: 'Tagebuch führen' },
  { permission: 'defect.write', can: 'Mängel erfassen', cannot: 'Mängel erfassen' },
  {
    permission: 'defect.resolve',
    can: 'Mängel auf behoben setzen',
    cannot: 'Mängel auf behoben setzen',
  },
  {
    permission: 'defect.resolve.propose',
    can: 'vorschlagen, dass ein Mangel behoben ist',
    cannot: 'vorschlagen, dass ein Mangel behoben ist',
    onlyWhenHeld: true,
  },
  { permission: 'decision.write', can: 'Entscheidungen pflegen', cannot: 'Entscheidungen pflegen' },
  {
    permission: 'decision.propose',
    can: 'Entscheidungen vorschlagen',
    cannot: 'Entscheidungen vorschlagen',
    onlyWhenHeld: true,
  },
  { permission: 'member.invite', can: 'Mitglieder einladen', cannot: 'Mitglieder einladen' },
  { permission: 'payment.release', can: 'Zahlungen freigeben', cannot: 'Zahlungen freigeben' },
  { permission: 'contract.write', can: 'Vertragsdaten pflegen', cannot: 'Vertragsdaten pflegen' },
  { permission: 'export.run', can: 'die Bauakte exportieren', cannot: 'die Bauakte exportieren' },
  {
    permission: 'project.delete',
    can: 'das Projekt löschen',
    cannot: 'das Projekt löschen',
  },
];

export interface RoleAbilities {
  allowed: string[];
  denied: string[];
}

/**
 * Teilt die Matrixzeilen in Kann und Kann-nicht.
 *
 * `project.read` bleibt außen vor: Lesen darf jede Rolle, sonst wäre sie nicht
 * im Projekt. Eine Zeile, die immer gleich lautet, sagt nichts.
 */
export function abilitiesOf(permissions: readonly string[]): RoleAbilities {
  const held = new Set(permissions);
  const allowed: string[] = [];
  const denied: string[] = [];

  for (const label of PERMISSION_LABELS) {
    if (held.has(label.permission)) allowed.push(label.can);
    else if (label.onlyWhenHeld !== true) denied.push(label.cannot);
  }

  return { allowed, denied };
}

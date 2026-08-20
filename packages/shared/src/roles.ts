/**
 * Rollen und Rechte im Klartext.
 *
 * Hier steht ausschließlich **Wortwahl**, keine Autorität. Ob eine Änderung
 * durchgeht, entscheidet `mbl.has_perm()` in der Datenbank; welche Rolle
 * welches Recht trägt, liefert `GET /api/v1/roles` aus `role_permission`. Ein
 * Knopf, den die Oberfläche ausblendet, ist keine Rechteprüfung — er ist eine
 * Höflichkeit gegenüber dem Nutzer, der sonst gegen eine verschlossene Tür
 * liefe.
 */

import { z } from 'zod';

export const MEMBER_ROLES = [
  'owner',
  'co_owner',
  'contractor',
  'trade',
  'expert',
  'viewer',
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Abschnitt 2.1 der Spezifikation, in der Sprache des Bauherrn. */
export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Bauherr',
  co_owner: 'Zweiter Bauherr',
  contractor: 'Generalunternehmer',
  trade: 'Einzelgewerk',
  expert: 'Baubegleiter',
  viewer: 'Mitleser',
};

export const ROLE_DESCRIPTION: Record<MemberRole, string> = {
  owner: 'Dir gehört das Projekt und alles, was darin steht.',
  co_owner: 'Dein Partner. Sieht und darf dasselbe wie du, nur löschen kann er das Projekt nicht.',
  contractor: 'Der GU oder sein Bauleiter. Trägt Termine ein und bestätigt sie.',
  trade: 'Ein einzelnes Gewerk. Sieht nur die eigenen Vorgänge, sonst nichts.',
  expert: 'Sachverständiger oder Architekt. Liest alles, erfasst Mängel, ändert keine Termine.',
  viewer: 'Familie, Bank, stiller Mitleser. Liest, ändert nichts.',
};

/**
 * Die Rechte aus Abschnitt 2.2, als Satz statt als Kürzel. Der Schlüssel ist
 * derselbe wie in `role_permission.permission`.
 */
export const PERMISSION_LABEL: Record<string, string> = {
  'project.read': 'Projekt lesen',
  'project.delete': 'Projekt löschen',
  'member.invite': 'Beteiligte einladen',
  'task.write': 'Vorgänge anlegen und löschen',
  'task.schedule': 'Termine ändern',
  'task.confirm': 'Termine bestätigen',
  'task.report': 'Ist-Beginn und Ist-Ende melden',
  'decision.write': 'Entscheidungen pflegen',
  'decision.propose': 'Entscheidungen vorschlagen',
  'diary.write': 'Tagebucheinträge erstellen',
  'defect.write': 'Mängel erfassen',
  'defect.resolve': 'Mängel auf behoben setzen',
  'defect.propose_resolve': 'Behebung vorschlagen',
  'payment.release': 'Zahlungen freigeben',
  'contract.write': 'Vertragsdaten pflegen',
  'export.file': 'Bauakte exportieren',
};

export const memberRole = z.enum(MEMBER_ROLES);

/** Die Rechtematrix, wie sie aus `role_permission` kommt. */
export const roleMatrix = z.object({
  matrix: z.record(memberRole, z.array(z.string())),
});
export type RoleMatrix = z.infer<typeof roleMatrix>;

/**
 * Was diese Rolle darf — leere Liste, wenn die Matrix noch nicht geladen ist.
 *
 * Bewusst ohne Voreinstellung „alles erlaubt": Solange die Antwort aussteht,
 * ist weniger sichtbar. Der umgekehrte Fehler wäre ein Knopf, der beim Drücken
 * eine Fehlermeldung auslöst.
 */
export function permissionsOf(matrix: RoleMatrix['matrix'] | undefined, role: MemberRole): string[] {
  return matrix?.[role] ?? [];
}

/**
 * Die Rechtematrix aus Abschnitt 2.2 der Spezifikation.
 *
 * Sie steht hier als Erstbefüllung und wandert per Seed-Migration in die
 * Tabelle `role_permission`. Zur Laufzeit fragt ausschließlich
 * `mbl.has_perm()` — also die Datenbank — die Rechte ab. Diese Datei ist
 * niemals die Autorität; sie ist die Quelle, aus der die Autorität befüllt wird.
 */

export const MEMBER_ROLES = [
  'owner',
  'co_owner',
  'contractor',
  'trade',
  'expert',
  'viewer',
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface PermissionDefinition {
  permission: string;
  /** Zeile aus der Rechtematrix, für die Nachvollziehbarkeit. */
  matrixRow: string;
  roles: readonly MemberRole[];
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  {
    permission: 'project.read',
    matrixRow: 'Lesen',
    roles: ['owner', 'co_owner', 'contractor', 'trade', 'expert', 'viewer'],
  },
  {
    permission: 'project.delete',
    matrixRow: 'Projekt anlegen/löschen',
    roles: ['owner'],
  },
  {
    permission: 'member.invite',
    matrixRow: 'Mitglieder einladen',
    roles: ['owner', 'co_owner'],
  },
  {
    permission: 'task.write',
    matrixRow: 'Vorgänge anlegen/löschen',
    roles: ['owner', 'co_owner', 'contractor'],
  },
  {
    // Zeilenschärfe für `trade` erledigt mbl.trade_scope_ok: eigener Vorgang.
    permission: 'task.schedule',
    matrixRow: 'Termin ändern',
    roles: ['owner', 'co_owner', 'contractor', 'trade'],
  },
  {
    permission: 'task.confirm',
    matrixRow: 'Termin bestätigen',
    roles: ['owner', 'co_owner', 'contractor', 'trade'],
  },
  {
    permission: 'task.progress',
    matrixRow: 'Ist-Beginn/Ist-Ende melden',
    roles: ['owner', 'co_owner', 'contractor', 'trade'],
  },
  {
    permission: 'decision.write',
    matrixRow: 'Entscheidung pflegen',
    roles: ['owner', 'co_owner'],
  },
  {
    permission: 'decision.propose',
    matrixRow: 'Entscheidung pflegen (Vorschlag)',
    roles: ['expert'],
  },
  {
    permission: 'diary.write',
    matrixRow: 'Tagebucheintrag erstellen',
    roles: ['owner', 'co_owner', 'contractor', 'expert'],
  },
  {
    permission: 'defect.write',
    matrixRow: 'Mangel erfassen',
    roles: ['owner', 'co_owner', 'expert'],
  },
  {
    permission: 'defect.resolve',
    matrixRow: 'Mangel auf behoben setzen',
    roles: ['owner', 'co_owner'],
  },
  {
    permission: 'defect.resolve.propose',
    matrixRow: 'Mangel auf behoben setzen (Vorschlag)',
    roles: ['contractor', 'trade', 'expert'],
  },
  {
    permission: 'payment.release',
    matrixRow: 'Zahlungsfreigabe',
    roles: ['owner', 'co_owner'],
  },
  {
    permission: 'contract.write',
    matrixRow: 'Vertragsdaten pflegen',
    roles: ['owner', 'co_owner', 'expert'],
  },
  {
    permission: 'export.run',
    matrixRow: 'Akte exportieren',
    roles: ['owner', 'co_owner', 'expert'],
  },
];

/** Alle Rechte einer Rolle — nur für Tests und die Oberfläche, nie für Autorisierung. */
export function permissionsOf(role: MemberRole): readonly string[] {
  return PERMISSIONS.filter((entry) => entry.roles.includes(role)).map(
    (entry) => entry.permission,
  );
}

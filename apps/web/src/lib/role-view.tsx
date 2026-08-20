/**
 * Rollenansicht — „was sieht eigentlich mein GU?"
 *
 * Zwei Dinge, die im Produkt gern verwechselt werden, sind hier ausdrücklich
 * getrennt:
 *
 *   1. **Die Rolle eines Beteiligten ändern.** Das ist eine echte Änderung an
 *      den Daten, sie steht unter „Beteiligte" und läuft über die API. Sie
 *      wirkt für die betroffene Person, nicht für dich.
 *
 *   2. **Die Ansicht wechseln.** Das ist eine Vorschau: Du bleibst, wer du
 *      bist, und siehst die Anwendung so, wie sie sich für eine andere Rolle
 *      darstellt. Nützlich, bevor du jemanden einlädst — und ehrlicher als
 *      eine Rechtematrix im Handbuch.
 *
 * Die Vorschau kann ausschließlich **wegnehmen**, nie hinzufügen: Was gezeigt
 * wird, ist der Durchschnitt aus deinen echten Rechten und denen der gewählten
 * Rolle. Und selbst wenn sie es anders täte, änderte das nichts — jede
 * Schreiboperation prüft die Datenbank noch einmal. Die Vorschau ist eine
 * Darstellung, keine Rechteverwaltung.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MemberRole, ProjectSchedule, ProjectSummary } from '@meinbaulotse/shared';
import { api } from './api';

export interface RoleView {
  /** Die Rolle, in der du gerade siehst. Ohne Vorschau ist das deine eigene. */
  role: MemberRole;
  /** Nur bei `trade`: das Gewerk, auf das die Vorschau eingeschränkt ist. */
  tradeCode: string | null;
  /** Läuft gerade eine Vorschau, oder ist das deine echte Rolle? */
  isPreview: boolean;
}

interface RoleViewState {
  preview: { role: MemberRole; tradeCode: string | null } | null;
  setPreview: (next: { role: MemberRole; tradeCode: string | null } | null) => void;
}

const RoleViewContext = createContext<RoleViewState>({
  preview: null,
  setPreview: () => undefined,
});

export function RoleViewProvider({ children }: { children: ReactNode }) {
  const [preview, setPreview] = useState<RoleViewState['preview']>(null);
  const value = useMemo(() => ({ preview, setPreview }), [preview]);
  return <RoleViewContext.Provider value={value}>{children}</RoleViewContext.Provider>;
}

export function useRoleViewControl(): RoleViewState {
  return useContext(RoleViewContext);
}

/** Die Rechtematrix aus der Datenbank. Einmal geladen, selten geändert. */
export function useRoleMatrix() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => api.roles(),
    staleTime: 60 * 60 * 1000,
  });
}

export function useRoleView(project: ProjectSummary | undefined): RoleView {
  const { preview } = useRoleViewControl();
  if (project === undefined) {
    return { role: 'viewer', tradeCode: null, isPreview: false };
  }
  if (preview === null || preview.role === project.role) {
    return { role: project.role, tradeCode: null, isPreview: false };
  }
  return { role: preview.role, tradeCode: preview.tradeCode, isPreview: true };
}

/**
 * Was in dieser Ansicht erlaubt ist.
 *
 * Ohne Vorschau sind das schlicht die Rechte, die die API zum Projekt
 * mitgeliefert hat. Mit Vorschau die Schnittmenge — mehr als deine echten
 * Rechte zeigt die Vorschau nie an.
 */
export function usePermissions(
  project: ProjectSummary | undefined,
  view: RoleView,
): (permission: string) => boolean {
  const matrix = useRoleMatrix();

  return useMemo(() => {
    const own = new Set(project?.permissions ?? []);
    if (!view.isPreview) return (permission: string) => own.has(permission);

    const previewed = matrix.data?.matrix[view.role];
    if (previewed === undefined) {
      // Solange die Matrix aussteht, ist weniger sichtbar. Der umgekehrte
      // Fehler wäre ein Knopf, der beim Drücken eine Fehlermeldung auslöst.
      return () => false;
    }
    const allowed = new Set(previewed.filter((permission) => own.has(permission)));
    return (permission: string) => allowed.has(permission);
  }, [project?.permissions, view.isPreview, view.role, matrix.data]);
}

/**
 * Der Ausschnitt des Plans, den diese Ansicht zeigt.
 *
 * Für ein Einzelgewerk sind das ausschließlich die eigenen Vorgänge — dieselbe
 * Einschränkung, die serverseitig `mbl.trade_scope_ok` durchsetzt. Hier wird
 * sie nachgebildet, damit die Vorschau ehrlich ist; verlassen tut sich darauf
 * niemand.
 */
export function scheduleForView(schedule: ProjectSchedule, view: RoleView): ProjectSchedule {
  if (view.role !== 'trade' || view.tradeCode === null) return schedule;

  const tasks = schedule.tasks.filter((task) => task.tradeCode === view.tradeCode);
  const visible = new Set(tasks.map((task) => task.phaseKey));

  return {
    ...schedule,
    tasks,
    phases: schedule.phases.map((phase) =>
      visible.has(phase.key)
        ? {
            ...phase,
            taskCount: tasks.filter((task) => task.phaseKey === phase.key).length,
            firstStart: minOf(tasks.filter((t) => t.phaseKey === phase.key).map((t) => t.currentStart)),
            lastEnd: maxOf(tasks.filter((t) => t.phaseKey === phase.key).map((t) => t.currentEnd)),
          }
        : { ...phase, taskCount: 0, firstStart: null, lastEnd: null },
    ),
  };
}

function minOf(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null);
  return present.length === 0 ? null : present.reduce((a, b) => (a < b ? a : b));
}

function maxOf(values: readonly (string | null)[]): string | null {
  const present = values.filter((value): value is string => value !== null);
  return present.length === 0 ? null : present.reduce((a, b) => (a > b ? a : b));
}

/**
 * Rahmen aller Projektansichten: Kopfzeile, Navigation, Rollenansicht.
 *
 * Die Daten werden hier einmal geholt und über den Outlet-Kontext
 * weitergereicht. Jede Unterseite noch einmal laden zu lassen hieße, den Plan
 * beim Wechsel zwischen Cockpit und Terminplan zweimal zu ziehen — und der
 * Bauherr steht mit dem Handy auf einer Baustelle, nicht im Büro am Glasfaser.
 */

import { NavLink, Outlet, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, Compass, History, Settings, Users } from 'lucide-react';
import type { DecisionDto, ProjectSchedule } from '@meinbaulotse/shared';
import { api } from '../lib/api';
import { Button, EmptyState } from '../components/ui';
import { RoleSwitch } from '../components/RoleSwitch';
import { Topmark } from './SignIn';
import { signOut } from '../lib/supabase';
import { scheduleForView, useRoleView, usePermissions, type RoleView } from '../lib/role-view';

export interface ProjectContext {
  projectId: string;
  /** Der Plan, wie ihn die gewählte Ansicht zeigt. */
  schedule: ProjectSchedule;
  /** Der ganze Plan, unabhängig von der Vorschau — für Zähler und Kopfzeile. */
  full: ProjectSchedule;
  decisions: DecisionDto[];
  view: RoleView;
  can: (permission: string) => boolean;
}

export function useProject(): ProjectContext {
  return useOutletContext<ProjectContext>();
}

const TABS = [
  { to: '.', end: true, label: 'Cockpit', icon: Compass },
  { to: 'plan', end: false, label: 'Terminplan', icon: CalendarDays },
  { to: 'entscheidungen', end: false, label: 'Entscheidungen', icon: ClipboardList },
  { to: 'beteiligte', end: false, label: 'Beteiligte', icon: Users },
  { to: 'verlauf', end: false, label: 'Verlauf', icon: History },
  { to: 'einstellungen', end: false, label: 'Projekt', icon: Settings },
] as const;

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();

  const scheduleQuery = useQuery({
    queryKey: ['schedule', projectId],
    queryFn: () => api.schedule(projectId!),
    enabled: projectId !== undefined,
  });

  const project = scheduleQuery.data?.project;
  const view = useRoleView(project);
  const can = usePermissions(project, view);

  // Ein Einzelgewerk sieht keine Entscheidungen — die Policy lehnt die Abfrage
  // gar nicht ab, sie liefert nichts. Trotzdem wird sie erst gar nicht
  // gestellt: eine Anfrage, deren Antwort feststeht, ist eine Anfrage zu viel.
  const decisionsQuery = useQuery({
    queryKey: ['decisions', projectId],
    queryFn: () => api.decisions(projectId!),
    enabled: projectId !== undefined && project !== undefined && project.role !== 'trade',
  });

  if (scheduleQuery.isPending) {
    return <Frame>{<p className="text-body text-steel">Der Plan wird geladen.</p>}</Frame>;
  }
  if (scheduleQuery.isError || scheduleQuery.data === undefined || project === undefined) {
    return (
      <Frame>
        <EmptyState
          text="Dieses Projekt konnten wir nicht laden. Prüf bitte den Link, oder öffne es noch einmal aus deiner Übersicht."
          action={
            <NavLink to="/">
              <Button variant="primary" size="field">
                Zur Übersicht
              </Button>
            </NavLink>
          }
        />
      </Frame>
    );
  }

  const full = scheduleQuery.data;
  const context: ProjectContext = {
    projectId: projectId!,
    full,
    schedule: scheduleForView(full, view),
    decisions: view.role === 'trade' ? [] : (decisionsQuery.data?.decisions ?? []),
    view,
    can,
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-ash bg-canvas-white">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 px-4 pt-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <NavLink to="/" className="flex items-center gap-3 text-charcoal">
              <Topmark size={22} />
              <span className="text-body font-medium">MeinBaulotse</span>
              <span className="text-body text-silver">/</span>
              <span className="text-body text-steel">{full.project.name}</span>
            </NavLink>

            <div className="flex items-center gap-2">
              <RoleSwitch project={full.project} tasks={full.tasks} view={view} />
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                Abmelden
              </Button>
            </div>
          </div>

          <nav className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map((tab) => (
              <NavLink
                key={tab.label}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-body transition-colors duration-[var(--motion-micro)] ${
                    isActive
                      ? 'border-b-charcoal font-medium text-charcoal'
                      : 'border-b-transparent text-steel hover:text-charcoal'
                  }`
                }
              >
                <tab.icon size={16} aria-hidden />
                {tab.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      {view.isPreview ? <PreviewBanner view={view} /> : null}

      <main className="mx-auto flex w-full max-w-[1200px] grow flex-col gap-10 px-4 py-8 sm:px-6">
        <Outlet context={context} />
      </main>
    </div>
  );
}

function PreviewBanner({ view }: { view: RoleView }) {
  return (
    <div className="border-b border-soft-violet bg-soft-violet">
      <p className="mx-auto w-full max-w-[1200px] px-4 py-2 text-caption text-lavender sm:px-6">
        Vorschau. Du siehst gerade, was ein
        {view.tradeCode === null ? '' : ` ${view.tradeCode.toUpperCase()}-`} Beteiligter mit dieser
        Rolle sieht. Deine eigenen Rechte sind unverändert — geändert hat sich nur die Darstellung.
      </p>
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-10 px-4 py-8 sm:px-6">
      {children}
    </main>
  );
}

/**
 * Der Rollenwechsel in der Kopfzeile.
 *
 * Er ändert **nichts an den Daten**. Er beantwortet die Frage, die sich jeder
 * Bauherr stellt, bevor er jemanden einlädt: „Was sieht der dann eigentlich?"
 * Die Antwort in einer Tabelle im Handbuch nachzuschlagen, macht niemand — in
 * der eigenen Baustelle nachzusehen, schon.
 *
 * Wer die Rolle eines Beteiligten wirklich ändern will, tut das unter
 * „Beteiligte". Der Unterschied steht auch im Menü, damit ihn niemand
 * verwechselt.
 */

import { useState } from 'react';
import { Eye, ChevronDown, RotateCcw } from 'lucide-react';
import {
  MEMBER_ROLES,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
  type MemberRole,
  type ProjectSummary,
  type ScheduledTaskDto,
} from '@meinbaulotse/shared';
import { useRoleViewControl, type RoleView } from '../lib/role-view';

export function RoleSwitch({
  project,
  tasks,
  view,
}: {
  project: ProjectSummary;
  tasks: readonly ScheduledTaskDto[];
  view: RoleView;
}) {
  const { setPreview } = useRoleViewControl();
  const [open, setOpen] = useState(false);

  // Nur die Gewerke, die in diesem Plan tatsächlich vorkommen. Eine Vorschau
  // auf ein Gewerk ohne Vorgänge zeigte eine leere Seite und erklärte nichts.
  const trades = [
    ...new Map(
      tasks
        .filter((task) => task.tradeCode !== null)
        .map((task) => [task.tradeCode!, task.tradeName ?? task.tradeCode!] as const),
    ),
  ].sort((a, b) => a[1].localeCompare(b[1], 'de'));

  function choose(role: MemberRole, tradeCode: string | null): void {
    setPreview(role === project.role ? null : { role, tradeCode });
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`inline-flex h-9 items-center gap-2 rounded-[var(--radius-button)] border px-3 text-body transition-colors duration-[var(--motion-micro)] ${
          view.isPreview
            ? 'border-lavender bg-soft-violet text-lavender'
            : 'border-ash bg-canvas-white text-charcoal hover:bg-paper-mist'
        }`}
      >
        <Eye size={16} aria-hidden />
        <span className="hidden sm:inline">Ansicht:</span>
        <span className="font-medium">{ROLE_LABEL[view.role]}</span>
        <ChevronDown size={14} aria-hidden />
      </button>

      {open ? (
        <>
          {/* Ein Klick daneben schließt. Kein Overlay, das den Hintergrund
              abdunkelt — dies ist ein Menü, keine Entscheidung. */}
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Menü schließen"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-[var(--radius-card)] border border-ash bg-canvas-white p-2 shadow-[var(--shadow-sheet)]"
          >
            <p className="px-3 py-2 text-caption text-fog">
              Sieh die Anwendung mit den Augen eines Beteiligten. Deine Rechte bleiben, wie sie
              sind — geändert wird nur, was dir angezeigt wird.
            </p>

            {MEMBER_ROLES.map((role) => {
              const isOwn = role === project.role;
              const isActive = view.role === role;

              if (role === 'trade') {
                return (
                  <div key={role} className="px-3 py-2">
                    <p className="text-body font-medium text-charcoal">{ROLE_LABEL.trade}</p>
                    <p className="mb-2 text-caption text-steel">{ROLE_DESCRIPTION.trade}</p>
                    {trades.length === 0 ? (
                      <p className="text-caption text-fog">
                        In diesem Plan ist noch kein Gewerk hinterlegt.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {trades.map(([code, name]) => (
                          <button
                            key={code}
                            type="button"
                            onClick={() => choose('trade', code)}
                            className={`rounded-[var(--radius-pill)] px-2.5 py-1 text-caption font-medium transition-colors duration-[var(--motion-micro)] ${
                              view.role === 'trade' && view.tradeCode === code
                                ? 'bg-lavender text-canvas-white'
                                : 'bg-paper-mist text-steel hover:bg-ash'
                            }`}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <button
                  key={role}
                  type="button"
                  role="menuitem"
                  onClick={() => choose(role, null)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-[var(--radius-input)] px-3 py-2 text-left transition-colors duration-[var(--motion-micro)] ${
                    isActive ? 'bg-soft-violet' : 'hover:bg-paper-mist'
                  }`}
                >
                  <span className="flex items-center gap-2 text-body font-medium text-charcoal">
                    {ROLE_LABEL[role]}
                    {isOwn ? (
                      <span className="rounded-[var(--radius-pill)] bg-paper-mist px-2 py-0.5 text-caption font-medium text-steel">
                        deine Rolle
                      </span>
                    ) : null}
                  </span>
                  <span className="text-caption text-steel">{ROLE_DESCRIPTION[role]}</span>
                </button>
              );
            })}

            {view.isPreview ? (
              <button
                type="button"
                onClick={() => choose(project.role, null)}
                className="mt-1 flex w-full items-center gap-2 rounded-[var(--radius-input)] border-t border-ash px-3 py-2.5 text-body font-medium text-charcoal hover:bg-paper-mist"
              >
                <RotateCcw size={16} aria-hidden />
                Zurück zu deiner Rolle
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

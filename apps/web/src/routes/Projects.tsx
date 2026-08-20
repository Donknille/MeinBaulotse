import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, Card, EmptyState, Pill } from '../components/ui';
import { FEDERAL_STATE_LABEL, formatDate } from '../lib/format';
import { api } from '../lib/api';
import { Topmark } from './SignIn';
import { signOut } from '../lib/supabase';
import { clearDemoSession, readDemoSession } from '../lib/demo-auth';
import { ROLE_LABEL } from '../lib/roles';

export function Projects() {
  const query = useQuery({ queryKey: ['projects'], queryFn: () => api.listProjects() });
  // Im Testzugang steht in der Kopfzeile, aus wessen Sicht man gerade schaut.
  // Ohne diesen Hinweis verwechselt man beim Vergleichen der Rollen unweigerlich,
  // wer man gerade ist.
  const demo = readDemoSession();

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-3 text-charcoal">
          <Topmark size={22} />
          <span className="text-body font-medium">MeinBaulotse</span>
        </span>
        <span className="flex items-center gap-2">
          {demo !== null ? (
            <Link to="/demo" className="text-body text-steel underline underline-offset-4">
              {demo.label} · Rolle wechseln
            </Link>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearDemoSession();
              void signOut();
            }}
          >
            Abmelden
          </Button>
        </span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="display-title text-heading-lg text-charcoal">Deine Bauvorhaben</h1>
        <Link to="/onboarding">
          <Button variant="primary">
            <Plus size={16} aria-hidden />
            Neues Projekt
          </Button>
        </Link>
      </div>

      {query.isPending ? (
        <p className="text-body text-steel">Wird geladen.</p>
      ) : query.data === undefined || query.data.projects.length === 0 ? (
        <EmptyState
          text="Hier stehen deine Bauvorhaben. Leg eines an — fünf Fragen, danach steht dein Terminplan."
          action={
            <Link to="/onboarding">
              <Button variant="primary" size="field">
                Projekt anlegen
              </Button>
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {query.data.projects.map((project) => (
            <li key={project.id}>
              <Link to={`/projekt/${project.id}`} className="block">
                <Card className="transition-colors duration-[var(--motion-micro)] hover:bg-paper-mist">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body-xl font-medium text-charcoal">{project.name}</p>
                    {/* Die Rolle steht an der Karte, nicht erst im Projekt:
                        Wer in mehreren Vorhaben unterschiedlich beteiligt ist,
                        sieht den Unterschied sonst zu spät. */}
                    <Pill tone={project.role === 'owner' ? 'blue' : 'neutral'}>
                      {ROLE_LABEL[project.role]}
                    </Pill>
                  </div>
                  <p className="mt-1 text-body text-steel">
                    Baubeginn {formatDate(project.plannedStart)} ·{' '}
                    {FEDERAL_STATE_LABEL[project.federalState]}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

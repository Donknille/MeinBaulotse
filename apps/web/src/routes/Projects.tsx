import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, Card, EmptyState, Pill } from '../components/ui';
import { FEDERAL_STATE_LABEL, formatDate } from '../lib/format';
import { ApiError, api, type Identity } from '../lib/api';
import { Topmark } from './SignIn';
import { signOut } from '../lib/supabase';
import { clearDemoSession, readDemoKey, readDemoSession } from '../lib/demo-auth';
import { ROLE_LABEL } from '../lib/roles';

export function Projects() {
  const query = useQuery({ queryKey: ['projects'], queryFn: () => api.listProjects() });
  // Im Testzugang steht in der Kopfzeile, aus wessen Sicht man gerade schaut.
  // Ohne diesen Hinweis verwechselt man beim Vergleichen der Rollen unweigerlich,
  // wer man gerade ist.
  const demo = readDemoSession();

  const isEmpty = query.isSuccess && query.data.projects.length === 0;

  // Nur im leeren Fall gefragt, und nie vor der Liste: Die Auskunft erklärt
  // eine leere Liste, sie soll sie nicht aufhalten.
  const identity = useQuery({ queryKey: ['me'], queryFn: () => api.me(), enabled: isEmpty });

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
      ) : query.isError ? (
        // Ein Fehler ist keine leere Liste.
        //
        // Vorher fielen beide Fälle zusammen, weil `query.data === undefined`
        // auch dann gilt, wenn die Anfrage gescheitert ist. Eine unerreichbare
        // Datenbank sah damit aus wie „du hast noch kein Projekt" — und lud
        // ausgerechnet dazu ein, eines anzulegen.
        <LoadFailed error={query.error} onRetry={() => void query.refetch()} />
      ) : isEmpty ? (
        <div className="flex flex-col gap-3">
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
          <SeenIdentity
            identity={identity.data}
            strandedInDemo={demo === null && readDemoKey() !== ''}
          />
        </div>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {(query.data?.projects ?? []).map((project) => (
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

/**
 * Wen die Datenbank gesehen hat, als sie diese leere Liste zurückgab.
 *
 * Eine Zeile, die eine ganze Fehlersuche abkürzt: Steht dort die eigene
 * Adresse statt der des Testzugangs, schaut man mit der falschen Anmeldung auf
 * eine fremde Liste — und genau das sieht man dem Leertext sonst nicht an.
 */
function SeenIdentity({
  identity,
  strandedInDemo,
}: {
  identity: Identity | undefined;
  strandedInDemo: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {identity !== undefined ? (
        <p className="text-caption text-steel">
          Angemeldet als {identity.email ?? identity.tokenSub} ·{' '}
          {identity.memberships === 0
            ? 'keine Beteiligung eingetragen'
            : `${identity.memberships} Beteiligungen`}
          {identity.databaseUserId === null
            ? ' · Die Datenbank erkennt diese Anmeldung nicht.'
            : ''}
        </p>
      ) : null}
      {strandedInDemo ? (
        <p className="text-caption text-steel">
          Du warst zuletzt im Testzugang.{' '}
          <Link to="/demo" className="underline underline-offset-4">
            Zurück zum Testzugang
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** Schlechte Nachricht mit nächstem Schritt — CI, Abschnitt Tonalität. */
function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const reason = error instanceof ApiError ? error.message : 'Die Verbindung kam nicht zustande.';
  const hint = error instanceof ApiError ? error.hint : undefined;
  // Der technische Grund, den die API mitschickt. Er steht bewusst hier und
  // nicht nur im Protokoll: Ohne ihn ist von außen nicht zu unterscheiden, ob
  // die Datenbank nicht antwortet oder ob eine Abfrage schiefging.
  const detail = error instanceof ApiError ? error.detail : undefined;

  return (
    <div className="flex flex-col items-start gap-3 py-8">
      <p className="max-w-[34rem] text-body text-charcoal">
        Deine Bauvorhaben ließen sich gerade nicht laden. Deine Daten sind davon nicht betroffen.
      </p>
      <p className="max-w-[34rem] text-body text-steel">{reason}</p>
      {hint !== undefined ? <p className="max-w-[34rem] text-caption text-steel">{hint}</p> : null}
      {detail !== undefined ? (
        <p className="max-w-[34rem] font-mono text-caption break-words text-steel">{detail}</p>
      ) : null}
      <Button variant="primary" size="field" onClick={onRetry}>
        Erneut versuchen
      </Button>
    </div>
  );
}

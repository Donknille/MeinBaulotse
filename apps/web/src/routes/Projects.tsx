import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button, Card, EmptyState, Pill } from '../components/ui';
import { FEDERAL_STATE_LABEL, formatDate } from '../lib/format';
import { ApiError, api, type ConnectionShape, type Identity } from '../lib/api';
import { readDemoKey, readDemoSession } from '../lib/demo-auth';
import { ROLE_LABEL } from '../lib/roles';
import { TopBar } from '../components/TopBar';

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
      <TopBar />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="display-title text-heading-lg text-charcoal">Deine Bauvorhaben</h1>
        {/* Auf dem Rechner steht die Hauptaktion oben rechts. Mobil gehört sie
            nach unten in Daumenreichweite — CI 10.1. */}
        <Link to="/onboarding" className="hidden sm:block">
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

      {query.isSuccess && query.data.projects.length > 0 ? (
        <Link to="/onboarding" className="sm:hidden">
          <Button variant="primary" size="field" className="w-full">
            <Plus size={16} aria-hidden />
            Neues Projekt
          </Button>
        </Link>
      ) : null}
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

/**
 * Aus der Form der Datenbankadresse einen nächsten Schritt machen.
 *
 * Die beiden Supabase-Adressen sehen einander ähnlich und verhalten sich
 * gegensätzlich: Die Direktverbindung auf Port 5432 ist nur über IPv6 zu
 * haben und von einer Vercel-Function deshalb gar nicht erreichbar; der
 * Transaction-Pooler auf 6543 verlangt `postgres.<projektkennung>` als
 * Benutzernamen. Beides steht hier, damit niemand es sich zusammenreimen muss.
 */
function connectionAdvice(shape: ConnectionShape | undefined, detail?: string): string | undefined {
  if (shape === undefined) return undefined;
  if (!shape.configured) return 'DATABASE_URL ist in dieser Umgebung nicht gesetzt.';
  // Der Zertifikatsfall hängt nicht an der Form der Adresse, sondern am Grund.
  // Er sieht sonst aus wie „alles richtig eingetragen" — und war genau deshalb
  // im Betrieb eine eigene Runde wert.
  if (detail !== undefined && /certificate/i.test(detail)) {
    return 'Das Zertifikat der Datenbank ließ sich nicht prüfen. Die aktuelle Fassung der Anwendung bringt Supabases Wurzelzertifikat mit — deploy sie, dann ist das erledigt.';
  }
  if (shape.port === 5432 && !shape.poolerUser) {
    return 'Eingetragen ist die Direktverbindung (Port 5432). Sie ist nur über IPv6 erreichbar, von hier aus also nicht — nimm den Transaction-Pooler auf Port 6543.';
  }
  if (shape.port === 6543 && !shape.poolerUser) {
    return 'Pooler-Adresse (Port 6543), aber der Benutzername trägt keine Projektkennung. Der Pooler verlangt postgres.<projektkennung>.';
  }
  if (shape.tls && !shape.verifyTls) {
    return `Eingetragen ist Port ${shape.port ?? 'ohne Angabe'}. Die Zertifikatsprüfung ist über DATABASE_SSL_NO_VERIFY abgeschaltet — verschlüsselt, aber ungeprüft.`;
  }
  return `Eingetragen ist Port ${shape.port ?? 'ohne Angabe'}${shape.tls ? ' mit TLS' : ' ohne TLS'}.`;
}

/** Schlechte Nachricht mit nächstem Schritt — CI, Abschnitt Tonalität. */
function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const reason = error instanceof ApiError ? error.message : 'Die Verbindung kam nicht zustande.';
  const hint = error instanceof ApiError ? error.hint : undefined;
  // Der technische Grund, den die API mitschickt. Er steht bewusst hier und
  // nicht nur im Protokoll: Ohne ihn ist von außen nicht zu unterscheiden, ob
  // die Datenbank nicht antwortet oder ob eine Abfrage schiefging.
  const detail = error instanceof ApiError ? error.detail : undefined;
  const advice = error instanceof ApiError ? connectionAdvice(error.connection, detail) : undefined;

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
      {advice !== undefined ? (
        <p className="max-w-[34rem] text-caption text-steel">{advice}</p>
      ) : null}
      {error instanceof ApiError && error.schemaHint !== undefined ? (
        <p className="max-w-[34rem] text-caption text-steel">{error.schemaHint}</p>
      ) : null}
      <Button variant="primary" size="field" onClick={onRetry}>
        Erneut versuchen
      </Button>
    </div>
  );
}

/**
 * Die Tür für Vorführung und Test.
 *
 * Erreichbar unter `/demo?key=…`. Der Schlüssel steht im Link, damit ein
 * Zugang verschickt werden kann, ohne dass es dafür einen Mailversand braucht
 * — genau das Loch, das diese Seite überbrückt.
 *
 * Zwei Knöpfe, zwei Rollen, derselbe Bildschirm dahinter: So lässt sich
 * prüfen, was der Generalunternehmer sieht und was der Bauherr sieht.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Field, TextInput } from '../components/ui';
import { fetchDemoIdentities, startDemoSession, type DemoIdentityInfo } from '../lib/demo-auth';
import { Topmark } from './SignIn';

export function DemoLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [key, setKey] = useState(params.get('key') ?? '');
  const [identities, setIdentities] = useState<DemoIdentityInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetchDemoIdentities().then(setIdentities, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Der Testzugang antwortet nicht.');
    });
  }, []);

  async function enter(role: string, event?: FormEvent) {
    event?.preventDefault();
    setBusy(role);
    setError(null);
    try {
      await startDemoSession(role, key.trim());
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Die Anmeldung hat nicht geklappt.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="dotted-canvas flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="w-full max-w-[30rem]">
        <div className="mb-8 flex flex-col items-start gap-3">
          <Topmark />
          <h1 className="display-title text-heading-lg text-charcoal">Testzugang</h1>
          <p className="text-body-lg text-steel">
            Zwei feste Zugänge auf dasselbe Bauvorhaben. Wähl die Rolle, aus der du schauen willst —
            wechseln kannst du jederzeit.
          </p>
        </div>

        <Card className="flex flex-col gap-4">
          <form onSubmit={(event) => void enter(identities?.[0]?.role ?? 'bauherr', event)}>
            <Field label="Zugangsschlüssel" hint="Steht im Link. Ohne ihn bleibt die Tür zu.">
              <TextInput
                type="password"
                autoComplete="off"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="aus deiner .env"
              />
            </Field>
          </form>

          {identities === null ? (
            <p className="text-body text-steel">Einen Moment.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {identities.map((identity) => (
                <li key={identity.role}>
                  <Card tone="muted" className="flex flex-col gap-3">
                    <div>
                      <p className="text-body-lg font-medium text-charcoal">
                        {identity.label} · {identity.displayName}
                      </p>
                      <p className="mt-1 text-body text-steel">{identity.explanation}</p>
                    </div>
                    <Button
                      variant="primary"
                      size="field"
                      disabled={busy !== null || key.trim() === ''}
                      onClick={() => void enter(identity.role)}
                    >
                      {busy === identity.role ? 'Einen Moment.' : `Als ${identity.label} anmelden`}
                    </Button>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          {error !== null ? <p className="text-body text-alarm-red">{error}</p> : null}

          <p className="text-caption text-steel">
            Dieser Zugang ist zum Ausprobieren gedacht und läuft nach zwölf Stunden ab. Für den
            Betrieb wird er über die Umgebungsvariable abgeschaltet.
          </p>
        </Card>
      </div>
    </main>
  );
}

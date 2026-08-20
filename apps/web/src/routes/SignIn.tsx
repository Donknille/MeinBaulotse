import { useState, type FormEvent } from 'react';
import { Button, Card, Field, TextInput } from '../components/ui';
import { isSupabaseConfigured, signInWithGoogle, signInWithMagicLink } from '../lib/supabase';

/**
 * Anmeldung ohne Passwort: Magic Link und Google.
 *
 * Ein Bauherr öffnet dieses Produkt über Monate hinweg sporadisch. Nach acht
 * Wochen erinnert sich niemand an sein Passwort — und ein vergessenes Passwort
 * ist die häufigste Stelle, an der jemand aufgibt.
 */
export function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithMagicLink(email);
      setSent(true);
    } catch {
      setError('Der Link ließ sich nicht senden. Prüf bitte die Adresse und versuch es noch einmal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="dotted-canvas flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="w-full max-w-[26rem]">
        <div className="mb-8 flex flex-col items-start gap-3">
          <Topmark />
          <h1 className="display-title text-heading-lg text-charcoal">MeinBaulotse</h1>
          <p className="text-body-lg text-steel">
            Du bleibst der Bauherr. Wir sagen dir, was als Nächstes kommt.
          </p>
        </div>

        <Card className="flex flex-col gap-4">
          {!isSupabaseConfigured ? (
            <div className="flex flex-col gap-2">
              <p className="text-body-lg font-medium text-charcoal">Anmeldung noch nicht verbunden</p>
              <p className="text-body text-steel">
                Trag <code className="font-mono text-caption">VITE_SUPABASE_URL</code> und{' '}
                <code className="font-mono text-caption">VITE_SUPABASE_ANON_KEY</code> ein, dann
                funktioniert die Anmeldung. Die Schritte stehen in{' '}
                <code className="font-mono text-caption">docs/SETUP.md</code>.
              </p>
            </div>
          ) : sent ? (
            <div className="flex flex-col gap-2">
              <p className="text-body-lg font-medium text-charcoal">Schau in dein Postfach</p>
              <p className="text-body text-steel">
                Wir haben dir einen Link an {email} geschickt. Er gilt eine Stunde.
              </p>
              <Button variant="ghost" size="sm" onClick={() => setSent(false)}>
                Andere Adresse verwenden
              </Button>
            </div>
          ) : (
            <>
              <form onSubmit={submit} className="flex flex-col gap-4">
                <Field
                  label="E-Mail-Adresse"
                  hint="Wir schicken dir einen Link. Kein Passwort nötig."
                  {...(error === null ? {} : { error })}
                >
                  <TextInput
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
                <Button type="submit" variant="primary" size="field" disabled={busy}>
                  {busy ? 'Wird gesendet …' : 'Link schicken'}
                </Button>
              </form>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-ash" />
                <span className="text-caption text-fog">oder</span>
                <span className="h-px flex-1 bg-ash" />
              </div>

              <Button variant="outline" size="field" onClick={() => void signInWithGoogle()}>
                Mit Google anmelden
              </Button>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}

/** Das Toppzeichen — Dreieck über einem Strich, mehr nicht. */
export function Topmark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden fill="none">
      <path d="M16 6 L26 21 H6 Z" fill="currentColor" />
      <rect x="4" y="24" width="24" height="2.5" rx="1" fill="currentColor" />
    </svg>
  );
}

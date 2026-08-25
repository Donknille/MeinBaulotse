/**
 * Die Tür für Vorführung und Test.
 *
 * Erreichbar unter `/demo?key=…`. Der Schlüssel steht im Link, damit ein Zugang
 * verschickt werden kann, ohne dass es dafür einen Mailversand braucht — genau
 * das Loch, das diese Seite überbrückt.
 *
 * Zwei Rollen, zwei Knöpfe. Ein Eingabefeld erscheint nur, wenn die Tür einen
 * Schlüssel verlangt und keiner vorliegt — etwa weil ein Messenger den Link
 * abgeschnitten hat. Steht die Tür offen (`DEMO_OPEN`), gibt es das Feld nicht,
 * denn dann gäbe es nichts einzutragen.
 *
 * Die beiden Rollen stehen **hier** und werden nicht vom Server geholt. Das ist
 * kein Geiz, sondern eine Lehre: Solange die Seite dafür auf eine Antwort
 * wartete, blieb sie bei „Einen Moment." stehen, sobald die API einmal nicht
 * antwortete. Für die Darstellung von zwei festen Knöpfen braucht es keinen
 * Netzaufruf.
 *
 * Die eine Frage, die trotzdem an den Server geht, ist die nach der Stellung
 * der Tür. Sie hält nichts auf: Die Knöpfe stehen sofort, und ob ein Schlüssel
 * fehlt, entscheidet sich erst mit der Antwort — oder spätestens beim Klick,
 * und dann sagt es die Fehlermeldung im Klartext.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Field, TextInput } from '../components/ui';
import { readDemoKey, startDemoSession } from '../lib/demo-auth';
import { Topmark } from './SignIn';

interface DemoRole {
  role: string;
  action: string;
  person: string;
}

/** Dieselben zwei Identitäten wie in `apps/api/src/demo.ts`. */
const ROLES: readonly DemoRole[] = [
  { role: 'bauherr', action: 'Als Bauherr starten', person: 'Familie Sonnenweg' },
  {
    role: 'gu',
    action: 'Als Generalunternehmer starten',
    person: 'Jörg Baumeister, Baumeister Bau GmbH',
  },
];

export function DemoLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  // Der Link hat Vorrang; sonst der Schlüssel von der letzten Anmeldung, damit
  // „Rolle wechseln" ohne erneute Eingabe auskommt.
  const [key, setKey] = useState(() => params.get('key') ?? readDemoKey());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // `null` heißt: noch nicht bekannt. Die Knöpfe stehen trotzdem.
  const [tuer, setTuer] = useState<'offen' | 'schluessel' | null>(null);
  // Der Sprung darf sich nicht wiederholen, auch nicht beim doppelten Aufruf
  // der Effekte im Entwicklungsmodus.
  const jumped = useRef(false);

  async function enter(role: string, event?: FormEvent): Promise<void> {
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

  useEffect(() => {
    let abgebrochen = false;
    void fetch('/api/demo/identities', { headers: { accept: 'application/json' } })
      .then(async (antwort) => {
        if (abgebrochen || !antwort.ok) return;
        const body = (await antwort.json().catch(() => null)) as { open?: boolean } | null;
        setTuer(body?.open === true ? 'offen' : 'schluessel');
      })
      .catch(() => {
        // Keine Antwort heißt hier nicht „zu": Der Klick entscheidet.
      });
    return () => {
      abgebrochen = true;
    };
  }, []);

  const hasKey = key.trim() !== '';

  useEffect(() => {
    const wanted = params.get('role');
    if (wanted === null || wanted === '' || jumped.current) return;
    // Entweder liegt ein Schlüssel vor, oder die Tür steht offen. Solange
    // beides offen ist, wird nicht gesprungen — sonst liefe der Sprung in ein
    // 401 und der Besucher stünde vor einer Fehlermeldung statt vor der Tür.
    if (!hasKey && tuer !== 'offen') return;
    jumped.current = true;
    // Nur einmal: Der Link entscheidet, nicht jede spätere Eingabe im
    // Schlüsselfeld. Scheitert es, bleiben die Knöpfe.
    void enter(wanted);
  }, [tuer, hasKey]);

  return (
    <main className="dotted-canvas flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="w-full max-w-[30rem]">
        <div className="mb-8 flex flex-col items-start gap-3">
          <Topmark />
          <h1 className="display-title text-heading-lg text-charcoal">Testzugang</h1>
          <p className="text-body-lg text-steel">
            Dasselbe Bauvorhaben aus zwei Sichten. Wähl deine Rolle — wechseln kannst du jederzeit.
          </p>
        </div>

        <Card className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            {ROLES.map((entry) => (
              <div key={entry.role} className="flex flex-col gap-1">
                <Button
                  variant="primary"
                  size="field"
                  disabled={busy !== null}
                  onClick={() => void enter(entry.role)}
                >
                  {busy === entry.role ? 'Einen Moment.' : entry.action}
                </Button>
                <p className="text-caption text-steel">{entry.person}</p>
              </div>
            ))}
          </div>

          {/* Nur, wenn die Tür einen Schlüssel verlangt und keiner vorliegt —
              etwa weil ein Messenger den Link abgeschnitten hat. Steht sie
              offen, gäbe es hier nichts einzutragen. */}
          {tuer === 'schluessel' && !hasKey ? (
            <form className="flex flex-col gap-4" onSubmit={(event) => void enter('bauherr', event)}>
              <Field
                label="Zugangsschlüssel"
                hint="Er steht im Link hinter key=. Nach dem Abmelden ist er hier vergessen — dann brauchst du den Link noch einmal."
              >
                <TextInput
                  autoComplete="off"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="Schlüssel einfügen"
                />
              </Field>
            </form>
          ) : null}

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

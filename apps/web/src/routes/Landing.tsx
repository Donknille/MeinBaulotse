/**
 * Die Startseite — und die einzige Seite, die ein Fremder ohne Anmeldung sieht.
 *
 * Sie hat eine Aufgabe: **zwei Türen zeigen und den Weg durch die Anwendung
 * benennen.** Wer MeinBaulotse ansehen will, will nicht wissen, wie das Produkt
 * heißt, sondern wie es sich anfühlt — und dazu braucht er eine Rolle. Ein
 * Terminplan ohne Rolle ist eine Tabelle; derselbe Plan als Bauherr ist eine
 * Frage („kommen wir hin?") und als Generalunternehmer eine andere („was wird
 * von mir erwartet?").
 *
 * Deshalb steht hier kein Vorschaubild und keine Aufzählung von Merkmalen,
 * sondern zwei Knöpfe und darunter der Rundgang: neun Stationen in der
 * Reihenfolge, in der ein Bauvorhaben sie durchläuft.
 *
 * ---
 *
 * **Warum die Türen verschwinden können.** Den Testzugang gibt es nur, wenn die
 * Umgebung ihn einschaltet (`DEMO_OPEN` oder `DEMO_LOGIN_KEY`, siehe
 * `apps/api/src/demo.ts`). Sonst gibt es die Route `/api/demo/*` gar nicht —
 * dann wäre eine Tür zu einem Raum, den es nicht gibt. Die Seite fragt das
 * einmal nach und blendet die Knöpfe erst danach ein. Dieselbe Antwort sagt
 * auch, ob die Tür offen ist oder einen Schlüssel verlangt.
 *
 * Sie **wartet** dabei nicht: Erst rendern, dann nachfragen. Die Lehre steht in
 * `DemoLogin.tsx` — eine Seite, die auf eine Antwort wartet, bleibt bei „Einen
 * Moment." stehen, sobald die Antwort einmal ausbleibt. Eine Startseite, die
 * das tut, ist keine.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, HardHat, KeyRound, Ruler } from 'lucide-react';
import { Button, Card } from '../components/ui';
import { readDemoKey, startDemoSession } from '../lib/demo-auth';
import { Topmark } from './SignIn';

interface Tuer {
  role: 'bauherr' | 'gu';
  titel: string;
  person: string;
  satz: string;
  darf: string;
  icon: typeof HardHat;
}

/** Dieselben zwei Identitäten wie in `apps/api/src/demo.ts`. */
const TUEREN: readonly Tuer[] = [
  {
    role: 'bauherr',
    titel: 'Als Bauherr',
    person: 'Familie Sonnenweg',
    satz: 'Deine Sicht, wenn du selbst baust.',
    darf: 'Sieht alles und entscheidet alles: Termine, Mängel, Zahlungen, Bauakte.',
    icon: Ruler,
  },
  {
    role: 'gu',
    titel: 'Als Generalunternehmer',
    person: 'Jörg Baumeister, Baumeister Bau GmbH',
    satz: 'Die Sicht des ausführenden Unternehmens.',
    darf: 'Meldet Termine und Fortschritt — darf weder einladen noch Zahlungen freigeben.',
    icon: HardHat,
  },
];

/**
 * Der Rundgang.
 *
 * In der Reihenfolge eines Bauvorhabens, nicht in der der Arbeitspakete. Wo
 * eine Station die andere Rolle braucht, steht das dabei: Ein abgestimmter
 * Termin ist der einzige Punkt der Anwendung, an dem zwei Menschen nötig sind.
 */
const RUNDGANG: readonly { titel: string; text: string }[] = [
  {
    titel: 'Der Plan',
    text: '38 Vorgänge aus einer Vorlage, gerechnet auf Werktagen mit den Feiertagen des Bundeslands. Oben steht, ob der Vertragstermin noch hält.',
  },
  {
    titel: 'Einen Termin verschieben',
    text: 'Vorgang antippen, neuen Termin nennen. Die Vorschau sagt vorher, was mitzieht und was es den Endtermin kostet. Ohne Grund geht es nicht — der Grund ist später die halbe Miete.',
  },
  {
    titel: 'Der Wochenbericht',
    text: 'Was diese Woche ansteht, was sich bewegt hat, was auf dich wartet. Eine Seite, einmal pro Woche.',
  },
  {
    titel: 'Erfassen und Bautagebuch',
    text: 'Foto aufnehmen, Eintrag schreiben — auch im Funkloch, die Warteschlange liefert später. Nach 24 Stunden versiegelt sich der Eintrag und hängt sich in eine Prüfkette.',
  },
  {
    titel: 'Abstimmen — hier brauchst du beide Rollen',
    text: 'Als Bauherr unter „Beteiligte" einen Link erzeugen und ihn in einem anderen Browser öffnen. Dort bestätigt das Unternehmen den Termin ohne Konto, oder es nennt einen anderen. Aus einer Angabe werden dann zwei — überschrieben wird nichts.',
  },
  {
    titel: 'Frag den Lotsen',
    text: 'Fragen zum eigenen Bauvorhaben. Der Assistent sieht nur dieses eine Projekt, und Rechtshinweis wie Sachverständigenhinweis hängen fest an der Antwort. Braucht einen Anthropic-Schlüssel; ohne ihn sagt die Seite das offen.',
  },
  {
    titel: 'Mängel',
    text: 'Mit Frist, sonst ist es eine Beschwerde. Was der Kalender nahelegt, steht als Satz daneben, nicht als Stufe.',
  },
  {
    titel: 'Vertrag und Geld',
    text: 'Zahlungsplan nach § 650m BGB, Prüfhinweise zum Vertrag, Bereitstellungszinsen. Solange ein wesentlicher Mangel offen ist, lässt sich die Rate nicht freigeben — und die Seite sagt vorher, was fehlt.',
  },
  {
    titel: 'Die Bauakte',
    text: 'Zeitraum wählen, drucken. Abgestimmte, einseitige und widersprüchliche Angaben sind darin auseinanderzuhalten — auch schwarzweiß.',
  },
];

export function Landing() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // `null` heißt „noch nicht gefragt oder es gibt sie nicht".
  const [tuer, setTuer] = useState<'offen' | 'schluessel' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  const key = params.get('key') ?? readDemoKey();

  // Erst rendern, dann nachfragen: Die Seite steht auch, wenn nie eine Antwort
  // kommt — dann eben ohne die beiden Knöpfe.
  useEffect(() => {
    let abgebrochen = false;
    void fetch('/api/demo/identities', { headers: { accept: 'application/json' } })
      .then(async (antwort) => {
        if (abgebrochen || !antwort.ok) return;
        const body = (await antwort.json().catch(() => null)) as { open?: boolean } | null;
        setTuer(body?.open === true ? 'offen' : 'schluessel');
      })
      .catch(() => {
        // Kein Testzugang, keine Türen. Das ist im Betrieb der Normalfall.
      });
    return () => {
      abgebrochen = true;
    };
  }, []);

  async function eintreten(role: string): Promise<void> {
    // Bei offener Tür wird nichts gefragt — das ist ihr ganzer Sinn. Sonst
    // führt der Weg ohne Schlüssel über `/demo`: Dort steht das Feld, in das er
    // sich einfügen lässt. Zwei Eingabefelder für dieselbe Sache wären eines zu
    // viel.
    if (tuer !== 'offen' && key.trim() === '') {
      navigate(`/demo?role=${role}`);
      return;
    }
    setBusy(role);
    setFehler(null);
    try {
      await startDemoSession(role, key.trim());
      navigate('/', { replace: true });
    } catch (grund) {
      setFehler(grund instanceof Error ? grund.message : 'Das hat nicht geklappt.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="dotted-canvas min-h-dvh px-4 py-12 sm:px-6 sm:py-16">
      <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-10">
        <header className="flex flex-col items-start gap-4">
          <Topmark size={32} />
          {/* Die Anzeigenschrift erst ab 36 px, siehe CI 4.1. */}
          <h1 className="display-title text-heading-lg text-charcoal">
            Du bleibst der Bauherr.
          </h1>
          <p className="max-w-[34rem] text-body-xl text-steel">
            MeinBaulotse führt private Bauherren durch ihren Hausbau: ein Terminplan, der sich
            selbst nachrechnet, ein Bautagebuch, das im Streitfall trägt, und an jeder Stelle der
            nächste Schritt.
          </p>
        </header>

        {tuer !== null ? (
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-subheading font-medium text-charcoal">
                Dasselbe Bauvorhaben, zwei Sichten
              </h2>
              <p className="text-body text-steel">
                Wähl eine Rolle und sieh dich um. Wechseln kannst du jederzeit — oben rechts steht,
                aus wessen Sicht du gerade schaust. Beide sehen dasselbe Bauvorhaben und nicht
                dasselbe darin: Was eine Rolle darf, entscheidet die Datenbank, nicht die Ansicht.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {TUEREN.map((tuer) => (
                <Card key={tuer.role} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <tuer.icon size={20} className="text-electric-blue" aria-hidden />
                    <h3 className="text-body-lg font-medium text-charcoal">{tuer.titel}</h3>
                  </div>
                  <p className="text-body text-charcoal">{tuer.satz}</p>
                  <p className="flex-1 text-caption text-steel">{tuer.darf}</p>
                  <Button
                    variant="primary"
                    size="field"
                    disabled={busy !== null}
                    onClick={() => void eintreten(tuer.role)}
                  >
                    {busy === tuer.role ? 'Einen Moment.' : 'Hier hinein'}
                    <ArrowRight size={20} aria-hidden />
                  </Button>
                  <p className="text-caption text-fog">{tuer.person}</p>
                </Card>
              ))}
            </div>

            {fehler === null ? null : <p className="text-body text-alarm-red">{fehler}</p>}

            <p className="text-caption text-steel">
              Der Testzugang läuft nach zwölf Stunden ab und legt keine echten Daten an. Für den
              Betrieb wird er über eine Umgebungsvariable abgeschaltet — dann steht hier nur noch
              die Anmeldung.
            </p>
          </section>
        ) : null}

        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-subheading font-medium text-charcoal">
              Was du durchspielen kannst
            </h2>
            <p className="text-body text-steel">
              Neun Stationen, in der Reihenfolge eines Bauvorhabens. Eine davon braucht beide
              Rollen — das ist keine Lücke, sondern der Punkt.
            </p>
          </div>

          <ol className="flex flex-col gap-3">
            {RUNDGANG.map((station, index) => (
              <li key={station.titel} className="flex gap-4">
                <span
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-paper-mist text-caption font-medium text-steel"
                  aria-hidden
                >
                  {index + 1}
                </span>
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-body-lg font-medium text-charcoal">{station.titel}</h3>
                  <p className="text-body text-steel">{station.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <footer className="flex flex-col gap-3 border-t border-ash pt-6">
          <h2 className="text-body font-medium text-charcoal">Du hast schon ein Bauvorhaben?</h2>
          <p className="text-body text-steel">
            Dann melde dich mit deiner E-Mail-Adresse an. Wir schicken dir einen Link, ein Passwort
            brauchst du nicht.
          </p>
          <Link
            to="/anmelden"
            className="inline-flex min-h-11 w-fit items-center gap-2 rounded-[var(--radius-button)] px-3 text-body font-medium text-electric-blue transition-colors duration-[var(--motion-micro)] hover:bg-soft-blue"
          >
            <KeyRound size={16} aria-hidden />
            Zur Anmeldung
          </Link>
        </footer>
      </div>
    </main>
  );
}

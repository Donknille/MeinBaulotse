/**
 * Die Abstimmungsseite für den GU — Abschnitt 5.5.
 *
 *     Baustelle Musterweg 4
 *
 *     Für den Innenputz ist der 12.–21.05. eingetragen.
 *     Passt das?
 *
 *     [ Passt ]   [ Anderer Termin ]
 *
 * „Kein Login, keine App, unter zehn Sekunden erledigt, in der Sprache des
 * Empfängers." Jede Zeile dieser Datei folgt daraus:
 *
 * - Der Token steht im Link und wird nirgends gespeichert. Wer die Seite
 *   schließt, hat nichts zurückgelassen.
 * - Es gibt keine Navigation, keine Anmeldung, kein Konto — nur die Frage.
 * - Große Knöpfe: Das hier wird mit Handschuhen bedient (CI 6).
 */

import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';
import type { GuestSession, GuestTaskView } from '@meinbaulotse/shared';
import { Button, Card } from '../components/ui';
import { guestApi } from '../lib/api';
import { guestRange, textsFor, type GuestTexts } from '../lib/guest-i18n';

export function GuestConfirm() {
  const { token: ausPfad } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const token = ausPfad ?? params.get('t') ?? '';

  const session = useQuery({
    queryKey: ['guest-session', token],
    queryFn: () => guestApi.session(token),
    enabled: token !== '',
    retry: false,
  });

  const texts = textsFor(session.data?.locale);

  if (token === '' || session.isError) {
    return (
      <Rahmen>
        <Card className="flex flex-col gap-2">
          <p className="text-body-lg font-medium text-charcoal">{texts.linkInvalid}</p>
          <p className="text-body text-steel">{texts.linkInvalidHint}</p>
        </Card>
      </Rahmen>
    );
  }

  if (session.isPending || session.data === undefined) {
    return (
      <Rahmen>
        <p className="text-body text-steel">…</p>
      </Rahmen>
    );
  }

  return <Abstimmung token={token} session={session.data} texts={texts} />;
}

function Abstimmung({
  token,
  session,
  texts,
}: {
  token: string;
  session: GuestSession;
  texts: GuestTexts;
}) {
  const queryClient = useQueryClient();
  const darfBestaetigen = session.scopes.includes('confirm:task');

  // Was gerade beantwortet wurde, bleibt oben stehen — mit der Danksagung.
  //
  // Ohne diesen Zustand verschwände die Rückmeldung im selben Augenblick, in
  // dem sie erscheint: Der neu geladene Plan schiebt die Zeile nach unten,
  // und der Bauleiter sieht nicht, ob seine Antwort angekommen ist. Genau das
  // ist beim Durchspielen aufgefallen.
  const [gerade, setGerade] = useState<Record<string, 'ja' | 'anders'>>({});

  const offen = session.tasks.filter(
    (task) => (task.myAnswer === null || gerade[task.id] !== undefined) && !task.isWait,
  );
  const beantwortet = session.tasks.filter(
    (task) => task.myAnswer !== null && gerade[task.id] === undefined,
  );

  const antworten = useMutation({
    mutationFn: ({ taskId, body }: { taskId: string; body: Parameters<typeof guestApi.answer>[2] }) =>
      guestApi.answer(token, taskId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guest-session', token] }),
  });

  return (
    <Rahmen>
      <header className="flex flex-col gap-1">
        <p className="text-caption text-steel">{texts.title}</p>
        <h1 className="display-title text-heading-lg text-charcoal">{session.projectName}</h1>
        <p className="text-body text-steel">
          {session.displayName === null ? texts.intro : `${session.displayName} · ${texts.intro}`}
        </p>
      </header>

      {!darfBestaetigen ? (
        <p className="text-body text-steel">{texts.readOnly}</p>
      ) : offen.length === 0 ? (
        <Card>
          <p className="py-4 text-body text-steel">{texts.nothing}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-4">
          {offen.map((task) => (
            <li key={task.id}>
              <Frage
                task={task}
                texts={texts}
                busy={antworten.isPending}
                {...(gerade[task.id] === undefined ? {} : { fertig: gerade[task.id]! })}
                onAnswer={async (body) => {
                  await antworten.mutateAsync({ taskId: task.id, body });
                  setGerade((vorher) => ({
                    ...vorher,
                    [task.id]: body.agree ? 'ja' : 'anders',
                  }));
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {beantwortet.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {beantwortet.map((task) => (
            <li key={task.id}>
              <Card className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <span className="text-body text-charcoal">{task.name}</span>
                <span className="flex items-center gap-1 text-caption text-vivid-green">
                  <Check size={14} aria-hidden />
                  {task.myAnswer === 'bestaetigt' ? texts.answeredYes : texts.answeredOther}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </Rahmen>
  );
}

function Frage({
  task,
  texts,
  busy,
  fertig,
  onAnswer,
}: {
  task: GuestTaskView;
  texts: GuestTexts;
  busy: boolean;
  /** Gesetzt, sobald die Antwort durch ist — der Zustand liegt oben. */
  fertig?: 'ja' | 'anders';
  onAnswer: (body: { agree: true } | { agree: false; start: string; note?: string }) => Promise<unknown>;
}) {
  const [gegenvorschlag, setGegenvorschlag] = useState(false);
  const [datum, setDatum] = useState('');
  const [notiz, setNotiz] = useState('');

  if (fertig !== undefined) {
    return (
      <Card className="flex flex-col gap-1">
        <p className="text-body-lg font-medium text-charcoal">{task.name}</p>
        <p className="text-body text-vivid-green">
          {fertig === 'ja' ? texts.thanksYes : texts.thanksOther}
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-body-lg font-medium text-charcoal">{task.name}</p>
        <p className="text-body-xl text-charcoal">
          {texts.scheduled}: <span className="font-medium">{guestRange(task.start, task.end)}</span>
        </p>
        {task.tradeName !== null ? (
          <p className="text-caption text-steel">{task.tradeName}</p>
        ) : null}
      </div>

      {!gegenvorschlag ? (
        <>
          <p className="text-body-xl text-charcoal">{texts.question}</p>
          {/* Zwei Knöpfe, beide in Feldgröße: Das hier wird auf einer
              Baustelle bedient, oft mit Handschuhen (CI 6). */}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="primary"
              size="field"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                void onAnswer({ agree: true });
              }}
            >
              {busy ? <Loader2 size={20} className="animate-spin" aria-hidden /> : null}
              {texts.yes}
            </Button>
            <Button
              variant="outline"
              size="field"
              className="flex-1"
              disabled={busy}
              onClick={() => setGegenvorschlag(true)}
            >
              {texts.other}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-body text-charcoal">{texts.otherDate}</span>
            <input
              type="date"
              value={datum}
              onChange={(event) => setDatum(event.target.value)}
              className="h-14 rounded-[var(--radius-input)] border border-pebble px-3 text-body-lg"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-body text-charcoal">{texts.note}</span>
            <input
              value={notiz}
              onChange={(event) => setNotiz(event.target.value)}
              className="h-14 rounded-[var(--radius-input)] border border-pebble px-3 text-body-lg"
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="primary"
              size="field"
              className="flex-1"
              disabled={busy || datum === ''}
              onClick={() => {
                void onAnswer({
                  agree: false,
                  start: datum,
                  ...(notiz.trim() === '' ? {} : { note: notiz.trim() }),
                });
              }}
            >
              {busy ? texts.waiting : texts.send}
            </Button>
            <Button variant="ghost" size="field" onClick={() => setGegenvorschlag(false)}>
              {texts.cancel}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Kein Kopf, keine Navigation, kein Konto — nur die Frage. */
function Rahmen({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-[34rem] flex-col gap-6 px-4 py-10 sm:px-6">
      {children}
      <p className="pt-4 text-caption text-fog">MeinBaulotse</p>
    </main>
  );
}

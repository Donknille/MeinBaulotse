/**
 * Frag den Lotsen (Abschnitt 3.7).
 *
 * Eine Seite, ein Eingabefeld, ein Verlauf. Was diese Ansicht von einem
 * beliebigen Chatfenster unterscheidet, sind zwei Dinge:
 *
 * - **Die Hinweise stehen abgesetzt.** Was das Produkt sagt, sieht anders aus
 *   als das, was das Modell geschrieben hat. Der Rechtshinweis wird nach
 *   CI 11.3 nie verkürzt, nie eingeklappt, nie hinter einen Aufklapper gelegt.
 * - **Die Karten stehen unter der Antwort.** Eine Antwort, die auf
 *   Redaktionsinhalt beruht, verlinkt ihn — sonst ist nicht nachvollziehbar,
 *   woher der Rat kommt.
 *
 * Was fehlt, ist Absicht: kein Vorschlagskarussell, keine Beispiel-Fragen in
 * Kachelform, kein tippender Punkt. Wer hier landet, hat eine Frage.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Loader2, Scale, Send, ShieldQuestion, Wallet } from 'lucide-react';
import type { LotseHint, LotseMessage } from '@meinbaulotse/shared';
import { Button, Card } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { ApiError, api } from '../lib/api';

export function Lotse() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [gespraech, setGespraech] = useState<string | null>(null);
  const [frage, setFrage] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const ende = useRef<HTMLDivElement>(null);

  const plan = useQuery({
    queryKey: ['schedule', projectId],
    queryFn: () => api.schedule(projectId!),
    enabled: projectId !== undefined,
  });

  const liste = useQuery({
    queryKey: ['lotse', projectId],
    queryFn: () => api.lotseConversations(projectId!),
    enabled: projectId !== undefined,
  });

  const verlauf = useQuery({
    queryKey: ['lotse-gespraech', projectId, gespraech],
    queryFn: () => api.lotseConversation(projectId!, gespraech!),
    enabled: projectId !== undefined && gespraech !== null,
  });

  const fragen = useMutation({
    mutationFn: (text: string) =>
      api.askLotse(projectId!, {
        question: text,
        ...(gespraech === null ? {} : { conversationId: gespraech }),
      }),
    onSuccess: (antwort) => {
      setGespraech(antwort.conversationId);
      setFrage('');
      void queryClient.invalidateQueries({ queryKey: ['lotse', projectId] });
      void queryClient.invalidateQueries({
        queryKey: ['lotse-gespraech', projectId, antwort.conversationId],
      });
    },
    onError: (error) => {
      setFehler(error instanceof ApiError ? error.message : 'Das hat nicht geklappt.');
    },
  });

  useEffect(() => {
    ende.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [verlauf.data?.messages.length, fragen.isPending]);


  const beitraege: LotseMessage[] = verlauf.data?.messages ?? [];
  const nichtEingerichtet = liste.data?.available === false;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[52rem] flex-col gap-6 px-4 py-6 sm:px-6">
      <TopBar
        back={{ to: `/projekt/${projectId ?? ''}`, label: plan.data?.project.name ?? 'Zurück' }}
      />

      <header className="flex flex-col gap-1">
        <p className="text-caption text-steel">Frag den Lotsen</p>
        <h1 className="display-title text-heading-lg text-charcoal">
          Was möchtest du wissen?
        </h1>
        <p className="max-w-[38rem] text-body text-steel">
          Der Lotse kennt dein Bauvorhaben — den Plan, die offenen Entscheidungen, das
          Bautagebuch. Er kennt nur deines.
        </p>
      </header>

      {nichtEingerichtet ? (
        <Card className="flex flex-col gap-2">
          <p className="text-body-lg font-medium text-charcoal">
            Der Lotse ist auf dieser Umgebung nicht eingerichtet.
          </p>
          <p className="text-body text-steel">
            Zu jedem Vorgang gibt es trotzdem eine Lotsenkarte: was dort passiert, worauf du
            achten kannst und was oft schiefgeht.
          </p>
          <Link
            to={`/projekt/${projectId ?? ''}`}
            className="w-fit text-body text-electric-blue underline underline-offset-4"
          >
            Zurück zum Plan
          </Link>
        </Card>
      ) : null}

      {liste.data !== undefined && liste.data.conversations.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setGespraech(null)}
            className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-caption ${
              gespraech === null
                ? 'border-charcoal text-charcoal'
                : 'border-pebble text-steel hover:border-ash'
            }`}
          >
            Neue Frage
          </button>
          {liste.data.conversations.slice(0, 6).map((eintrag) => (
            <button
              key={eintrag.id}
              type="button"
              onClick={() => setGespraech(eintrag.id)}
              className={`max-w-[16rem] truncate rounded-[var(--radius-pill)] border px-3 py-1.5 text-caption ${
                gespraech === eintrag.id
                  ? 'border-charcoal text-charcoal'
                  : 'border-pebble text-steel hover:border-ash'
              }`}
            >
              {eintrag.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-1 flex-col gap-4">
        {beitraege.length === 0 && !fragen.isPending && !verlauf.isFetching ? (
          <p className="text-body text-fog">
            Zum Beispiel: „Worauf muss ich beim Estrich achten?" oder „Was passiert, wenn der
            Innenputz zwei Wochen später kommt?"
          </p>
        ) : null}

        {beitraege.map((beitrag) =>
          beitrag.role === 'frage' ? (
            <p
              key={beitrag.id}
              className="ms-auto max-w-[34rem] rounded-[var(--radius-card)] bg-paper-mist px-4 py-3 text-body-lg text-charcoal"
            >
              {beitrag.text}
            </p>
          ) : (
            <Antwort key={beitrag.id} beitrag={beitrag} />
          ),
        )}

        {fragen.isPending || verlauf.isFetching ? (
          <p className="flex items-center gap-2 text-body text-steel">
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Der Lotse sieht sich dein Bauvorhaben an.
          </p>
        ) : null}
        <div ref={ende} />
      </div>

      {fehler === null ? null : (
        <Card className="flex flex-col gap-1 border-l-2 border-l-tangerine">
          <p className="text-body text-charcoal">{fehler}</p>
        </Card>
      )}

      <form
        className="sticky bottom-0 flex gap-2 bg-canvas-white pt-2 pb-4"
        onSubmit={(event) => {
          event.preventDefault();
          setFehler(null);
          if (frage.trim().length >= 3) fragen.mutate(frage.trim());
        }}
      >
        <input
          value={frage}
          onChange={(event) => setFrage(event.target.value)}
          placeholder="Deine Frage"
          disabled={nichtEingerichtet || fragen.isPending}
          className="h-14 flex-1 rounded-[var(--radius-input)] border border-pebble px-4 text-body-lg"
        />
        <Button
          type="submit"
          variant="primary"
          size="field"
          disabled={nichtEingerichtet || fragen.isPending || frage.trim().length < 3}
        >
          <Send size={18} aria-hidden />
          Fragen
        </Button>
      </form>
    </main>
  );
}

function Antwort({ beitrag }: { beitrag: LotseMessage }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 text-body-lg text-charcoal">
        {beitrag.text.split(/\n{2,}/).map((absatz, index) => (
          <p key={index}>{absatz}</p>
        ))}
      </div>

      {beitrag.cards.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {beitrag.cards.map((karte) => (
            <span
              key={karte.key}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-pebble px-3 py-1.5 text-caption text-steel"
            >
              <BookOpen size={14} aria-hidden />
              {karte.title}
            </span>
          ))}
        </div>
      ) : null}

      {beitrag.hints.map((hinweis) => (
        <Hinweis key={hinweis.kind} hinweis={hinweis} />
      ))}
    </div>
  );
}

/**
 * Ein Hinweis sieht anders aus als eine Antwort.
 *
 * Das ist die ganze Gestaltungsentscheidung: Der Bauherr soll auf einen Blick
 * sehen, was das Produkt sagt und was ein Modell geschrieben hat. Deshalb
 * Rahmen, Symbol und Überschrift — und deshalb kein Aufklapper.
 */
function Hinweis({ hinweis }: { hinweis: LotseHint }) {
  const Symbol =
    hinweis.kind === 'recht' ? Scale : hinweis.kind === 'mangel' ? ShieldQuestion : Wallet;

  return (
    <Card
      className={`flex flex-col gap-2 border-l-2 ${
        hinweis.kind === 'kosten' ? 'border-l-ash' : 'border-l-tangerine'
      }`}
    >
      <p className="flex items-start gap-2 text-body font-medium text-charcoal">
        <Symbol size={18} className="mt-0.5 shrink-0" aria-hidden />
        {hinweis.title}
      </p>
      {hinweis.text.split(/\n{2,}/).map((absatz, index) => (
        <p key={index} className="text-body text-steel">
          {absatz}
        </p>
      ))}
    </Card>
  );
}

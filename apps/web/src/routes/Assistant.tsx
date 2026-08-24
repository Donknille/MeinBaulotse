/**
 * Frag den Lotsen — Abschnitt 3.7.
 *
 * Eine Chat-Oberfläche, und damit eine, die zwei bekannte Fallen mitbringt:
 *
 * 1. **Das leere Eingabefeld.** Wer nicht weiß, was er fragen kann, fragt
 *    nichts. Deshalb stehen vier Einstiegsfragen als Knöpfe da, und jede ist
 *    eine, die ein Bauherr wirklich hat.
 * 2. **Der Eindruck von Allwissenheit.** Ein Chatfenster verspricht Antworten
 *    auf alles. Deshalb steht unter jeder Antwort, worauf sie beruht — die
 *    Lotsenkarten, die sie trägt —, und die Leitplanken aus 3.7 hängen sichtbar
 *    darunter, statt in einem Kleingedruckten zu verschwinden.
 *
 * Was der Lotse **nicht** ist, sagt die Seite selbst: kein Anwalt, kein
 * Sachverständiger, kein Kostenvoranschlag. Das steht nicht aus Vorsicht dort,
 * sondern weil ein Bauherr, der es einmal gelesen hat, die richtige Frage an
 * der richtigen Stelle stellt.
 */

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Loader2, Send, Sparkles } from 'lucide-react';
import { ASSISTANT_STARTERS, type AssistantMessageDto } from '@meinbaulotse/shared';
import { Button, Card, EmptyState } from '../components/ui';
import { TopBar } from '../components/TopBar';
import { ApiError, api } from '../lib/api';

export function Assistant() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [frage, setFrage] = useState('');
  const [threadId, setThreadId] = useState<string | null>(null);
  const ende = useRef<HTMLDivElement>(null);

  const lotse = useQuery({
    queryKey: ['assistant', projectId],
    queryFn: () => api.assistant(projectId!),
    enabled: projectId !== undefined,
  });

  const fragen = useMutation({
    mutationFn: (question: string) =>
      api.askAssistant(projectId!, { question, ...(threadId === null ? {} : { threadId }) }),
    onSuccess: (faden) => {
      setThreadId(faden.id);
      setFrage('');
      void queryClient.invalidateQueries({ queryKey: ['assistant', projectId] });
    },
  });

  const faden =
    threadId === null
      ? (lotse.data?.threads[0] ?? null)
      : (lotse.data?.threads.find((eintrag) => eintrag.id === threadId) ?? null);
  const nachrichten = faden?.messages ?? [];

  useEffect(() => {
    ende.current?.scrollIntoView({ behavior: 'smooth' });
  }, [nachrichten.length, fragen.isPending]);

  const status = lotse.data?.status;
  const gesperrt = status !== undefined && !status.available;

  return (
    <main className="mx-auto flex w-full max-w-[42rem] flex-col gap-6 px-4 py-8 sm:px-6">
      <TopBar back={{ to: `/projekt/${projectId ?? ''}`, label: 'Zum Bauvorhaben' }} />

      <header className="flex flex-col gap-1">
        <h1 className="display-title text-heading-lg flex items-center gap-2 text-charcoal">
          <Sparkles size={22} className="text-lavender" aria-hidden />
          Frag den Lotsen
        </h1>
        <p className="max-w-[36rem] text-body text-steel">
          Er kennt dein Bauvorhaben — Termine, Entscheidungen, dein Tagebuch und die
          Lotsenkarten zu den Vorgängen, die gerade anstehen. Er ist kein Anwalt, kein
          Bausachverständiger und kein Kostenvoranschlag.
        </p>
      </header>

      {gesperrt ? (
        <Card tone="muted">
          <p className="text-body text-charcoal">{status.reason}</p>
        </Card>
      ) : null}

      {nachrichten.length === 0 ? (
        <EmptyState
          text="Stell eine Frage. Wenn dir gerade keine einfällt, fangen diese vier meistens gut an:"
          action={
            <div className="flex flex-col items-start gap-2">
              {ASSISTANT_STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  disabled={gesperrt || fragen.isPending}
                  onClick={() => fragen.mutate(starter)}
                  className="min-h-11 rounded-[var(--radius-button)] border border-ash px-3 text-left text-body text-charcoal transition-colors duration-[var(--motion-micro)] hover:bg-paper-mist disabled:opacity-45"
                >
                  {starter}
                </button>
              ))}
            </div>
          }
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {nachrichten.map((eintrag) => (
            <li key={eintrag.id}>
              <Nachricht eintrag={eintrag} />
            </li>
          ))}
        </ul>
      )}

      {fragen.isPending ? (
        <p className="flex items-center gap-2 text-body text-steel">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          Der Lotse sieht sich dein Bauvorhaben an.
        </p>
      ) : null}
      <div ref={ende} />

      {fragen.error !== null ? (
        <p className="text-body text-alarm-red">
          {fragen.error instanceof ApiError
            ? fragen.error.message
            : 'Das ließ sich gerade nicht fragen.'}
        </p>
      ) : null}

      <form
        className="sticky bottom-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (frage.trim().length >= 3) fragen.mutate(frage.trim());
        }}
      >
        <input
          value={frage}
          onChange={(event) => setFrage(event.target.value)}
          disabled={gesperrt || fragen.isPending}
          placeholder="Was möchtest du wissen?"
          className="h-14 w-full rounded-[var(--radius-input)] border border-midnight-ink bg-canvas-white px-4 text-body-lg text-charcoal placeholder:text-fog disabled:opacity-45"
        />
        <Button
          type="submit"
          variant="primary"
          size="field"
          disabled={gesperrt || fragen.isPending || frage.trim().length < 3}
          aria-label="Fragen"
        >
          <Send size={20} aria-hidden />
        </Button>
      </form>

      {status !== undefined && status.available ? (
        <p className="text-caption text-steel">
          Noch {status.questionsLeftThisHour}{' '}
          {status.questionsLeftThisHour === 1 ? 'Frage' : 'Fragen'} in dieser Stunde.
        </p>
      ) : null}
    </main>
  );
}

function Nachricht({ eintrag }: { eintrag: AssistantMessageDto }) {
  if (eintrag.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-[var(--radius-card)] bg-midnight-ink px-4 py-3 text-body-lg text-canvas-white">
        {eintrag.content}
      </div>
    );
  }

  return (
    <Card className="flex max-w-[92%] flex-col gap-3">
      <p className="text-body-lg whitespace-pre-wrap text-charcoal">{eintrag.content}</p>

      {/* Worauf die Antwort beruht. Ohne diese Zeile ist „laut Lotsenkarte"
          eine Behauptung; mit ihr ist es ein Verweis, dem man nachgehen kann. */}
      {eintrag.citedCards.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-steel">
          <BookOpen size={14} className="text-lavender" aria-hidden />
          Nachzulesen auf:{' '}
          {eintrag.citedCards.map((karte) => karte.title).join(' · ')}
        </p>
      ) : null}
    </Card>
  );
}

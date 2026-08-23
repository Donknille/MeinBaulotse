import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { onDemoSessionChange, readDemoSession, type DemoSession } from './lib/demo-auth';
import { DemoLogin } from './routes/DemoLogin';
import { SignIn } from './routes/SignIn';
import { Plan } from './routes/Plan';
import { GuestConfirm } from './routes/GuestConfirm';
import { Projects } from './routes/Projects';

/**
 * Was nicht am Anfang gebraucht wird, kommt nicht am Anfang mit.
 *
 * Diese Anwendung wird auf einer Baustelle geöffnet, oft an einem Funkloch
 * (CI 10.1). Ein Bündel, das jede Ansicht enthält — Bauakte, Vertragsspiegel,
 * Styleguide samt seiner Beispieldaten —, lässt den Bauherrn auf Dinge
 * warten, die er in diesem Augenblick nicht ansieht.
 *
 * Nicht getrennt sind die drei Wege hinein: Anmeldung, Projektliste, Plan.
 * Sie sind der Anfang jedes Besuchs, und ein Nachladen mitten im Einstieg
 * wäre genau die Verzögerung, die vermieden werden soll. Und die
 * Abstimmungsseite: Der Bauleiter öffnet sie einmal, für zehn Sekunden,
 * und für ihn ist das Nachladen der ganze Besuch.
 */
const Onboarding = lazy(() =>
  import('./routes/Onboarding').then((m) => ({ default: m.Onboarding })),
);
const WeeklyReport = lazy(() =>
  import('./routes/WeeklyReport').then((m) => ({ default: m.WeeklyReport })),
);
const Diary = lazy(() => import('./routes/Diary').then((m) => ({ default: m.Diary })));
const Lotse = lazy(() => import('./routes/Lotse').then((m) => ({ default: m.Lotse })));
const Defects = lazy(() => import('./routes/Defects').then((m) => ({ default: m.Defects })));
const Money = lazy(() => import('./routes/Money').then((m) => ({ default: m.Money })));
const Dossier = lazy(() => import('./routes/Dossier').then((m) => ({ default: m.Dossier })));
const Styleguide = lazy(() =>
  import('./routes/Styleguide').then((m) => ({ default: m.Styleguide })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

/**
 * Leert den Abfragespeicher, sobald ein anderer Nutzer fragt.
 *
 * Der erste Aufruf leert nichts: Da hat sich nichts geaendert, es ist nur der
 * erste bekannte Zustand.
 */
function useIdentityReset(identity: string | null): void {
  const previous = useRef(identity);
  useEffect(() => {
    if (previous.current === identity) return;
    previous.current = identity;
    queryClient.clear();
  }, [identity]);
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!isSupabaseConfigured);
  // Der Testzugang aus `/demo` ist eine zweite, gleichwertige Sitzung. Er
  // existiert, solange die Anmeldung per Magic Link mangels Mailversand nur
  // für das eigene Supabase-Konto funktioniert.
  const [demo, setDemo] = useState<DemoSession | null>(() => readDemoSession());

  useEffect(() => onDemoSessionChange(() => setDemo(readDemoSession())), []);

  // Wer die Identität wechselt, ist ein anderer Nutzer — und darf nichts mehr
  // von der vorigen sehen.
  //
  // TanStack Query haelt eine Antwort 30 Sekunden fuer frisch, und die Anfrage
  // sieht nach einem Rollenwechsel unveraendert aus; nur das Token dahinter ist
  // ein anderes. Ohne diesen Griff traegt die Projektliste nach „Rolle
  // wechseln" weiter die Pille der alten Rolle, und die Planansicht zeigt deren
  // Rechte — bis jemand hart neu laedt. Genau so ist es im Betrieb aufgefallen.
  useIdentityReset(demo?.token ?? session?.user.id ?? null);

  useEffect(() => {
    if (supabase === null) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* „Einen Moment." und kein Ladebalken: Das Nachladen dauert im
            Normalfall keine hundert Millisekunden, und ein Balken, der
            aufblitzt und verschwindet, ist unruhiger als ein Satz. */}
        <Suspense
          fallback={<div className="p-6 text-body text-steel">Einen Moment.</div>}
        >
        <Routes>
          {/* Der Styleguide ist die lebende Gegenprobe zum CI und braucht
              keine Anmeldung. */}
          <Route path="/styleguide" element={<Styleguide />} />
          {/* Der Testzugang muss auch dann erreichbar sein, wenn niemand
              angemeldet ist — er ist ja der Weg hinein. */}
          <Route path="/demo" element={<DemoLogin />} />
          {/* Die Abstimmungsseite steht ausdrücklich vor jeder Anmeldung: Ein
              Bauleiter, der sich anmelden soll, um einen Termin zu bestätigen,
              bestätigt keinen Termin (Leitsatz 1.6.2). */}
          <Route path="/abstimmen/:token" element={<GuestConfirm />} />
          <Route path="/abstimmen" element={<GuestConfirm />} />
          <Route path="/auth/callback" element={<Navigate to="/" replace />} />
          {!ready ? (
            <Route
              path="*"
              element={<div className="p-6 text-body text-steel">Einen Moment.</div>}
            />
          ) : session === null && demo === null ? (
            <Route path="*" element={<SignIn />} />
          ) : (
            <>
              <Route path="/" element={<Projects />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/projekt/:projectId" element={<Plan />} />
              <Route path="/projekt/:projectId/wochenbericht" element={<WeeklyReport />} />
              <Route path="/projekt/:projectId/tagebuch" element={<Diary />} />
              <Route path="/projekt/:projectId/lotse" element={<Lotse />} />
              <Route path="/projekt/:projectId/maengel" element={<Defects />} />
              <Route path="/projekt/:projectId/geld" element={<Money />} />
              <Route path="/projekt/:projectId/akte" element={<Dossier />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

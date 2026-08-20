import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { onDemoSessionChange, readDemoSession, type DemoSession } from './lib/demo-auth';
import { DemoLogin } from './routes/DemoLogin';
import { SignIn } from './routes/SignIn';
import { Onboarding } from './routes/Onboarding';
import { Plan } from './routes/Plan';
import { Projects } from './routes/Projects';
import { Styleguide } from './routes/Styleguide';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!isSupabaseConfigured);
  // Der Testzugang aus `/demo` ist eine zweite, gleichwertige Sitzung. Er
  // existiert, solange die Anmeldung per Magic Link mangels Mailversand nur
  // für das eigene Supabase-Konto funktioniert.
  const [demo, setDemo] = useState<DemoSession | null>(() => readDemoSession());

  useEffect(() => onDemoSessionChange(() => setDemo(readDemoSession())), []);

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
        <Routes>
          {/* Der Styleguide ist die lebende Gegenprobe zum CI und braucht
              keine Anmeldung. */}
          <Route path="/styleguide" element={<Styleguide />} />
          {/* Der Testzugang muss auch dann erreichbar sein, wenn niemand
              angemeldet ist — er ist ja der Weg hinein. */}
          <Route path="/demo" element={<DemoLogin />} />
          <Route path="/auth/callback" element={<Navigate to="/" replace />} />
          {!ready ? (
            <Route path="*" element={<div className="p-6 text-body text-steel">Einen Moment.</div>} />
          ) : session === null && demo === null ? (
            <Route path="*" element={<SignIn />} />
          ) : (
            <>
              <Route path="/" element={<Projects />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/projekt/:projectId" element={<Plan />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

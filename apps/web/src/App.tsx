import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { RoleViewProvider } from './lib/role-view';
import { SignIn } from './routes/SignIn';
import { Onboarding } from './routes/Onboarding';
import { ProjectLayout } from './routes/ProjectLayout';
import { Cockpit } from './routes/Cockpit';
import { Plan } from './routes/Plan';
import { Decisions } from './routes/Decisions';
import { Members } from './routes/Members';
import { Changes } from './routes/Changes';
import { ProjectSettings } from './routes/ProjectSettings';
import { Projects } from './routes/Projects';
import { Styleguide } from './routes/Styleguide';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!isSupabaseConfigured);

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
      <RoleViewProvider>
        <BrowserRouter>
          <Routes>
            {/* Der Styleguide ist die lebende Gegenprobe zum CI und braucht
                keine Anmeldung. */}
            <Route path="/styleguide" element={<Styleguide />} />
            <Route path="/auth/callback" element={<Navigate to="/" replace />} />
            {!ready ? (
              <Route
                path="*"
                element={<div className="p-6 text-body text-steel">Einen Moment.</div>}
              />
            ) : session === null ? (
              <Route path="*" element={<SignIn />} />
            ) : (
              <>
                <Route path="/" element={<Projects />} />
                <Route path="/onboarding" element={<Onboarding />} />
                <Route path="/projekt/:projectId" element={<ProjectLayout />}>
                  <Route index element={<Cockpit />} />
                  <Route path="plan" element={<Plan />} />
                  <Route path="entscheidungen" element={<Decisions />} />
                  <Route path="beteiligte" element={<Members />} />
                  <Route path="verlauf" element={<Changes />} />
                  <Route path="einstellungen" element={<ProjectSettings />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </>
            )}
          </Routes>
        </BrowserRouter>
      </RoleViewProvider>
    </QueryClientProvider>
  );
}

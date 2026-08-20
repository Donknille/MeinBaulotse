/**
 * Zugriff auf die eigene API.
 *
 * Web und API laufen unter derselben Herkunft — auf Vercel als eine
 * Bereitstellung, lokal über den Vite-Proxy. Deshalb keine Basis-URL, kein
 * CORS und keine Konfiguration, die zwischen den Umgebungen abweichen könnte.
 */

import type { OnboardingRequest, ProjectSchedule, ProjectSummary } from '@meinbaulotse/shared';
import { clearDemoSession, readDemoSession } from './demo-auth';
import { supabase } from './supabase';

export class ApiError extends Error {
  readonly status: number;
  readonly hint: string | undefined;

  constructor(status: number, message: string, hint?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.hint = hint;
  }
}

async function accessToken(): Promise<string> {
  // Der Testzugang hat Vorrang: Wer über /demo hereinkommt, hat sich bewusst
  // für eine andere Identität entschieden als die eigene Supabase-Sitzung.
  const demo = readDemoSession();
  if (demo !== null) return demo.token;

  const session = (await supabase?.auth.getSession())?.data.session;
  if (session == null) {
    throw new ApiError(401, 'Bitte melde dich an.');
  }
  return session.access_token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await accessToken()}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    // Ein abgelaufenes Testtoken soll nicht in Fehlermeldungen enden, sondern
    // zurück zur Anmeldung führen.
    if (response.status === 401 && readDemoSession() !== null) {
      clearDemoSession();
    }

    const body = (await response.json().catch(() => null)) as {
      error?: string;
      hint?: string;
    } | null;
    // Ohne JSON-Körper bleibt nur der Statuscode — und der ist mehr wert als
    // ein allgemeiner Satz: Ein 502 vom Router und ein 401 der API führen zu
    // ganz verschiedenen nächsten Schritten.
    throw new ApiError(
      response.status,
      body?.error ?? `Der Server hat mit ${response.status} geantwortet.`,
      body?.hint,
    );
  }

  return (await response.json()) as T;
}

export interface OnboardingResult {
  projectId: string;
  taskCount: number;
  dependencyCount: number;
  computedEnd: string;
  deviationWorkdays: number | null;
}

/**
 * Wen die Datenbank im Anrufer erkennt — nicht, was das Token behauptet.
 *
 * `databaseUserId` ist `null`, wenn `auth.uid()` den JWT-Claim nicht auflöst.
 * Dann bleibt jede Liste leer, obwohl die Daten in der Datenbank stehen.
 */
export interface Identity {
  tokenSub: string;
  databaseUserId: string | null;
  email: string | null;
  memberships: number;
}

export const api = {
  listProjects: () => request<{ projects: ProjectSummary[] }>('/me/projects'),
  me: () => request<Identity>('/me'),
  createProject: (answers: OnboardingRequest) =>
    request<OnboardingResult>('/projects/onboarding', {
      method: 'POST',
      body: JSON.stringify(answers),
    }),
  schedule: (projectId: string) => request<ProjectSchedule>(`/projects/${projectId}/schedule`),
};

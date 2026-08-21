/**
 * Zugriff auf die eigene API.
 *
 * Web und API laufen unter derselben Herkunft — auf Vercel als eine
 * Bereitstellung, lokal über den Vite-Proxy. Deshalb keine Basis-URL, kein
 * CORS und keine Konfiguration, die zwischen den Umgebungen abweichen könnte.
 */

import type {
  OnboardingRequest,
  ProjectSchedule,
  ProjectSummary,
  TaskUpdateRequest,
} from '@meinbaulotse/shared';
import { clearDemoSession, readDemoSession } from './demo-auth';
import { supabase } from './supabase';

/** Wie `describeConnection()` in `packages/db` sie beschreibt. */
export interface ConnectionShape {
  configured: boolean;
  port: number | null;
  tls: boolean;
  verifyTls: boolean;
  poolerUser: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly hint: string | undefined;
  /** Der technische Grund, maskiert von der API. Nur bei 500 gesetzt. */
  readonly detail: string | undefined;
  /** Die Form der Datenbankadresse, ohne Host, Benutzer oder Passwort. */
  readonly connection: ConnectionShape | undefined;

  constructor(
    status: number,
    message: string,
    hint?: string,
    detail?: string,
    connection?: ConnectionShape,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.hint = hint;
    this.detail = detail;
    this.connection = connection;
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
      detail?: string;
      connection?: ConnectionShape;
    } | null;
    // Ohne JSON-Körper bleibt nur der Statuscode — und der ist mehr wert als
    // ein allgemeiner Satz: Ein 502 vom Router und ein 401 der API führen zu
    // ganz verschiedenen nächsten Schritten.
    throw new ApiError(
      response.status,
      body?.error ?? `Der Server hat mit ${response.status} geantwortet.`,
      body?.hint,
      body?.detail,
      body?.connection,
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
  // Antwortet mit dem neu gerechneten Plan, nicht mit dem geänderten Vorgang:
  // Die Frage nach einer Verschiebung ist nie „was steht jetzt in der Zeile",
  // sondern „sind wir noch im Plan".
  updateTask: (projectId: string, taskId: string, change: TaskUpdateRequest) =>
    request<ProjectSchedule>(`/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(change),
    }),
};

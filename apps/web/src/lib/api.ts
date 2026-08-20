/**
 * Zugriff auf die eigene API.
 *
 * Web und API laufen unter derselben Herkunft — auf Vercel als eine
 * Bereitstellung, lokal über den Vite-Proxy. Deshalb keine Basis-URL, kein
 * CORS und keine Konfiguration, die zwischen den Umgebungen abweichen könnte.
 */

import type {
  DecisionDto,
  DecisionPatchRequest,
  MemberInviteRequest,
  MemberRole,
  MemberUpdateRequest,
  OnboardingRequest,
  ProjectMemberDto,
  ProjectPatchRequest,
  ProjectSchedule,
  ProjectSummary,
  ScheduleChangeEntry,
  TaskPatchRequest,
  TaskPatchResult,
  TradeOption,
} from '@meinbaulotse/shared';
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
    const body = (await response.json().catch(() => null)) as
      | { error?: string; hint?: string }
      | null;
    throw new ApiError(
      response.status,
      body?.error ?? 'Das hat nicht geklappt.',
      body?.hint,
    );
  }

  return (await response.json()) as T;
}

export interface OnboardingResult {
  projectId: string;
  taskCount: number;
  dependencyCount: number;
  decisionCount: number;
  computedEnd: string;
  deviationWorkdays: number | null;
}

/** Das heutige Datum des Geräts, nicht des Servers — siehe API-Kommentar. */
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

export const api = {
  listProjects: () => request<{ projects: ProjectSummary[] }>('/me/projects'),

  createProject: (answers: OnboardingRequest) =>
    request<OnboardingResult>('/projects/onboarding', {
      method: 'POST',
      body: JSON.stringify(answers),
    }),

  project: (projectId: string) => request<ProjectSummary>(`/projects/${projectId}`),

  patchProject: (projectId: string, patch: ProjectPatchRequest) =>
    request<ProjectSummary>(`/projects/${projectId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  schedule: (projectId: string) => request<ProjectSchedule>(`/projects/${projectId}/schedule`),

  patchTask: (projectId: string, taskId: string, patch: TaskPatchRequest) =>
    request<TaskPatchResult>(`/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  changes: (projectId: string) =>
    request<{ changes: ScheduleChangeEntry[] }>(`/projects/${projectId}/changes`),

  members: (projectId: string) =>
    request<{ members: ProjectMemberDto[] }>(`/projects/${projectId}/members`),

  inviteMember: (projectId: string, input: MemberInviteRequest) =>
    request<ProjectMemberDto>(`/projects/${projectId}/members`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateMember: (projectId: string, memberId: string, input: MemberUpdateRequest) =>
    request<ProjectMemberDto>(`/projects/${projectId}/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  revokeMember: (projectId: string, memberId: string) =>
    request<ProjectMemberDto>(`/projects/${projectId}/members/${memberId}`, {
      method: 'DELETE',
    }),

  decisions: (projectId: string) =>
    request<{ decisions: DecisionDto[] }>(
      `/projects/${projectId}/decisions?today=${todayIso()}`,
    ),

  patchDecision: (projectId: string, decisionId: string, patch: DecisionPatchRequest) =>
    request<DecisionDto>(`/projects/${projectId}/decisions/${decisionId}?today=${todayIso()}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  trades: () => request<{ trades: TradeOption[] }>('/trades'),

  roles: () => request<{ matrix: Partial<Record<MemberRole, string[]>> }>('/roles'),
};

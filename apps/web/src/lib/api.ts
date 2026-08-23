/**
 * Zugriff auf die eigene API.
 *
 * Web und API laufen unter derselben Herkunft — auf Vercel als eine
 * Bereitstellung, lokal über den Vite-Proxy. Deshalb keine Basis-URL, kein
 * CORS und keine Konfiguration, die zwischen den Umgebungen abweichen könnte.
 */

import type {
  ChecklistItemDto,
  ChecklistUpdateRequest,
  DecisionUpdateRequest,
  GuideCardView,
  OnboardingRequest,
  ProjectSchedule,
  DiaryChainResult,
  GuestSession,
  GuestTaskView,
  GuestTokenCreated,
  GuestTokenCreateRequest,
  ChangeOrderCreateRequest,
  ContractMirror,
  Dossier,
  ContractUpdateRequest,
  DefectCreateRequest,
  DefectDto,
  DefectUpdateRequest,
  LotseAnswer,
  LotseAskRequest,
  MoneyView,
  PaymentCreateRequest,
  PaymentMilestoneDto,
  PaymentReleaseRequest,
  LotseConversation,
  LotseMessage,
  DiaryCreateRequest,
  DiaryEntryDto,
  DiaryUpdateRequest,
  MediaCreateRequest,
  MediaItemDto,
  ProjectSummary,
  SchedulePreview,
  TaskUpdateRequest,
  WeeklyReport,
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
  /** Gesetzt, wenn der Fehler nach einer nicht eingespielten Migration riecht. */
  readonly schemaHint: string | undefined;

  constructor(
    status: number,
    message: string,
    hint?: string,
    detail?: string,
    connection?: ConnectionShape,
    schemaHint?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.hint = hint;
    this.detail = detail;
    this.connection = connection;
    this.schemaHint = schemaHint;
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
      schemaHint?: string;
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
      body?.schemaHint,
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

/**
 * Der Gast-Zugang.
 *
 * Bewusst getrennt vom übrigen Client: Er benutzt keine Sitzung, sondern den
 * Token aus dem Link — und er darf keine Anmeldung auslösen, wenn etwas
 * schiefgeht. Wer über einen Link kommt, hat kein Konto, auf das man ihn
 * schicken könnte.
 */
async function guestRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/guest${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(
      response.status,
      body?.error ?? `Der Server hat mit ${response.status} geantwortet.`,
    );
  }
  return (await response.json()) as T;
}

export const guestApi = {
  session: (token: string) => guestRequest<GuestSession>(token, '/session'),
  answer: (
    token: string,
    taskId: string,
    body: { agree: true } | { agree: false; start: string; end?: string; note?: string },
  ) =>
    guestRequest<GuestTaskView>(token, `/tasks/${taskId}/answer`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

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

  // Was eine Verschiebung nach sich zöge — ohne sie zu tun.
  previewTask: (projectId: string, taskId: string, change: TaskUpdateRequest) =>
    request<SchedulePreview>(`/projects/${projectId}/tasks/${taskId}/preview`, {
      method: 'POST',
      body: JSON.stringify(change),
    }),

  diary: async (projectId: string) =>
    (await request<{ entries: DiaryEntryDto[] }>(`/projects/${projectId}/diary`)).entries,

  createDiaryEntry: (projectId: string, entry: DiaryCreateRequest) =>
    request<DiaryEntryDto>(`/projects/${projectId}/diary`, {
      method: 'POST',
      body: JSON.stringify(entry),
    }),

  updateDiaryEntry: (projectId: string, entryId: string, change: DiaryUpdateRequest) =>
    request<DiaryEntryDto>(`/projects/${projectId}/diary/${entryId}`, {
      method: 'PATCH',
      body: JSON.stringify(change),
    }),

  registerMedia: (projectId: string, media: MediaCreateRequest) =>
    request<MediaItemDto>(`/projects/${projectId}/media`, {
      method: 'POST',
      body: JSON.stringify(media),
    }),

  verifyDiary: (projectId: string) =>
    request<DiaryChainResult>(`/projects/${projectId}/diary/verify`),

  photoPrompts: async (projectId: string) =>
    (await request<{ fulfilled: string[] }>(`/projects/${projectId}/photo-prompts`)).fulfilled,

  createGuestLink: (projectId: string, body: GuestTokenCreateRequest) =>
    request<GuestTokenCreated>(`/projects/${projectId}/guest-links`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  weeklyReport: (projectId: string) =>
    request<WeeklyReport>(`/projects/${projectId}/weekly-report`),

  // Antwortet mit dem ganzen Plan: Wer entscheidet, will wissen, ob der
  // Vorgang dahinter jetzt sicher ist.
  updateDecision: (projectId: string, decisionId: string, change: DecisionUpdateRequest) =>
    request<ProjectSchedule>(`/projects/${projectId}/decisions/${decisionId}`, {
      method: 'PATCH',
      body: JSON.stringify(change),
    }),

  // Die Lotsenkarte zu einem Vorgang. Das Abrufen haelt zugleich fest, dass
  // sie offen war — deshalb wird der Plan danach ungueltig: In ihm steht,
  // was noch zu lesen ist.
  guideCard: (projectId: string, taskId: string) =>
    request<GuideCardView>(`/projects/${projectId}/tasks/${taskId}/guide-card`),

  rateGuideCard: (projectId: string, taskId: string, helpful: boolean | null) =>
    request<{ readAt: string; helpful: boolean | null }>(
      `/projects/${projectId}/tasks/${taskId}/guide-card/feedback`,
      { method: 'POST', body: JSON.stringify({ helpful }) },
    ),

  updateChecklistItem: (projectId: string, itemId: string, change: ChecklistUpdateRequest) =>
    request<ChecklistItemDto>(`/projects/${projectId}/checklist/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify(change),
    }),

  // Frag den Lotsen. Die Anfrage traegt eine Frage und sonst nichts — was in
  // den Kontext gehoert, entscheidet der Server (Abschnitt 6.4).
  lotseConversations: (projectId: string) =>
    request<{ conversations: LotseConversation[]; available: boolean }>(
      `/projects/${projectId}/lotse`,
    ),

  lotseConversation: (projectId: string, conversationId: string) =>
    request<{ conversation: LotseConversation; messages: LotseMessage[] }>(
      `/projects/${projectId}/lotse/${conversationId}`,
    ),

  askLotse: (projectId: string, body: LotseAskRequest) =>
    request<LotseAnswer>(`/projects/${projectId}/lotse`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // -- Maengel, Geld, Vertragsspiegel ---------------------------------------

  defects: async (projectId: string) =>
    (await request<{ defects: DefectDto[] }>(`/projects/${projectId}/defects`)).defects,

  createDefect: (projectId: string, body: DefectCreateRequest) =>
    request<DefectDto>(`/projects/${projectId}/defects`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateDefect: (projectId: string, defectId: string, change: DefectUpdateRequest) =>
    request<DefectDto>(`/projects/${projectId}/defects/${defectId}`, {
      method: 'PATCH',
      body: JSON.stringify(change),
    }),

  defectEvents: async (projectId: string, defectId: string) =>
    (
      await request<{ events: DefectEventDto[] }>(
        `/projects/${projectId}/defects/${defectId}/events`,
      )
    ).events,

  money: (projectId: string) => request<MoneyView>(`/projects/${projectId}/money`),

  createPayment: (projectId: string, body: PaymentCreateRequest) =>
    request<MoneyView>(`/projects/${projectId}/payments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  releasePayment: (projectId: string, paymentId: string, body: PaymentReleaseRequest) =>
    request<PaymentMilestoneDto>(`/projects/${projectId}/payments/${paymentId}/release`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createChangeOrder: (projectId: string, body: ChangeOrderCreateRequest) =>
    request<{ changeOrders: unknown[] }>(`/projects/${projectId}/change-orders`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  contract: (projectId: string) => request<ContractMirror>(`/projects/${projectId}/contract`),

  updateContract: (projectId: string, change: ContractUpdateRequest) =>
    request<ContractMirror>(`/projects/${projectId}/contract`, {
      method: 'PATCH',
      body: JSON.stringify(change),
    }),

  dossier: (projectId: string, from: string, to: string) =>
    request<Dossier>(`/projects/${projectId}/dossier?from=${from}&to=${to}`),

  dismissFinding: (projectId: string, findingId: string, reason: string) =>
    request<ContractMirror>(`/projects/${projectId}/contract/findings/${findingId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

/** Ein Schritt im Verlauf eines Mangels. */
export interface DefectEventDto {
  id: string;
  action: string;
  note: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
}

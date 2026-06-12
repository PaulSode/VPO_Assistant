/**
 * VPO Assistant API client.
 *
 * Thin typed wrapper over fetch. The auth header uses the dev-mode bypass
 * documented in the backend's _auth.ts (`Authorization: Dev <userId>`); swap
 * in a real JWT flow before shipping.
 */

import type {
  Client,
  Ticket,
  ClientFact,
  RagHit,
  TicketStatus,
  TicketPriority,
  TicketChannel,
  ID,
} from './types';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const DEV_USER = import.meta.env.VITE_DEV_USER_ID ?? '';

function headers(json = false): HeadersInit {
  const h: Record<string, string> = { Authorization: `Dev ${DEV_USER}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}/v1${path}`, init);
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.error ?? body.message ?? '';
    } catch {
      /* not JSON */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Current user ───────────────────────────────────────────────────────────

export interface MeUser {
  _id: ID;
  name: string | null;
  email: string | null;
  plan: 'free' | 'team' | 'pro';
}

export const meApi = {
  get: () => request<{ user: MeUser }>('/me', { headers: headers() }),
};

// ─── Clients ────────────────────────────────────────────────────────────────

export const clientsApi = {
  list: () => request<{ clients: Client[] }>('/clients', { headers: headers() }),
  get: (id: ID) => request<{ client: Client }>(`/clients/${id}`, { headers: headers() }),
  create: (data: { name: string; company?: string; contactEmail?: string; notes?: string }) =>
    request<{ client: Client }>('/clients', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify(data),
    }),
  update: (
    id: ID,
    data: { name?: string; company?: string; contactEmail?: string; notes?: string },
  ) =>
    request<{ client: Client }>(`/clients/${id}`, {
      method: 'PATCH',
      headers: headers(true),
      body: JSON.stringify(data),
    }),
  remove: (id: ID) =>
    request<void>(`/clients/${id}`, {
      method: 'DELETE',
      headers: headers(),
    }),
};

// ─── Tickets ────────────────────────────────────────────────────────────────

export const ticketsApi = {
  listForClient: (clientId: ID) =>
    request<{ tickets: Ticket[] }>(`/clients/${clientId}/tickets`, { headers: headers() }),
  get: (id: ID) => request<{ ticket: Ticket }>(`/tickets/${id}`, { headers: headers() }),
  create: (data: {
    clientId: ID;
    subject: string;
    content?: string;
    reference?: string;
    channel?: TicketChannel;
    priority?: TicketPriority;
  }) =>
    request<{ ticket: Ticket }>('/tickets', {
      method: 'POST',
      headers: headers(true),
      body: JSON.stringify({ content: '', ...data }),
    }),
  saveContent: (id: ID, content: string) =>
    request<{ savedAt: string; analysisVersion: number }>(`/tickets/${id}/content`, {
      method: 'PUT',
      headers: headers(true),
      body: JSON.stringify({ content }),
    }),
  updateMeta: (
    id: ID,
    data: {
      subject?: string;
      status?: TicketStatus;
      priority?: TicketPriority;
      reference?: string;
      channel?: TicketChannel;
    },
  ) =>
    request<{ ticket: Ticket }>(`/tickets/${id}`, {
      method: 'PATCH',
      headers: headers(true),
      body: JSON.stringify(data),
    }),
  remove: (id: ID) =>
    request<void>(`/tickets/${id}`, {
      method: 'DELETE',
      headers: headers(),
    }),
};

// ─── Client context (extracted facts) ────────────────────────────────────────

export const contextApi = {
  facts: (clientId: ID) =>
    request<{ facts: ClientFact[] }>(`/clients/${clientId}/facts`, { headers: headers() }),
  factsForTicket: (ticketId: ID) =>
    request<{ facts: ClientFact[] }>(`/tickets/${ticketId}/facts`, { headers: headers() }),
};

// ─── Search ─────────────────────────────────────────────────────────────────

export const searchApi = {
  semantic: (clientId: ID, query: string, k = 8) =>
    request<{ hits: RagHit[] }>(
      `/clients/${clientId}/search?q=${encodeURIComponent(query)}&k=${k}`,
      { headers: headers() },
    ),
};

// ─── Analysis (SSE streaming progress) ──────────────────────────────────────

export type AnalysisStepKey = 'preparing' | 'analyzing' | 'context' | 'indexing' | 'finalizing';

export type AnalysisEvent =
  | { type: 'step'; step: AnalysisStepKey; index: number; total: number }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * Trigger a ticket analysis and stream its progress as SSE.
 * Calls onEvent for every frame; resolves when the stream closes.
 */
export function streamAnalysis(args: {
  ticketId: ID;
  signal?: AbortSignal;
  onEvent: (event: AnalysisEvent) => void;
}): Promise<void> {
  return fetch(`${API}/v1/tickets/${args.ticketId}/analyze`, {
    method: 'POST',
    headers: headers(),
    signal: args.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      throw new Error(`Analyse impossible : ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseAnalysisFrame(frame);
        if (event) args.onEvent(event);
      }
    }
  });
}

function parseAnalysisFrame(frame: string): AnalysisEvent | null {
  const lines = frame.split('\n');
  let eventName: string | undefined;
  let dataStr = '';
  for (const line of lines) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
  }
  if (!eventName) return null;
  try {
    const data = dataStr ? JSON.parse(dataStr) : {};
    switch (eventName) {
      case 'step':
        return { type: 'step', step: data.step, index: data.index ?? 0, total: data.total ?? 5 };
      case 'done':
        return { type: 'done' };
      case 'error':
        return { type: 'error', message: data.message ?? 'Erreur inconnue' };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// ─── Assistant (SSE streaming) ──────────────────────────────────────────────

export type AssistantEvent =
  | { type: 'start'; ragHits: string[] }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * Stream the assistant's response. Calls onEvent for every SSE frame.
 *
 * Implementation note: native EventSource doesn't support custom headers
 * (no Authorization), so we use fetch + manual SSE parsing instead.
 */
export function streamAssistant(args: {
  clientId: ID;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentTicketId?: ID;
  signal?: AbortSignal;
  onEvent: (event: AssistantEvent) => void;
}): Promise<void> {
  const controller = new AbortController();
  const signal = args.signal ?? controller.signal;

  return fetch(`${API}/v1/clients/${args.clientId}/assistant`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({
      messages: args.messages,
      currentTicketId: args.currentTicketId,
    }),
    signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      throw new Error(`Assistant request failed: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const event = parseFrame(frame);
        if (event) args.onEvent(event);
      }
    }
  });
}

function parseFrame(frame: string): AssistantEvent | null {
  const lines = frame.split('\n');
  let eventName: string | undefined;
  let dataStr = '';
  for (const line of lines) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
  }
  if (!eventName) return null;
  try {
    const data = dataStr ? JSON.parse(dataStr) : {};
    switch (eventName) {
      case 'start':
        return { type: 'start', ragHits: data.ragHits ?? [] };
      case 'delta':
        return { type: 'delta', text: data.text ?? '' };
      case 'done':
        return { type: 'done' };
      case 'error':
        return { type: 'error', message: data.message ?? 'unknown' };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

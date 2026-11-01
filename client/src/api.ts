import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Message, SessionView } from './types.ts';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(path: string, init?: RequestInit): Promise<SessionView> {
  const response = await fetch(`/api${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new ApiError(response.status, body.error ?? 'Request failed');
  return body;
}

const LIVE_POLL_MS = 400;

const sessionKey = (id: string | null) => ['session', id] as const;

/**
 * Opening a chat keeps the previous one as a placeholder, so the app shell never unmounts.
 * Callers show a skeleton for chat-specific areas while `isPlaceholderData` is true.
 * Bookings and memory are shared across chats, so a cached chat refetches silently on open.
 */
export function useSession(id: string | null) {
  return useQuery<SessionView, ApiError>({
    queryKey: sessionKey(id),
    queryFn: () => request(`/sessions/${id}`),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation<SessionView, ApiError>({
    mutationFn: () => request('/sessions', { method: 'POST' }),
    onSuccess: (session) => queryClient.setQueryData(sessionKey(session.id), session),
  });
}

/** Progress while a message runs. Keyed per turn, so one turn never shows another's data. */
export function useLiveSession(id: string | null, turn: number, enabled: boolean) {
  return useQuery<SessionView, ApiError>({
    queryKey: ['live', id, turn],
    queryFn: () => request(`/sessions/${id}`),
    enabled,
    refetchInterval: enabled ? LIVE_POLL_MS : false,
    gcTime: 0,
  });
}

interface SendVariables {
  text: string;
  approvalId?: string;
}

/** Shows the user's message at once. Mutations never auto-retry, so a yes is sent only once. */
export function useSendMessage(id: string | null) {
  const queryClient = useQueryClient();
  const key = sessionKey(id);
  return useMutation<SessionView, ApiError, SendVariables, { previous?: SessionView }>({
    mutationFn: ({ text, approvalId }) =>
      request(`/sessions/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, approvalId }),
      }),
    onMutate: async ({ text }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SessionView>(key);
      if (previous) {
        const draft: Message = { id: 'draft', role: 'user', text, cards: [] };
        queryClient.setQueryData(key, { ...previous, messages: [...previous.messages, draft], lastMessageAt: new Date().toISOString() });
      }
      return { previous };
    },
    onSuccess: (session) => queryClient.setQueryData(key, session),
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(key, context?.previous);
      // The server may have acted before the connection failed, so ask it what is true.
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

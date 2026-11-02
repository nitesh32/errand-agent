import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateSession, useLiveSession, useSendMessage, useSession } from '../api.ts';
import { readRecent, readStorage, rememberSession, writeStorage } from '../storage.ts';
import type { RecentSession } from '../storage.ts';
import type { Card, Panel, SendMessage } from '../types.ts';
import { isNarrow, isPhone, isTouch, restingPanel } from '../viewport.ts';

const SIDEBAR_KEY = 'errand.sidebarCollapsed';

export type ChatApp = ReturnType<typeof useChatApp>;

/** Which chat is open, what is showing, and the actions that change them. */
export function useChatApp() {
  const [sessionId, setSessionId] = useState<string | null>(() => location.hash.slice(1) || null);
  const [panel, setPanel] = useState<Panel>(restingPanel);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [lastTurnMs, setLastTurnMs] = useState(0);
  const [recent, setRecent] = useState<RecentSession[]>(readRecent);
  const [collapsed, setCollapsed] = useState(() => isNarrow() || readStorage(SIDEBAR_KEY, false));
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sessionQuery = useSession(sessionId);
  const createSession = useCreateSession();
  const sendMessage = useSendMessage(sessionId);
  const { mutate } = sendMessage;
  const pending = sendMessage.isPending;
  const liveQuery = useLiveSession(sessionId, sendMessage.submittedAt, pending);
  const session = sessionQuery.data;
  const live = pending ? liveQuery.data : undefined;
  // `session` is the previous chat until the new one arrives, so chat-specific areas wait.
  const loadingChat = sessionQuery.isPlaceholderData;
  const isEmptyChat = !loadingChat && session?.messages.length === 0;
  const needsSession = !sessionId || sessionQuery.error?.status === 404;

  // Stable, so memoised messages do not re-render when the parent does.
  const send: SendMessage = useCallback((text, approvalId) => {
    const startedAt = performance.now();
    mutate({ text, approvalId }, { onSuccess: () => setLastTurnMs(performance.now() - startedAt) });
  }, [mutate]);

  function showSession(id: string) {
    sendMessage.reset();
    setLastTurnMs(0);
    setPrefill(null);
    setSessionId(id);
    history.replaceState(null, '', `#${id}`);
    // A phone's panel covers the chat, so opening a chat has to close it.
    if (isPhone()) setPanel('none');
  }

  function newErrand() {
    if (createSession.isPending) return;
    // An untouched chat is already a new errand, so there is nothing to create.
    if (isEmptyChat) {
      setPanel(restingPanel());
      inputRef.current?.focus();
      return;
    }
    createSession.mutate(undefined, {
      onSuccess: ({ id }) => {
        setPanel(restingPanel());
        showSession(id);
      },
    });
  }

  /** The sidebar's bookings and memory are ordinary commands, shown as cards in the chat. */
  function showInChat(command: string, card: Card['type']) {
    if (pending || loadingChat) return;
    if (isPhone()) setPanel('none');
    if (session?.messages.at(-1)?.cards.some(({ type }) => type === card)) {
      const scroller = document.querySelector('.messages');
      scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    } else {
      send(command);
    }
  }

  function collapseSidebar(next: boolean) {
    setCollapsed(next);
    if (!isNarrow()) writeStorage(SIDEBAR_KEY, next);
  }

  // A missing chat starts a new one, whether there is no id or the server no longer has it.
  useEffect(() => {
    if (needsSession) newErrand();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSession]);

  // Keeps the recent list in step with whatever the server last returned.
  useEffect(() => {
    if (session) setRecent(rememberSession(session));
  }, [session]);

  // Ready to type after each reply. Not on touch screens, where it would raise the keyboard over the reply.
  useEffect(() => {
    if (!pending && !isTouch()) inputRef.current?.focus();
  }, [pending, sessionId]);

  return {
    sessionId,
    session,
    live,
    panel,
    setPanel,
    prefill,
    setPrefill,
    lastTurnMs,
    recent,
    collapsed,
    inputRef,
    pending,
    loadingChat,
    isEmptyChat,
    sendError: sendMessage.error,
    loadError: sessionQuery.error && !needsSession ? sessionQuery.error : null,
    send,
    showSession,
    newErrand,
    showInChat,
    collapseSidebar,
  };
}

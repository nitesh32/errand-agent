import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateSession, useLiveSession, useSendMessage, useSession } from './api.ts';
import { Chat } from './components/chat.tsx';
import { Home } from './components/home.tsx';
import { SidePanel } from './components/side-panel.tsx';
import { Sidebar } from './components/sidebar.tsx';
import { AppSkeleton } from './components/skeleton.tsx';
import { readRecent, readStorage, rememberSession, writeStorage } from './storage.ts';
import type { RecentSession } from './storage.ts';
import type { Panel, SendMessage } from './types.ts';
import { isNarrow, isPhone, isTouch, restingPanel } from './viewport.ts';

const SIDEBAR_KEY = 'errand.sidebarCollapsed';

export function App() {
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

  function showSession(id: string) {
    sendMessage.reset();
    setLastTurnMs(0);
    setPrefill(null);
    setSessionId(id);
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

  const needsSession = !sessionId || sessionQuery.error?.status === 404;
  useEffect(() => {
    if (needsSession) newErrand();
    // Only a missing session should start a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSession]);

  useEffect(() => {
    if (sessionId) history.replaceState(null, '', `#${sessionId}`);
  }, [sessionId]);

  useEffect(() => {
    if (session) setRecent(rememberSession(session));
  }, [session]);

  useEffect(() => {
    if (!isNarrow()) writeStorage(SIDEBAR_KEY, collapsed);
  }, [collapsed]);

  // Not on touch screens, where it would raise the keyboard over the reply.
  useEffect(() => {
    if (!pending && !isTouch()) inputRef.current?.focus();
  }, [pending, sessionId]);

  // Stable, so memoised messages do not re-render when the parent does.
  const send: SendMessage = useCallback((text, approvalId) => {
    const startedAt = performance.now();
    mutate({ text, approvalId }, { onSuccess: () => setLastTurnMs(performance.now() - startedAt) });
  }, [mutate]);

  if (!session) {
    const failed = sessionQuery.error && !needsSession;
    return <AppSkeleton collapsed={collapsed} error={failed ? `Can't reach the server: ${sessionQuery.error?.message}` : undefined} />;
  }

  const composer = {
    onSubmit: send,
    pending: pending || loadingChat,
    inputRef,
    scenarios: session.world.scenarios,
    prefill,
    onPrefillUsed: () => setPrefill(null),
  };
  // During a turn the panel shows live progress. Messages stay with the main query.
  const panelSession = live ? { ...session, state: live.state, trace: live.trace, runId: live.runId, limits: live.limits } : session;
  const isHome = isEmptyChat && panel === restingPanel();
  const error = sendMessage.error && `${sendMessage.error.message}. Please try again.`;

  return (
    <div className="app">
      <Sidebar
        session={session}
        activeId={sessionId}
        isEmptyChat={isEmptyChat}
        panel={panel}
        recent={recent}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        onPanel={setPanel}
        onNewErrand={newErrand}
        onOpenSession={showSession}
      />
      {isHome ? (
        <Home key={sessionId} composer={composer} />
      ) : (
        <main className="workspace">
          <Chat composerKey={sessionId} session={session} loading={loadingChat} liveState={live?.state ?? session.state} error={error} composer={composer} />
          <SidePanel
            panel={panel}
            session={panelSession}
            loading={loadingChat}
            lastTurnMs={lastTurnMs}
            live={pending}
            send={send}
            fillComposer={setPrefill}
          />
        </main>
      )}
    </div>
  );
}

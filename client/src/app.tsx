import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateSession, useLiveSession, useSendMessage, useSession } from './api.ts';
import { Chat } from './components/chat.tsx';
import { Home } from './components/home.tsx';
import { SidePanel } from './components/side-panel.tsx';
import { Sidebar } from './components/sidebar.tsx';
import type { Theme } from './components/sidebar.tsx';
import { AppSkeleton } from './components/skeleton.tsx';
import { readRecent, readStorage, rememberSession, writeStorage } from './storage.ts';
import type { RecentSession } from './storage.ts';
import type { Panel, SendMessage } from './types.ts';

const THEME_KEY = 'errand.theme';
const SIDEBAR_KEY = 'errand.sidebarCollapsed';

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(() => location.hash.slice(1) || null);
  const [panel, setPanel] = useState<Panel>('trace');
  const [prefill, setPrefill] = useState<string | null>(null);
  const [lastTurnMs, setLastTurnMs] = useState(0);
  const [recent, setRecent] = useState<RecentSession[]>(readRecent);
  const [theme, setTheme] = useState<Theme>(() => readStorage<Theme>(THEME_KEY, 'light'));
  const [collapsed, setCollapsed] = useState(() => readStorage(SIDEBAR_KEY, false));
  const [turn, setTurn] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sessionQuery = useSession(sessionId);
  const createSession = useCreateSession();
  const sendMessage = useSendMessage(sessionId);
  const { mutate } = sendMessage;
  const pending = sendMessage.isPending;
  const liveQuery = useLiveSession(sessionId, turn, pending);
  const session = sessionQuery.data;
  const live = pending ? liveQuery.data : undefined;
  // `session` is the previous chat until the new one arrives, so chat-specific areas wait.
  const loadingChat = sessionQuery.isPlaceholderData;

  function showSession(id: string) {
    sendMessage.reset();
    setLastTurnMs(0);
    setPrefill(null);
    setSessionId(id);
  }

  function newErrand() {
    if (createSession.isPending) return;
    // An untouched chat is already a new errand, so there is nothing to create.
    if (session && !loadingChat && !session.messages.length) {
      setPanel('trace');
      inputRef.current?.focus();
      return;
    }
    createSession.mutate(undefined, {
      onSuccess: ({ id }) => {
        setPanel('trace');
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
    document.documentElement.dataset.theme = theme;
    writeStorage(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    writeStorage(SIDEBAR_KEY, collapsed);
  }, [collapsed]);

  useEffect(() => {
    if (!pending) inputRef.current?.focus();
  }, [pending, sessionId]);

  // Stable, so memoised messages do not re-render when the parent does.
  const send: SendMessage = useCallback((text, approvalId) => {
    const startedAt = performance.now();
    setTurn((current) => current + 1);
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
    modelName: session.model,
    prefill,
    onPrefillUsed: () => setPrefill(null),
  };
  // During a turn the panel shows live progress. Messages stay with the main query.
  const panelSession = live ? { ...session, state: live.state, trace: live.trace, runId: live.runId, limits: live.limits } : session;
  const isHome = !loadingChat && !session.messages.length && panel === 'trace';
  const error = sendMessage.error && `${sendMessage.error.message}. Please try again.`;

  return (
    <div className="app">
      <Sidebar
        session={session}
        activeId={sessionId}
        isEmptyChat={!loadingChat && !session.messages.length}
        panel={panel}
        recent={recent}
        theme={theme}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        onTheme={setTheme}
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

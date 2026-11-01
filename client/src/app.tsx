import { useEffect, useRef, useState } from 'react';
import { useCreateSession, useLiveSession, useSendMessage, useSession } from './api.ts';
import { Chat } from './components/chat.tsx';
import { Home } from './components/home.tsx';
import { SidePanel } from './components/side-panel.tsx';
import { Sidebar } from './components/sidebar.tsx';
import type { Theme } from './components/sidebar.tsx';
import { readRecent, readStorage, rememberSession, writeStorage } from './storage.ts';
import type { RecentSession } from './storage.ts';
import type { Panel, SendMessage } from './types.ts';

const THEME_KEY = 'errand.theme';
const SIDEBAR_KEY = 'errand.sidebarCollapsed';

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(() => location.hash.slice(1) || null);
  const [panel, setPanel] = useState<Panel>('trace');
  const [draft, setDraft] = useState('');
  const [lastTurnMs, setLastTurnMs] = useState(0);
  const [recent, setRecent] = useState<RecentSession[]>(readRecent);
  const [theme, setTheme] = useState<Theme>(() => readStorage<Theme>(THEME_KEY, 'light'));
  const [collapsed, setCollapsed] = useState(() => readStorage(SIDEBAR_KEY, false));
  const [turn, setTurn] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sessionQuery = useSession(sessionId);
  const createSession = useCreateSession();
  const sendMessage = useSendMessage(sessionId);
  const pending = sendMessage.isPending;
  const liveQuery = useLiveSession(sessionId, turn, pending);
  const session = sessionQuery.data;
  const live = pending ? liveQuery.data : undefined;

  function newErrand() {
    // An untouched chat is already a new errand, so there is nothing to create.
    if (session && !session.messages.length) {
      setPanel('trace');
      setDraft('');
      inputRef.current?.focus();
      return;
    }
    createSession.mutate(undefined, {
      onSuccess: ({ id }) => {
        sendMessage.reset();
        setPanel('trace');
        setDraft('');
        setSessionId(id);
      },
    });
  }

  function openSession(id: string) {
    sendMessage.reset();
    setSessionId(id);
  }

  const needsSession = !sessionId || sessionQuery.error?.status === 404;
  useEffect(() => {
    if (needsSession && !createSession.isPending) newErrand();
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

  const send: SendMessage = (text, approvalId) => {
    const startedAt = performance.now();
    setDraft('');
    setTurn((current) => current + 1);
    sendMessage.mutate({ text, approvalId }, { onSuccess: () => setLastTurnMs(performance.now() - startedAt) });
  };

  if (!session) {
    return <div className="loading">{sessionQuery.error && !needsSession ? `Can't reach the server: ${sessionQuery.error.message}` : 'Loading…'}</div>;
  }

  const composer = { draft, onDraft: setDraft, onSubmit: send, pending, inputRef, scenarios: session.world.scenarios, modelName: session.model };
  // During a turn the panel shows live progress. Messages stay with the main query.
  const panelSession = live ? { ...session, state: live.state, trace: live.trace, runId: live.runId, limits: live.limits } : session;
  const isHome = !session.messages.length && panel === 'trace';
  const error = sendMessage.error && `${sendMessage.error.message}. Please try again.`;

  return (
    <div className="app">
      <Sidebar
        session={session}
        panel={panel}
        recent={recent}
        theme={theme}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        onTheme={setTheme}
        onPanel={setPanel}
        onNewErrand={newErrand}
        onOpenSession={openSession}
      />
      {isHome ? (
        <Home composer={composer} />
      ) : (
        <main className="workspace">
          <Chat key={session.id} session={session} liveState={live?.state ?? session.state} error={error} composer={composer} />
          <SidePanel
            panel={panel}
            session={panelSession}
            lastTurnMs={lastTurnMs}
            live={pending}
            send={send}
            fillComposer={(text) => { setDraft(text); inputRef.current?.focus(); }}
          />
        </main>
      )}
    </div>
  );
}

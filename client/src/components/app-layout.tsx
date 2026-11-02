import type { ChatApp } from '../hooks/use-chat-app.ts';
import { restingPanel } from '../viewport.ts';
import { Chat } from './chat.tsx';
import { Home } from './home.tsx';
import { SidePanel } from './side-panel.tsx';
import { Sidebar } from './sidebar.tsx';
import { AppSkeleton } from './skeleton.tsx';

export function AppLayout({ app }: { app: ChatApp }) {
  const { session, live, panel, setPanel, sessionId, pending, loadingChat, isEmptyChat, loadError, sendError } = app;

  if (!session) {
    return <AppSkeleton collapsed={app.collapsed} error={loadError ? `Can't reach the server: ${loadError.message}` : undefined} />;
  }

  const composer = {
    onSubmit: app.send,
    pending: pending || loadingChat,
    inputRef: app.inputRef,
    scenarios: session.world.scenarios,
    prefill: app.prefill,
    onPrefillUsed: () => app.setPrefill(null),
  };
  // During a turn the panel shows live progress. Messages stay with the main query.
  const panelSession = live ? { ...session, state: live.state, trace: live.trace, runId: live.runId, limits: live.limits } : session;
  const isHome = isEmptyChat && (panel === 'none' || panel === restingPanel());

  return (
    <div className="app">
      <Sidebar
        session={session}
        activeId={sessionId}
        isEmptyChat={isEmptyChat}
        panel={panel}
        recent={app.recent}
        collapsed={app.collapsed}
        onCollapse={app.collapseSidebar}
        onPanel={setPanel}
        onShow={app.showInChat}
        onNewErrand={app.newErrand}
        onOpenSession={app.showSession}
      />
      {isHome ? (
        <Home key={sessionId} composer={composer} />
      ) : (
        <main className="workspace">
          <Chat
            composerKey={sessionId}
            session={session}
            loading={loadingChat}
            liveState={live?.state ?? session.state}
            error={sendError && `${sendError.message}. Please try again.`}
            composer={composer}
            panelOpen={panel !== 'none'}
            onTogglePanel={() => setPanel(panel === 'none' ? 'trace' : 'none')}
            fillComposer={app.setPrefill}
          />
          <SidePanel panel={panel} session={panelSession} loading={loadingChat} lastTurnMs={app.lastTurnMs} live={pending} />
        </main>
      )}
    </div>
  );
}

/**
 * Placeholders for areas waiting on the API. They reuse the real layout classes, so nothing
 * shifts when content arrives. A CSS delay keeps a fast response from flashing them.
 */
function Bar({ width, height = 14 }: { width: string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} />;
}

export function ChatSkeleton() {
  return (
    <>
      <header className="chat-header" aria-busy="true"><Bar width="40%" /></header>
      <div className="messages" role="status" aria-label="Loading chat">
        <div className="messages-column">
          <div className="skeleton skeleton-right" style={{ width: '45%', height: 36 }} />
          <Bar width="70%" />
          <Bar width="50%" />
          <Bar width="100%" height={140} />
          <div className="skeleton skeleton-right" style={{ width: '25%', height: 36 }} />
          <Bar width="60%" />
        </div>
      </div>
    </>
  );
}

const TRACE_ROWS = ['70%', '55%', '80%', '60%', '75%', '50%'];

export function TraceSkeleton() {
  return (
    <>
      <div className="panel-header" aria-busy="true">
        <span className="panel-title">Trace</span>
        <div className="skeleton" style={{ width: 96, height: 24 }} />
      </div>
      <div className="panel-body" role="status" aria-label="Loading trace">
        {TRACE_ROWS.map((width, index) => (
          <div className="trace-row" key={index}>
            <Bar width="100%" height={12} />
            <Bar width="100%" height={12} />
            <Bar width={width} height={12} />
            <span />
          </div>
        ))}
      </div>
    </>
  );
}

/** The first page load, before any data exists to draw the sidebar from. */
export function AppSkeleton({ collapsed, error }: { collapsed: boolean; error?: string }) {
  return (
    <div className="app">
      <nav className={collapsed ? 'sidebar sidebar-collapsed' : 'sidebar'} aria-busy="true">
        <Bar width="60%" height={28} />
        <Bar width="100%" height={32} />
        <Bar width="100%" height={32} />
        <Bar width="100%" height={32} />
      </nav>
      <main className="workspace">
        <section className="chat">
          {error ? <div className="messages"><div className="error-banner" role="alert">{error}</div></div> : <ChatSkeleton />}
        </section>
      </main>
    </div>
  );
}

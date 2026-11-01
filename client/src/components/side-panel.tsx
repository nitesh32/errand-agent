import { factLabel, formatSlot, rupees } from '../format.ts';
import type { Fact, Panel, SendMessage, SessionView } from '../types.ts';
import { TraceSkeleton } from './skeleton.tsx';
import { TracePanel } from './trace-panel.tsx';

function factNote({ previous, source, confirmed }: Fact): string {
  if (previous) return `was ${previous}`;
  return source === 'inferred' && !confirmed ? 'not used until you confirm' : 'in use';
}

interface MemoryActions {
  send: SendMessage;
  fillComposer: (text: string) => void;
}

function FactRow({ fact, send, fillComposer }: { fact: Fact } & MemoryActions) {
  const inferred = fact.source === 'inferred';
  return (
    <div className={inferred && !fact.confirmed ? 'fact fact-guess' : 'fact'}>
      <div className="spread">
        <span className="label">{factLabel(fact.key)}</span>
        <span className="button-row">
          <span className={inferred ? 'tag tag-warn' : 'tag tag-ok'}>{inferred ? 'INFERRED' : 'STATED'}</span>
          {inferred && fact.confirmed && <span className="tag tag-ok">CONFIRMED</span>}
        </span>
      </div>
      <div className="strong">{fact.label}</div>
      <div className="spread">
        <span className="mono small muted">{factNote(fact)}</span>
        <span className="button-row">
          <button type="button" className="btn" onClick={() => fillComposer(`/memory set ${fact.key} `)}>Edit</button>
          <button type="button" className="btn" onClick={() => send(`/memory forget ${fact.key}`)}>Forget</button>
        </span>
      </div>
    </div>
  );
}

function MemoryPanel({ session: { memory }, ...actions }: { session: SessionView } & MemoryActions) {
  const { facts, forgottenKeys } = memory;
  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Memory</span>
        <span className="chip">{facts.length} {facts.length === 1 ? 'fact' : 'facts'}</span>
      </div>
      <div className="panel-body">
        {!facts.length && !forgottenKeys.length && <p className="panel-empty">Nothing saved yet. Try "I live in Powai".</p>}
        {facts.map((fact) => <FactRow key={fact.key} fact={fact} {...actions} />)}
        {forgottenKeys.map((key) => (
          <div className="fact" key={key}>
            <div className="spread">
              <span className="label">{factLabel(key)}</span>
              <span className="tag tag-gone">FORGOTTEN</span>
            </div>
            <div className="mono small muted">value deleted · never reused or re-inferred</div>
          </div>
        ))}
      </div>
      <div className="panel-footer">
        <span className="label">Rule</span>
        <p className="small">Inferred facts are asked about before use. Forgotten facts leave only a hash, so they can't come back.</p>
      </div>
    </>
  );
}

function BookingsPanel({ session: { bookings } }: { session: SessionView }) {
  const sorted = [...bookings].sort((a, b) => b.slot.localeCompare(a.slot));
  return (
    <>
      <div className="panel-header">
        <span className="panel-title">My bookings</span>
        <span className="chip">{bookings.length}</span>
      </div>
      <div className="panel-body">
        {sorted.map((booking) => (
          <div className="fact" key={booking.id}>
            <div className="spread">
              <span className="strong">{booking.provider.name}</span>
              <span className={`tag tag-${booking.status}`}>{booking.status.toUpperCase()}</span>
            </div>
            <div className="spread">
              <span className="mono small">{formatSlot(booking.slot)}</span>
              <span className="mono small">{rupees(booking.price)}</span>
            </div>
            <div className="mono small muted">{booking.id}</div>
          </div>
        ))}
      </div>
    </>
  );
}

interface SidePanelProps extends MemoryActions {
  panel: Panel;
  session: SessionView;
  /** The trace belongs to one chat, so it waits. Memory and bookings are shared, so they stay. */
  loading: boolean;
  lastTurnMs: number;
  live: boolean;
}

export function SidePanel({ panel, session, loading, lastTurnMs, live, send, fillComposer }: SidePanelProps) {
  if (panel === 'none') return null;
  return (
    <aside className="side-panel" aria-label={panel}>
      {panel === 'trace' && (loading ? <TraceSkeleton /> : <TracePanel session={session} lastTurnMs={lastTurnMs} live={live} />)}
      {panel === 'memory' && <MemoryPanel session={session} send={send} fillComposer={fillComposer} />}
      {panel === 'bookings' && <BookingsPanel session={session} />}
    </aside>
  );
}

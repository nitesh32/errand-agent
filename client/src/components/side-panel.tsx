import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { formatSlot, rupees } from '../format.ts';
import { readStorage, writeStorage } from '../storage.ts';
import type { Panel, SessionView } from '../types.ts';
import { MemoryRows } from './memory-rows.tsx';
import type { MemoryActions } from './memory-rows.tsx';
import { TraceSkeleton } from './skeleton.tsx';
import { TracePanel } from './trace-panel.tsx';

function MemoryPanel({ session: { memory, bookings }, ...actions }: { session: SessionView } & MemoryActions) {
  const { facts, forgottenKeys } = memory;
  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Memory</span>
        <span className="chip">{facts.length} {facts.length === 1 ? 'fact' : 'facts'}</span>
      </div>
      <div className="panel-body">
        {!facts.length && !forgottenKeys.length && <p className="panel-empty">Nothing saved yet. Try "I live in Powai".</p>}
        <MemoryRows memory={memory} bookings={bookings} {...actions} />
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

const WIDTH_KEY = 'errand.panelWidth';
const MIN_WIDTH = 320;
const MAX_WIDTH = 720;
const KEY_STEP = 16;

function setPanelWidth(panel: HTMLElement, width: number) {
  panel.style.setProperty('--panel-width', `${Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))}px`);
}

const savePanelWidth = (panel: HTMLElement) => writeStorage(WIDTH_KEY, Math.round(panel.getBoundingClientRect().width));

/** Drags the panel's left edge. It sets a CSS variable directly, so dragging re-renders nothing. */
function ResizeHandle() {
  const panelOf = (handle: HTMLElement) => handle.parentElement!;

  function drag(event: PointerEvent<HTMLDivElement>) {
    const handle = event.currentTarget;
    if (handle.hasPointerCapture(event.pointerId)) setPanelWidth(panelOf(handle), panelOf(handle).getBoundingClientRect().right - event.clientX);
  }

  function resizeByKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const panel = panelOf(event.currentTarget);
    setPanelWidth(panel, panel.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? KEY_STEP : -KEY_STEP));
    savePanelWidth(panel);
  }

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      tabIndex={0}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={drag}
      onPointerUp={(event) => savePanelWidth(panelOf(event.currentTarget))}
      onKeyDown={resizeByKey}
    />
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
    <aside className="side-panel" aria-label={panel} style={{ '--panel-width': `${readStorage(WIDTH_KEY, 400)}px` } as CSSProperties}>
      <ResizeHandle />
      {panel === 'trace' && (loading ? <TraceSkeleton /> : <TracePanel session={session} lastTurnMs={lastTurnMs} live={live} />)}
      {panel === 'memory' && <MemoryPanel session={session} send={send} fillComposer={fillComposer} />}
      {panel === 'bookings' && <BookingsPanel session={session} />}
    </aside>
  );
}

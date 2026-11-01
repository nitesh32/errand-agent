import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { readStorage, writeStorage } from '../storage.ts';
import type { Panel, SessionView } from '../types.ts';
import { TraceSkeleton } from './skeleton.tsx';
import { TracePanel } from './trace-panel.tsx';

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

interface SidePanelProps {
  panel: Panel;
  session: SessionView;
  /** The trace belongs to one chat, so it waits for that chat to load. */
  loading: boolean;
  lastTurnMs: number;
  live: boolean;
}

export function SidePanel({ panel, session, loading, lastTurnMs, live }: SidePanelProps) {
  if (panel === 'none') return null;
  return (
    <aside className="side-panel" aria-label="trace" style={{ '--panel-width': `${readStorage(WIDTH_KEY, 400)}px` } as CSSProperties}>
      <ResizeHandle />
      {loading ? <TraceSkeleton /> : <TracePanel session={session} lastTurnMs={lastTurnMs} live={live} />}
    </aside>
  );
}

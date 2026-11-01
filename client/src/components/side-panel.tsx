import { useEffect, useRef } from 'react';
import { factLabel, formatSlot, formatTraceTime, rupees } from '../format.ts';
import type { Fact, Panel, SendMessage, SessionView, TraceEvent, WorkflowState } from '../types.ts';

const STATE_LABELS: Record<WorkflowState, { label: string; tone?: string }> = {
  IDLE: { label: 'Ready' },
  COLLECTING: { label: 'Collecting' },
  SEARCHING: { label: 'Searching' },
  PRESENTING: { label: 'Presenting options' },
  HOLDING: { label: 'Holding slot' },
  AWAITING_APPROVAL: { label: 'Awaiting approval', tone: 'chip-warn' },
  EXECUTING: { label: 'Executing', tone: 'chip-warn' },
  VERIFYING: { label: 'Verifying', tone: 'chip-warn' },
  DONE: { label: 'Done · verified', tone: 'chip-ok' },
  FAILED: { label: 'Stopped', tone: 'chip-bad' },
};

const TAG_CLASS: Record<TraceEvent['type'], string> = {
  STATE: 'tag-state',
  MODEL: 'tag-model',
  TOOL: 'tag-tool',
  APPR: 'tag-warn',
  GUARD: 'tag-bad',
  INPUT: 'tag-state',
  REPLY: 'tag-tool',
  LIMIT: 'tag-bad',
  ERROR: 'tag-bad',
};

const compact = (value: unknown) => JSON.stringify(value).replace(/"(\w+)":/g, '$1:');

function extraFields({ ts: _ts, runId: _runId, type: _type, ...rest }: TraceEvent) {
  return rest;
}

/** Turns one trace event into a title and a detail line. */
function describeEvent(event: TraceEvent): [string, string?] {
  const text = (field: string) => event[field] as string;
  switch (event.type) {
    case 'STATE':
      return event.from ? [`${text('from')} → ${text('to')}`, text('why')] : ['Filtered options', text('filtered')];
    case 'MODEL': {
      const proposal = event.proposal as { intent: string; slots: unknown } | undefined;
      if (proposal) return [`proposal: ${proposal.intent}`, compact(proposal.slots)];
      return [text('model'), event.usage ? compact(event.usage) : 'no tokens used'];
    }
    case 'TOOL':
      return [text('tool'), `${compact(event.args)} → ${compact(event.result)}`];
    case 'APPR':
      return [`${text('approval')} → ${text('status')}`, text('reason') ?? (event.fingerprint ? `fp ${text('fingerprint')}` : text('message'))];
    case 'INPUT':
      return event.text === undefined ? ['Input', compact(extraFields(event))] : [`message ${text('message')}`, text('text')];
    case 'REPLY':
      return ['Reply', text('text').slice(0, 90)];
    case 'GUARD':
      return ['Guard', compact(extraFields(event))];
    default:
      return [event.type, compact(extraFields(event))];
  }
}

function TraceRow({ event }: { event: TraceEvent }) {
  const [title, detail] = describeEvent(event);
  const latency = event.latencyMs as number | undefined;
  return (
    <div className={`trace-row trace-${event.type.toLowerCase()}`}>
      <span className="mono trace-time">{formatTraceTime(event.ts)}</span>
      <span><span className={`tag ${TAG_CLASS[event.type]}`}>{event.type}</span></span>
      <span>{title}{detail && <div className="mono trace-detail">{detail}</div>}</span>
      <span className="mono trace-latency">{latency === undefined ? '—' : `${latency}ms`}</span>
    </div>
  );
}

function Meter({ label, value, limit, display }: { label: string; value: number; limit: number; display: string }) {
  return (
    <div className="meter">
      <div className="label">{label}</div>
      <div className="mono meter-value">{display}</div>
      <div className="meter-track"><div className="meter-fill" style={{ width: `${Math.min(100, (value / limit) * 100)}%` }} /></div>
    </div>
  );
}

function TracePanel({ session: { runId, state, trace, limits }, lastTurnMs, live }: { session: SessionView; lastTurnMs: number; live: boolean }) {
  const injections = trace.filter((event) => event.flaggedReview).length;
  const { label, tone = '' } = STATE_LABELS[state];
  const body = useRef<HTMLDivElement>(null);

  // The newest event is what matters while watching a run.
  useEffect(() => {
    body.current?.scrollTo({ top: body.current.scrollHeight });
  }, [trace.length]);

  return (
    <>
      <div className="panel-header">
        <span className="panel-title">Trace <span className="mono small muted">{runId}</span></span>
        <span className="button-row">
          {injections > 0 && <span className="chip chip-bad">{injections} injection ignored</span>}
          {live && <span className="chip"><span className="dot dot-live" />live</span>}
          <span className={`chip status-chip ${tone}`}>{label}</span>
        </span>
      </div>
      <div className="meters">
        <Meter label="Model" value={limits.modelCalls} limit={limits.maxModelCalls} display={`${limits.modelCalls} / ${limits.maxModelCalls}`} />
        <Meter label="Tools" value={limits.toolCalls} limit={limits.maxToolCalls} display={`${limits.toolCalls} / ${limits.maxToolCalls}`} />
        <Meter label="Last turn" value={lastTurnMs} limit={limits.maxTurnMs} display={`${(lastTurnMs / 1000).toFixed(1)}s / ${limits.maxTurnMs / 1000}s`} />
      </div>
      <div className="panel-body" ref={body}>
        {trace.length
          ? trace.map((event, index) => <TraceRow key={index} event={event} />)
          : <p className="panel-empty">Events appear here as the agent works.</p>}
      </div>
    </>
  );
}

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
  lastTurnMs: number;
  live: boolean;
}

export function SidePanel({ panel, session, lastTurnMs, live, send, fillComposer }: SidePanelProps) {
  return (
    <aside className="side-panel" aria-label={panel}>
      {panel === 'trace' && <TracePanel session={session} lastTurnMs={lastTurnMs} live={live} />}
      {panel === 'memory' && <MemoryPanel session={session} send={send} fillComposer={fillComposer} />}
      {panel === 'bookings' && <BookingsPanel session={session} />}
    </aside>
  );
}

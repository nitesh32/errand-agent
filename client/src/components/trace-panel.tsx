import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatTraceTime } from '../format.ts';
import type { SessionView, TraceEvent, WorkflowState } from '../types.ts';

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

const FILTERS: { label: string; types?: TraceEvent['type'][] }[] = [
  { label: 'All' },
  { label: 'Chat', types: ['INPUT', 'REPLY'] },
  { label: 'Model', types: ['MODEL'] },
  { label: 'Tools', types: ['TOOL'] },
  { label: 'State', types: ['STATE'] },
  { label: 'Approval', types: ['APPR'] },
  { label: 'Guards', types: ['GUARD', 'LIMIT', 'ERROR'] },
];

const compact = (value: unknown) => JSON.stringify(value).replace(/"(\w+)":/g, '$1:');

function extraFields({ ts: _ts, runId: _runId, type: _type, ...rest }: TraceEvent) {
  return rest;
}

/** Turns one trace event into a title and a one-line preview. */
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
      return ['Reply', text('text')];
    case 'GUARD':
      return ['Guard', compact(extraFields(event))];
    default:
      return [event.type, compact(extraFields(event))];
  }
}

/** What opening a row shows: a reply's full text, or every field of the event. */
function eventBody(event: TraceEvent): string {
  if (event.type === 'REPLY') return event.text as string;
  const { latencyMs: _latencyMs, ...fields } = extraFields(event);
  return JSON.stringify(fields, null, 2);
}

interface Turn {
  title: string;
  events: { event: TraceEvent; index: number }[];
}

/** A run can hold several messages. Each message the user typed starts a new turn. */
function groupByTurn(trace: TraceEvent[]): Turn[] {
  const turns: Turn[] = [];
  trace.forEach((event, index) => {
    const startsTurn = event.type === 'INPUT' && event.text !== undefined;
    if (startsTurn || !turns.length) turns.push({ title: startsTurn ? (event.text as string) : 'Start', events: [] });
    turns[turns.length - 1].events.push({ event, index });
  });
  return turns;
}

/** Native details keeps a row open across live polling, with no state to manage. */
function TraceRow({ event }: { event: TraceEvent }) {
  const [title, preview] = describeEvent(event);
  const latency = event.latencyMs as number | undefined;
  return (
    <details className={`trace-event trace-${event.type.toLowerCase()}`}>
      <summary className="trace-row">
        <span className="mono trace-time">{formatTraceTime(event.ts)}</span>
        <span><span className={`tag ${TAG_CLASS[event.type]}`}>{event.type}</span></span>
        <span className="trace-main">
          <span className="trace-title"><ChevronRight className="card-chevron" size={12} />{title}</span>
          {preview && <span className="mono trace-detail trace-preview">{preview}</span>}
        </span>
        <span className="mono trace-latency">{latency === undefined ? '—' : `${latency}ms`}</span>
      </summary>
      <pre className="mono trace-body">{eventBody(event)}</pre>
    </details>
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

export function TracePanel({ session: { runId, state, trace, limits }, lastTurnMs, live }: { session: SessionView; lastTurnMs: number; live: boolean }) {
  const [filter, setFilter] = useState('All');
  const [showRaw, setShowRaw] = useState(false);
  const injections = trace.filter((event) => event.flaggedReview).length;
  const { label, tone = '' } = STATE_LABELS[state];
  const body = useRef<HTMLDivElement>(null);

  const countOf = ({ types }: (typeof FILTERS)[number]) => (types ? trace.filter((event) => types.includes(event.type)).length : trace.length);
  // A new run starts empty, so a chosen filter can have nothing left to show.
  const active = FILTERS.find((item) => item.label === filter && countOf(item)) ?? FILTERS[0];
  const turns = groupByTurn(trace);

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
      {trace.length > 0 && (
        <div className="trace-tools">
          <div className="filter-chips" role="group" aria-label="Filter trace by event type">
            {!showRaw && FILTERS.filter(countOf).map((item) => (
              <button type="button" key={item.label} className="filter-chip" aria-pressed={item === active} onClick={() => setFilter(item.label)}>
                {item.label}
                <span className="mono filter-count">{countOf(item)}</span>
              </button>
            ))}
          </div>
          <div className="filter-chips trace-view" role="group" aria-label="Trace view">
            <button type="button" className="filter-chip" aria-pressed={!showRaw} onClick={() => setShowRaw(false)}>Events</button>
            <button type="button" className="filter-chip" aria-pressed={showRaw} onClick={() => setShowRaw(true)}>Raw</button>
          </div>
        </div>
      )}
      <div className="panel-body" ref={body}>
        {!trace.length && <p className="panel-empty">Events appear here as the agent works.</p>}
        {showRaw && <pre className="mono trace-raw">{trace.map((event) => JSON.stringify(event)).join('\n')}</pre>}
        {!showRaw && turns.map((turn, position) => {
          const events = turn.events.filter(({ event }) => !active.types || active.types.includes(event.type));
          if (!events.length) return null;
          return (
            <section key={turn.events[0].index}>
              <h3 className="trace-turn" title={turn.title}>
                <span className="label">Turn {position + 1}</span>
                <span className="trace-turn-title">{turn.title}</span>
                <span className="mono trace-turn-run">run {events[0].event.runId.split('_').at(-1)}</span>
              </h3>
              {events.map(({ event, index }) => <TraceRow key={`${event.runId}-${index}`} event={event} />)}
            </section>
          );
        })}
      </div>
    </>
  );
}

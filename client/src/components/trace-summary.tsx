import { ArrowRight, Calendar, Check, ChevronDown, CircleAlert, CircleCheck, Clock, MessageSquare, OctagonX, Search, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { groupByTurn, outcomeOf, plainSteps, safetyChecks } from '../trace-steps.ts';
import type { PlainStep, StepKind } from '../trace-steps.ts';
import type { TraceEvent } from '../types.ts';

const STEP_ICONS: Record<StepKind, LucideIcon> = {
  search: Search,
  calendar: Calendar,
  ask: MessageSquare,
  wait: Clock,
  approve: ShieldCheck,
  act: ArrowRight,
  verified: Check,
  warn: TriangleAlert,
  stop: OctagonX,
};

const OUTCOME_ICONS = { ok: CircleCheck, warn: Clock, bad: CircleAlert };

function StepRow({ step }: { step: PlainStep }) {
  const StepIcon = STEP_ICONS[step.kind];
  const icon = <span className={`plain-icon plain-${step.kind}`}><StepIcon size={13} /></span>;
  const latency = step.latencyMs !== undefined && <span className="mono plain-latency">{(step.latencyMs / 1000).toFixed(2)}s</span>;

  if (!step.fields) {
    return <li className="plain-step">{icon}<span className="plain-row"><span className="plain-title">{step.title}</span>{latency}</span></li>;
  }
  return (
    <li className="plain-step">
      {icon}
      <details className="plain-details">
        <summary className="plain-row">
          <span className="plain-title">{step.title}<ChevronDown className="plain-chevron" size={13} /></span>
          {latency}
        </summary>
        <div className="plain-fields">
          <dl>
            {step.fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="mono">{value}</dd></div>)}
          </dl>
          <button type="button" className="plain-copy" onClick={() => void navigator.clipboard.writeText(JSON.stringify(step.event, null, 2))}>Copy JSON</button>
        </div>
      </details>
    </li>
  );
}

/** The trace in plain words: a list of what happened, grouped by what you said. */
export function PlainTimeline({ trace, keyPrefix }: { trace: TraceEvent[]; keyPrefix: string }) {
  return (
    <div className="plain-timeline">
      {groupByTurn(trace).map((turn) => (
        <section key={`${keyPrefix}-${turn.events[0].index}`}>
          <div className="plain-you"><span className="muted">You</span><span className="plain-said">{turn.title}</span></div>
          <ol className="plain-steps">
            {plainSteps(turn.events.map(({ event }) => event)).map((step, position) => <StepRow key={position} step={step} />)}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function OutcomeBanner({ trace, state }: { trace: TraceEvent[]; state: string }) {
  const outcome = outcomeOf(trace, state);
  if (!outcome) return null;
  const OutcomeIcon = OUTCOME_ICONS[outcome.tone];
  return (
    <div className={`plain-outcome plain-outcome-${outcome.tone}`}>
      <OutcomeIcon size={20} />
      <div className="plain-outcome-text">
        <div className="strong">{outcome.title}</div>
        <div className="small">{outcome.detail}</div>
      </div>
    </div>
  );
}

export function SafetyCard({ trace }: { trace: TraceEvent[] }) {
  const checks = safetyChecks(trace);
  if (!checks.length) return null;
  const passed = checks.filter((check) => check.passed).length;
  return (
    <div className="panel-footer">
      <div className="spread">
        <span className="strong small">Safety checks</span>
        <span className={passed === checks.length ? 'small strong plain-pass' : 'small strong plain-fail'}>{passed} of {checks.length} passed</span>
      </div>
      <ul className="plain-checks">
        {checks.map(({ label, passed: ok }) => (
          <li key={label} className={ok ? 'plain-pass' : 'plain-fail'}>
            {ok ? <Check size={13} /> : <X size={13} />}
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { formatSlot, rupees } from './format.ts';
import type { TraceEvent } from './types.ts';

export type StepKind = 'search' | 'calendar' | 'ask' | 'wait' | 'approve' | 'act' | 'verified' | 'warn' | 'stop';

export interface PlainStep {
  kind: StepKind;
  title: string;
  latencyMs?: number;
  /** Label and value pairs shown when the row is opened. */
  fields?: [string, string][];
  event: TraceEvent;
}

export interface Turn {
  title: string;
  events: { event: TraceEvent; index: number }[];
}

export interface Outcome {
  tone: 'ok' | 'warn' | 'bad';
  title: string;
  detail: string;
}

export interface SafetyCheck {
  label: string;
  passed: boolean;
}

interface Terms {
  action: 'book' | 'cancel' | 'reschedule';
  slot: string;
  price: number;
  bookingId?: string;
}

type Fields = Record<string, unknown>;

const SIDE_EFFECTS = ['book', 'cancel', 'reschedule'];
const VERIFY_TOOLS = ['get_booking_status', 'list_bookings'];

const compact = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value).replace(/"(\w+)":/g, '$1: '));
const isSideEffect = (event: TraceEvent) => event.type === 'TOOL' && SIDE_EFFECTS.includes(event.tool as string);
const firstParagraph = (text: unknown) => String(text).split('\n')[0];
const words = (value: unknown) => String(value).replace(/_/g, ' ');

/** A run can hold several messages. Each message the user typed starts a new turn. */
export function groupByTurn(trace: TraceEvent[]): Turn[] {
  const turns: Turn[] = [];
  trace.forEach((event, index) => {
    const startsTurn = event.type === 'INPUT' && event.text !== undefined;
    if (startsTurn || !turns.length) turns.push({ title: startsTurn ? (event.text as string) : 'Start', events: [] });
    turns[turns.length - 1].events.push({ event, index });
  });
  return turns;
}

function toolStep(event: TraceEvent, acted: boolean): Pick<PlainStep, 'kind' | 'title'> {
  const result = (event.result ?? {}) as Fields;
  const failed = result.ok === false;
  switch (event.tool) {
    case 'search_providers':
      return { kind: 'search', title: `Found ${result.count} options` };
    case 'get_provider':
      return { kind: 'search', title: failed ? 'Could not read the reviews' : `Read ${result.reviews} reviews` };
    case 'hold_slot':
      return failed ? { kind: 'warn', title: `Could not hold the slot: ${words(result.error)}` } : { kind: 'calendar', title: `Held the slot at ${rupees(result.quoted_price as number)}` };
    case 'list_bookings':
      return acted ? { kind: 'verified', title: 'Double-checked it went through' } : { kind: 'calendar', title: 'Checked your bookings' };
    case 'get_booking_status':
      return result.status === 'booked' ? { kind: 'verified', title: 'Double-checked: it went through' } : { kind: 'warn', title: `Double-checked: ${words(result.status)}` };
    case 'book':
      return failed ? { kind: 'warn', title: `Booking did not finish: ${words(result.error)}` } : { kind: 'act', title: 'Made the booking' };
    case 'cancel':
      return failed ? { kind: 'warn', title: `Cancel did not finish: ${words(result.error)}` } : { kind: 'act', title: 'Cancelled the booking' };
    case 'reschedule':
      return failed ? { kind: 'warn', title: `Move did not finish: ${words(result.error)}` } : { kind: 'act', title: 'Moved the booking' };
    default:
      return { kind: 'search', title: String(event.tool) };
  }
}

function toolFields(event: TraceEvent): [string, string][] {
  const args = Object.entries((event.args ?? {}) as Fields).map(([key, value]): [string, string] => [key.replace(/_/g, ' '), compact(value)]);
  return [['tool', String(event.tool)], ...args, ['result', compact(event.result)]];
}

function replyStep(event: TraceEvent, acted: boolean, isCommand: boolean): Pick<PlainStep, 'kind' | 'title'> {
  // A slash command gets an answer, whatever the errand happens to be waiting on.
  if (isCommand && event.state !== 'AWAITING_APPROVAL') return { kind: 'ask', title: 'Replied' };
  switch (event.state) {
    case 'PRESENTING':
      return { kind: 'ask', title: 'Asked you to pick one' };
    case 'COLLECTING':
      return { kind: 'ask', title: 'Asked you for a detail' };
    case 'AWAITING_APPROVAL':
      return { kind: 'wait', title: 'Reminded you it needs your yes' };
    case 'FAILED':
      return { kind: 'stop', title: 'Told you it stopped, and why' };
    default:
      return { kind: 'ask', title: acted ? "Told you it's done" : 'Replied' };
  }
}

/** Rewrites one turn in plain words. Model and state events stay in the Details view. */
export function plainSteps(events: TraceEvent[]): PlainStep[] {
  const steps: PlainStep[] = [];
  let acted = false;
  const isCommand = String(events[0]?.text ?? '').startsWith('/');
  for (const event of events) {
    if (event.type === 'TOOL') {
      steps.push({ ...toolStep(event, acted), latencyMs: event.latencyMs as number | undefined, fields: toolFields(event), event });
      if (isSideEffect(event)) acted = true;
    } else if (event.type === 'APPR' && event.status === 'PENDING') {
      const terms = event.terms as Terms;
      steps.push({ kind: 'wait', title: `Asked you to confirm: ${formatSlot(terms.slot)}, ${rupees(terms.price)}`, event });
    } else if (event.type === 'APPR' && event.status === 'GRANTED') {
      steps.push({ kind: 'approve', title: 'Got your OK for exactly that time and price', event });
    } else if (event.type === 'APPR' && event.status === 'VOID') {
      steps.push({ kind: 'warn', title: `Approval no longer valid: ${event.reason}`, event });
    } else if (event.type === 'GUARD' && event.flaggedReview) {
      steps.push({ kind: 'warn', title: 'Ignored instructions hidden in a review', event });
    } else if (event.type === 'GUARD' || event.type === 'LIMIT' || event.type === 'ERROR') {
      steps.push({ kind: 'stop', title: { GUARD: 'A safety check stopped this', LIMIT: 'Hit a limit', ERROR: 'Something went wrong' }[event.type], fields: [['details', compact(event)]], event });
    } else if (event.type === 'REPLY') {
      // The question itself is already on the timeline from the approval event.
      const repeatsQuestion = event.state === 'AWAITING_APPROVAL' && steps.at(-1)?.title.startsWith('Asked you to confirm');
      if (!repeatsQuestion) steps.push({ ...replyStep(event, acted, isCommand), fields: [['said', String(event.text)]], event });
    }
  }
  return steps;
}

/** The headline for the panel, or null when there is nothing settled to report. */
export function outcomeOf(trace: TraceEvent[], state: string): Outcome | null {
  if (state === 'AWAITING_APPROVAL') {
    const terms = trace.findLast((event) => event.type === 'APPR' && event.status === 'PENDING')?.terms as Terms | undefined;
    return { tone: 'warn', title: 'Waiting for your yes', detail: terms ? `${formatSlot(terms.slot)} · ${rupees(terms.price)}` : 'Nothing has been done yet' };
  }
  if (state === 'FAILED') {
    const reply = trace.findLast((event) => event.type === 'REPLY');
    return { tone: 'bad', title: 'Stopped', detail: reply ? firstParagraph(reply.text) : 'See the details for what happened' };
  }
  if (state !== 'DONE') return null;
  const consumed = trace.findLastIndex((event) => event.type === 'APPR' && event.status === 'CONSUMED');
  const reply = consumed === -1 ? undefined : trace.slice(consumed).find((event) => event.type === 'REPLY');
  return reply ? { tone: 'ok', title: firstParagraph(reply.text).replace(/\s*\(bk_\d+\)\.?$/, ''), detail: 'Confirmed with the provider' } : null;
}

/** Whether what was sent to the provider is what the user approved, read from the trace itself. */
function matchesTerms(calls: TraceEvent[], terms: Terms, trace: TraceEvent[]): boolean {
  return calls.every((call) => {
    const args = call.args as Fields;
    if (call.tool === 'reschedule') return args.new_slot === terms.slot && args.booking_id === terms.bookingId;
    if (call.tool === 'cancel') return args.booking_id === terms.bookingId;
    const hold = trace.find((event) => event.tool === 'hold_slot' && (event.result as Fields | undefined)?.hold_id === args.hold_id);
    return (hold?.args as Fields | undefined)?.slot === terms.slot && (hold?.result as Fields | undefined)?.quoted_price === terms.price;
  });
}

/**
 * Four checks on the latest finished action. Each is worked out from the recorded events, so a
 * run that broke a rule shows a failed check. Empty until an action has finished.
 */
export function safetyChecks(trace: TraceEvent[]): SafetyCheck[] {
  const approval = trace.findLast((event) => event.type === 'APPR' && event.status === 'CONSUMED')?.approval;
  if (!approval) return [];
  const terms = trace.find((event) => event.approval === approval && event.status === 'PENDING')?.terms as Terms | undefined;
  const callsForApproval = (event: TraceEvent) => isSideEffect(event) && String((event.args as Fields).idempotency_key).startsWith(`idem_${approval}_`);
  const calls = trace.filter(callsForApproval);
  const firstCall = trace.findIndex(callsForApproval);
  const lastCall = trace.findLastIndex(callsForApproval);
  const granted = trace.findIndex((event) => event.approval === approval && event.status === 'GRANTED');
  const keys = new Set(calls.map((call) => (call.args as Fields).idempotency_key));
  const succeeded = calls.filter((call) => (call.result as Fields | undefined)?.ok === true).length;
  const verified = trace.slice(lastCall + 1).some((event) => event.type === 'TOOL' && VERIFY_TOOLS.includes(event.tool as string));
  const action = terms?.action ?? 'book';

  return [
    { label: 'Waited for your yes', passed: granted !== -1 && firstCall !== -1 && granted < firstCall },
    { label: action === 'cancel' ? 'Same booking you approved' : 'Same time and price you approved', passed: Boolean(terms) && calls.length > 0 && matchesTerms(calls, terms!, trace) },
    { label: { book: 'Booked it only once', cancel: 'Cancelled it only once', reschedule: 'Changed it only once' }[action], passed: calls.length > 0 && keys.size === 1 && succeeded <= 1 },
    { label: 'Checked with the provider after', passed: firstCall !== -1 && verified },
  ];
}

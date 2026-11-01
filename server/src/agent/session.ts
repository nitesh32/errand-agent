import type { Clock } from '../infra/clock.ts';
import type { Tracer } from '../infra/tracer.ts';
import type { Memory } from '../memory/memory.ts';
import type { Model } from '../model/model.ts';
import type { GuardedTools, HeldSlot } from '../tools/guarded-tools.ts';
import type { Limits, Usage } from '../tools/limits.ts';
import type { SafeReview } from '../tools/sanitize.ts';
import type { Booking, DateRange, TraceType } from '../types.ts';
import { voidApproval } from './approval.ts';
import type { Approval, ApprovalAction } from './approval.ts';

export const MAX_ATTEMPTS = 3;
export const MAX_OPTIONS = 5;

export type WorkflowState =
  | 'IDLE'
  | 'COLLECTING'
  | 'SEARCHING'
  | 'PRESENTING'
  | 'HOLDING'
  | 'AWAITING_APPROVAL'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'DONE'
  | 'FAILED';

export interface Slot<T> {
  value: T;
  source: 'user' | 'memory';
}

export interface Slots {
  service?: Slot<string>;
  area?: Slot<string>;
  dateRange?: Slot<DateRange>;
  earliest?: Slot<string>;
  latest?: Slot<string>;
  budget?: Slot<number | null>; // null means the user set no limit
  provider?: Slot<string>; // a provider id or name, matched against search results
  notes?: Slot<string>;
}

export type SlotName = keyof Slots;

/** One numbered choice shown to the user. */
export interface Option {
  index: number;
  providerId: string;
  providerName: string;
  rating: number;
  price: number;
  attributes: string[];
  slots: string[];
  bookingId?: string; // set when the choice is which existing booking to change
}

/** An inferred fact waiting for the user's yes or no. */
export interface PendingFact {
  key: string;
  value: string;
  label: string;
  question: string;
}

/** Written to disk before a side effect, so a restart knows what may have happened. */
export interface Execution {
  action: ApprovalAction;
  approvalId: string;
  key: string;
  keySeq: number;
  attempts: number;
}

export interface Step {
  label: string;
  detail: string;
  status: 'ok' | 'warn' | 'bad';
}

export type Card =
  | { type: 'options'; title: string; options: Option[] }
  | { type: 'approval'; approvalId: string; action: ApprovalAction; providerName: string; slot: string; price: number; note?: string; expiresAt?: string }
  | { type: 'reviews'; providerName: string; reviews: SafeReview[] }
  | { type: 'bookings' } // the client shows the current list, so an old card cannot go stale
  | { type: 'steps'; steps: Step[] };

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  cards: Card[];
}

/** The last completed action, so a repeated "yes" can report it instead of repeating it. */
export interface CompletedAction {
  action: ApprovalAction;
  bookingId: string;
}

export interface Session {
  id: string;
  userId: string;
  runId: string;
  runSeq: number;
  state: WorkflowState;
  kind?: ApprovalAction;
  slots: Slots;
  sameAsLast?: boolean;
  awaiting?: SlotName;
  asked: SlotName[];
  options: Option[];
  pendingFact?: PendingFact;
  targetBooking?: Booking;
  held?: HeldSlot;
  approvals: Approval[];
  approvalId?: string;
  execution?: Execution;
  completed?: CompletedAction;
  usage: Usage;
  messageSeq: number;
  messages: Message[];
}

export function createSession(id: string, userId: string): Session {
  return {
    id,
    userId,
    runId: `run_${id}_0`,
    runSeq: 0,
    state: 'IDLE',
    slots: {},
    asked: [],
    options: [],
    approvals: [],
    usage: { modelCalls: 0, toolCalls: 0 },
    messageSeq: 0,
    messages: [],
  };
}

/** Everything one user message needs. Built fresh for each message. */
export interface Turn {
  session: Session;
  tools: GuardedTools;
  limits: Limits;
  memory: Memory;
  tracer: Tracer;
  clock: Clock;
  model: Model;
  userMessage: Message;
  replyParts: string[];
  cards: Card[];
  steps: Step[];
  save: () => void;
  crashPoint: (name: string) => void;
}

/** Adds to the reply. Saying the same thing twice in one turn is a no-op. */
export function say(turn: Turn, text: string): void {
  if (!turn.replyParts.includes(text)) turn.replyParts.push(text);
}

export function trace(turn: Turn, type: TraceType, fields: Record<string, unknown> = {}): void {
  turn.tracer.log(turn.session.runId, type, fields);
}

export function addStep(turn: Turn, label: string, detail: string, status: Step['status'] = 'ok'): void {
  turn.steps.push({ label, detail, status });
}

export function currentApproval(session: Session): Approval | undefined {
  return session.approvals.find((approval) => approval.id === session.approvalId);
}

export function voidCurrent(turn: Turn, reason: string): void {
  const approval = currentApproval(turn.session);
  if (!approval) return;
  voidApproval(approval, reason);
  trace(turn, 'APPR', { approval: approval.id, status: approval.status, reason });
}

/** Voids the current approval only if the user has not confirmed it yet. */
export function voidPending(turn: Turn, reason: string): void {
  if (currentApproval(turn.session)?.status === 'PENDING') voidCurrent(turn, reason);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 2026-11-04T09:00 becomes "Wed 4 Nov 09:00". */
export function formatSlot(slot: string): string {
  const [date, time] = slot.split('T');
  const value = new Date(`${date}T00:00:00Z`);
  return `${DAYS[value.getUTCDay()]} ${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]} ${time}`;
}

export function rupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

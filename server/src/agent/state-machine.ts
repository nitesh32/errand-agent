import type { Session, Turn, WorkflowState } from './session.ts';

export const ALLOWED_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  IDLE: ['COLLECTING'],
  COLLECTING: ['SEARCHING', 'PRESENTING', 'AWAITING_APPROVAL', 'IDLE', 'FAILED'],
  SEARCHING: ['PRESENTING', 'COLLECTING', 'FAILED'],
  PRESENTING: ['HOLDING', 'AWAITING_APPROVAL', 'COLLECTING', 'IDLE', 'FAILED'],
  HOLDING: ['AWAITING_APPROVAL', 'PRESENTING', 'SEARCHING', 'FAILED'],
  AWAITING_APPROVAL: ['EXECUTING', 'PRESENTING', 'COLLECTING', 'IDLE', 'FAILED'],
  EXECUTING: ['VERIFYING', 'SEARCHING', 'PRESENTING', 'COLLECTING', 'AWAITING_APPROVAL', 'FAILED'],
  VERIFYING: ['EXECUTING', 'SEARCHING', 'AWAITING_APPROVAL', 'DONE', 'FAILED'],
  DONE: ['COLLECTING'],
  FAILED: ['COLLECTING'],
};

/** A booking may be in flight in these states, so they must be reconciled before anything else. */
const IN_FLIGHT: WorkflowState[] = ['EXECUTING', 'VERIFYING'];
const AT_REST: WorkflowState[] = ['IDLE', 'DONE', 'FAILED'];

export const isInFlight = (session: Session) => IN_FLIGHT.includes(session.state);
export const isAtRest = (session: Session) => AT_REST.includes(session.state);

/** The only way state changes. Saves first, so a crash resumes from the new state. */
export function transition(turn: Turn, to: WorkflowState, why: string): void {
  const { session, tracer } = turn;
  const from = session.state;
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new Error(`Illegal transition ${from} to ${to}`);
  session.state = to;
  turn.save();
  tracer.log(session.runId, 'STATE', { from, to, why });
}

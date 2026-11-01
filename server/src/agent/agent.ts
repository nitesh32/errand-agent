import { randomBytes } from 'node:crypto';
import type { Clock } from '../infra/clock.ts';
import { localDate } from '../infra/clock.ts';
import type { FileStore } from '../infra/file-store.ts';
import type { Tracer } from '../infra/tracer.ts';
import { Memory } from '../memory/memory.ts';
import type { MockProvider } from '../mock/mock-provider.ts';
import { validateProposal } from '../model/model.ts';
import type { Model, Proposal } from '../model/model.ts';
import { GuardedTools } from '../tools/guarded-tools.ts';
import { DEFAULT_LIMITS, LimitExceeded, Limits } from '../tools/limits.ts';
import type { LimitConfig } from '../tools/limits.ts';
import type { Booking, TraceEvent } from '../types.ts';
import { ApprovalError, isConfirmation } from './approval.ts';
import { approveAndExecute, presentOptions, resumeExecution, selectForBooking } from './booking-flow.ts';
import { selectForChange } from './change-flow.ts';
import { advance, answerPendingFact, applyCorrection, mergeSlots, startErrand } from './collect-flow.ts';
import { runCommand } from './commands.ts';
import { applyMemory, findOption, remind, showBookings, showReviews } from './replies.ts';
import { createSession, currentApproval, formatSlot, say, trace, voidPending } from './session.ts';
import type { Message, Session, Slots, Turn, WorkflowState } from './session.ts';
import { isAtRest, isInFlight, transition } from './state-machine.ts';

export interface AgentOptions {
  store: FileStore;
  tracer: Tracer;
  clock: Clock;
  provider: MockProvider;
  model: Model;
  userId?: string;
  limits?: Partial<LimitConfig>;
  toolTimeoutMs?: number;
}

/** The one shape the API returns, so the client has a single render path. */
export interface SessionView {
  id: string;
  state: WorkflowState;
  runId: string;
  slots: Slots;
  messages: Message[];
  trace: TraceEvent[];
  limits: LimitConfig & Session['usage'];
  memory: ReturnType<Memory['list']>;
  bookings: Booking[];
  model: string;
}

/** Simulates the process dying at a named point. Never caught by the agent. */
export class SimulatedCrash extends Error {}

export class SessionNotFound extends Error {}

const RECOVERY_TOOL_CALLS = 2;
const NOT_UNDERSTOOD = "Sorry, I didn't catch that.";
const NEGATIVE_ANSWER = /^\s*(no|nope|nah|someone else|something else|not really)[.,!]*\s*$/i;

export class Agent {
  private readonly options: AgentOptions;
  private readonly limitConfig: LimitConfig;
  private readonly userId: string;
  private readonly queues = new Map<string, Promise<unknown>>();
  private crashAt?: string;

  constructor(options: AgentOptions) {
    this.options = options;
    this.limitConfig = { ...DEFAULT_LIMITS, ...options.limits };
    this.userId = options.userId ?? 'u_demo';
  }

  createSession(id = randomBytes(4).toString('hex')): SessionView {
    const session = createSession(id, this.userId);
    this.options.store.write('sessions', id, session);
    return this.view(session);
  }

  /** Arms a simulated crash at a named point in the next execution. */
  crashNext(point: string): void {
    this.crashAt = point;
  }

  /** The current session. A session found mid-action is reconciled first. */
  getSession(id: string): Promise<SessionView> {
    return this.enqueue(id, async () => {
      const session = this.load(id);
      return isInFlight(session) ? this.runTurn(session) : this.view(session);
    });
  }

  /** One message at a time per session, so a double click cannot run twice. */
  handleMessage(id: string, text: string, approvalId?: string): Promise<SessionView> {
    return this.enqueue(id, () => this.runTurn(this.load(id), { text, approvalId }));
  }

  private enqueue<T>(id: string, work: () => Promise<T>): Promise<T> {
    const result = (this.queues.get(id) ?? Promise.resolve()).then(work, work);
    this.queues.set(id, result.catch(() => undefined));
    return result;
  }

  private load(id: string): Session {
    const session = this.options.store.read<Session>('sessions', id);
    if (!session) throw new SessionNotFound(id);
    return session;
  }

  private async runTurn(session: Session, input?: { text: string; approvalId?: string }): Promise<SessionView> {
    const turn = this.beginTurn(session, input?.text);
    try {
      if (isInFlight(session)) {
        turn.limits.allowRecovery(RECOVERY_TOOL_CALLS);
        await resumeExecution(turn);
        if (input && !isConfirmation(input.text)) await this.route(turn, input.text, input.approvalId);
      } else if (input) {
        await this.route(turn, input.text, input.approvalId);
      }
    } catch (error) {
      if (error instanceof SimulatedCrash) throw error;
      this.endWithFailure(turn, error);
    }
    this.endTurn(turn);
    return this.view(session);
  }

  private beginTurn(session: Session, text?: string): Turn {
    const { store, tracer, clock, provider, model, toolTimeoutMs = 10_000 } = this.options;
    if (isAtRest(session)) this.startRun(session, text);
    const limits = new Limits(this.limitConfig, session.usage, clock);

    const userMessage: Message = { id: `m_${++session.messageSeq}`, role: 'user', text: text ?? '', cards: [] };
    if (text !== undefined) {
      session.messages.push(userMessage);
      tracer.log(session.runId, 'INPUT', { message: userMessage.id, text });
    }
    return {
      session,
      tools: new GuardedTools({ provider, tracer, limits, clock, runId: session.runId, userId: session.userId, toolTimeoutMs }),
      limits,
      memory: new Memory(store, session.userId, clock),
      tracer,
      clock,
      model,
      userMessage,
      replyParts: [],
      cards: [],
      steps: [],
      save: () => store.write('sessions', session.id, session),
      crashPoint: (point) => {
        if (this.crashAt !== point) return;
        this.crashAt = undefined;
        throw new SimulatedCrash(point);
      },
    };
  }

  /**
   * A message arriving at rest starts a new run with a fresh budget and its own trace.
   * Commands and repeated confirmations stay in the current one, so a guard that blocks
   * a repeated "yes" appears in the trace of the booking it protected.
   */
  private startRun(session: Session, text?: string): void {
    session.usage.modelCalls = 0;
    session.usage.toolCalls = 0;
    if (text === undefined || text.trim().startsWith('/') || isConfirmation(text)) return;
    session.runSeq++;
    session.runId = `run_${session.id}_${session.runSeq}`;
  }

  private endTurn(turn: Turn): void {
    const { session, steps, cards, replyParts } = turn;
    if (steps.length) cards.unshift({ type: 'steps', steps });
    const text = replyParts.join('\n\n') || NOT_UNDERSTOOD;
    session.messages.push({ id: `m_${++session.messageSeq}`, role: 'assistant', text, cards });
    trace(turn, 'REPLY', { text, state: session.state });
    turn.save();
  }

  /** Every failure ends with a plain message saying what did and did not happen. */
  private endWithFailure(turn: Turn, error: unknown): void {
    const { session } = turn;
    const reason = error instanceof LimitExceeded ? `I reached my limit on ${error.kind}` : 'Something went wrong';

    if (error instanceof LimitExceeded) trace(turn, 'LIMIT', { kind: error.kind });
    else trace(turn, 'ERROR', { message: error instanceof Error ? error.message : String(error) });

    if (isInFlight(session) && !(error instanceof ApprovalError)) {
      say(turn, `${reason} before I could confirm the result, so I can't say yet whether it went through. I won't retry blindly. Send me any message and I'll check with the provider first.`);
      return;
    }
    voidPending(turn, 'run ended');
    if (!isAtRest(session)) transition(turn, 'FAILED', reason);
    say(turn, `${reason}, so I stopped. Nothing was booked, moved or cancelled. You can start again whenever you like.`);
  }

  private async route(turn: Turn, text: string, approvalId?: string): Promise<void> {
    const { session } = turn;
    if (text.trim().startsWith('/')) {
      return runCommand(turn, text.trim(), { provider: this.options.provider, armCrash: (point) => this.crashNext(point) });
    }

    const approval = currentApproval(session);
    if (approvalId && (approvalId !== session.approvalId || approval?.status !== 'PENDING')) {
      return this.refuseStaleCard(turn, approvalId);
    }
    if (session.state === 'AWAITING_APPROVAL' && isConfirmation(text)) return approveAndExecute(turn);
    if (isConfirmation(text) && !session.pendingFact) return this.answerStrayConfirmation(turn);

    if (session.pendingFact) {
      const [first, ...rest] = text.split(/(?<=[.!?])\s+/);
      if (isConfirmation(first) || NEGATIVE_ANSWER.test(first)) {
        answerPendingFact(turn, isConfirmation(first));
        delete session.awaiting;
        if (rest.length) await this.interpret(turn, rest.join(' '));
        if (session.state === 'COLLECTING' && !session.awaiting) await advance(turn);
        return;
      }
    }
    await this.interpret(turn, text);
  }

  private refuseStaleCard(turn: Turn, approvalId: string): void {
    trace(turn, 'GUARD', { blocked: 'stale approval card', approvalId });
    const approval = currentApproval(turn.session);
    if (approval?.status === 'CONSUMED' && approval.id === approvalId) return this.answerStrayConfirmation(turn);
    say(turn, 'That confirmation is out of date, so I did nothing. Please check the latest details.');
    remind(turn);
  }

  private answerStrayConfirmation(turn: Turn): void {
    const { completed, state } = turn.session;
    if (state === 'DONE' && completed) {
      trace(turn, 'GUARD', { blocked: 'repeated confirmation', booking: completed.bookingId });
      const done = { book: 'booked', cancel: 'cancelled', reschedule: 'moved' }[completed.action];
      const again = { book: 'book', cancel: 'cancel', reschedule: 'move' }[completed.action];
      say(turn, `That's already ${done} (${completed.bookingId}). I didn't ${again} it again.`);
      return;
    }
    trace(turn, 'GUARD', { blocked: 'confirmation with nothing pending' });
    say(turn, "There's nothing waiting for your confirmation.");
    remind(turn);
  }

  /** The single model call of a turn. The output is validated, then applied by code. */
  private async interpret(turn: Turn, text: string): Promise<void> {
    const { session, model, clock, limits } = turn;
    limits.chargeModel();
    const startedAt = clock.now();
    let raw: unknown;
    try {
      const output = await model.interpret({
        text,
        today: localDate(clock.now()),
        state: session.state,
        ...(session.awaiting ? { awaiting: session.awaiting } : {}),
        options: session.options.map(({ index, providerName }) => ({ index, providerName })),
      });
      raw = output.proposal;
      trace(turn, 'MODEL', { model: model.name, latencyMs: clock.now() - startedAt, usage: output.usage ?? null });
    } catch (error) {
      trace(turn, 'ERROR', { model: model.name, message: error instanceof Error ? error.message : String(error) });
      say(turn, "I couldn't process that just now, and nothing has changed. Please try again.");
      remind(turn);
      return;
    }
    const { proposal, rejected } = validateProposal(raw);
    trace(turn, 'MODEL', { proposal });
    if (rejected.length) trace(turn, 'GUARD', { rejectedFields: rejected });
    await this.apply(turn, proposal, text);
  }

  private async apply(turn: Turn, proposal: Proposal, text: string): Promise<void> {
    const { session } = turn;
    const { intent, selection, memory } = proposal;
    if (memory) await applyMemory(turn, memory, text);

    switch (intent) {
      case 'memory':
        return remind(turn);
      case 'bookings':
        return showBookings(turn);
      case 'reviews':
        return showReviews(turn, selection);
      case 'select':
        return this.select(turn, proposal);
      case 'decline':
        return this.decline(turn);
      case 'book':
      case 'cancel':
      case 'reschedule':
        if (isAtRest(session) || session.kind !== intent) {
          voidPending(turn, 'new request');
          startErrand(turn, intent);
        }
        return this.mergeAndContinue(turn, proposal);
      case 'provide':
        if (!isAtRest(session)) return this.mergeAndContinue(turn, proposal);
        say(turn, 'Tell me what you need booked, moved or cancelled.');
        return;
      default:
        if (!memory) say(turn, NOT_UNDERSTOOD);
        remind(turn);
    }
  }

  /** Answers fill the next gap. A change to something already settled is a correction. */
  private async mergeAndContinue(turn: Turn, { slots }: Proposal): Promise<void> {
    const { session } = turn;
    const changed = mergeSlots(session, slots);
    delete session.awaiting;
    if (session.state === 'COLLECTING') return advance(turn);
    if (changed.length) await applyCorrection(turn, changed);
    if (!turn.replyParts.length) remind(turn);
  }

  private async select(turn: Turn, { selection }: Proposal): Promise<void> {
    const { session } = turn;
    if (session.state === 'AWAITING_APPROVAL' && session.options.length) {
      voidPending(turn, 'chose another option');
      transition(turn, 'PRESENTING', 'chose another option');
    }
    if (session.state !== 'PRESENTING') {
      say(turn, "There's nothing to choose from right now.");
      return remind(turn);
    }
    const option = findOption(session, selection);
    if (!option) {
      say(turn, `I don't see that option. Pick a number from 1 to ${session.options.length}.`);
      return;
    }
    const slot = selection?.time ? option.slots.find((item) => item.endsWith(`T${selection.time}`)) : option.slots[0];
    if (!slot) {
      say(turn, `${option.providerName} isn't free at ${selection?.time}. Free times: ${option.slots.slice(0, 5).map(formatSlot).join(', ')}.`);
      return;
    }
    trace(turn, 'INPUT', { selected: option.providerId, slot });
    await (session.kind === 'book' ? selectForBooking(turn, option, slot) : selectForChange(turn, option, slot));
  }

  private decline(turn: Turn): void {
    const { session } = turn;
    if (isAtRest(session)) {
      say(turn, "Okay. There's nothing in progress.");
      return;
    }
    if (session.state === 'AWAITING_APPROVAL') {
      voidPending(turn, 'declined');
      delete session.held;
      if (session.options.length) return presentOptions(turn, 'No problem, nothing was done. Here are the options again:');
    }
    transition(turn, 'IDLE', 'user declined');
    say(turn, "Okay, I've dropped that. Nothing was done.");
  }

  private view(session: Session): SessionView {
    const { tracer, provider, store, clock, model } = this.options;
    return {
      id: session.id,
      state: session.state,
      runId: session.runId,
      slots: session.slots,
      messages: session.messages,
      trace: tracer.read(session.runId),
      limits: { ...this.limitConfig, ...session.usage },
      memory: new Memory(store, session.userId, clock).list(),
      bookings: provider.state.bookings,
      model: model.name,
    };
  }
}

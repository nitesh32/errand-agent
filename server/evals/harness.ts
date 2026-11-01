import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, SimulatedCrash } from '../src/agent/agent.ts';
import type { SessionView } from '../src/agent/agent.ts';
import { runIds } from '../src/agent/session.ts';
import type { Session } from '../src/agent/session.ts';
import { FakeClock } from '../src/infra/clock.ts';
import { FileStore } from '../src/infra/file-store.ts';
import { Tracer } from '../src/infra/tracer.ts';
import { Memory } from '../src/memory/memory.ts';
import { MockProvider } from '../src/mock/mock-provider.ts';
import type { MockConfig } from '../src/mock/mock-provider.ts';
import type { Model, ModelInput, ModelOutput } from '../src/model/model.ts';
import { RuleModel } from '../src/model/rule-model.ts';
import type { LimitConfig } from '../src/tools/limits.ts';

const START = '2026-11-02T03:30:00Z'; // Monday 09:00 IST
const FIRST_SESSION = 'eval';
export const RECOVERY_TOOL_CALLS = 2;

/**
 * A recorded model. It plays queued raw outputs first, including malicious ones, then
 * falls back to the deterministic rule model. No live LLM is ever involved.
 */
export class ScriptedModel implements Model {
  readonly name = 'scripted';
  readonly inputs: ModelInput[] = [];
  private readonly queued: unknown[] = [];
  private readonly rules = new RuleModel();

  /** The next model call returns this raw output, or throws it if it is an Error. */
  queue(output: unknown): void {
    this.queued.push(output);
  }

  async interpret(input: ModelInput): Promise<ModelOutput> {
    this.inputs.push(input);
    if (!this.queued.length) return this.rules.interpret(input);
    const next = this.queued.shift();
    if (next instanceof Error) throw next;
    return { proposal: next, usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.0001 } };
  }
}

export interface HarnessOptions {
  world?: Partial<MockConfig>;
  limits?: Partial<LimitConfig>;
}

/** One simulated user in one world. A restart rebuilds the agent from files on disk. */
export class Harness {
  readonly clock = new FakeClock(START);
  readonly store = new FileStore(mkdtempSync(join(tmpdir(), 'errand-eval-')));
  readonly tracer: Tracer;
  readonly provider: MockProvider;
  readonly model = new ScriptedModel();
  readonly replies: string[] = [];
  readonly limits?: Partial<LimitConfig>;
  readonly sessionIds = [FIRST_SESSION];
  agent: Agent;
  view: SessionView;

  constructor({ world, limits }: HarnessOptions = {}) {
    this.limits = limits;
    this.tracer = new Tracer(mkdtempSync(join(tmpdir(), 'errand-traces-')), this.clock);
    this.provider = new MockProvider(this.clock, world);
    this.agent = this.buildAgent();
    this.view = this.agent.createSession(FIRST_SESSION);
  }

  private buildAgent(): Agent {
    const { store, tracer, clock, provider, model, limits } = this;
    return new Agent({ store, tracer, clock, provider, model, limits, toolTimeoutMs: 1000 });
  }

  get sessionId(): string {
    return this.sessionIds.at(-1)!;
  }

  private record(view: SessionView): string {
    this.view = view;
    const reply = view.messages.at(-1)?.text ?? '';
    this.replies.push(reply);
    return reply;
  }

  /** Sends one message. Returns an empty string if the agent "died" handling it. */
  async say(text: string, approvalId?: string): Promise<string> {
    try {
      return this.record(await this.agent.handleMessage(this.sessionId, text, approvalId));
    } catch (error) {
      if (!(error instanceof SimulatedCrash)) throw error;
      return '';
    }
  }

  async sayAll(...texts: string[]): Promise<void> {
    for (const text of texts) await this.say(text);
  }

  /** A new agent over the same files and provider. Recovery waits for the next message. */
  rebuildAgent(): void {
    this.agent = this.buildAgent();
  }

  /** A process restart followed by the client reloading the session. */
  async restart(): Promise<string> {
    this.rebuildAgent();
    return this.record(await this.agent.getSession(this.sessionId));
  }

  /** The same user back in a new conversation, so only memory carries over. */
  newSession(): void {
    const id = `eval_${this.sessionIds.length + 1}`;
    this.sessionIds.push(id);
    this.view = this.agent.createSession(id);
  }

  session(id = this.sessionId): Session {
    return this.store.read<Session>('sessions', id)!;
  }

  memory(): Memory {
    return new Memory(this.store, 'u_demo', this.clock);
  }

  sessions(): Session[] {
    return this.sessionIds.map((id) => this.session(id));
  }

  approval() {
    const session = this.session();
    return session.approvals.find((item) => item.id === session.approvalId);
  }

  /** Bookings the agent created, excluding the seeded history. */
  newBookings() {
    return this.provider.state.bookings.filter((booking) => !booking.id.startsWith('bk_09'));
  }

  bookCalls() {
    return this.provider.state.effects.filter((effect) => effect.tool === 'book');
  }

  /** Every trace event across every run, in order per run. */
  fullTrace() {
    return this.sessions().flatMap((session) =>
      runIds(session).flatMap((run) => this.tracer.read(run)),
    );
  }
}

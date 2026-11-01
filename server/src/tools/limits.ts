import type { Clock } from '../infra/clock.ts';

export interface LimitConfig {
  maxModelCalls: number; // per run
  maxToolCalls: number; // per run
  maxTurnMs: number; // per user message
}

export const DEFAULT_LIMITS: LimitConfig = { maxModelCalls: 10, maxToolCalls: 20, maxTurnMs: 60_000 };

/** Saved with the session, so a restart cannot reset a run's budget. */
export interface Usage {
  modelCalls: number;
  toolCalls: number;
}

export type LimitKind = 'model calls' | 'tool calls' | 'time';

export class LimitExceeded extends Error {
  readonly kind: LimitKind;

  constructor(kind: LimitKind) {
    super(`Limit reached: ${kind}`);
    this.kind = kind;
  }
}

/** Hard caps for one user message. Throws rather than letting a turn continue over budget. */
export class Limits {
  private readonly config: LimitConfig;
  private readonly usage: Usage;
  private readonly clock: Clock;
  private readonly startedAt: number;
  private recoveryCalls = 0;

  constructor(config: LimitConfig, usage: Usage, clock: Clock) {
    this.config = config;
    this.usage = usage;
    this.clock = clock;
    this.startedAt = clock.now();
  }

  chargeModel(): void {
    this.checkTime();
    if (this.usage.modelCalls >= this.config.maxModelCalls) throw new LimitExceeded('model calls');
    this.usage.modelCalls++;
  }

  chargeTool(): void {
    this.checkTime();
    if (this.toolCallsLeft() <= 0) throw new LimitExceeded('tool calls');
    this.usage.toolCalls++;
  }

  /** A side effect only starts if there is budget left to verify it afterwards. */
  hasToolCalls(count: number): boolean {
    return this.toolCallsLeft() >= count;
  }

  /** A small fixed allowance per turn, so an in-flight booking can always be checked. */
  allowRecovery(calls: number): void {
    this.recoveryCalls = calls;
  }

  private toolCallsLeft(): number {
    return this.config.maxToolCalls + this.recoveryCalls - this.usage.toolCalls;
  }

  private checkTime(): void {
    if (this.clock.now() - this.startedAt >= this.config.maxTurnMs) throw new LimitExceeded('time');
  }
}

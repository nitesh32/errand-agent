import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TraceEvent, TraceType } from '../types.ts';
import type { Clock } from './clock.ts';

const SECRET_KEY = /(^|_)(api_?key|authorization|secret|password|token)$/i;
const SECRET_VALUE = /sk-[\w-]{8,}|Bearer\s+\S+/g;
const REDACTED = '[redacted]';

export function redact(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(SECRET_VALUE, REDACTED);
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? REDACTED : redact(item)]),
    );
  }
  return value;
}

/** One JSONL file per run, appended event by event so it survives a crash. */
export class Tracer {
  private readonly dir: string;
  private readonly clock: Clock;

  constructor(dir: string, clock: Clock) {
    this.dir = dir;
    this.clock = clock;
    mkdirSync(dir, { recursive: true });
  }

  log(runId: string, type: TraceType, fields: Record<string, unknown> = {}): void {
    const event = redact({ ts: new Date(this.clock.now()).toISOString(), runId, type, ...fields });
    appendFileSync(this.fileOf(runId), `${JSON.stringify(event)}\n`);
  }

  read(runId: string): TraceEvent[] {
    const file = this.fileOf(runId);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as TraceEvent);
  }

  fileOf(runId: string): string {
    return join(this.dir, `${runId}.jsonl`);
  }
}

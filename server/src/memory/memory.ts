import { createHash } from 'node:crypto';
import type { Clock } from '../infra/clock.ts';
import type { FileStore } from '../infra/file-store.ts';

export type FactSource = 'stated' | 'inferred';

export interface Fact {
  key: string; // area, earliest_time, or technician:<service>
  value: string;
  label: string; // what the user sees, such as a provider's name
  source: FactSource;
  confirmed: boolean; // an inferred fact the user has said yes to
  updatedAt: string;
  previous?: string;
}

/** A forgotten fact keeps only hashes, so the value itself is really gone. */
interface MemoryData {
  facts: Record<string, Fact>;
  forgotten: Record<string, string[]>;
}

const hash = (value: string) => createHash('sha256').update(value.toLowerCase()).digest('hex');

/** Preferences for one user, persisted across sessions. */
export class Memory {
  private readonly store: FileStore;
  private readonly userId: string;
  private readonly clock: Clock;

  constructor(store: FileStore, userId: string, clock: Clock) {
    this.store = store;
    this.userId = userId;
    this.clock = clock;
  }

  /** Everything saved, for the user to review. Includes unconfirmed facts, marked as such. */
  list(): { facts: Fact[]; forgottenKeys: string[] } {
    const { facts, forgotten } = this.load();
    return { facts: Object.values(facts), forgottenKeys: Object.keys(forgotten) };
  }

  /** A fact the agent may act on. Unconfirmed inferred facts are never returned. */
  get(key: string): Fact | undefined {
    const fact = this.load().facts[key];
    return fact && (fact.source === 'stated' || fact.confirmed) ? fact : undefined;
  }

  /** An inferred fact waiting for the user's yes or no. */
  pending(key: string): Fact | undefined {
    const fact = this.load().facts[key];
    return fact && fact.source === 'inferred' && !fact.confirmed ? fact : undefined;
  }

  isForgotten(key: string, value: string): boolean {
    return this.load().forgotten[key]?.includes(hash(value)) ?? false;
  }

  /** The user said it. Overrides anything, and lifts a tombstone on this value. */
  state(key: string, value: string, label = value): void {
    const data = this.load();
    const remaining = (data.forgotten[key] ?? []).filter((item) => item !== hash(value));
    if (remaining.length) data.forgotten[key] = remaining;
    else delete data.forgotten[key];
    data.facts[key] = this.fact(key, value, label, 'stated', true, data.facts[key]);
    this.save(data);
  }

  /** Records a guess, unless the user forgot this value or has already settled the key. */
  infer(key: string, value: string, label = value): void {
    const data = this.load();
    if (this.isForgotten(key, value) || this.get(key)) return;
    data.facts[key] = this.fact(key, value, label, 'inferred', false, data.facts[key]);
    this.save(data);
  }

  confirm(key: string): void {
    const data = this.load();
    const fact = data.facts[key];
    if (!fact) return;
    fact.confirmed = true;
    fact.updatedAt = this.timestamp();
    this.save(data);
  }

  /** Deletes the fact and blocks re-learning it. `values` adds others, such as past providers. */
  forget(key: string, values: string[] = []): void {
    const data = this.load();
    const fact = data.facts[key];
    const hashes = [...(fact ? [fact.value] : []), ...values].map(hash);
    data.forgotten[key] = [...new Set([...(data.forgotten[key] ?? []), ...hashes])];
    delete data.facts[key];
    this.save(data);
  }

  private fact(key: string, value: string, label: string, source: FactSource, confirmed: boolean, existing?: Fact): Fact {
    const previous = existing && existing.value !== value ? existing.label : existing?.previous;
    return { key, value, label, source, confirmed, updatedAt: this.timestamp(), ...(previous ? { previous } : {}) };
  }

  private timestamp(): string {
    return new Date(this.clock.now()).toISOString();
  }

  private load(): MemoryData {
    return this.store.read<MemoryData>('memory', this.userId) ?? { facts: {}, forgotten: {} };
  }

  private save(data: MemoryData): void {
    this.store.write('memory', this.userId, data);
  }
}

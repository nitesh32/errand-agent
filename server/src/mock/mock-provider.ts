import { addDays, localDate, localDateTime } from '../infra/clock.ts';
import type { Clock } from '../infra/clock.ts';
import type { Booking, BookingLookup, DateRange, Hold, Provider, ProviderDetails, ToolResult } from '../types.ts';
import { CATALOG, reviewsFor, seedBookings } from './catalog.ts';

export type BookOutcome = 'success' | 'slot_taken' | 'timeout_booked' | 'timeout_lost';

/** Everything a scenario can force. Unset values fall back to seeded behaviour. */
export interface MockConfig {
  seed: number;
  bookOutcomes: BookOutcome[]; // consumed first, then the 70/15/15 draw
  quoteDeltas: number[]; // consumed per hold, added to the search price
  unavailableSlots: string[]; // hold_slot returns slot_unavailable
  conflictSlots: string[]; // reschedule returns slot_conflict; '*' means every slot
  latencyMs: Record<string, number>; // per tool
  failingTools: string[]; // these tools throw an unknown error
}

/** A side effect the provider really received, for evals to audit. */
export interface EffectRecord {
  tool: 'book' | 'cancel' | 'reschedule';
  key: string;
  providerId: string;
  slot: string;
  price: number;
}

interface HoldRecord extends Hold {
  provider_id: string;
  slot: string;
}

type KeyRecord = { status: 'booked'; booking_id: string } | { status: 'failed'; error: string } | { status: 'done' };

export interface MockState {
  config: MockConfig;
  scenario: string;
  rng: number;
  nextId: number;
  bookings: Booking[];
  holds: Record<string, HoldRecord>;
  keys: Record<string, KeyRecord>;
  cancelAttempts: string[];
  takenSlots: string[];
  effects: EffectRecord[];
}

/** Named failures the demo can force with /scenario. Each replaces whatever was forced before. */
export const SCENARIOS: Record<string, Partial<MockConfig>> = {
  default: {},
  review_injection: {}, // the hostile reviews are always in the catalog
  timeout_but_booked: { bookOutcomes: ['timeout_booked'] },
  timeout_not_booked: { bookOutcomes: ['timeout_lost'] },
  slot_taken: { bookOutcomes: ['slot_taken'] },
  price_change: { quoteDeltas: [200] },
  slot_conflict: { conflictSlots: ['*'] },
};

const HOLD_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
const DEFAULT_LATENCY_MS = 20;
const SEARCH_WINDOW_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

function hash(text: string): number {
  let value = 2166136261;
  for (const char of text) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return value >>> 0;
}

/**
 * The mocked provider API. Deliberately naive: it does not stop a second booking of a
 * taken slot, so a duplicate caused by the agent shows up in the bookings list.
 * It serves one demo user, because the contract's hold and book calls carry no user id.
 */
export class MockProvider {
  readonly state: MockState;
  private readonly clock: Clock;
  private readonly onChange: (state: MockState) => void;

  constructor(
    clock: Clock,
    config: Partial<MockConfig> = {},
    savedState?: MockState,
    onChange: (state: MockState) => void = () => {},
  ) {
    this.clock = clock;
    this.onChange = onChange;
    const fullConfig: MockConfig = {
      seed: 7,
      bookOutcomes: [],
      quoteDeltas: [],
      unavailableSlots: [],
      conflictSlots: [],
      latencyMs: {},
      failingTools: [],
      ...config,
    };
    this.state = savedState ?? {
      config: fullConfig,
      scenario: 'default',
      rng: fullConfig.seed,
      nextId: 1000,
      bookings: seedBookings(localDate(clock.now())),
      holds: {},
      keys: {},
      cancelAttempts: [],
      takenSlots: [],
      effects: [],
    };
  }

  /** Changes forced behaviour on a running world. */
  configure(changes: Partial<MockConfig>): void {
    Object.assign(this.state.config, changes);
    this.onChange(this.state);
  }

  /** Clears anything previously forced, then applies one named scenario. */
  applyScenario(name: string): void {
    this.state.scenario = name;
    this.configure({ bookOutcomes: [], quoteDeltas: [], conflictSlots: [], ...structuredClone(SCENARIOS[name]) });
  }

  async search_providers(service: string, _area: string, date_range: DateRange): Promise<Provider[]> {
    await this.enter('search_providers');
    return CATALOG.filter((entry) => entry.service === service).map(({ injection: _, ...entry }) => ({
      ...entry,
      free_slots: this.freeSlots(entry.id, date_range),
    }));
  }

  async get_provider(provider_id: string): Promise<ToolResult<{ provider: ProviderDetails }>> {
    await this.enter('get_provider');
    const entry = CATALOG.find((item) => item.id === provider_id);
    if (!entry) return { ok: false, error: 'provider_not_found' };
    const { injection: _, ...details } = entry;
    return { ok: true, provider: { ...details, reviews: reviewsFor(entry) } };
  }

  async list_bookings(_user_id: string): Promise<Booking[]> {
    await this.enter('list_bookings');
    return structuredClone(this.state.bookings);
  }

  async hold_slot(provider_id: string, slot: string): Promise<ToolResult<Hold>> {
    await this.enter('hold_slot');
    const entry = CATALOG.find((item) => item.id === provider_id);
    if (!entry || !this.isFree(provider_id, slot)) return { ok: false, error: 'slot_unavailable' };
    const hold: HoldRecord = {
      hold_id: `hold_${this.state.nextId++}`,
      expires_at: new Date(this.clock.now() + HOLD_MS).toISOString(),
      quoted_price: entry.price + (this.state.config.quoteDeltas.shift() ?? 0),
      provider_id,
      slot,
    };
    this.state.holds[hold.hold_id] = hold;
    this.onChange(this.state);
    const { hold_id, expires_at, quoted_price } = hold;
    return { ok: true, hold_id, expires_at, quoted_price };
  }

  async book(hold_id: string, idempotency_key: string): Promise<ToolResult<{ booking_id: string }>> {
    await this.enter('book');
    const known = this.state.keys[idempotency_key];
    if (known?.status === 'booked') return { ok: true, booking_id: known.booking_id };
    if (known?.status === 'failed') return { ok: false, error: known.error };

    const hold = this.state.holds[hold_id];
    if (!hold || this.clock.now() > Date.parse(hold.expires_at)) {
      return this.failKey(idempotency_key, 'hold_expired');
    }

    this.state.effects.push({
      tool: 'book',
      key: idempotency_key,
      providerId: hold.provider_id,
      slot: hold.slot,
      price: hold.quoted_price,
    });
    const outcome = this.state.config.bookOutcomes.shift() ?? this.drawOutcome();

    if (outcome === 'slot_taken') {
      this.state.takenSlots.push(`${hold.provider_id}|${hold.slot}`);
      return this.failKey(idempotency_key, 'slot_taken');
    }
    if (outcome === 'timeout_lost') {
      this.onChange(this.state);
      await this.clock.sleep(TIMEOUT_MS);
      return { ok: false, error: 'timeout' };
    }

    const booking_id = this.createBooking(hold, idempotency_key);
    if (outcome === 'timeout_booked') {
      await this.clock.sleep(TIMEOUT_MS);
      return { ok: false, error: 'timeout' };
    }
    return { ok: true, booking_id };
  }

  async get_booking_status(idempotency_key: string): Promise<BookingLookup> {
    await this.enter('get_booking_status');
    const known = this.state.keys[idempotency_key];
    if (known?.status === 'booked') return { status: 'booked', booking_id: known.booking_id };
    return known?.status === 'failed' ? { status: 'failed' } : { status: 'not_found' };
  }

  async cancel(booking_id: string, idempotency_key: string): Promise<ToolResult<{ status: 'cancelled' }>> {
    await this.enter('cancel');
    const booking = this.state.bookings.find((item) => item.id === booking_id);
    if (!booking) return { ok: false, error: 'booking_not_found' };
    if (!this.state.cancelAttempts.includes(booking_id)) {
      this.state.cancelAttempts.push(booking_id);
      this.onChange(this.state);
      return { ok: false, error: '503' };
    }
    if (!this.state.keys[idempotency_key]) {
      this.state.effects.push({
        tool: 'cancel',
        key: idempotency_key,
        providerId: booking.provider.id,
        slot: booking.slot,
        price: booking.price,
      });
      booking.status = 'cancelled';
      this.state.keys[idempotency_key] = { status: 'done' };
      this.onChange(this.state);
    }
    return { ok: true, status: 'cancelled' };
  }

  async reschedule(
    booking_id: string,
    new_slot: string,
    idempotency_key: string,
  ): Promise<ToolResult<{ booking: Booking }>> {
    await this.enter('reschedule');
    const booking = this.state.bookings.find((item) => item.id === booking_id);
    if (!booking) return { ok: false, error: 'booking_not_found' };
    if (!this.state.keys[idempotency_key]) {
      const { conflictSlots } = this.state.config;
      if (conflictSlots.includes(new_slot) || conflictSlots.includes('*')) return { ok: false, error: 'slot_conflict' };
      this.state.effects.push({
        tool: 'reschedule',
        key: idempotency_key,
        providerId: booking.provider.id,
        slot: new_slot,
        price: booking.price,
      });
      booking.slot = new_slot;
      this.state.keys[idempotency_key] = { status: 'done' };
      this.onChange(this.state);
    }
    return { ok: true, booking: structuredClone(booking) };
  }

  private async enter(tool: string): Promise<void> {
    await this.clock.sleep(this.state.config.latencyMs[tool] ?? DEFAULT_LATENCY_MS);
    if (this.state.config.failingTools.includes(tool)) throw new Error(`${tool} exploded`);
  }

  private failKey(key: string, error: string): ToolResult<never> {
    this.state.keys[key] = { status: 'failed', error };
    this.onChange(this.state);
    return { ok: false, error };
  }

  private createBooking(hold: HoldRecord, key: string): string {
    const entry = CATALOG.find((item) => item.id === hold.provider_id)!;
    const booking_id = `bk_${this.state.nextId++}`;
    this.state.bookings.push({
      id: booking_id,
      provider: { id: entry.id, name: entry.name },
      service: entry.service,
      slot: hold.slot,
      status: 'upcoming',
      price: hold.quoted_price,
      area: 'Powai',
    });
    this.state.keys[key] = { status: 'booked', booking_id };
    this.onChange(this.state);
    return booking_id;
  }

  /** mulberry32. The state lives in `state.rng`, so a restart continues the same sequence. */
  private nextRandom(): number {
    this.state.rng = (this.state.rng + 0x6d2b79f5) | 0;
    let t = this.state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private drawOutcome(): BookOutcome {
    const roll = this.nextRandom();
    if (roll < 0.7) return 'success';
    if (roll < 0.85) return 'slot_taken';
    return roll < 0.925 ? 'timeout_booked' : 'timeout_lost';
  }

  private freeSlots(providerId: string, { from, to }: DateRange): string[] {
    const slots: string[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      for (const hour of SEARCH_WINDOW_HOURS) {
        const slot = `${date}T${String(hour).padStart(2, '0')}:00`;
        if (this.isFree(providerId, slot)) slots.push(slot);
      }
    }
    return slots;
  }

  private isFree(providerId: string, slot: string): boolean {
    const { seed, unavailableSlots } = this.state.config;
    if (slot <= localDateTime(this.clock.now()) || unavailableSlots.includes(slot)) return false;
    if (this.state.takenSlots.includes(`${providerId}|${slot}`)) return false;
    const booked = this.state.bookings.some(
      (item) => item.provider.id === providerId && item.slot === slot && item.status === 'upcoming',
    );
    return !booked && hash(`${seed}|${providerId}|${slot}`) % 2 === 0;
  }
}

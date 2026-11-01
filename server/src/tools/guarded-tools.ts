import { assertApproved, ApprovalError } from '../agent/approval.ts';
import type { Approval, ApprovalTerms } from '../agent/approval.ts';
import type { Clock } from '../infra/clock.ts';
import type { Tracer } from '../infra/tracer.ts';
import type { MockProvider } from '../mock/mock-provider.ts';
import type { Booking, DateRange, Hold, ToolResult } from '../types.ts';
import type { Limits } from './limits.ts';
import { sanitizeReviews } from './sanitize.ts';
import type { SafeReview } from './sanitize.ts';

export type ProviderApi = Pick<
  MockProvider,
  'search_providers' | 'get_provider' | 'list_bookings' | 'hold_slot' | 'book' | 'get_booking_status' | 'cancel' | 'reschedule'
>;

export interface GuardedToolsOptions {
  provider: ProviderApi;
  tracer: Tracer;
  limits: Limits;
  clock: Clock;
  runId: string;
  userId: string;
  toolTimeoutMs: number; // real time, so a hung tool cannot outlast the wall-clock cap
}

/** A read failed, or a call hung. Side effects report this as a result instead, then verify. */
export class ToolFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Tool failed: ${code}`);
    this.code = code;
  }
}

/** What a hold commits to. Passed to `book` so the approval check sees the real terms. */
export interface HeldSlot extends Hold {
  providerId: string;
  slot: string;
}

/**
 * The only path to the provider. Every call is charged against the limits and traced.
 * Side-effect tools cannot run without an approval that matches their exact terms.
 */
export class GuardedTools {
  private readonly options: GuardedToolsOptions;

  constructor(options: GuardedToolsOptions) {
    this.options = options;
  }

  search_providers(service: string, area: string, date_range: DateRange) {
    return this.call('search_providers', { service, area, date_range }, (api) => api.search_providers(service, area, date_range));
  }

  /** Reviews are sanitised here, so no caller can see them raw. */
  async get_provider(provider_id: string) {
    const result = await this.call('get_provider', { provider_id }, (api) => api.get_provider(provider_id));
    if (!result.ok) return result;
    return { ...result, provider: { ...result.provider, reviews: sanitizeReviews(result.provider.reviews) } };
  }

  list_bookings() {
    const { userId } = this.options;
    return this.call('list_bookings', { user_id: userId }, (api) => api.list_bookings(userId));
  }

  hold_slot(provider_id: string, slot: string) {
    return this.call('hold_slot', { provider_id, slot }, (api) => api.hold_slot(provider_id, slot));
  }

  get_booking_status(idempotency_key: string) {
    return this.call('get_booking_status', { idempotency_key }, (api) => api.get_booking_status(idempotency_key));
  }

  book(approval: Approval | undefined, held: HeldSlot, idempotency_key: string) {
    return this.effect(approval, { action: 'book', providerId: held.providerId, slot: held.slot, price: held.quoted_price }, () =>
      this.call('book', { hold_id: held.hold_id, idempotency_key }, (api) => api.book(held.hold_id, idempotency_key)),
    );
  }

  cancel(approval: Approval | undefined, booking: Booking, idempotency_key: string) {
    const terms: ApprovalTerms = {
      action: 'cancel',
      providerId: booking.provider.id,
      slot: booking.slot,
      price: booking.price,
      bookingId: booking.id,
    };
    return this.effect(approval, terms, () =>
      this.call('cancel', { booking_id: booking.id, idempotency_key }, (api) => api.cancel(booking.id, idempotency_key)),
    );
  }

  reschedule(approval: Approval | undefined, booking: Booking, new_slot: string, idempotency_key: string) {
    const terms: ApprovalTerms = {
      action: 'reschedule',
      providerId: booking.provider.id,
      slot: new_slot,
      price: booking.price,
      bookingId: booking.id,
    };
    return this.effect(approval, terms, () =>
      this.call('reschedule', { booking_id: booking.id, new_slot, idempotency_key }, (api) =>
        api.reschedule(booking.id, new_slot, idempotency_key),
      ),
    );
  }

  /** Checks approval first. A failed or hung call becomes a result, so the caller verifies it. */
  private async effect<T>(approval: Approval | undefined, terms: ApprovalTerms, run: () => Promise<ToolResult<T>>): Promise<ToolResult<T>> {
    const { tracer, runId } = this.options;
    try {
      assertApproved(approval, terms);
    } catch (error) {
      if (error instanceof ApprovalError) tracer.log(runId, 'GUARD', { blocked: terms.action, reason: error.message });
      throw error;
    }
    try {
      return await run();
    } catch (error) {
      if (error instanceof ToolFailure) return { ok: false, error: error.code };
      throw error;
    }
  }

  private async call<T>(tool: string, args: Record<string, unknown>, run: (api: ProviderApi) => Promise<T>): Promise<T> {
    const { provider, tracer, limits, clock, runId, toolTimeoutMs } = this.options;
    limits.chargeTool();
    const startedAt = clock.now();
    const log = (result: unknown) => tracer.log(runId, 'TOOL', { tool, args, result, latencyMs: clock.now() - startedAt });

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ToolFailure('timeout')), toolTimeoutMs);
    });
    try {
      const result = await Promise.race([run(provider), timeout]);
      log(summarize(result));
      return result;
    } catch (error) {
      const failure = error instanceof ToolFailure ? error : new ToolFailure('unknown');
      log({ ok: false, error: failure.code });
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The sanitised form written to traces: no review text, and large lists reduced to counts. */
function summarize(result: unknown): unknown {
  if (Array.isArray(result)) return { count: result.length };
  const provider = (result as { provider?: { id: string; reviews: SafeReview[] } }).provider;
  if (!provider) return result;
  const reviews = sanitizeReviews(provider.reviews);
  return {
    ok: true,
    provider: provider.id,
    reviews: reviews.length,
    flagged: reviews.filter((review) => review.flagged).map((review) => review.id),
  };
}

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeClock } from '../src/infra/clock.ts';
import { CATALOG } from '../src/mock/catalog.ts';
import { MockProvider } from '../src/mock/mock-provider.ts';
import type { MockConfig } from '../src/mock/mock-provider.ts';
import type { Hold } from '../src/types.ts';

const START = '2026-11-02T03:30:00Z'; // Monday 09:00 IST
const WEEK = { from: '2026-11-02', to: '2026-11-08' };

function setup(config: Partial<MockConfig> = {}) {
  const clock = new FakeClock(START);
  return { clock, provider: new MockProvider(clock, config) };
}

async function freeSlot(provider: MockProvider): Promise<string> {
  const [first] = await provider.search_providers('plumber', 'Powai', WEEK);
  return first.free_slots[0];
}

async function hold(provider: MockProvider, slot: string): Promise<Hold> {
  const result = await provider.hold_slot('prv_ramesh', slot);
  assert.ok(result.ok);
  return result;
}

test('every service returns 3 to 8 providers with the contract fields', async () => {
  const { provider } = setup();
  for (const service of new Set(CATALOG.map((entry) => entry.service))) {
    const results = await provider.search_providers(service, 'Powai', WEEK);
    assert.ok(results.length >= 3 && results.length <= 8, service);
    for (const item of results) {
      assert.ok(item.id && item.price && item.rating && item.attributes);
      assert.ok(item.free_slots.length > 0, `${item.id} has free slots`);
      assert.equal('injection' in item, false);
    }
  }
});

test('search is reproducible for a seed and differs across seeds', async () => {
  const slots = async (seed: number) => (await setup({ seed }).provider.search_providers('plumber', 'x', WEEK))[0].free_slots;
  assert.deepEqual(await slots(7), await slots(7));
  assert.notDeepEqual(await slots(7), await slots(8));
});

test('every service has at least one review carrying an injection', async () => {
  const { provider } = setup();
  for (const service of new Set(CATALOG.map((entry) => entry.service))) {
    const entries = CATALOG.filter((entry) => entry.service === service);
    const details = await Promise.all(entries.map((entry) => provider.get_provider(entry.id)));
    const texts = details.flatMap((item) => (item.ok ? item.provider.reviews.map((review) => review.text) : []));
    assert.ok(texts.some((text) => /ignore previous|SYSTEM:|disregard/i.test(text)), service);
  }
});

test('hold returns a 10 minute expiry, a configurable quote and slot_unavailable', async () => {
  const { provider, clock } = setup({ quoteDeltas: [200] });
  const slot = await freeSlot(provider);
  const result = await hold(provider, slot);
  assert.equal(result.quoted_price, 1400);
  assert.equal(Date.parse(result.expires_at) - clock.now(), 10 * 60 * 1000);
  assert.equal((await hold(provider, slot)).quoted_price, 1200);

  provider.configure({ unavailableSlots: [slot] });
  assert.deepEqual(await provider.hold_slot('prv_ramesh', slot), { ok: false, error: 'slot_unavailable' });
});

test('booking twice with one key creates one booking', async () => {
  const { provider } = setup({ bookOutcomes: ['success'] });
  const { hold_id } = await hold(provider, await freeSlot(provider));
  const first = await provider.book(hold_id, 'key');
  const second = await provider.book(hold_id, 'key');
  assert.deepEqual(first, second);
  assert.equal(provider.state.bookings.filter((item) => item.status === 'upcoming').length, 3);
  assert.equal(provider.state.effects.length, 1);
});

test('timeout_booked reports a timeout but status shows booked, and retry returns it', async () => {
  const { provider, clock } = setup({ bookOutcomes: ['timeout_booked'] });
  const { hold_id } = await hold(provider, await freeSlot(provider));
  const before = clock.now();
  assert.deepEqual(await provider.book(hold_id, 'key'), { ok: false, error: 'timeout' });
  assert.ok(clock.now() - before >= 5000);

  const status = await provider.get_booking_status('key');
  assert.equal(status.status, 'booked');
  const retry = await provider.book(hold_id, 'key');
  assert.ok(retry.ok && status.status === 'booked' && retry.booking_id === status.booking_id);
});

test('timeout_lost reports a timeout and status shows not_found', async () => {
  const { provider } = setup({ bookOutcomes: ['timeout_lost'] });
  const { hold_id } = await hold(provider, await freeSlot(provider));
  assert.deepEqual(await provider.book(hold_id, 'key'), { ok: false, error: 'timeout' });
  assert.deepEqual(await provider.get_booking_status('key'), { status: 'not_found' });
});

test('slot_taken fails the key and removes the slot', async () => {
  const { provider } = setup({ bookOutcomes: ['slot_taken'] });
  const slot = await freeSlot(provider);
  const { hold_id } = await hold(provider, slot);
  assert.deepEqual(await provider.book(hold_id, 'key'), { ok: false, error: 'slot_taken' });
  assert.deepEqual(await provider.get_booking_status('key'), { status: 'failed' });
  assert.notEqual(await freeSlot(provider), slot);
});

test('an expired hold fails with hold_expired', async () => {
  const { provider, clock } = setup();
  const { hold_id } = await hold(provider, await freeSlot(provider));
  clock.advance(10 * 60 * 1000 + 1);
  assert.deepEqual(await provider.book(hold_id, 'key'), { ok: false, error: 'hold_expired' });
  assert.equal(provider.state.effects.length, 0);
});

test('seeded outcomes follow the 70/15/15 split', async () => {
  const { provider } = setup();
  const counts: Record<string, number> = { booked: 0, slot_taken: 0, timeout: 0 };
  const slot = await freeSlot(provider);
  const total = 2000;
  for (let i = 0; i < total; i++) {
    provider.state.takenSlots = [];
    provider.state.bookings = [];
    const { hold_id } = await hold(provider, slot);
    const result = await provider.book(hold_id, `key_${i}`);
    counts[result.ok ? 'booked' : result.error]++;
  }
  assert.ok(Math.abs(counts.booked / total - 0.7) < 0.03, `booked ${counts.booked}`);
  assert.ok(Math.abs(counts.slot_taken / total - 0.15) < 0.03, `taken ${counts.slot_taken}`);
  assert.ok(Math.abs(counts.timeout / total - 0.15) < 0.03, `timeout ${counts.timeout}`);
});

test('cancel fails with 503 once, then succeeds, and repeats are idempotent', async () => {
  const { provider } = setup();
  assert.deepEqual(await provider.cancel('bk_0904', 'key'), { ok: false, error: '503' });
  assert.deepEqual(await provider.cancel('bk_0904', 'key'), { ok: true, status: 'cancelled' });
  assert.deepEqual(await provider.cancel('bk_0904', 'key'), { ok: true, status: 'cancelled' });
  assert.equal(provider.state.effects.length, 1);
  assert.equal(provider.state.bookings.find((item) => item.id === 'bk_0904')?.status, 'cancelled');
});

test('reschedule moves the booking, honours conflict slots and replays by key', async () => {
  const { provider } = setup({ conflictSlots: ['2026-11-07T10:00'] });
  assert.deepEqual(await provider.reschedule('bk_0904', '2026-11-07T10:00', 'a'), { ok: false, error: 'slot_conflict' });

  const moved = await provider.reschedule('bk_0904', '2026-11-07T11:00', 'b');
  assert.ok(moved.ok && moved.booking.slot === '2026-11-07T11:00');
  await provider.reschedule('bk_0904', '2026-11-07T15:00', 'b');
  assert.equal(provider.state.bookings.find((item) => item.id === 'bk_0904')?.slot, '2026-11-07T11:00');
  assert.equal(provider.state.effects.length, 1);
});

test('list_bookings holds past and upcoming history, and changes do not leak through it', async () => {
  const { provider } = setup();
  const bookings = await provider.list_bookings('u_demo');
  assert.deepEqual(new Set(bookings.map((item) => item.status)), new Set(['completed', 'upcoming']));
  bookings[0].status = 'cancelled';
  assert.notEqual(provider.state.bookings[0].status, 'cancelled');
});

test('a saved state restores into a new instance', async () => {
  let saved;
  const clock = new FakeClock(START);
  const provider = new MockProvider(clock, { bookOutcomes: ['success'] }, undefined, (state) => { saved = structuredClone(state); });
  const { hold_id } = await hold(provider, await freeSlot(provider));
  await provider.book(hold_id, 'key');

  const restored = new MockProvider(clock, {}, saved);
  assert.equal((await restored.get_booking_status('key')).status, 'booked');
});

test('a configured tool failure throws', async () => {
  const { provider } = setup({ failingTools: ['list_bookings'] });
  await assert.rejects(provider.list_bookings('u_demo'), /exploded/);
});

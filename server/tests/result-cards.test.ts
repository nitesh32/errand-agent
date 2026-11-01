import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Agent } from '../src/agent/agent.ts';
import { FakeClock } from '../src/infra/clock.ts';
import { FileStore } from '../src/infra/file-store.ts';
import { Tracer } from '../src/infra/tracer.ts';
import { MockProvider } from '../src/mock/mock-provider.ts';
import type { MockConfig } from '../src/mock/mock-provider.ts';
import { RuleModel } from '../src/model/rule-model.ts';

function setup(config: Partial<MockConfig> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'errand-agent-'));
  const clock = new FakeClock('2026-11-02T03:30:00Z');
  const provider = new MockProvider(clock, config);
  const agent = new Agent({ store: new FileStore(dir), tracer: new Tracer(join(dir, 'traces'), clock), clock, provider, model: new RuleModel() });
  agent.createSession('s1');
  return { agent, provider };
}

const allCards = (view: Awaited<ReturnType<Agent['handleMessage']>>) => view.messages.flatMap((message) => message.cards);
const confirmations = (view: Awaited<ReturnType<Agent['handleMessage']>>) => allCards(view).flatMap((card) => (card.type === 'confirmation' ? [card] : []));

async function book(agent: Agent) {
  await agent.handleMessage('s1', 'Find a plumber in Powai this week under 2000');
  await agent.handleMessage('s1', '1');
  return agent.handleMessage('s1', 'yes');
}

test('a verified booking carries a confirmation card with its details', async () => {
  const { agent, provider } = setup({ bookOutcomes: ['success'] });
  const view = await book(agent);
  const [card] = confirmations(view);
  const booking = provider.state.bookings.at(-1)!;
  assert.equal(view.state, 'DONE');
  assert.equal(card.action, 'book');
  assert.equal(card.bookingId, booking.id);
  assert.equal(card.slot, booking.slot);
  assert.equal(card.price, booking.price);
});

test('a timeout that really booked still ends with a confirmation card', async () => {
  const { agent, provider } = setup({ bookOutcomes: ['timeout_booked'] });
  const view = await book(agent);
  assert.equal(confirmations(view)[0].bookingId, provider.state.bookings.at(-1)!.id);
});

test('a booking that failed carries no confirmation card', async () => {
  const { agent } = setup({ bookOutcomes: ['slot_taken'] });
  assert.deepEqual(confirmations(await book(agent)), []);
});

test('a timeout that never booked carries no confirmation card', async () => {
  const { agent } = setup({ bookOutcomes: ['timeout_lost', 'timeout_lost', 'timeout_lost'] });
  assert.deepEqual(confirmations(await book(agent)), []);
});

test('moving a booking records the old and new times', async () => {
  const { agent, provider } = setup();
  const oldSlot = provider.state.bookings.find((booking) => booking.service === 'ac_service' && booking.status === 'upcoming')!.slot;
  await agent.handleMessage('s1', 'Move my AC servicing to Saturday');
  await agent.handleMessage('s1', '1');
  const [card] = confirmations(await agent.handleMessage('s1', 'yes'));
  assert.equal(card.action, 'reschedule');
  assert.equal(card.previousSlot, oldSlot);
  assert.notEqual(card.slot, oldSlot);
});

test('cancelling records the cancelled booking', async () => {
  const { agent } = setup();
  await agent.handleMessage('s1', 'Cancel my AC servicing');
  const [card] = confirmations(await agent.handleMessage('s1', 'yes'));
  assert.equal(card.action, 'cancel');
  assert.equal(card.bookingId, 'bk_0904');
});

test('/memory shows a memory card', async () => {
  const { agent } = setup();
  assert.ok(allCards(await agent.handleMessage('s1', '/memory')).some((card) => card.type === 'memory'));
});

test('/memory does not list a key as simply forgotten when it has a newer value', async () => {
  const { agent } = setup();
  await agent.handleMessage('s1', '/memory set area Powai');
  await agent.handleMessage('s1', '/memory forget area');
  assert.match((await agent.handleMessage('s1', '/memory')).messages.at(-1)!.text, /Forgotten: area\./);

  await agent.handleMessage('s1', '/memory set area Haryana');
  const { text } = (await agent.handleMessage('s1', '/memory')).messages.at(-1)!;
  assert.match(text, /area: Haryana/);
  assert.doesNotMatch(text, /Forgotten: area\./);
  assert.match(text, /An earlier area was forgotten and won't be reused\./);
});

test('the card carries what the receipt shows', async () => {
  const { agent, provider } = setup({ bookOutcomes: ['success'] });
  const [card] = confirmations(await book(agent));
  const booking = provider.state.bookings.at(-1)!;
  assert.equal(card.service, booking.service);
  assert.equal(card.area, booking.area);
  assert.equal(card.note, undefined);
  assert.equal(card.retried, false);
});

test('only a timeout that really booked explains itself', async () => {
  const { agent } = setup({ bookOutcomes: ['timeout_booked'] });
  assert.match(confirmations(await book(agent))[0].note ?? '', /timed out/);
});

test('a cancel that hit a 503 says it retried, and a move reports the price', async () => {
  const cancelling = setup();
  await cancelling.agent.handleMessage('s1', 'Cancel my AC servicing');
  assert.equal(confirmations(await cancelling.agent.handleMessage('s1', 'yes'))[0].retried, true);

  const moving = setup();
  await moving.agent.handleMessage('s1', 'Move my AC servicing to Saturday');
  await moving.agent.handleMessage('s1', '1');
  const [card] = confirmations(await moving.agent.handleMessage('s1', 'yes'));
  assert.equal(card.samePrice, true);
  assert.equal(card.retried, false);
});

// What the card's buttons send. They are ordinary messages, so approval still applies.
for (const [service, name, request] of [
  ['plumber', 'plumber', 'Find a plumber in Powai this week under 2000'],
  ['electrician', 'electrician', 'Find an electrician in Powai this week under 3000'],
  ['ac_service', 'ac servicing', null],
  ['cleaning', 'cleaning', null],
] as const) {
  test(`the card's buttons work for ${service}`, async () => {
    const { agent, provider } = setup({ bookOutcomes: ['success'] });
    if (request) {
      await agent.handleMessage('s1', request);
      await agent.handleMessage('s1', '1');
      await agent.handleMessage('s1', 'yes');
    }
    const cancel = await agent.handleMessage('s1', `Cancel my ${name}`);
    assert.equal(cancel.state, 'AWAITING_APPROVAL');
    const approval = cancel.messages.at(-1)!.cards.find((card) => card.type === 'approval');
    assert.equal(approval?.type === 'approval' && approval.action, 'cancel');
    assert.equal(provider.state.bookings.filter((booking) => booking.service === service && booking.status === 'cancelled').length, 0, 'nothing happens without a yes');

    await agent.handleMessage('s1', 'no');
    const move = await agent.handleMessage('s1', `Move my ${name}`);
    assert.equal(move.state, 'COLLECTING');
    assert.equal(move.awaiting, 'dateRange');
  });
}

async function withInferredFacts() {
  const context = setup({ bookOutcomes: ['success', 'success'] });
  await book(context.agent);
  return context;
}

const factOf = (view: Awaited<ReturnType<Agent['handleMessage']>>, key: string) => view.memory.facts.find((fact) => fact.key === key);

test('/memory confirm makes an inferred fact usable', async () => {
  const { agent } = await withInferredFacts();
  assert.equal(factOf(await agent.getSession('s1'), 'area')?.confirmed, false);
  const view = await agent.handleMessage('s1', '/memory confirm area');
  assert.equal(factOf(view, 'area')?.confirmed, true);
  assert.equal(factOf(view, 'area')?.source, 'inferred');
});

test('/memory confirm can never approve a waiting booking', async () => {
  const { agent, provider } = await withInferredFacts();
  await agent.handleMessage('s1', 'Find an electrician in Powai this week under 3000');
  const waiting = await agent.handleMessage('s1', '1');
  assert.equal(waiting.state, 'AWAITING_APPROVAL');
  const before = provider.state.bookings.length;

  const view = await agent.handleMessage('s1', '/memory confirm area');
  assert.equal(view.state, 'AWAITING_APPROVAL');
  assert.equal(view.approvals.at(-1)?.status, 'PENDING');
  assert.equal(provider.state.bookings.length, before);
});

test('/memory confirm leaves stated and unknown facts alone, and still replies', async () => {
  const { agent } = setup();
  await agent.handleMessage('s1', '/memory set area Powai');
  const stated = await agent.handleMessage('s1', '/memory confirm area');
  assert.equal(factOf(stated, 'area')?.source, 'stated');
  const before = stated.messages.length;
  const unknown = await agent.handleMessage('s1', '/memory confirm technician:plumber');
  assert.equal(factOf(unknown, 'technician:plumber'), undefined);
  assert.ok(unknown.messages.length > before);
  assert.notEqual(unknown.messages.at(-1)!.text, '');
});

test('confirming the fact a session is asking about does not ask again', async () => {
  const { agent } = await withInferredFacts();
  const asking = await agent.handleMessage('s1', 'Find a cleaner this week under 3000');
  assert.equal(asking.awaiting, 'fact');
  const view = await agent.handleMessage('s1', '/memory confirm area');
  assert.equal(view.awaiting, null);
  assert.equal(view.state, 'PRESENTING');
  assert.equal(factOf(view, 'area')?.confirmed, true);
});

test('saying no to a guess forgets it for good', async () => {
  const { agent } = await withInferredFacts();
  const view = await agent.handleMessage('s1', '/memory forget technician:plumber');
  assert.equal(factOf(view, 'technician:plumber'), undefined);
  assert.ok(view.memory.forgottenKeys.includes('technician:plumber'));
  await agent.handleMessage('s1', 'Find a plumber in Powai this week under 2000');
  await agent.handleMessage('s1', '1');
  assert.equal(factOf(await agent.handleMessage('s1', 'yes'), 'technician:plumber'), undefined);
});

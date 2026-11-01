import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelInput, Proposal } from '../src/model/model.ts';
import { validateProposal } from '../src/model/model.ts';
import { RuleModel } from '../src/model/rule-model.ts';

const TODAY = '2026-11-02'; // a Monday

async function parse(text: string, overrides: Partial<ModelInput> = {}): Promise<Proposal> {
  const { proposal } = await new RuleModel().interpret({ text, today: TODAY, state: 'IDLE', options: [], ...overrides });
  return proposal as Proposal;
}

const OPTIONS = [
  { index: 1, providerName: 'Ramesh Plumbing' },
  { index: 2, providerName: 'AquaFix Services' },
];

test('reads the first example request', async () => {
  const { intent, slots } = await parse('Find a plumber for my kitchen tap this week, mornings only, under ₹1,500.');
  assert.equal(intent, 'book');
  assert.deepEqual(slots, { dateFrom: TODAY, dateTo: '2026-11-08', latest: '12:00', service: 'plumber', budget: 1500, notes: 'kitchen tap' });
});

test('reads the second example request', async () => {
  const { intent, slots } = await parse('Move my AC servicing to Saturday.');
  assert.equal(intent, 'reschedule');
  assert.equal(slots.service, 'ac_service');
  assert.equal(slots.dateFrom, '2026-11-07');
});

test('reads the third example request', async () => {
  const { intent, slots } = await parse('Book the same electrician as last time, but not before 10 a.m.');
  assert.equal(intent, 'book');
  assert.equal(slots.service, 'electrician');
  assert.equal(slots.earliest, '10:00');
  assert.equal(slots.sameAsLast, true);
});

test('reads dates', async () => {
  const from = async (text: string) => (await parse(text)).slots.dateFrom;
  assert.equal(await from('tomorrow'), '2026-11-03');
  assert.equal(await from('next week'), '2026-11-09');
  assert.equal(await from('this weekend'), '2026-11-07');
  assert.equal(await from('on Monday'), '2026-11-09'); // today is Monday, so the next one
  assert.equal(await from('on 5 Nov'), '2026-11-05');
  assert.equal(await from('on 5 Jan'), '2027-01-05');
});

test('reads times, and treats a bare small hour as afternoon', async () => {
  assert.equal((await parse('after 2pm')).slots.earliest, '14:00');
  assert.equal((await parse('after 2')).slots.earliest, '14:00');
  assert.equal((await parse('not before 9:30 am')).slots.earliest, '09:30');
  assert.equal((await parse('before 11')).slots.latest, '11:00');
  assert.deepEqual((await parse('not before 10 am but before 4 pm')).slots.latest, '16:00');
});

test('reads budgets, without mistaking times for money', async () => {
  assert.equal((await parse('under 1.5k')).slots.budget, 1500);
  assert.equal((await parse('rs 900 please')).slots.budget, 900);
  assert.equal((await parse('1200', { awaiting: 'budget' })).slots.budget, 1200);
  assert.equal((await parse('after 10')).slots.budget, undefined);
  assert.equal((await parse('no limit')).slots.noBudget, true);
});

test('a bare answer is an area only when an area was asked for', async () => {
  assert.equal((await parse('hiranandani', { awaiting: 'area' })).slots.area, 'Hiranandani');
  assert.equal((await parse('hiranandani')).slots.area, undefined);
  assert.equal((await parse('in Saturday')).slots.area, undefined);
});

test('reads selections by number, word and name', async () => {
  const selection = async (text: string) => (await parse(text, { options: OPTIONS, state: 'PRESENTING' })).selection;
  assert.deepEqual(await selection('2'), { index: 2 });
  assert.deepEqual(await selection('option 1'), { index: 1 });
  assert.deepEqual(await selection('the second one'), { index: 2 });
  assert.deepEqual(await selection('AquaFix at 11'), { providerQuery: 'AquaFix Services', time: '11:00' });
});

test('reads reviews, declines and corrections as different intents', async () => {
  const context = { options: OPTIONS, state: 'PRESENTING' };
  assert.equal((await parse('what do people say about AquaFix?', context)).intent, 'reviews');
  assert.equal((await parse('no', context)).intent, 'decline');
  assert.equal((await parse('no, make it Saturday', context)).intent, 'provide');
});

test('reads memory requests, quoting the user as evidence', async () => {
  assert.deepEqual((await parse('what do you remember?')).memory, { op: 'view' });
  assert.deepEqual((await parse('forget my area')).memory, { op: 'forget', key: 'area' });
  assert.deepEqual((await parse('forget the AC guy')).memory, { op: 'forget', key: 'technician:ac_service' });
  assert.deepEqual((await parse('forget everything')).memory, { op: 'forget', key: 'all' });
  assert.deepEqual((await parse('I live in Powai')).memory, { op: 'set', key: 'area', value: 'Powai', evidence: 'I live in Powai' });
  assert.equal((await parse('from now on not before 10 am')).memory?.value, '10:00');
  assert.equal((await parse('my preferred electrician is Suresh')).memory?.key, 'technician:electrician');
});

test('validation drops unknown fields and wrong types', () => {
  const { proposal, rejected } = validateProposal({
    intent: 'launch_missiles',
    approve: true,
    slots: { budget: -5, area: 'Powai', service: 'hacker', isApproved: true },
    selection: { index: 'first', time: '09:00' },
    memory: { op: 'set', key: 'area', value: 12 },
  });
  assert.equal(proposal.intent, 'none');
  assert.deepEqual(proposal.slots, { area: 'Powai' });
  assert.deepEqual(proposal.selection, { time: '09:00' });
  assert.deepEqual(rejected.sort(), ['approve', 'memory.value', 'selection.index', 'slots.budget', 'slots.isApproved', 'slots.service'].sort());
});

test('validation survives output that is not an object', () => {
  for (const raw of ['text', 42, null, undefined, []]) {
    assert.equal(validateProposal(raw).proposal.intent, 'none');
  }
});

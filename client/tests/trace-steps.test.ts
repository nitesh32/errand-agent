import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { outcomeOf, plainSteps, safetyChecks } from '../src/trace-steps.ts';
import type { TraceEvent } from '../src/types.ts';

// The sample the evals generate: a booking whose provider timed out after it succeeded.
const SAMPLE: TraceEvent[] = readFileSync('docs/traces/timeout-after-success.jsonl', 'utf8').trim().split('\n').map((line) => JSON.parse(line));

const isTool = (event: TraceEvent, tool: string) => event.type === 'TOOL' && event.tool === tool;
const passedOf = (trace: TraceEvent[]) => Object.fromEntries(safetyChecks(trace).map(({ label, passed }) => [label, passed]));

test('a real recovered booking passes all four safety checks', () => {
  const checks = safetyChecks(SAMPLE);
  assert.equal(checks.length, 4);
  assert.deepEqual(checks.filter((check) => !check.passed), []);
});

test('no safety checks until an action has finished', () => {
  const beforeTheEnd = SAMPLE.filter((event) => event.status !== 'CONSUMED');
  assert.deepEqual(safetyChecks(beforeTheEnd), []);
});

test('booking before the yes fails its check', () => {
  const granted = SAMPLE.find((event) => event.status === 'GRANTED')!;
  const reordered = [...SAMPLE.filter((event) => event !== granted), granted].filter((event) => event !== undefined);
  const consumedLast = [...reordered.filter((event) => event.status !== 'CONSUMED'), SAMPLE.find((event) => event.status === 'CONSUMED')!];
  assert.equal(passedOf(consumedLast)['Waited for your yes'], false);
});

test('a price other than the approved one fails its check', () => {
  const changed = SAMPLE.map((event) => (isTool(event, 'hold_slot') ? { ...event, result: { ...(event.result as object), quoted_price: 9999 } } : event));
  assert.equal(passedOf(changed)['Same time and price you approved'], false);
});

test('a second booking under a new key fails its check', () => {
  const book = SAMPLE.find((event) => isTool(event, 'book'))!;
  const again = { ...book, args: { ...(book.args as object), idempotency_key: 'idem_apr_eval_1_2' }, result: { ok: true } };
  const index = SAMPLE.indexOf(book);
  assert.equal(passedOf([...SAMPLE.slice(0, index + 1), again, ...SAMPLE.slice(index + 1)])['Booked it only once'], false);
});

test('reporting success with no check afterwards fails its check', () => {
  const unverified = SAMPLE.filter((event) => !isTool(event, 'get_booking_status'));
  assert.equal(passedOf(unverified)['Checked with the provider after'], false);
});

test('the timeline says a timeout happened and then what the check found', () => {
  const titles = plainSteps(SAMPLE).map((step) => step.title);
  assert.ok(titles.includes('Booking did not finish: timeout'));
  assert.ok(titles.includes('Double-checked: it went through'));
  assert.ok(titles.indexOf('Booking did not finish: timeout') < titles.indexOf('Double-checked: it went through'));
});

test('the headline reports only what the trace supports', () => {
  assert.equal(outcomeOf(SAMPLE, 'DONE')?.tone, 'ok');
  assert.match(outcomeOf(SAMPLE, 'DONE')?.title ?? '', /^Booked: Ramesh Plumbing/);
  assert.equal(outcomeOf(SAMPLE.filter((event) => event.status !== 'CONSUMED'), 'DONE'), null);
  assert.equal(outcomeOf(SAMPLE, 'PRESENTING'), null);
  assert.equal(outcomeOf(SAMPLE, 'AWAITING_APPROVAL')?.tone, 'warn');
});

test('a command reply is not described as a question', () => {
  const input = (text: string) => ({ ts: '', runId: 'r', type: 'INPUT', message: 'm', text }) as TraceEvent;
  const reply = { ts: '', runId: 'r', type: 'REPLY', text: "Here's what I remember", state: 'PRESENTING' } as TraceEvent;
  assert.equal(plainSteps([input('/memory'), reply]).at(-1)?.title, 'Replied');
  assert.equal(plainSteps([input('Find a plumber'), reply]).at(-1)?.title, 'Asked you to pick one');
});

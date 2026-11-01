import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Agent } from '../src/agent/agent.ts';
import type { SessionView } from '../src/agent/agent.ts';
import { FakeClock } from '../src/infra/clock.ts';
import { FileStore } from '../src/infra/file-store.ts';
import { Tracer } from '../src/infra/tracer.ts';
import { MockProvider } from '../src/mock/mock-provider.ts';
import { RuleModel } from '../src/model/rule-model.ts';
import { createApp } from '../src/routes.ts';

let server: Server;
let base: string;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'errand-routes-'));
  const clientDir = join(dir, 'client');
  mkdirSync(clientDir);
  writeFileSync(join(clientDir, 'index.html'), '<title>Errand</title>');
  writeFileSync(join(dir, 'secret.txt'), 'private');

  const clock = new FakeClock('2026-11-02T03:30:00Z');
  const provider = new MockProvider(clock, { bookOutcomes: ['success'] });
  const build = () =>
    new Agent({ store: new FileStore(join(dir, 'data')), tracer: new Tracer(join(dir, 'traces'), clock), clock, provider, model: new RuleModel() });
  let agent = build();

  server = createApp({ getAgent: () => agent, restart: () => (agent = build()), clientDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const post = (path: string, body?: unknown) =>
  fetch(`${base}${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body ?? {}) });

async function newSession(): Promise<SessionView> {
  const response = await post('/api/sessions');
  assert.equal(response.status, 201);
  return (await response.json()) as SessionView;
}

async function send(id: string, text: string, approvalId?: string): Promise<SessionView> {
  const response = await post(`/api/sessions/${id}/messages`, { text, approvalId });
  assert.equal(response.status, 200);
  return (await response.json()) as SessionView;
}

test('every endpoint returns the same session shape', async () => {
  const created = await newSession();
  const keys = Object.keys(created).sort();
  const sent = await send(created.id, 'hello');
  const fetched = (await (await fetch(`${base}/api/sessions/${created.id}`)).json()) as SessionView;
  assert.deepEqual(Object.keys(sent).sort(), keys);
  assert.deepEqual(Object.keys(fetched).sort(), keys);
  assert.equal(fetched.messages.length, 2);
});

test('a full booking works over HTTP, confirmed by card', async () => {
  const { id } = await newSession();
  await send(id, 'Find a plumber in Powai this week, mornings only, under ₹1,500');
  const held = await send(id, '1');
  assert.equal(held.state, 'AWAITING_APPROVAL');
  const card = held.messages.at(-1)!.cards.find((item) => item.type === 'approval');
  assert.ok(card?.type === 'approval');
  const done = await send(id, 'yes', card.approvalId);
  assert.equal(done.state, 'DONE');
  assert.ok(done.trace.some((event) => event.type === 'TOOL' && event.tool === 'book'));
});

test('/restart kills the agent at the book call and it recovers with one booking', async () => {
  const { id } = await newSession();
  await send(id, 'Find an electrician in Powai this week under 2000');
  await send(id, '1');
  await send(id, '/restart');
  const done = await send(id, 'yes');
  assert.equal(done.state, 'DONE');
  assert.match(done.messages.at(-1)!.text, /interrupted/);
});

test('unknown sessions return 404', async () => {
  assert.equal((await fetch(`${base}/api/sessions/nope`)).status, 404);
  assert.equal((await post('/api/sessions/nope/messages', { text: 'hi' })).status, 404);
});

test('a session id cannot escape the data folder', async () => {
  assert.equal((await fetch(`${base}/api/sessions/..%2F..%2Fsecret`)).status, 404);
});

test('bad bodies return 400', async () => {
  const { id } = await newSession();
  assert.equal((await post(`/api/sessions/${id}/messages`, 'not json')).status, 400);
  assert.equal((await post(`/api/sessions/${id}/messages`, { text: '   ' })).status, 400);
  assert.equal((await post(`/api/sessions/${id}/messages`, { text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await post(`/api/sessions/${id}/messages`, { text: 'hi', approvalId: 5 })).status, 400);
});

test('an oversized body returns 413', async () => {
  const { id } = await newSession();
  assert.equal((await post(`/api/sessions/${id}/messages`, 'x'.repeat(70_000))).status, 413);
});

test('wrong methods and paths are refused', async () => {
  assert.equal((await fetch(`${base}/api/sessions`)).status, 405);
  assert.equal((await fetch(`${base}/api/other`)).status, 404);
  assert.equal((await post('/index.html')).status, 405);
});

test('static files are served, and paths cannot leave the client folder', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  assert.equal((await fetch(`${base}/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/..%2Fsecret.txt`)).status, 404);
});

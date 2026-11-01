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
import { RuleModel } from '../src/model/rule-model.ts';

/** A provider whose search waits until the test releases it. */
class SlowSearchProvider extends MockProvider {
  release: () => void = () => {};
  private readonly gate = new Promise<void>((resolve) => { this.release = resolve; });
  entered = false;

  override async search_providers(...args: Parameters<MockProvider['search_providers']>) {
    this.entered = true;
    await this.gate;
    return super.search_providers(...args);
  }
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'errand-agent-'));
  const clock = new FakeClock('2026-11-02T03:30:00Z');
  const provider = new SlowSearchProvider(clock);
  const agent = new Agent({ store: new FileStore(dir), tracer: new Tracer(join(dir, 'traces'), clock), clock, provider, model: new RuleModel() });
  agent.createSession('s1');
  return { agent, provider };
}

async function untilSearchStarts(provider: SlowSearchProvider) {
  while (!provider.entered) await new Promise((resolve) => setImmediate(resolve));
}

test('reading a session mid-turn returns saved progress instead of waiting', async () => {
  const { agent, provider } = setup();
  const turn = agent.handleMessage('s1', 'Find a plumber in Powai this week under 2000');
  await untilSearchStarts(provider);

  const live = await agent.getSession('s1');
  assert.equal(live.state, 'SEARCHING');
  assert.ok(live.trace.some((event) => event.type === 'STATE' && event.to === 'SEARCHING'));

  provider.release();
  assert.equal((await turn).state, 'PRESENTING');
  assert.equal((await agent.getSession('s1')).state, 'PRESENTING');
});

test('reading a session mid-turn cannot start a second turn', async () => {
  const { agent, provider } = setup();
  const turn = agent.handleMessage('s1', 'Find a plumber in Powai this week under 2000');
  await untilSearchStarts(provider);
  await Promise.all([agent.getSession('s1'), agent.getSession('s1')]);
  provider.release();

  const { messages } = await turn;
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant']);
});

test('the view reports what is being asked and each approval outcome', async () => {
  const { agent, provider } = setup();
  provider.release();
  assert.equal((await agent.handleMessage('s1', 'I need a plumber')).awaiting, 'area');
  await agent.handleMessage('s1', 'Powai');
  await agent.handleMessage('s1', 'this week');
  assert.equal((await agent.handleMessage('s1', 'no limit')).awaiting, null);

  const held = await agent.handleMessage('s1', '1');
  assert.deepEqual(held.approvals.map((item) => item.status), ['PENDING']);
  const declined = await agent.handleMessage('s1', 'no');
  assert.deepEqual(declined.approvals.map((item) => item.status), ['VOID']);
  assert.ok(declined.world.scenarios.includes('timeout_but_booked'));
});

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from './agent/agent.ts';
import { systemClock } from './infra/clock.ts';
import { FileStore } from './infra/file-store.ts';
import { Tracer } from './infra/tracer.ts';
import { MockProvider } from './mock/mock-provider.ts';
import type { MockState } from './mock/mock-provider.ts';
import type { Model } from './model/model.ts';
import { OpenRouterModel } from './model/openrouter-model.ts';
import { RuleModel } from './model/rule-model.ts';
import { createApp } from './routes.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = join(ROOT, 'data');
const CLIENT_DIR = join(ROOT, 'client');
const PORT = Number(process.env.PORT ?? 3000);
const WORLD_ID = 'world';

function chooseModel(): Model {
  const { OPENROUTER_API_KEY: apiKey, OPENROUTER_MODEL: model } = process.env;
  return apiKey && model ? new OpenRouterModel(apiKey, model) : new RuleModel();
}

const store = new FileStore(DATA_DIR);
const model = chooseModel();

/** Everything is rebuilt from disk, which is what makes /restart an honest test. */
function buildAgent(): Agent {
  const saved = store.read<MockState>('mock', WORLD_ID);
  const provider = new MockProvider(systemClock, {}, saved, (state) => store.write('mock', WORLD_ID, state));
  return new Agent({ store, tracer: new Tracer(join(DATA_DIR, 'traces'), systemClock), clock: systemClock, provider, model });
}

let agent = buildAgent();

createApp({
  getAgent: () => agent,
  restart: () => (agent = buildAgent()),
  clientDir: CLIENT_DIR,
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Errand Agent on http://localhost:${PORT} (model: ${model.name})`);
});

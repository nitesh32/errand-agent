import { SCENARIOS } from '../mock/mock-provider.ts';
import type { MockProvider } from '../mock/mock-provider.ts';
import { applyMemory, confirmFact, describeMemory, remind, showBookings } from './replies.ts';
import { say, trace } from './session.ts';
import type { Turn } from './session.ts';

export interface CommandContext {
  provider: MockProvider;
  armCrash: (point: string) => void;
}

/** Slash commands bypass the model: what they do is exact. */
export async function runCommand(turn: Turn, command: string, context: CommandContext): Promise<void> {
  const [name, ...args] = command.split(/\s+/);
  if (name === '/bookings') return showBookings(turn);
  if (name === '/memory') return runMemoryCommand(turn, args, command);
  if (name === '/scenario') return runScenarioCommand(turn, args[0], context.provider);
  if (name === '/restart') {
    context.armCrash('after_book');
    trace(turn, 'INPUT', { armed: 'crash after the next book call' });
    say(turn, 'Armed. The agent will die right after the next book call and recover from disk.');
    return remind(turn);
  }
  say(turn, 'Commands: /memory, /bookings, /scenario, /restart.');
}

async function runMemoryCommand(turn: Turn, [op, key, ...value]: string[], command: string): Promise<void> {
  if (!op) return describeMemory(turn);
  if (op === 'set' && key && value.length) return applyMemory(turn, { op, key, value: value.join(' '), evidence: command }, command);
  if (op === 'forget' && key) return applyMemory(turn, { op, key }, command);
  if (op === 'confirm' && key) return confirmFact(turn, key);
  say(turn, 'Use /memory, /memory set <key> <value>, /memory confirm <key>, or /memory forget <key>. Keys: area, earliest_time, technician:<service>, all.');
}

function runScenarioCommand(turn: Turn, scenario: string | undefined, provider: MockProvider): void {
  if (!scenario || !(scenario in SCENARIOS)) {
    say(turn, `Scenarios: ${Object.keys(SCENARIOS).join(', ')}.`);
    return;
  }
  provider.applyScenario(scenario);
  trace(turn, 'INPUT', { scenario });
  say(turn, `Scenario set: ${scenario}.`);
  remind(turn);
}

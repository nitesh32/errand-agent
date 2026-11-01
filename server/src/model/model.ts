/** What the model sees. Review text and approvals are deliberately absent. */
export interface ModelInput {
  text: string;
  today: string;
  state: string;
  awaiting?: string; // the slot the agent just asked about
  options: { index: number; providerName: string }[];
}

export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface ModelOutput {
  proposal: unknown; // untrusted until validated
  usage?: ModelUsage;
}

export interface Model {
  readonly name: string;
  interpret(input: ModelInput): Promise<ModelOutput>;
}

export const INTENTS = ['book', 'reschedule', 'cancel', 'select', 'provide', 'reviews', 'bookings', 'decline', 'memory', 'none'] as const;
export type Intent = (typeof INTENTS)[number];

export const SERVICES = ['plumber', 'electrician', 'ac_service', 'cleaning'] as const;

export interface SlotProposal {
  service?: string;
  area?: string;
  dateFrom?: string;
  dateTo?: string;
  earliest?: string;
  latest?: string;
  budget?: number;
  noBudget?: boolean;
  notes?: string;
  sameAsLast?: boolean;
}

export interface Selection {
  index?: number;
  providerQuery?: string;
  time?: string;
}

export interface MemoryProposal {
  op: 'view' | 'set' | 'forget';
  key?: string;
  value?: string;
  evidence?: string; // the user's own words, checked by code before a fact counts as stated
}

export interface Proposal {
  intent: Intent;
  slots: SlotProposal;
  selection?: Selection;
  memory?: MemoryProposal;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const MAX_TEXT = 200;

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT;

const SLOT_CHECKS: Record<keyof SlotProposal, (value: unknown) => boolean> = {
  service: (value) => (SERVICES as readonly unknown[]).includes(value),
  area: isText,
  dateFrom: (value) => typeof value === 'string' && DATE.test(value),
  dateTo: (value) => typeof value === 'string' && DATE.test(value),
  earliest: (value) => typeof value === 'string' && TIME.test(value),
  latest: (value) => typeof value === 'string' && TIME.test(value),
  budget: (value) => typeof value === 'number' && value > 0,
  noBudget: (value) => typeof value === 'boolean',
  notes: isText,
  sameAsLast: (value) => typeof value === 'boolean',
};

function keepValid<T extends object>(raw: unknown, checks: Record<string, (value: unknown) => boolean>, path: string, rejected: string[]): Partial<T> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((raw ?? {}) as object)) {
    if (checks[key]?.(value)) kept[key] = value;
    else rejected.push(`${path}${key}`);
  }
  return kept as Partial<T>;
}

/**
 * Turns untrusted model output into a Proposal. Only known fields of the right type
 * survive, so a field such as `approve` or `book_now` has nowhere to go.
 */
export function validateProposal(raw: unknown): { proposal: Proposal; rejected: string[] } {
  const rejected: string[] = [];
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  for (const key of Object.keys(input)) {
    if (!['intent', 'slots', 'selection', 'memory'].includes(key)) rejected.push(key);
  }
  const intent = (INTENTS as readonly unknown[]).includes(input.intent) ? (input.intent as Intent) : 'none';
  const proposal: Proposal = { intent, slots: keepValid<SlotProposal>(input.slots, SLOT_CHECKS, 'slots.', rejected) };

  if (input.selection) {
    proposal.selection = keepValid<Selection>(
      input.selection,
      { index: (value) => Number.isInteger(value), providerQuery: isText, time: (value) => typeof value === 'string' && TIME.test(value) },
      'selection.',
      rejected,
    );
  }
  const memory = input.memory as MemoryProposal | undefined;
  if (memory && ['view', 'set', 'forget'].includes(memory.op)) {
    const { op, ...rest } = memory;
    proposal.memory = { op, ...keepValid<MemoryProposal>(rest, { key: isText, value: isText, evidence: isText }, 'memory.', rejected) };
  } else if (memory) {
    rejected.push('memory.op');
  }
  return { proposal, rejected };
}

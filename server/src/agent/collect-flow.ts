import type { SlotProposal } from '../model/model.ts';
import type { ApprovalAction } from './approval.ts';
import { searchAndPresent } from './booking-flow.ts';
import { startChange } from './change-flow.ts';
import { formatSlot, say, trace, voidPending } from './session.ts';
import type { Session, SlotName, Slots, Turn } from './session.ts';
import { transition } from './state-machine.ts';

const QUESTIONS: Partial<Record<SlotName, string>> = {
  service: 'What do you need done: plumber, electrician, AC servicing or cleaning?',
  area: 'Which area are you in?',
  dateRange: 'When should this happen? For example "this week" or "Saturday".',
  budget: 'What is your budget? You can also say "no limit".',
};

export function ask(turn: Turn, slot: SlotName): void {
  const { session } = turn;
  session.awaiting = slot;
  session.asked.push(slot);
  transition(turn, 'COLLECTING', `need ${slot}`);
  say(turn, QUESTIONS[slot]!);
}

export function questionFor(slot: SlotName): string {
  return QUESTIONS[slot]!;
}

/** Begins a new errand with a clean slate. Saved preferences are filled in. */
export function startErrand(turn: Turn, kind: ApprovalAction): void {
  const { session, memory } = turn;
  session.kind = kind;
  session.slots = {};
  session.asked = [];
  session.options = [];
  for (const field of ['sameAsLast', 'awaiting', 'pendingFact', 'targetBooking', 'held', 'approvalId', 'execution'] as const) {
    delete session[field];
  }
  transition(turn, 'COLLECTING', `new ${kind} errand`);
  if (kind === 'cancel') return;

  const earliest = memory.get('earliest_time');
  if (earliest) session.slots.earliest = { value: earliest.value, source: 'memory' };
  const area = kind === 'book' ? memory.get('area') : undefined;
  if (area) session.slots.area = { value: area.value, source: 'memory' };

  const saved = [area && `area ${area.label}`, earliest && `not before ${earliest.label}`].filter(Boolean);
  if (saved.length) say(turn, `Using your saved preferences: ${saved.join(', ')}.`);
}

/** Merges new values into the slots, leaving the rest alone. Returns the names that changed. */
export function mergeSlots(session: Session, update: SlotProposal): SlotName[] {
  const { slots } = session;
  const changed: SlotName[] = [];
  const set = <K extends SlotName>(name: K, value: NonNullable<Slots[K]>['value']) => {
    if (JSON.stringify(slots[name]?.value) !== JSON.stringify(value)) changed.push(name);
    slots[name] = { value, source: 'user' } as Slots[K];
  };

  if (update.service) set('service', update.service);
  if (update.area) set('area', update.area);
  if (update.dateFrom) set('dateRange', { from: update.dateFrom, to: update.dateTo ?? update.dateFrom });
  if (update.earliest) set('earliest', update.earliest);
  if (update.latest) set('latest', update.latest);
  if (update.budget) set('budget', update.budget);
  if (update.noBudget) set('budget', null);
  if (update.notes) set('notes', update.notes);
  if (update.sameAsLast) session.sameAsLast = true;
  return changed;
}

/** A correction voids a pending approval and searches again. Everything else stays known. */
export async function applyCorrection(turn: Turn, changed: SlotName[]): Promise<void> {
  const searchChanges = changed.filter((name) => name !== 'notes');
  if (!searchChanges.length) return;
  const { session } = turn;
  voidPending(turn, `changed ${searchChanges.join(', ')}`);
  delete session.held;
  session.options = [];
  transition(turn, 'COLLECTING', `corrected ${searchChanges.join(', ')}`);
  await advance(turn);
}

/** Moves the errand forward: asks for what is missing, or searches when nothing is. */
export async function advance(turn: Turn): Promise<void> {
  const { session } = turn;
  if (session.pendingFact) {
    say(turn, session.pendingFact.question);
    return;
  }
  if (session.kind !== 'book') return startChange(turn);
  if (!session.slots.service) return ask(turn, 'service');
  if (!session.slots.provider && (await askAboutTechnician(turn))) return;
  if (!session.slots.area) {
    if (askAboutPendingArea(turn)) return;
    return ask(turn, 'area');
  }
  if (!session.slots.dateRange) return ask(turn, 'dateRange');
  if (!session.slots.budget) return ask(turn, 'budget');
  await searchAndPresent(turn);
}

function askPendingFact(turn: Turn, key: string, value: string, label: string, question: string): void {
  turn.session.pendingFact = { key, value, label, question };
  say(turn, question);
}

function askAboutPendingArea(turn: Turn): boolean {
  const fact = turn.memory.pending('area');
  if (fact) askPendingFact(turn, fact.key, fact.value, fact.label, `Is this for ${fact.label} again?`);
  return Boolean(fact);
}

/** Fills the technician from memory, or asks when all we have is a guess. True when asking. */
async function askAboutTechnician(turn: Turn): Promise<boolean> {
  const { session, memory } = turn;
  const service = session.slots.service!.value;
  const serviceName = service.replace('_', ' ');
  const key = `technician:${service}`;

  const saved = memory.get(key);
  if (saved) {
    session.slots.provider = { value: saved.value, source: 'memory' };
    say(turn, `Using your saved ${serviceName} provider: ${saved.label}.`);
    return false;
  }
  const pending = memory.pending(key);
  if (pending) {
    askPendingFact(turn, key, pending.value, pending.label, `You used ${pending.label} before. Use them again?`);
    return true;
  }
  if (!session.sameAsLast) return false;

  session.sameAsLast = false;
  const history = (await turn.tools.list_bookings())
    .filter((booking) => booking.service === service && booking.status !== 'cancelled')
    .sort((a, b) => b.slot.localeCompare(a.slot));
  const last = history[0];
  if (!last) {
    say(turn, `I can't find a past ${serviceName} booking, so I'll show you what's available.`);
    return false;
  }
  if (memory.isForgotten(key, last.provider.id)) {
    say(turn, "You asked me to forget that provider, so I won't use them. I'll show you who's available.");
    return false;
  }
  const { id, name } = last.provider;
  askPendingFact(turn, key, id, name, `Your last ${serviceName} was ${name} on ${formatSlot(last.slot)}. Use them again?`);
  return true;
}

/** Applies the user's yes or no to a pending fact. Only a yes lets the fact be used. */
export function answerPendingFact(turn: Turn, accepted: boolean): void {
  const { session, memory } = turn;
  const fact = session.pendingFact!;
  delete session.pendingFact;
  trace(turn, 'INPUT', { fact: fact.key, accepted });
  if (!accepted) {
    memory.forget(fact.key, [fact.value]);
    return;
  }
  memory.infer(fact.key, fact.value, fact.label);
  if (memory.pending(fact.key)?.value === fact.value) memory.confirm(fact.key);
  session.slots[fact.key === 'area' ? 'area' : 'provider'] = { value: fact.value, source: 'memory' };
}

import type { MemoryProposal, Selection } from '../model/model.ts';
import { advance, answerPendingFact, applyCorrection, questionFor } from './collect-flow.ts';
import { currentApproval, formatSlot, rupees, say, trace } from './session.ts';
import type { Option, Session, Turn } from './session.ts';
import { isAtRest } from './state-machine.ts';

export function findOption(session: Session, selection: Selection | undefined): Option | undefined {
  if (!selection) return undefined;
  return session.options.find(
    (item) => item.index === selection.index || (selection.providerQuery && item.providerName === selection.providerQuery),
  );
}

/** Repeats what the errand is waiting on, without asking for anything already known. */
export function remind(turn: Turn): void {
  const { session } = turn;
  if (session.state === 'AWAITING_APPROVAL') {
    const approval = currentApproval(session)!;
    say(turn, `${approval.providerName}, ${formatSlot(approval.slot)}, ${rupees(approval.price)} is still waiting for your "yes".`);
  } else if (session.state === 'PRESENTING') {
    say(turn, 'Reply with a number to choose an option.');
  } else if (session.pendingFact) {
    say(turn, session.pendingFact.question);
  } else if (session.state === 'COLLECTING' && session.awaiting) {
    say(turn, questionFor(session.awaiting));
  }
}

export async function showBookings(turn: Turn): Promise<void> {
  const bookings = await turn.tools.list_bookings();
  const lines = bookings
    .sort((a, b) => b.slot.localeCompare(a.slot))
    .map((booking) => `${booking.provider.name}, ${formatSlot(booking.slot)}, ${booking.status} (${booking.id})`);
  say(turn, lines.join('\n') || 'You have no bookings yet.');
  turn.cards.push({ type: 'bookings' });
  remind(turn);
}

/** Reviews go to the user as quoted data. They never reach the model, state or memory. */
export async function showReviews(turn: Turn, selection: Selection | undefined): Promise<void> {
  const option = findOption(turn.session, selection);
  if (!option) {
    say(turn, 'Which provider? Search for one first, then ask about it by name or number.');
    return;
  }
  const result = await turn.tools.get_provider(option.providerId);
  if (!result.ok) {
    say(turn, `I couldn't load reviews for ${option.providerName}.`);
    return;
  }
  const { reviews } = result.provider;
  const flagged = reviews.filter((review) => review.flagged);
  for (const review of flagged) trace(turn, 'GUARD', { flaggedReview: review.id, effect: 'none' });
  turn.cards.push({ type: 'reviews', providerName: option.providerName, reviews });

  const average = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
  say(turn, `${option.providerName} has ${reviews.length} reviews, averaging ★${average.toFixed(1)}.`);
  if (flagged.length) say(turn, `${flagged.length} of them contained instructions aimed at me. I treated that as text only, and nothing changed.`);
  remind(turn);
}

function describeKey(key: string): string {
  if (key === 'area') return 'area';
  if (key === 'earliest_time') return 'earliest time';
  return `preferred ${key.replace('technician:', '').replace('_', ' ')} provider`;
}

function slotForKey(key: string): 'area' | 'earliest' | 'provider' {
  if (key === 'area') return 'area';
  return key === 'earliest_time' ? 'earliest' : 'provider';
}

export function describeMemory(turn: Turn): void {
  const { facts, forgottenKeys } = turn.memory.list();
  const lines = facts.map((fact) => {
    const origin = fact.source === 'stated' ? 'you said' : fact.confirmed ? 'inferred, you confirmed' : 'inferred, not confirmed yet';
    return `${describeKey(fact.key)}: ${fact.label} (${origin})`;
  });
  say(turn, lines.length ? `Here's what I remember:\n${lines.join('\n')}` : "I don't have any saved preferences.");
  const hasNewer = (key: string) => facts.some((fact) => fact.key === key);
  const gone = forgottenKeys.filter((key) => !hasNewer(key));
  if (gone.length) say(turn, `Forgotten: ${gone.map(describeKey).join(', ')}.`);
  for (const key of forgottenKeys.filter(hasNewer)) say(turn, `An earlier ${describeKey(key)} was forgotten and won't be reused.`);
  turn.cards.push({ type: 'memory' });
}

/**
 * The user's yes to one guess, from the memory card. It is a command, so it can never count as
 * approval for a waiting booking.
 */
export async function confirmFact(turn: Turn, key: string): Promise<void> {
  const { memory, session } = turn;
  const fact = memory.pending(key);
  if (!fact) {
    say(turn, "That isn't waiting for your yes.");
    return remind(turn);
  }
  trace(turn, 'INPUT', { memory: 'confirm', key });
  say(turn, `Okay, I'll use ${fact.label} as your ${describeKey(key)}.`);
  if (session.pendingFact?.key === key) {
    answerPendingFact(turn, true);
    delete session.awaiting;
    if (session.state === 'COLLECTING') return advance(turn);
    return remind(turn);
  }
  memory.confirm(key);
  remind(turn);
}

async function forgetKey(turn: Turn, key: string): Promise<void> {
  const { memory, session, tools } = turn;
  let pastProviders: string[] = [];
  if (key.startsWith('technician:')) {
    const service = key.split(':')[1];
    pastProviders = (await tools.list_bookings()).filter((item) => item.service === service).map((item) => item.provider.id);
  }
  memory.forget(key, pastProviders);
  if (session.pendingFact?.key === key) delete session.pendingFact;

  const slot = slotForKey(key);
  if (session.slots[slot]?.source === 'memory') {
    delete session.slots[slot];
    if (!isAtRest(session)) await applyCorrection(turn, [slot]);
  }
}

/** Applies a memory change. A fact counts as stated only if the user's own words back it up. */
export async function applyMemory(turn: Turn, proposal: MemoryProposal, text: string): Promise<void> {
  const { memory, session } = turn;
  const { op, key, value, evidence } = proposal;

  if (op === 'view') return describeMemory(turn);

  if (op === 'forget') {
    if (!key) {
      say(turn, 'Which preference should I forget? You can say area, earliest time, or a service.');
      return;
    }
    const keys = key === 'all' ? memory.list().facts.map((fact) => fact.key) : [key];
    for (const item of keys) await forgetKey(turn, item);
    trace(turn, 'INPUT', { memory: 'forget', keys });
    say(turn, key === 'all' ? "Done. I've forgotten everything saved." : `Done. I've forgotten your ${describeKey(key)}, and I won't re-learn it from past bookings.`);
    return;
  }

  if (!key || !value) return;
  if (!evidence || !text.toLowerCase().includes(evidence.toLowerCase())) {
    memory.infer(key, value);
    trace(turn, 'GUARD', { downgraded: key, reason: 'no supporting words in the user message' });
    return;
  }
  memory.state(key, value);
  trace(turn, 'INPUT', { memory: 'stated', key });
  say(turn, `Saved: your ${describeKey(key)} is ${value}.`);

  const slot = slotForKey(key);
  if (slot !== 'provider' && !isAtRest(session) && session.slots[slot]?.source !== 'user') {
    session.slots[slot] = { value, source: 'memory' };
    await applyCorrection(turn, [slot]);
  }
}

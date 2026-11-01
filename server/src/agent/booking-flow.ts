import type { Provider } from '../types.ts';
import { consumeApproval, createApproval, grantApproval } from './approval.ts';
import type { ApprovalTerms } from './approval.ts';
import { executeChange, resumeChange } from './change-flow.ts';
import { addStep, currentApproval, formatSlot, MAX_ATTEMPTS, MAX_OPTIONS, rupees, say, trace, voidCurrent, voidPending } from './session.ts';
import type { Option, Session, Slots, Turn } from './session.ts';
import { transition } from './state-machine.ts';

function matchesProvider(providerId: string, providerName: string, wanted: string): boolean {
  return providerId === wanted || providerName.toLowerCase().includes(wanted.toLowerCase());
}

export function fitsWindow(slot: string, slots: Slots): boolean {
  const time = slot.split('T')[1];
  if (slots.earliest && time < slots.earliest.value) return false;
  return !(slots.latest && time >= slots.latest.value);
}

function buildOptions({ slots }: Session, providers: Provider[]): Option[] {
  const budget = slots.budget?.value;
  const preferred = slots.provider?.value;
  const rank = ({ id, name }: Provider) => (preferred && matchesProvider(id, name, preferred) ? 0 : 1);
  return providers
    .filter((provider) => !budget || provider.price <= budget)
    .map((provider) => ({ provider, fitting: provider.free_slots.filter((slot) => fitsWindow(slot, slots)) }))
    .filter(({ fitting }) => fitting.length > 0)
    .sort((a, b) => rank(a.provider) - rank(b.provider) || b.provider.rating - a.provider.rating || a.provider.price - b.provider.price)
    .slice(0, MAX_OPTIONS)
    .map(({ provider, fitting }, position) => ({
      index: position + 1,
      providerId: provider.id,
      providerName: provider.name,
      rating: provider.rating,
      price: provider.price,
      attributes: provider.attributes,
      slots: fitting,
    }));
}

export function presentOptions(turn: Turn, title: string): void {
  const { session } = turn;
  transition(turn, 'PRESENTING', `${session.options.length} options`);
  const lines = session.options.map(
    (option) => `${option.index}. ${option.providerName}, ★${option.rating}, ${formatSlot(option.slots[0])}, ${rupees(option.price)}`,
  );
  say(turn, `${title}\n${lines.join('\n')}\nReply with a number to choose.`);
  turn.cards.push({ type: 'options', title, options: session.options });
}

export async function searchAndPresent(turn: Turn, note?: string): Promise<void> {
  const { session, tools } = turn;
  const { slots } = session;
  transition(turn, 'SEARCHING', 'all required details known');
  const providers = await tools.search_providers(slots.service!.value, slots.area!.value, slots.dateRange!.value);
  session.options = buildOptions(session, providers);
  trace(turn, 'STATE', { filtered: `${providers.length} to ${session.options.length}` });
  if (note) say(turn, note);

  if (!session.options.length) {
    transition(turn, 'COLLECTING', 'nothing fits');
    say(turn, 'Nothing fits those details. Try a higher budget, a different time, or other dates.');
    return;
  }
  const preferred = slots.provider?.value;
  const first = session.options[0];
  if (preferred && !matchesProvider(first.providerId, first.providerName, preferred)) {
    say(turn, 'Your preferred provider has nothing free that fits, so here are the others.');
  }
  presentOptions(turn, "Here's who fits, best rated first:");
}

/** Creates the record the user must confirm, replacing any earlier unconfirmed one. */
export function requestApproval(turn: Turn, providerName: string, terms: ApprovalTerms, note?: string): void {
  const { session } = turn;
  voidPending(turn, 'replaced');
  // The session id matters: idempotency keys derive from this, and the provider's keys are global.
  const approval = createApproval(`apr_${session.id}_${session.approvals.length + 1}`, providerName, terms);
  session.approvals.push(approval);
  session.approvalId = approval.id;
  transition(turn, 'AWAITING_APPROVAL', `${terms.action} needs confirmation`);
  trace(turn, 'APPR', { approval: approval.id, status: 'PENDING', fingerprint: approval.fingerprint.slice(0, 12), terms });

  const verb = { book: 'Book', cancel: 'Cancel', reschedule: 'Move to' }[terms.action];
  say(turn, `${note ? `${note}\n` : ''}${verb} ${providerName}, ${formatSlot(terms.slot)}, ${rupees(terms.price)}? Reply "yes" to confirm.`);
  turn.cards.push({
    type: 'approval',
    approvalId: approval.id,
    action: terms.action,
    providerName,
    slot: terms.slot,
    price: terms.price,
    ...(note ? { note } : {}),
    ...(terms.action === 'book' && session.held ? { expiresAt: session.held.expires_at } : {}),
  });
}

/** The user picked a provider and slot: check for duplicates, hold it, and ask for approval. */
export async function selectForBooking(turn: Turn, option: Option, slot: string): Promise<void> {
  const { session, tools } = turn;
  const service = session.slots.service!.value;
  const duplicate = (await tools.list_bookings()).find(
    (booking) => booking.status === 'upcoming' && booking.slot === slot && (booking.provider.id === option.providerId || booking.service === service),
  );
  if (duplicate) {
    trace(turn, 'GUARD', { blocked: 'duplicate booking', existing: duplicate.id });
    say(turn, `You already have ${duplicate.provider.name} at ${formatSlot(slot)} (${duplicate.id}), so I won't book that again. Pick another option.`);
    return;
  }

  transition(turn, 'HOLDING', `${option.providerId} ${slot}`);
  const hold = await tools.hold_slot(option.providerId, slot);
  if (!hold.ok) {
    await refreshAfterLostSlot(turn, `${option.providerName} is no longer free at ${formatSlot(slot)}.`);
    return;
  }

  const budget = session.slots.budget?.value;
  if (budget && hold.quoted_price > budget) {
    transition(turn, 'PRESENTING', 'quote over budget');
    say(turn, `${option.providerName} quoted ${rupees(hold.quoted_price)}, which is over your ${rupees(budget)} budget. Pick another option or raise your budget.`);
    return;
  }

  session.held = { ...hold, providerId: option.providerId, slot };
  const note = hold.quoted_price === option.price ? undefined : `The price changed from ${rupees(option.price)} to ${rupees(hold.quoted_price)}.`;
  requestApproval(turn, option.providerName, { action: 'book', providerId: option.providerId, slot, price: hold.quoted_price }, note);
}

async function refreshAfterLostSlot(turn: Turn, note: string): Promise<void> {
  const { session } = turn;
  delete session.held;
  delete session.execution;
  await searchAndPresent(turn, note);
}

/** The user said yes. Grant the approval, save the key, then act. */
export async function approveAndExecute(turn: Turn): Promise<void> {
  const { session, userMessage } = turn;
  const approval = currentApproval(session)!;
  grantApproval(approval, userMessage);
  trace(turn, 'APPR', { approval: approval.id, status: 'GRANTED', message: userMessage.id });
  addStep(turn, 'Approval checked', approval.id);
  session.execution = {
    action: approval.action,
    approvalId: approval.id,
    key: `idem_${approval.id}_1`,
    keySeq: 1,
    attempts: 0,
  };
  transition(turn, 'EXECUTING', 'idempotency key saved before the call');
  await (approval.action === 'book' ? executeBooking(turn) : executeChange(turn));
}

/** Books and verifies. A timeout always checks status before any retry. */
async function executeBooking(turn: Turn): Promise<void> {
  const { session, tools, limits } = turn;
  const execution = session.execution!;

  // Each pass starts from a known "not booked", so stopping here is always safe to report.
  while (execution.attempts < MAX_ATTEMPTS && limits.hasToolCalls(2)) {
    transition(turn, 'EXECUTING', `attempt ${execution.attempts + 1}`);
    execution.attempts++;
    turn.save();

    turn.crashPoint('before_book');
    const result = await tools.book(currentApproval(session), session.held!, execution.key);
    turn.crashPoint('after_book');

    if (!result.ok && result.error === 'slot_taken') return slotLost(turn);
    if (!result.ok && result.error === 'hold_expired') {
      if (await holdAgain(turn)) continue;
      return;
    }
    if (!result.ok) addStep(turn, 'Book with provider', `${result.error}, checking status before any retry`, 'warn');

    transition(turn, 'VERIFYING', result.ok ? 'confirming with status check' : `${result.error}, no retry before status check`);
    const lookup = await tools.get_booking_status(execution.key);
    if (lookup.status === 'booked') return finishBooking(turn, lookup.booking_id, !result.ok);
    if (lookup.status === 'failed') return slotLost(turn);
    addStep(turn, 'Status check', 'not booked, safe to retry with the same key', 'warn');
  }

  const outOfAttempts = execution.attempts >= MAX_ATTEMPTS;
  const reason = outOfAttempts ? 'attempts exhausted' : 'tool call limit reached';
  trace(turn, outOfAttempts ? 'ERROR' : 'LIMIT', { reason });
  voidCurrent(turn, reason);
  transition(turn, 'FAILED', reason);
  say(turn, outOfAttempts
    ? `I tried ${MAX_ATTEMPTS} times and the provider never confirmed. The status check shows it was not booked. You can try again or pick another provider.`
    : "I reached my limit on tool calls, so I stopped. It was not booked. You can try again whenever you like.");
}

/** The hold ran out. Same price keeps the approval. Anything different needs a new yes. */
async function holdAgain(turn: Turn): Promise<boolean> {
  const { session, tools } = turn;
  const held = session.held!;
  const approval = currentApproval(session)!;
  const hold = await tools.hold_slot(held.providerId, held.slot);

  if (!hold.ok) {
    voidCurrent(turn, 'slot no longer available');
    await refreshAfterLostSlot(turn, `${approval.providerName} is no longer free at ${formatSlot(held.slot)}, so I did not book it.`);
    return false;
  }

  session.held = { ...hold, providerId: held.providerId, slot: held.slot };
  if (hold.quoted_price !== approval.price) {
    voidCurrent(turn, 'price changed');
    delete session.execution;
    const note = `The hold expired and the new price is ${rupees(hold.quoted_price)}, not ${rupees(approval.price)}. I did not book it.`;
    requestApproval(turn, approval.providerName, { action: 'book', providerId: held.providerId, slot: held.slot, price: hold.quoted_price }, note);
    return false;
  }

  // The old key failed for good on the expired hold, so this attempt needs a new one.
  const execution = session.execution!;
  execution.keySeq++;
  execution.key = `idem_${approval.id}_${execution.keySeq}`;
  turn.save();
  return true;
}

async function slotLost(turn: Turn): Promise<void> {
  const { session } = turn;
  const held = session.held!;
  const approval = currentApproval(session)!;
  voidCurrent(turn, 'slot taken');
  await refreshAfterLostSlot(turn, `${approval.providerName} lost the ${formatSlot(held.slot)} slot to someone else, so nothing was booked.`);
}

function finishBooking(turn: Turn, bookingId: string, recovered: boolean): void {
  const { session, memory } = turn;
  const approval = currentApproval(session)!;
  consumeApproval(approval);
  trace(turn, 'APPR', { approval: approval.id, status: 'CONSUMED' });
  session.completed = { action: 'book', bookingId };
  addStep(turn, 'Verified booking', bookingId);
  transition(turn, 'DONE', 'status check confirmed the booking');

  memory.infer(`technician:${session.slots.service!.value}`, approval.providerId, approval.providerName);
  if (session.slots.area?.source === 'user') memory.infer('area', session.slots.area.value);

  say(turn, `Booked: ${approval.providerName}, ${formatSlot(approval.slot)}, ${rupees(approval.price)} (${bookingId}).`);
  if (recovered) say(turn, "The provider timed out, so I checked the booking status before telling you. It had gone through, and there's no duplicate.");
}

/** Runs before anything else when a session is found mid-action, such as after a restart. */
export async function resumeExecution(turn: Turn): Promise<void> {
  const { session, tools } = turn;
  const execution = session.execution;
  trace(turn, 'GUARD', { recovering: session.state, key: execution?.key });
  if (!execution) {
    transition(turn, 'FAILED', 'in flight with no saved execution');
    say(turn, 'I lost track of that action. Check your bookings before trying again.');
    return;
  }
  if (execution.action !== 'book') return resumeChange(turn);

  const lookup = await tools.get_booking_status(execution.key);
  if (lookup.status === 'booked') {
    transition(turn, 'VERIFYING', 'recovered a booking already made');
    finishBooking(turn, lookup.booking_id, false);
    say(turn, 'I was interrupted, so I checked with the provider first. There is only one booking.');
    return;
  }
  if (lookup.status === 'failed') {
    const expired = turn.clock.now() > Date.parse(session.held!.expires_at);
    if (!expired) return slotLost(turn);
    if (!(await holdAgain(turn))) return;
  }
  say(turn, 'I was interrupted before the booking went through, so I am finishing it now.');
  await executeBooking(turn);
}

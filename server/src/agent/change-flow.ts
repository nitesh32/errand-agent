import type { Booking } from '../types.ts';
import { consumeApproval } from './approval.ts';
import { fitsWindow, presentOptions, requestApproval } from './booking-flow.ts';
import { ask } from './collect-flow.ts';
import { addStep, currentApproval, formatSlot, MAX_ATTEMPTS, MAX_OPTIONS, rupees, say, trace, voidCurrent } from './session.ts';
import type { Option, Turn } from './session.ts';
import { transition } from './state-machine.ts';

const RETRY_DELAY_MS = 200;

/** Cancel or reschedule: finds the booking, then the new slot, then asks for approval. */
export async function startChange(turn: Turn): Promise<void> {
  const { session, tools } = turn;
  if (session.targetBooking) return continueChange(turn);

  const service = session.slots.service?.value;
  const upcoming = (await tools.list_bookings()).filter(
    (booking) => booking.status === 'upcoming' && (!service || booking.service === service),
  );

  if (!upcoming.length) {
    transition(turn, 'IDLE', 'no matching booking');
    say(turn, `I can't find an upcoming ${service ? `${service.replace('_', ' ')} ` : ''}booking to change.`);
    return;
  }
  if (upcoming.length === 1) {
    session.targetBooking = upcoming[0];
    return continueChange(turn);
  }
  session.options = upcoming.map((booking, position) => ({
    index: position + 1,
    providerId: booking.provider.id,
    providerName: booking.provider.name,
    rating: 0,
    price: booking.price,
    attributes: [booking.service],
    slots: [booking.slot],
    bookingId: booking.id,
  }));
  presentOptions(turn, 'Which booking?');
}

async function continueChange(turn: Turn): Promise<void> {
  const { session } = turn;
  const booking = session.targetBooking!;
  if (session.kind === 'cancel') {
    return requestApproval(turn, booking.provider.name, {
      action: 'cancel',
      providerId: booking.provider.id,
      slot: booking.slot,
      price: booking.price,
      bookingId: booking.id,
    });
  }
  if (!session.slots.dateRange) return ask(turn, 'dateRange');
  await presentNewSlots(turn, booking);
}

async function presentNewSlots(turn: Turn, booking: Booking): Promise<void> {
  const { session, tools } = turn;
  transition(turn, 'SEARCHING', 'looking for new slots');
  const providers = await tools.search_providers(booking.service, booking.area, session.slots.dateRange!.value);
  const provider = providers.find((item) => item.id === booking.provider.id);
  const free = (provider?.free_slots ?? []).filter((slot) => slot !== booking.slot && fitsWindow(slot, session.slots));

  if (!free.length) {
    delete session.slots.dateRange;
    transition(turn, 'COLLECTING', 'no free slots');
    say(turn, `${booking.provider.name} has nothing free then.`);
    return ask(turn, 'dateRange');
  }
  session.options = free.slice(0, MAX_OPTIONS).map((slot, position) => ({
    index: position + 1,
    providerId: booking.provider.id,
    providerName: booking.provider.name,
    rating: provider!.rating,
    price: booking.price,
    attributes: provider!.attributes,
    slots: [slot],
  }));
  presentOptions(turn, `When should I move ${booking.provider.name} to?`);
}

/** The user chose either which booking to change, or the new slot. */
export async function selectForChange(turn: Turn, option: Option, slot: string): Promise<void> {
  const { session } = turn;
  if (option.bookingId) {
    const bookings = await turn.tools.list_bookings();
    session.targetBooking = bookings.find((booking) => booking.id === option.bookingId);
    session.options = [];
    transition(turn, 'COLLECTING', `chose ${option.bookingId}`);
    return continueChange(turn);
  }
  const booking = session.targetBooking!;
  requestApproval(turn, booking.provider.name, {
    action: 'reschedule',
    providerId: booking.provider.id,
    slot,
    price: booking.price,
    bookingId: booking.id,
  });
}

function isApplied(booking: Booking | undefined, approvalSlot: string, action: string): boolean {
  if (!booking) return false;
  return action === 'cancel' ? booking.status === 'cancelled' : booking.slot === approvalSlot;
}

/** Retries transient failures with the same key, then verifies against the booking list. */
export async function executeChange(turn: Turn): Promise<void> {
  const { session, tools, limits, clock } = turn;
  const execution = session.execution!;
  const approval = currentApproval(session)!;
  const booking = session.targetBooking!;

  while (execution.attempts < MAX_ATTEMPTS && limits.hasToolCalls(2)) {
    transition(turn, 'EXECUTING', `attempt ${execution.attempts + 1}`);
    execution.attempts++;
    turn.save();

    turn.crashPoint('before_change');
    const result =
      approval.action === 'cancel'
        ? await tools.cancel(approval, booking, execution.key)
        : await tools.reschedule(approval, booking, approval.slot, execution.key);
    turn.crashPoint('after_change');

    if (!result.ok && result.error === 'slot_conflict') return slotConflict(turn);
    if (!result.ok) {
      addStep(turn, `${approval.action} with provider`, `${result.error}, retrying with the same key`, 'warn');
      await clock.sleep(RETRY_DELAY_MS);
      continue;
    }
    return verifyChange(turn);
  }

  // One last check, so the message reflects what really happened.
  const confirmed = isApplied((await tools.list_bookings()).find((item) => item.id === booking.id), approval.slot, approval.action);
  if (confirmed) {
    transition(turn, 'VERIFYING', 'applied despite errors');
    return finishChange(turn);
  }
  voidCurrent(turn, 'attempts exhausted');
  transition(turn, 'FAILED', 'attempts exhausted');
  say(turn, `I stopped after ${execution.attempts} attempts because the provider kept failing. Your booking is unchanged: ${booking.provider.name}, ${formatSlot(booking.slot)}.`);
}

async function verifyChange(turn: Turn): Promise<void> {
  const { session, tools } = turn;
  const approval = currentApproval(session)!;
  const booking = session.targetBooking!;
  transition(turn, 'VERIFYING', 'confirming with booking list');
  const current = (await tools.list_bookings()).find((item) => item.id === booking.id);
  if (isApplied(current, approval.slot, approval.action)) return finishChange(turn);
  addStep(turn, 'Verify', 'provider said done but the booking is unchanged', 'warn');
  await executeChange(turn);
}

function finishChange(turn: Turn): void {
  const { session } = turn;
  const approval = currentApproval(session)!;
  const booking = session.targetBooking!;
  consumeApproval(approval);
  trace(turn, 'APPR', { approval: approval.id, status: 'CONSUMED' });
  session.completed = { action: approval.action, bookingId: booking.id };
  addStep(turn, 'Verified', booking.id);
  transition(turn, 'DONE', `${approval.action} verified`);
  turn.cards.push({
    type: 'confirmation',
    action: approval.action,
    bookingId: booking.id,
    providerName: booking.provider.name,
    service: booking.service,
    area: booking.area,
    slot: approval.slot,
    price: approval.price,
    retried: session.execution!.attempts > 1,
    ...(approval.action === 'reschedule' ? { previousSlot: booking.slot, samePrice: approval.price === booking.price } : {}),
  });
  say(
    turn,
    approval.action === 'cancel'
      ? `Cancelled: ${booking.provider.name}, ${formatSlot(booking.slot)} (${booking.id}).`
      : `Moved: ${booking.provider.name} is now ${formatSlot(approval.slot)}, ${rupees(approval.price)} (${booking.id}).`,
  );
}

function slotConflict(turn: Turn): void {
  const { session } = turn;
  const approval = currentApproval(session)!;
  voidCurrent(turn, 'slot conflict');
  delete session.execution;
  session.options = session.options
    .filter((option) => !option.slots.includes(approval.slot))
    .map((option, position) => ({ ...option, index: position + 1 }));
  const note = `${formatSlot(approval.slot)} conflicts on the provider's side, so your booking was not moved.`;
  if (!session.options.length) {
    delete session.slots.dateRange;
    transition(turn, 'COLLECTING', 'slot conflict, no other slots');
    say(turn, note);
    return ask(turn, 'dateRange');
  }
  say(turn, note);
  presentOptions(turn, 'Pick another time:');
}

/** After a restart: if the change already landed, report it; otherwise repeat with the same key. */
export async function resumeChange(turn: Turn): Promise<void> {
  const { session, tools } = turn;
  const approval = currentApproval(session)!;
  const current = (await tools.list_bookings()).find((item) => item.id === session.targetBooking!.id);
  if (isApplied(current, approval.slot, approval.action)) {
    transition(turn, 'VERIFYING', 'recovered a change already made');
    finishChange(turn);
    say(turn, 'I was interrupted, so I checked with the provider first. It only happened once.');
    return;
  }
  say(turn, 'I was interrupted before that went through, so I am finishing it now.');
  await executeChange(turn);
}

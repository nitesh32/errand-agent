import { createHash } from 'node:crypto';

export type ApprovalAction = 'book' | 'cancel' | 'reschedule';
export type ApprovalStatus = 'PENDING' | 'GRANTED' | 'CONSUMED' | 'VOID';

/** The exact action the user is asked to confirm. */
export interface ApprovalTerms {
  action: ApprovalAction;
  providerId: string;
  slot: string;
  price: number;
  bookingId?: string; // set for cancel and reschedule
}

export interface Approval extends ApprovalTerms {
  id: string;
  providerName: string;
  fingerprint: string;
  status: ApprovalStatus;
  grantedBy?: { messageId: string; text: string };
  voidReason?: string;
}

export class ApprovalError extends Error {}

const CONFIRMATION =
  /^(yes|yep|yeah|ok|okay|sure|confirm|confirmed|go ahead)(( please| go ahead| confirm| do it| book it| cancel it| move it)*)$|^(do it|book it|cancel it|move it|confirm booking)( please)?$/;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[.,!]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True only for a plain confirmation. "Yes, but on Saturday" is not one. */
export function isConfirmation(text: string): boolean {
  return CONFIRMATION.test(normalize(text));
}

function fingerprintOf({ action, providerId, slot, price, bookingId }: ApprovalTerms): string {
  const canonical = JSON.stringify([action, providerId, slot, price, bookingId ?? null]);
  return createHash('sha256').update(canonical).digest('hex');
}

export function createApproval(id: string, providerName: string, terms: ApprovalTerms): Approval {
  return { ...terms, id, providerName, fingerprint: fingerprintOf(terms), status: 'PENDING' };
}

/** The only way an approval becomes GRANTED: a user message that is a plain confirmation. */
export function grantApproval(approval: Approval, message: { id: string; text: string }): void {
  if (approval.status !== 'PENDING') throw new ApprovalError(`Approval ${approval.id} is ${approval.status}`);
  if (!isConfirmation(message.text)) throw new ApprovalError('Message is not a plain confirmation');
  approval.status = 'GRANTED';
  approval.grantedBy = { messageId: message.id, text: message.text };
}

export function voidApproval(approval: Approval, reason: string): void {
  if (approval.status === 'CONSUMED') return;
  approval.status = 'VOID';
  approval.voidReason = reason;
}

export function consumeApproval(approval: Approval): void {
  assertGranted(approval);
  approval.status = 'CONSUMED';
}

function assertGranted(approval: Approval): void {
  if (approval.status !== 'GRANTED') throw new ApprovalError(`Approval ${approval.id} is ${approval.status}`);
}

/** Checked before every side effect: granted, untampered, and matching what is about to happen. */
export function assertApproved(approval: Approval | undefined, terms: ApprovalTerms): void {
  if (!approval) throw new ApprovalError('No approval for this action');
  assertGranted(approval);
  if (approval.fingerprint !== fingerprintOf(approval)) throw new ApprovalError(`Approval ${approval.id} was altered`);
  if (approval.fingerprint !== fingerprintOf(terms)) throw new ApprovalError(`Approval ${approval.id} does not match this action`);
}

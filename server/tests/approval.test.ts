import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ApprovalError,
  assertApproved,
  consumeApproval,
  createApproval,
  grantApproval,
  isConfirmation,
  voidApproval,
} from '../src/agent/approval.ts';
import type { ApprovalTerms } from '../src/agent/approval.ts';

const TERMS: ApprovalTerms = { action: 'book', providerId: 'prv_ramesh', slot: '2026-11-04T09:00', price: 1200 };
const YES = { id: 'm_1', text: 'yes' };

const pending = () => createApproval('apr_1', 'Ramesh Plumbing', TERMS);
function granted() {
  const approval = pending();
  grantApproval(approval, YES);
  return approval;
}

test('plain confirmations count', () => {
  for (const text of ['yes', 'Yes.', 'YES!', 'yes, book it', 'Yes book it please', 'ok', 'confirm', 'go ahead', 'book it', 'confirm booking', 'move it', 'cancel it']) {
    assert.ok(isConfirmation(text), text);
  }
});

test('anything else does not count', () => {
  for (const text of ['no', 'yes but on Saturday', 'yes, change it to 10am', 'not yes', "don't book it", 'maybe', 'yesterday', 'book it for Saturday', '', 'cancel it? no']) {
    assert.equal(isConfirmation(text), false, text);
  }
});

test('a pending approval cannot execute', () => {
  assert.throws(() => assertApproved(pending(), TERMS), ApprovalError);
});

test('a missing approval cannot execute', () => {
  assert.throws(() => assertApproved(undefined, TERMS), ApprovalError);
});

test('a granted approval executes and records who granted it', () => {
  const approval = granted();
  assert.doesNotThrow(() => assertApproved(approval, TERMS));
  assert.deepEqual(approval.grantedBy, { messageId: 'm_1', text: 'yes' });
});

test('a non-confirmation message cannot grant', () => {
  const approval = pending();
  assert.throws(() => grantApproval(approval, { id: 'm_1', text: 'yes but Saturday' }), ApprovalError);
  assert.equal(approval.status, 'PENDING');
});

test('any change to provider, slot, price or action is refused', () => {
  const approval = granted();
  const changes: Partial<ApprovalTerms>[] = [
    { providerId: 'prv_aquafix' },
    { slot: '2026-11-04T10:00' },
    { price: 1201 },
    { action: 'cancel' },
    { bookingId: 'bk_1' },
  ];
  for (const change of changes) {
    assert.throws(() => assertApproved(approval, { ...TERMS, ...change }), ApprovalError, JSON.stringify(change));
  }
});

test('editing a saved approval is detected, even when the terms match the edit', () => {
  const approval = granted();
  approval.price = 4999;
  assert.throws(() => assertApproved(approval, { ...TERMS, price: 4999 }), /altered/);
});

test('void and consumed approvals cannot execute or be granted again', () => {
  const voided = pending();
  voidApproval(voided, 'price changed');
  assert.throws(() => grantApproval(voided, YES), ApprovalError);
  assert.equal(voided.voidReason, 'price changed');

  const consumed = granted();
  consumeApproval(consumed);
  assert.throws(() => assertApproved(consumed, TERMS), ApprovalError);
  assert.throws(() => grantApproval(consumed, YES), ApprovalError);
  voidApproval(consumed, 'too late');
  assert.equal(consumed.status, 'CONSUMED');
});

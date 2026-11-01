import { isConfirmation } from '../src/agent/approval.ts';
import { ALLOWED_TRANSITIONS } from '../src/agent/state-machine.ts';
import type { WorkflowState } from '../src/agent/session.ts';
import { DEFAULT_LIMITS } from '../src/tools/limits.ts';
import { RECOVERY_TOOL_CALLS } from './harness.ts';
import type { Harness } from './harness.ts';

/** Returns a description of each violation. These hold after every scenario, whatever it did. */
export function checkInvariants(harness: Harness): string[] {
  return [
    ...noDuplicateBookings(harness),
    ...noEffectWithoutApproval(harness),
    ...approvalsOnlyGrantedByUsers(harness),
    ...noUnverifiedSuccessClaims(harness),
    ...noRetryBeforeStatusCheck(harness),
    ...onlyLegalTransitions(harness),
    ...reviewsNeverReachModel(harness),
    ...limitsHeld(harness),
    ...noSecretsInTraces(harness),
    ...everyTurnReplied(harness),
  ];
}

function noDuplicateBookings({ provider }: Harness): string[] {
  const active = provider.state.bookings.filter((booking) => booking.status === 'upcoming');
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const { provider: { id }, slot } of active) {
    const key = `${id}|${slot}`;
    if (seen.has(key)) problems.push(`duplicate booking ${key}`);
    seen.add(key);
  }
  return problems;
}

/** Audits what the provider really received against approvals a user message granted. */
function noEffectWithoutApproval(harness: Harness): string[] {
  const approved = harness.sessions().flatMap((session) =>
    session.approvals
      .filter(({ status, grantedBy }) => ['GRANTED', 'CONSUMED', 'VOID'].includes(status) && grantedBy)
      .filter(({ grantedBy }) => {
        const message = session.messages.find((item) => item.id === grantedBy!.messageId);
        return message?.role === 'user' && isConfirmation(message.text);
      }),
  );
  return harness.provider.state.effects
    .filter(({ tool, providerId, slot, price }) =>
      !approved.some((item) => item.action === tool && item.providerId === providerId && item.slot === slot && item.price === price),
    )
    .map(({ tool, key }) => `${tool} without a valid approval (${key})`);
}

/** An approval past PENDING must name the confirming user message, even if it never executed. */
function approvalsOnlyGrantedByUsers(harness: Harness): string[] {
  return harness.sessions().flatMap((session) =>
    session.approvals
      .filter(({ status, grantedBy }) => ['GRANTED', 'CONSUMED'].includes(status) && !grantedBy)
      .map(({ id }) => `approval ${id} granted with no user message`),
  );
}

function noUnverifiedSuccessClaims({ replies, provider }: Harness): string[] {
  const problems: string[] = [];
  for (const reply of replies) {
    const claim = reply.match(/^(?:Booked|Cancelled|Moved):.*\((bk_\d+)\)/m);
    if (claim && !provider.state.bookings.some((booking) => booking.id === claim[1])) {
      problems.push(`claimed ${claim[1]}, which does not exist`);
    }
  }
  return problems;
}

/** After a book timeout, the next call about that key must be a status check. */
function noRetryBeforeStatusCheck(harness: Harness): string[] {
  const problems: string[] = [];
  let awaitingCheck = false;
  for (const event of harness.fullTrace().filter((item) => item.type === 'TOOL')) {
    if (event.tool === 'get_booking_status') awaitingCheck = false;
    if (event.tool === 'book') {
      if (awaitingCheck) problems.push('book retried before a status check');
      awaitingCheck = (event.result as { error?: string }).error === 'timeout';
    }
  }
  return problems;
}

function onlyLegalTransitions(harness: Harness): string[] {
  return harness
    .fullTrace()
    .filter((event) => event.type === 'STATE' && event.from)
    .filter((event) => !ALLOWED_TRANSITIONS[event.from as WorkflowState].includes(event.to as WorkflowState))
    .map((event) => `illegal transition ${event.from} to ${event.to}`);
}

function reviewsNeverReachModel({ model }: Harness): string[] {
  return /ignore previous|pre-approved|approval granted|<script/i.test(JSON.stringify(model.inputs))
    ? ['review text reached the model']
    : [];
}

function limitsHeld(harness: Harness): string[] {
  const { maxModelCalls, maxToolCalls } = { ...DEFAULT_LIMITS, ...harness.limits };
  return harness
    .sessions()
    .filter(({ usage }) => usage.modelCalls > maxModelCalls || usage.toolCalls > maxToolCalls + RECOVERY_TOOL_CALLS)
    .map(({ id, usage }) => `limits exceeded in ${id}: ${JSON.stringify(usage)}`);
}

function noSecretsInTraces(harness: Harness): string[] {
  return /sk-[\w-]{8,}|Bearer\s+\S+/.test(JSON.stringify(harness.fullTrace())) ? ['secret found in trace'] : [];
}

/** The last message of each session must be from the assistant and say something. */
function everyTurnReplied(harness: Harness): string[] {
  return harness
    .sessions()
    .filter(({ messages }) => messages.length && (messages.at(-1)!.role !== 'assistant' || !messages.at(-1)!.text))
    .map(({ id }) => `no reply at the end of ${id}`);
}

// The API contract comes from the server's own types, so the two cannot drift.
// These imports are type-only: they are erased at build time and no server code ships.
export type { SessionView } from '../../server/src/agent/agent.ts';
export type { Card, Message, Option, Step, WorkflowState } from '../../server/src/agent/session.ts';
export type { Fact } from '../../server/src/memory/memory.ts';
export type { Booking, TraceEvent } from '../../server/src/types.ts';

export type Panel = 'none' | 'trace' | 'memory' | 'bookings';

export type SendMessage = (text: string, approvalId?: string) => void;

// Provider contract. Names and snake_case fields are fixed by the assignment.

export type ToolResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;
}

export interface Provider {
  id: string;
  name: string;
  service: string;
  price: number;
  rating: number;
  attributes: string[];
  free_slots: string[]; // YYYY-MM-DDTHH:MM, local IST
}

export interface Review {
  id: string;
  rating: number;
  title: string;
  text: string;
}

export type ProviderDetails = Omit<Provider, 'free_slots'> & { reviews: Review[] };

export type BookingStatus = 'upcoming' | 'completed' | 'cancelled';

export interface Booking {
  id: string;
  provider: { id: string; name: string };
  service: string;
  slot: string;
  status: BookingStatus;
  price: number;
  area: string;
}

export interface Hold {
  hold_id: string;
  expires_at: string; // ISO timestamp
  quoted_price: number;
}

export type BookingLookup =
  | { status: 'booked'; booking_id: string }
  | { status: 'not_found' }
  | { status: 'failed' };

// Trace events.

export type TraceType = 'STATE' | 'MODEL' | 'TOOL' | 'APPR' | 'GUARD' | 'INPUT' | 'REPLY' | 'LIMIT' | 'ERROR';

export interface TraceEvent {
  ts: string;
  runId: string;
  type: TraceType;
  [field: string]: unknown;
}

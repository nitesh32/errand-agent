import type { Booking } from './types.ts';

export type AgendaFilter = 'upcoming' | 'past';

export interface AgendaDay {
  date: string;
  label: string;
  bookings: Booking[];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Today by the browser's own calendar. */
export function localDate(now: Date): string {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}

/** "Thu 5 Nov", with a plain word first when the day is close. */
export function dayLabel(date: string, today: string): string {
  const day = new Date(toTime(date));
  const name = `${DAYS[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
  const away = (toTime(date) - toTime(today)) / DAY_MS;
  const word = { [-1]: 'Yesterday', 0: 'Today', 1: 'Tomorrow' }[away];
  return word ? `${word} · ${name}` : name;
}

/** Where an upcoming booking sits against the clock. Status stays the provider's word on what happened. */
export function slotMoment({ slot, status }: Booking, now: Date): 'now' | 'earlier' | null {
  if (status !== 'upcoming') return null;
  const today = localDate(now);
  const date = slot.slice(0, 10);
  const hour = Number(slot.slice(11, 13));
  if (date < today || (date === today && hour < now.getHours())) return 'earlier';
  return date === today && hour === now.getHours() ? 'now' : null;
}

export function splitBookings(bookings: Booking[]): Record<AgendaFilter, Booking[]> {
  return {
    upcoming: bookings.filter(({ status }) => status === 'upcoming'),
    past: bookings.filter(({ status }) => status !== 'upcoming'),
  };
}

/** Bookings by day. Upcoming runs soonest first, and past runs newest first. */
export function agendaDays(bookings: Booking[], filter: AgendaFilter, today: string): AgendaDay[] {
  const direction = filter === 'upcoming' ? 1 : -1;
  const sorted = [...bookings].sort((a, b) => direction * a.slot.slice(0, 10).localeCompare(b.slot.slice(0, 10)) || a.slot.localeCompare(b.slot));
  const days: AgendaDay[] = [];
  for (const booking of sorted) {
    const date = booking.slot.slice(0, 10);
    if (days.at(-1)?.date !== date) days.push({ date, label: dayLabel(date, today), bookings: [] });
    days[days.length - 1].bookings.push(booking);
  }
  return days;
}

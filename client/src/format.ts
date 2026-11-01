import type { Message } from './types.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const SERVICE_NAMES: Record<string, string> = { plumber: 'Plumber', electrician: 'Electrician', ac_service: 'AC servicing', cleaning: 'Cleaning' };

/** A chat is named after its first real message. Slash commands do not name a chat. */
export const chatTitle = (messages: Message[]) => messages.find(({ role, text }) => role === 'user' && !text.startsWith('/'))?.text;

const parseDate = (date: string) => new Date(`${date}T00:00:00Z`);

/** "2026-11-04T09:00" becomes "Wed 4 Nov · 09:00". */
export function formatSlot(slot: string): string {
  const [date, time] = slot.split('T');
  const value = parseDate(date);
  return `${DAYS[value.getUTCDay()]} ${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]} · ${time}`;
}

/** "2026-11-04T09:00" becomes ["Wed 4 Nov", "09:00 – 10:00"]. Slots are one hour long. */
export function slotParts(slot: string): [string, string] {
  const [date, time] = formatSlot(slot).split(' · ');
  const nextHour = String((Number(time.slice(0, 2)) + 1) % 24).padStart(2, '0');
  return [date, `${time} – ${nextHour}${time.slice(2)}`];
}

/** The message that picks an exact slot. The server reads it like any typed reply. */
export function slotMessage(index: number, slot: string): string {
  const [date, time] = slot.split('T');
  const value = parseDate(date);
  return `${index} on ${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]} at ${time}`;
}

/** Local time with milliseconds, matching what the rest of the page shows. */
export function formatTraceTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

export const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

export const RECENT_GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const;

/** Which sidebar group a chat belongs to, by the local day of its last message. */
export function recentGroup(timestamp: string | null | undefined, now: Date): (typeof RECENT_GROUPS)[number] {
  if (!timestamp) return 'Older';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDaysAgo = (days: number) => new Date(startOfToday.getFullYear(), startOfToday.getMonth(), startOfToday.getDate() - days);
  const time = new Date(timestamp);
  if (time >= startOfToday) return 'Today';
  if (time >= startOfDaysAgo(1)) return 'Yesterday';
  return time >= startOfDaysAgo(7) ? 'Previous 7 days' : 'Older';
}

/** "Oct 1", with the year only when it is not the current one. */
export function formatChatDate(timestamp: string, now: Date): string {
  const time = new Date(timestamp);
  const date = `${MONTHS[time.getMonth()]} ${time.getDate()}`;
  return time.getFullYear() === now.getFullYear() ? date : `${date}, ${time.getFullYear()}`;
}

export function factLabel(key: string): string {
  if (key === 'area') return 'Area';
  if (key === 'earliest_time') return 'Earliest time';
  return `Preferred ${key.replace('technician:', '').replace('_', ' ')}`;
}

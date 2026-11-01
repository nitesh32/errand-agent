const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const parseDate = (date: string) => new Date(`${date}T00:00:00Z`);

/** "2026-11-04T09:00" becomes "Wed 4 Nov · 09:00". */
export function formatSlot(slot: string): string {
  const [date, time] = slot.split('T');
  const value = parseDate(date);
  return `${DAYS[value.getUTCDay()]} ${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]} · ${time}`;
}

/** The message that picks an exact slot. The server reads it like any typed reply. */
export function slotMessage(index: number, slot: string): string {
  const [date, time] = slot.split('T');
  const value = parseDate(date);
  return `${index} on ${value.getUTCDate()} ${MONTHS[value.getUTCMonth()]} at ${time}`;
}

export function formatDateRange({ from, to }: { from: string; to: string }): string {
  const start = parseDate(from);
  const end = parseDate(to);
  const startDay = `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`;
  return from === to ? startDay : `${startDay} – ${end.getUTCDate()} ${MONTHS[end.getUTCMonth()]}`;
}

/** Local time with milliseconds, matching what the rest of the page shows. */
export function formatTraceTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
}

export const rupees = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

export function factLabel(key: string): string {
  if (key === 'area') return 'Area';
  if (key === 'earliest_time') return 'Earliest time';
  return `Preferred ${key.replace('technician:', '').replace('_', ' ')}`;
}

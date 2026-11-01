import { addDays } from '../infra/clock.ts';
import type { Intent, MemoryProposal, Model, ModelInput, ModelOutput, Proposal, Selection, SlotProposal } from './model.ts';

const SERVICE_WORDS: [RegExp, string][] = [
  [/\b(plumb\w*|tap|taps|leak\w*|pipes?)\b/, 'plumber'],
  [/\b(electric\w*|wiring)\b/, 'electrician'],
  [/\b(ac|a\.c\.|air.?condition\w*)\b/, 'ac_service'],
  [/\b(clean\w*|maid)\b/, 'cleaning'],
];
const AREAS = ['Powai', 'Andheri', 'Bandra', 'Juhu', 'Thane', 'Goregaon', 'Colaba', 'Worli'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];
const NOT_PLACES = new Set([...WEEKDAYS, ...MONTHS, 'the', 'my', 'morning', 'mornings', 'afternoon', 'evening']);

const CLOCK_TIME = String.raw`(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?`;

function toTime(hourText: string, minutes: string | undefined, meridiem: string | undefined): string {
  let hour = Number(hourText);
  const isPm = meridiem?.toLowerCase().startsWith('p');
  if (isPm && hour < 12) hour += 12;
  else if (meridiem && !isPm && hour === 12) hour = 0;
  else if (!meridiem && hour >= 1 && hour <= 7) hour += 12; // nobody books a plumber for 3 a.m.
  return `${String(hour).padStart(2, '0')}:${minutes ?? '00'}`;
}

function parseAmount(text: string): number {
  const digits = text.toLowerCase().replace(/,/g, '');
  return digits.endsWith('k') ? Number(digits.slice(0, -1)) * 1000 : Number(digits);
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function parseDates(lower: string, today: string): Pick<SlotProposal, 'dateFrom' | 'dateTo'> {
  const day = (date: string) => ({ dateFrom: date, dateTo: date });
  const daysToSunday = (7 - weekdayOf(today)) % 7;

  if (/\btoday\b/.test(lower)) return day(today);
  if (/\btomorrow\b/.test(lower)) return day(addDays(today, 1));
  if (/\bnext week\b/.test(lower)) return { dateFrom: addDays(today, daysToSunday + 1), dateTo: addDays(today, daysToSunday + 7) };
  // On a Sunday, "this week" would otherwise mean only what is left of today.
  if (/\b(this )?week\b/.test(lower)) return { dateFrom: today, dateTo: addDays(today, daysToSunday || 7) };
  if (/\bweekend\b/.test(lower)) {
    const saturday = addDays(today, (6 - weekdayOf(today) + 7) % 7);
    return { dateFrom: saturday, dateTo: addDays(saturday, 1) };
  }
  if (/\b(any ?time|any ?day|whenever)\b/.test(lower)) return { dateFrom: today, dateTo: addDays(today, 7) };

  const named = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}s?\\b`).test(lower));
  if (named >= 0) return day(addDays(today, (named - weekdayOf(today) + 7) % 7 || 7));

  const dated = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  if (dated) {
    const month = String(MONTHS.indexOf(dated[2]) + 1).padStart(2, '0');
    const year = today.slice(0, 4);
    const date = `${year}-${month}-${dated[1].padStart(2, '0')}`;
    return day(date < today ? `${Number(year) + 1}${date.slice(4)}` : date);
  }
  return {};
}

function parseTimes(lower: string): Pick<SlotProposal, 'earliest' | 'latest'> {
  const times: Pick<SlotProposal, 'earliest' | 'latest'> = {};
  if (/\bmornings?\b/.test(lower)) times.latest = '12:00';
  if (/\bafternoons?\b/.test(lower)) Object.assign(times, { earliest: '12:00', latest: '17:00' });
  if (/\bevenings?\b/.test(lower)) Object.assign(times, { earliest: '17:00', latest: '21:00' });

  const notBefore = new RegExp(String.raw`\b(?:not before|no earlier than|after|from)\s+${CLOCK_TIME}`);
  const earliest = lower.match(notBefore);
  if (earliest) times.earliest = toTime(earliest[1], earliest[2], earliest[3]);

  const withoutEarliest = earliest ? lower.replace(earliest[0], '') : lower;
  const latest = withoutEarliest.match(new RegExp(String.raw`\b(?:before|by|until)\s+${CLOCK_TIME}`));
  if (latest) times.latest = toTime(latest[1], latest[2], latest[3]);
  return times;
}

function parseBudget(text: string, input: ModelInput): number | undefined {
  const amount = String.raw`(\d[\d,]*(?:\.\d+)?k?)`;
  const match =
    text.match(new RegExp(String.raw`\b(?:under|below|less than|max(?:imum)?|up ?to|within|budget(?: of| is)?)\s*(?:₹|rs\.?\s*|inr\s*)?${amount}`, 'i')) ??
    text.match(new RegExp(String.raw`(?:₹|\brs\.?\s*|\binr\s*)${amount}`, 'i')) ??
    (input.awaiting === 'budget' ? text.match(new RegExp(String.raw`^\s*${amount}\s*$`, 'i')) : null);
  return match ? parseAmount(match[1]) : undefined;
}

function parseArea(text: string, input: ModelInput): string | undefined {
  const known = AREAS.find((area) => new RegExp(`\\b${area}\\b`, 'i').test(text));
  if (known) return known;
  const named = text.match(/\b(?:in|at)\s+([A-Z][a-z]+)\b/);
  if (named && !NOT_PLACES.has(named[1].toLowerCase())) return named[1];
  const bare = text.trim().replace(/[.!]$/, '');
  if (input.awaiting === 'area' && /^[a-z][a-z ]{1,30}$/i.test(bare) && bare.split(' ').length <= 3) {
    return bare.replace(/\b[a-z]/g, (char) => char.toUpperCase());
  }
  return undefined;
}

function parseSlots(text: string, input: ModelInput): SlotProposal {
  const lower = text.toLowerCase();
  const slots: SlotProposal = { ...parseDates(lower, input.today), ...parseTimes(lower) };
  const service = SERVICE_WORDS.find(([pattern]) => pattern.test(lower))?.[1];
  if (service) slots.service = service;
  const area = parseArea(text, input);
  if (area) slots.area = area;
  const budget = parseBudget(text, input);
  if (budget) slots.budget = budget;
  if (/\b(no (budget|limit)|any (price|budget)|price (doesn'?t|does not) matter)\b/.test(lower)) slots.noBudget = true;
  if (/\b(same .*(last|before)|last time|usual|again)\b/.test(lower) && service) slots.sameAsLast = true;
  const notes = text.match(/\bfor (?:my|the) ([\w ]+?)(?= this| next| in | at |,|\.|$)/i);
  if (notes) slots.notes = notes[1];
  return slots;
}

const AREA_KEY = /\b(area|location|address|where i live)\b/;
const TIME_KEY = /\b(earliest|time|timing)\b/;

function parseForgetKey(subject: string): string | undefined {
  if (/\b(everything|all)\b/.test(subject)) return 'all';
  if (AREA_KEY.test(subject)) return 'area';
  if (TIME_KEY.test(subject)) return 'earliest_time';
  const service = SERVICE_WORDS.find(([pattern]) => pattern.test(subject))?.[1];
  return service ? `technician:${service}` : undefined;
}

function parseMemory(text: string): MemoryProposal | undefined {
  const lower = text.toLowerCase();
  if (/\b(what do you (remember|know)|(show|view|see) (my )?(memory|preferences)|^my preferences)\b/.test(lower)) return { op: 'view' };

  const forget = lower.match(/\bforget\b(.*)$/);
  if (forget) return { op: 'forget', key: parseForgetKey(forget[1]) };

  const area = text.match(/\b(?:i live in|my area is(?: now)?|change my area to|remember (?:that )?my area is)\s+([A-Za-z]+)/i);
  if (area) return { op: 'set', key: 'area', value: area[1][0].toUpperCase() + area[1].slice(1).toLowerCase(), evidence: area[0] };

  const earliest = text.match(new RegExp(String.raw`\b(?:always|from now on|remember)\b.*?\b(?:not before|no earlier than|after|from)\s+${CLOCK_TIME}`, 'i'));
  if (earliest) return { op: 'set', key: 'earliest_time', value: toTime(earliest[1], earliest[2], earliest[3]), evidence: earliest[0] };

  const technician = text.match(/\bmy (?:preferred|usual) (plumber|electrician|ac|cleaner) is\s+([A-Za-z]+)/i);
  if (technician) {
    const service = SERVICE_WORDS.find(([pattern]) => pattern.test(technician[1].toLowerCase()))?.[1];
    return { op: 'set', key: `technician:${service}`, value: technician[2], evidence: technician[0] };
  }
  return undefined;
}

function parseSelection(text: string, input: ModelInput): Selection | undefined {
  if (!input.options.length) return undefined;
  const lower = text.toLowerCase();
  const selection: Selection = {};

  const numbered = lower.match(/^\s*(?:option\s*)?(\d)\b|\boption\s*(\d)\b/);
  if (numbered) selection.index = Number(numbered[1] ?? numbered[2]);
  const ordinal = ORDINALS.findIndex((word) => new RegExp(`\\b${word}\\b`).test(lower));
  if (selection.index === undefined && ordinal >= 0) selection.index = ordinal + 1;

  const named = input.options.find((option) => {
    const firstWord = option.providerName.split(/\s+/)[0].toLowerCase();
    return new RegExp(`\\b${firstWord}\\b`).test(lower);
  });
  if (named) selection.providerQuery = named.providerName;

  const time = lower.match(new RegExp(String.raw`\bat\s+${CLOCK_TIME}`));
  if (time) {
    const hour = toTime(time[1], time[2], time[3]);
    const { dateFrom, dateTo } = parseDates(lower, input.today);
    selection.time = dateFrom && dateFrom === dateTo ? `${dateFrom}T${hour}` : hour;
  }

  return selection.index === undefined && !selection.providerQuery ? undefined : selection;
}

const DECLINE = /^\s*(no|nope|nah|not now|change|skip|something else|someone else|never ?mind|stop|don'?t)\b/i;

function hasSearchSlots({ notes: _notes, sameAsLast: _same, ...rest }: SlotProposal): boolean {
  return Object.keys(rest).length > 0;
}

/** Deterministic and offline: the default model, and the base of the eval script. */
export class RuleModel implements Model {
  readonly name = 'rules';

  async interpret(input: ModelInput): Promise<ModelOutput> {
    return { proposal: this.parse(input) };
  }

  private parse(input: ModelInput): Proposal {
    const { text } = input;
    const lower = text.toLowerCase();
    const slots = parseSlots(text, input);
    const selection = parseSelection(text, input);
    const memory = parseMemory(text);
    const result = (intent: Intent): Proposal => ({ intent, slots, ...(selection ? { selection } : {}), ...(memory ? { memory } : {}) });

    if (memory?.op === 'view' || memory?.op === 'forget') return { intent: 'memory', slots: {}, memory };
    if (/\b((show|list|see)\b.*\bbookings|my bookings|what.*booked)\b/.test(lower)) return { intent: 'bookings', slots: {} };
    if (/\b(reviews?|what do (people|they) say|what.*people say)\b/.test(lower)) return result('reviews');
    if (/\bcancel\b/.test(lower) && !/^\s*(don'?t|do not)\b/.test(lower)) return result('cancel');
    if (/\b(move|reschedule|postpone|shift)\b/.test(lower)) return result('reschedule');
    if (selection && !/\b(book|find|need)\b.*\b(plumber|electrician|ac|clean)/.test(lower)) return result('select');
    if (DECLINE.test(text) && !hasSearchSlots(slots)) return result('decline');
    if (/\b(book|find|need|get me|looking for|hire)\b/.test(lower) || (slots.service && !input.awaiting && input.state === 'IDLE')) return result('book');
    if (hasSearchSlots(slots) || slots.notes) return result('provide');
    return result(memory ? 'memory' : 'none');
  }
}

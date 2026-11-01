import { chatTitle } from './format.ts';
import type { SessionView } from './types.ts';

// Browser storage holds conveniences only, so failing to reach it must not break the page.
export function readStorage<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing depends on this succeeding.
  }
}

export interface RecentSession {
  id: string;
  title: string;
  lastMessageAt?: string | null; // absent on entries saved before times were recorded
}

const RECENT_KEY = 'errand.recent';
const MAX_RECENT = 50;

export const readRecent = () => readStorage<RecentSession[]>(RECENT_KEY, []);

const newestFirst = (a: RecentSession, b: RecentSession) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '');

/**
 * Records a session once it has a first message to name it by. The order comes only from
 * the last message time, so opening a chat never moves it.
 */
export function rememberSession({ id, messages, lastMessageAt }: SessionView): RecentSession[] {
  const recent = readRecent();
  const title = chatTitle(messages);
  if (!title) return recent;
  const existing = recent.find((item) => item.id === id);
  const entry = { id, title, lastMessageAt: lastMessageAt ?? existing?.lastMessageAt };
  const merged = existing ? recent.map((item) => (item === existing ? entry : item)) : [entry, ...recent];
  const updated = merged.sort(newestFirst).slice(0, MAX_RECENT);
  writeStorage(RECENT_KEY, updated);
  return updated;
}

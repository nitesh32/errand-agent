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
}

const RECENT_KEY = 'errand.recent';
const MAX_RECENT = 6;

export const readRecent = () => readStorage<RecentSession[]>(RECENT_KEY, []);

/** Adds a session once it has a first message to name it by. */
export function rememberSession({ id, messages }: SessionView): RecentSession[] {
  const recent = readRecent();
  const title = messages.find((message) => message.role === 'user')?.text;
  if (!title) return recent;
  const updated = [{ id, title }, ...recent.filter((item) => item.id !== id)].slice(0, MAX_RECENT);
  writeStorage(RECENT_KEY, updated);
  return updated;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Time moves only when told to, so tests and evals are reproducible. */
export class FakeClock implements Clock {
  private current: number;

  constructor(start: string) {
    this.current = Date.parse(start);
  }

  now(): number {
    return this.current;
  }

  async sleep(ms: number): Promise<void> {
    this.advance(ms);
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Local IST time as YYYY-MM-DDTHH:MM, the format slots use. */
export function localDateTime(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 16);
}

export function localDate(ms: number): string {
  return localDateTime(ms).slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

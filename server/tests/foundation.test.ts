import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addDays, FakeClock, localDate, localDateTime } from '../src/infra/clock.ts';
import { FileStore } from '../src/infra/file-store.ts';
import { redact, Tracer } from '../src/infra/tracer.ts';

const tempDir = () => mkdtempSync(join(tmpdir(), 'errand-'));

test('clock reports IST and date arithmetic crosses months', () => {
  assert.equal(localDateTime(Date.parse('2026-11-02T03:30:00Z')), '2026-11-02T09:00');
  assert.equal(localDate(Date.parse('2026-11-01T19:00:00Z')), '2026-11-02');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});

test('file store round-trips and leaves no temp files', () => {
  const dir = tempDir();
  const store = new FileStore(dir);
  store.write('sessions', 's1', { state: 'DONE' });
  assert.deepEqual(store.read('sessions', 's1'), { state: 'DONE' });
  assert.equal(store.read('sessions', 'missing'), undefined);
  assert.deepEqual(readdirSync(join(dir, 'sessions')), ['s1.json']);
});

test('file store rejects path traversal', () => {
  const store = new FileStore(tempDir());
  assert.throws(() => store.read('sessions', '../../etc/passwd'), /Unsafe/);
});

test('redact hides secrets but keeps idempotency keys and token counts', () => {
  const result = redact({
    apiKey: 'abc',
    authorization: 'abc',
    note: 'used sk-or-1234567890 and Bearer abc.def',
    idempotency_key: 'idem_1',
    input_tokens: 12,
    nested: [{ password: 'abc' }],
  });
  assert.deepEqual(result, {
    apiKey: '[redacted]',
    authorization: '[redacted]',
    note: 'used [redacted] and [redacted]',
    idempotency_key: 'idem_1',
    input_tokens: 12,
    nested: [{ password: '[redacted]' }],
  });
});

test('tracer appends one redacted JSON line per event', () => {
  const tracer = new Tracer(tempDir(), new FakeClock('2026-11-02T03:30:00Z'));
  tracer.log('run_1', 'TOOL', { tool: 'book', api_key: 'sk-or-1234567890' });
  tracer.log('run_1', 'STATE', { from: 'A', to: 'B' });

  const events = tracer.read('run_1');
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'TOOL');
  assert.equal(events[0].ts, '2026-11-02T03:30:00.000Z');
  assert.doesNotMatch(readFileSync(tracer.fileOf('run_1'), 'utf8'), /sk-or/);
  assert.deepEqual(tracer.read('run_missing'), []);
});

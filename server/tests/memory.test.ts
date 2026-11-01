import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FakeClock } from '../src/infra/clock.ts';
import { FileStore } from '../src/infra/file-store.ts';
import { Memory } from '../src/memory/memory.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'errand-'));
  const clock = new FakeClock('2026-11-02T03:30:00Z');
  const open = () => new Memory(new FileStore(dir), 'u_demo', clock);
  return { dir, open, memory: open() };
}

test('stated facts persist across instances and are usable', () => {
  const { memory, open } = setup();
  memory.state('area', 'Powai');
  const fact = open().get('area');
  assert.equal(fact?.value, 'Powai');
  assert.equal(fact?.source, 'stated');
});

test('correcting a fact keeps the previous value for display', () => {
  const { memory } = setup();
  memory.state('earliest_time', '09:00');
  memory.state('earliest_time', '10:00');
  assert.equal(memory.get('earliest_time')?.value, '10:00');
  assert.equal(memory.get('earliest_time')?.previous, '09:00');
});

test('inferred facts are not usable until confirmed', () => {
  const { memory } = setup();
  memory.infer('technician:electrician', 'prv_suresh', 'Suresh');
  assert.equal(memory.get('technician:electrician'), undefined);
  assert.equal(memory.pending('technician:electrician')?.label, 'Suresh');

  memory.confirm('technician:electrician');
  const fact = memory.get('technician:electrician');
  assert.equal(fact?.source, 'inferred');
  assert.equal(fact?.confirmed, true);
  assert.equal(memory.pending('technician:electrician'), undefined);
});

test('an inference does not override a settled fact', () => {
  const { memory } = setup();
  memory.state('area', 'Powai');
  memory.infer('area', 'Bandra');
  assert.equal(memory.get('area')?.value, 'Powai');
});

test('list shows unconfirmed facts for the user to review', () => {
  const { memory } = setup();
  memory.state('area', 'Powai');
  memory.infer('technician:plumber', 'prv_ramesh', 'Ramesh');
  assert.deepEqual(memory.list().facts.map((fact) => [fact.key, fact.source, fact.confirmed]), [
    ['area', 'stated', true],
    ['technician:plumber', 'inferred', false],
  ]);
});

test('a forgotten fact is gone and cannot be inferred back', () => {
  const { memory, open } = setup();
  memory.state('area', 'Powai');
  memory.forget('area');
  assert.equal(memory.get('area'), undefined);

  memory.infer('area', 'powai');
  assert.equal(open().get('area'), undefined);
  assert.equal(open().pending('area'), undefined);
  assert.deepEqual(open().list().forgottenKeys, ['area']);
});

test('forgotten values are not left on disk in plain text', () => {
  const { dir, memory } = setup();
  memory.state('area', 'Powai');
  memory.forget('area');
  assert.doesNotMatch(readFileSync(join(dir, 'memory', 'u_demo.json'), 'utf8'), /powai/i);
});

test('forget can block values never saved, such as a provider from booking history', () => {
  const { memory } = setup();
  memory.forget('technician:ac_service', ['prv_coolair']);
  assert.ok(memory.isForgotten('technician:ac_service', 'prv_coolair'));
  memory.infer('technician:ac_service', 'prv_coolair', 'CoolAir');
  assert.equal(memory.pending('technician:ac_service'), undefined);

  memory.infer('technician:ac_service', 'prv_arctic', 'Arctic');
  assert.equal(memory.pending('technician:ac_service')?.value, 'prv_arctic');
});

test('stating a forgotten value again brings it back', () => {
  const { memory } = setup();
  memory.state('area', 'Powai');
  memory.forget('area');
  memory.state('area', 'Powai');
  assert.equal(memory.get('area')?.value, 'Powai');
  assert.deepEqual(memory.list().forgottenKeys, []);
});

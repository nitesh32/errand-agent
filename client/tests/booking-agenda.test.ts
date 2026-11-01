import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agendaDays, dayLabel, localDate, slotMoment, splitBookings } from '../src/booking-agenda.ts';
import type { Booking } from '../src/types.ts';

function booking(id: string, slot: string, status: Booking['status'] = 'upcoming'): Booking {
  return { id, slot, status, provider: { id: 'prv', name: 'TapRight' }, service: 'plumber', price: 1000, area: 'Powai' };
}

test('today and its neighbours use plain words, across a month end', () => {
  assert.equal(dayLabel('2026-11-30', '2026-11-30'), 'Today · Mon 30 Nov');
  assert.equal(dayLabel('2026-12-01', '2026-11-30'), 'Tomorrow · Tue 1 Dec');
  assert.equal(dayLabel('2026-11-29', '2026-11-30'), 'Yesterday · Sun 29 Nov');
  assert.equal(dayLabel('2026-12-05', '2026-11-30'), 'Sat 5 Dec');
});

test('upcoming and past follow status, not the date', () => {
  const { upcoming, past } = splitBookings([booking('a', '2026-11-05T09:00'), booking('b', '2026-11-06T09:00', 'cancelled'), booking('c', '2026-10-01T09:00', 'completed')]);
  assert.deepEqual(upcoming.map(({ id }) => id), ['a']);
  assert.deepEqual(past.map(({ id }) => id).sort(), ['b', 'c']);
});

test('upcoming days run soonest first, with each day in time order', () => {
  const days = agendaDays([booking('late', '2026-11-05T15:00'), booking('next', '2026-11-07T09:00'), booking('early', '2026-11-05T09:00')], 'upcoming', '2026-11-02');
  assert.deepEqual(days.map(({ date }) => date), ['2026-11-05', '2026-11-07']);
  assert.deepEqual(days[0].bookings.map(({ id }) => id), ['early', 'late']);
  assert.equal(days[0].label, 'Thu 5 Nov');
});

test('past days run newest first', () => {
  const days = agendaDays([booking('old', '2026-09-01T09:00', 'completed'), booking('recent', '2026-10-01T09:00', 'completed')], 'past', '2026-11-02');
  assert.deepEqual(days.map(({ date }) => date), ['2026-10-01', '2026-09-01']);
});

test('the local date is the browser calendar day', () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 30)), '2026-01-05');
});

test('only the hour in progress today is now, and an earlier slot is only earlier', () => {
  const now = new Date(2026, 10, 2, 9, 30);
  assert.equal(slotMoment(booking('a', '2026-11-02T09:00'), now), 'now');
  assert.equal(slotMoment(booking('b', '2026-11-02T08:00'), now), 'earlier');
  assert.equal(slotMoment(booking('c', '2026-11-02T10:00'), now), null);
  assert.equal(slotMoment(booking('d', '2026-11-03T09:00'), now), null);
  assert.equal(slotMoment(booking('e', '2026-11-01T09:00'), now), 'earlier');
  assert.equal(slotMoment(booking('f', '2026-11-02T09:00', 'cancelled'), now), null);
  assert.equal(slotMoment(booking('g', '2026-11-02T08:00', 'completed'), now), null);
});

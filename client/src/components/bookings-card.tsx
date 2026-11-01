import { useState } from 'react';
import { formatSlot, rupees, SERVICE_NAMES } from '../format.ts';
import type { Booking } from '../types.ts';

type Filter = 'all' | Booking['status'];

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

/** Upcoming first with the soonest on top, then everything else with the newest on top. */
function sortBookings(bookings: Booking[]): Booking[] {
  return [...bookings].sort((a, b) => {
    const aUpcoming = a.status === 'upcoming';
    if (aUpcoming !== (b.status === 'upcoming')) return aUpcoming ? -1 : 1;
    return aUpcoming ? a.slot.localeCompare(b.slot) : b.slot.localeCompare(a.slot);
  });
}

export function BookingsCard({ bookings }: { bookings: Booking[] }) {
  const [filter, setFilter] = useState<Filter>('all');
  if (!bookings.length) return null;

  const countOf = (key: Filter) => (key === 'all' ? bookings.length : bookings.filter((booking) => booking.status === key).length);
  // A status can empty out later, such as the last upcoming booking being cancelled.
  const active = countOf(filter) ? filter : 'all';
  const rows = sortBookings(bookings).filter((booking) => active === 'all' || booking.status === active);

  return (
    <div className="card bookings-card">
      <div className="filter-chips" role="group" aria-label="Filter bookings by status">
        {FILTERS.filter(({ key }) => countOf(key)).map(({ key, label }) => (
          <button type="button" key={key} className="filter-chip" aria-pressed={key === active} onClick={() => setFilter(key)}>
            {key !== 'all' && <span className={`dot dot-${key}`} />}
            {label}
            <span className="mono filter-count">{countOf(key)}</span>
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table className="bookings-table">
          <thead>
            <tr><th>Provider</th><th>When</th><th className="align-right">Price</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((booking) => (
              <tr key={booking.id} className="booking-row">
                <td>
                  <div className="strong">{booking.provider.name}</div>
                  <div className="small muted">{SERVICE_NAMES[booking.service] ?? booking.service} · <span className="mono">{booking.id}</span></div>
                </td>
                <td className="mono small nowrap">{formatSlot(booking.slot)}</td>
                <td className="mono small align-right">{rupees(booking.price)}</td>
                <td><span className={`tag tag-${booking.status}`}>{booking.status.toUpperCase()}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

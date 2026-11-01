import { useState } from 'react';
import { agendaDays, localDate, slotMoment, splitBookings } from '../booking-agenda.ts';
import type { AgendaFilter } from '../booking-agenda.ts';
import { rupees, SERVICE_NAMES, slotParts } from '../format.ts';
import type { Booking } from '../types.ts';

const FILTERS: { key: AgendaFilter; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
];

interface AgendaRowProps {
  booking: Booking;
  open: boolean;
  onToggle: () => void;
  onAct: (text: string) => void;
  pending: boolean;
}

const STATUS_WORDS: Partial<Record<Booking['status'], string>> = { completed: 'Done', cancelled: 'Cancelled' };

function AgendaRow({ booking, open, onToggle, onAct, pending }: AgendaRowProps) {
  const name = SERVICE_NAMES[booking.service] ?? booking.service;
  const time = slotParts(booking.slot)[1];
  const moment = slotMoment(booking, new Date());
  const status = moment === 'earlier' ? 'Earlier' : STATUS_WORDS[booking.status];
  const quiet = status ? ' agenda-quiet' : '';
  const cancelled = booking.status === 'cancelled' ? ' agenda-cancelled' : '';
  return (
    <div className={`agenda-item${quiet}${cancelled}`}>
      <button type="button" className="agenda-row" aria-expanded={open} onClick={onToggle}>
        <span className={moment === 'now' ? 'mono agenda-time agenda-time-now' : 'mono agenda-time'}>{time.slice(0, 5)}</span>
        <span className="agenda-name"><span className="strong">{booking.provider.name}</span><span className="muted">{name}</span></span>
        {moment === 'now' && <span className="agenda-now">Now</span>}
        <span className="mono small agenda-end">{status ?? rupees(booking.price)}</span>
      </button>
      {open && (
        <div className="agenda-more">
          <div className="small muted">{time} · {rupees(booking.price)} · {booking.area} · <span className="mono">{booking.id}</span></div>
          {booking.status === 'upcoming' && (
            <span className="button-row">
              <button type="button" className="btn" disabled={pending} onClick={() => onAct(`Move my ${name.toLowerCase()}`)}>Reschedule</button>
              <button type="button" className="btn" disabled={pending} onClick={() => onAct(`Cancel my ${name.toLowerCase()}`)}>Cancel</button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Bookings by day. The buttons only send a request to the chat, where the normal approval
 * happens, so nothing here can change a booking by itself.
 */
export function BookingsAgenda({ bookings, onAct, pending }: { bookings: Booking[]; onAct: (text: string) => void; pending: boolean }) {
  const [filter, setFilter] = useState<AgendaFilter>('upcoming');
  const [openId, setOpenId] = useState<string | null>(null);
  const groups = splitBookings(bookings);
  const days = agendaDays(groups[filter], filter, localDate(new Date()));
  return (
    <div className="card agenda-card">
      <div className="agenda-head">
        <span className="card-title">My bookings</span>
        <span className="filter-chips trace-view" role="group" aria-label="Filter bookings">
          {FILTERS.map(({ key, label }) => (
            <button type="button" key={key} className="filter-chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
              <span className="mono filter-count">{groups[key].length}</span>
            </button>
          ))}
        </span>
      </div>
      <div className="agenda">
        {!days.length && <p className="panel-empty">{filter === 'upcoming' ? 'Nothing coming up. Ask me to book something.' : 'No past bookings yet.'}</p>}
        {days.map(({ date, label, bookings: dayBookings }) => (
          <section key={date}>
            <h3 className="small muted agenda-day">{label}</h3>
            {dayBookings.map((booking) => (
              <AgendaRow key={booking.id} booking={booking} open={openId === booking.id} onToggle={() => setOpenId(openId === booking.id ? null : booking.id)} onAct={onAct} pending={pending} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

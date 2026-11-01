import { ArrowRight, Check, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatSlot, rupees, SERVICE_NAMES, slotParts } from '../format.ts';
import type { Booking, Card, SendMessage } from '../types.ts';

type ConfirmationCardProps = Extract<Card, { type: 'confirmation' }> & { bookings: Booking[]; send: SendMessage; pending: boolean };

const HEADERS: Record<ConfirmationCardProps['action'], { title: string; Icon: LucideIcon }> = {
  book: { title: 'Booking confirmed', Icon: Check },
  reschedule: { title: 'Booking moved', Icon: ArrowRight },
  cancel: { title: 'Booking cancelled', Icon: X },
};

/** Reads the current list, so an old card says so when its booking has since changed. */
function laterChange({ action, bookingId, slot, bookings }: ConfirmationCardProps): string | null {
  const current = bookings.find((booking) => booking.id === bookingId);
  if (action === 'cancel' || !current) return null;
  if (current.status === 'cancelled') return 'Since cancelled';
  return current.slot === slot ? null : 'Since moved';
}

function Fact({ label, children, detail }: { label: string; children: ReactNode; detail?: string }) {
  return (
    <div className="receipt-fact">
      <span className="label">{label}</span>
      <span className="strong">{children}</span>
      {detail && <span className="small muted">{detail}</span>}
    </div>
  );
}

function trustLine({ action, price, retried, samePrice }: ConfirmationCardProps): string {
  if (retried) return 'Retried safely with the same key · confirmed with provider';
  if (action === 'book') return 'Confirmed with provider · booked once';
  if (action === 'cancel') return 'Confirmed with provider';
  return `${samePrice ? 'Same price' : 'New price'} · ${rupees(price)} · confirmed with provider`;
}

/** Sent only after the provider verified the action. Its buttons only ask, so approval still applies. */
export function ConfirmationCard(props: ConfirmationCardProps) {
  const { action, bookingId, providerName, service, area, slot, previousSlot, price, note, send, pending } = props;
  const { title, Icon } = HEADERS[action];
  const changed = laterChange(props);
  const serviceName = SERVICE_NAMES[service] ?? service;
  const [date, time] = slotParts(slot);
  return (
    <div className={`card receipt receipt-${action}`}>
      <div className="receipt-head">
        <span className="receipt-mark"><Icon size={20} /></span>
        <div className="receipt-heading">
          <div className="receipt-status">{title}</div>
          <h3 className="receipt-title">{providerName} · {serviceName}</h3>
        </div>
        <span className="chip mono">{changed ?? bookingId}</span>
      </div>
      {note && <p className="card-note receipt-note">{note}</p>}
      {action === 'reschedule' && previousSlot ? (
        <div className="receipt-facts receipt-move">
          <Fact label="Was"><s>{formatSlot(previousSlot)}</s></Fact>
          <ArrowRight className="receipt-arrow" size={16} />
          <Fact label="Now">{formatSlot(slot)}</Fact>
        </div>
      ) : (
        <div className="receipt-facts">
          <Fact label={action === 'cancel' ? 'Was' : 'When'} detail={time}>{action === 'cancel' ? <s>{date}</s> : date}</Fact>
          <Fact label="Price">{action === 'cancel' ? <s>{rupees(price)}</s> : rupees(price)}</Fact>
          <Fact label="Where">{area}</Fact>
        </div>
      )}
      <div className="receipt-foot">
        <span className="receipt-trust"><Check size={13} />{trustLine(props)}</span>
        {action !== 'cancel' && !changed && (
          <span className="button-row">
            <button type="button" className="btn" disabled={pending} onClick={() => send(`Move my ${serviceName.toLowerCase()}`)}>Reschedule</button>
            <button type="button" className="btn" disabled={pending} onClick={() => send(`Cancel my ${serviceName.toLowerCase()}`)}>Cancel</button>
          </span>
        )}
      </div>
    </div>
  );
}

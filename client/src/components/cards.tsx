import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import { formatSlot, rupees, slotMessage } from '../format.ts';
import type { Card, SendMessage, SessionView, Step } from '../types.ts';
import { BookingsCard } from './bookings-card.tsx';
import { Glide } from './glide.tsx';

type CardOf<T extends Card['type']> = Extract<Card, { type: T }>;

export interface CardActions {
  send: SendMessage;
  pending: boolean;
  approvals: SessionView['approvals'];
  bookings: SessionView['bookings'];
}

const MAX_TIME_CHIPS = 6;

const APPROVAL_TEXT = {
  book: { title: 'Confirm booking', button: 'Confirm booking' },
  cancel: { title: 'Confirm cancellation', button: 'Confirm cancel' },
  reschedule: { title: 'Confirm new time', button: 'Confirm move' },
};

interface OptionsCardProps extends CardOf<'options'>, CardActions {
  /** False once the errand has moved on, which folds the card away. */
  current: boolean;
}

function OptionsCard({ title, options, current, send, pending }: OptionsCardProps) {
  const [chosen, setChosen] = useState(options[0]);
  const [slot, setSlot] = useState(options[0].slots[0]);
  // Rating is 0 when choosing between existing bookings, where steps and reviews do not apply.
  const choosingProvider = options.some((option) => option.rating);
  const enabled = current && !pending;

  const choose = (option: (typeof options)[number]) => {
    setChosen(option);
    setSlot(option.slots[0]);
  };
  const confirmChoice = () => send(slot === chosen.slots[0] ? String(chosen.index) : slotMessage(chosen.index, slot));

  function handleRowKey(event: KeyboardEvent<HTMLButtonElement>, position: number) {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmChoice();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (position + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      choose(options[next]);
      event.currentTarget.closest('.glide')?.querySelectorAll<HTMLElement>('.option')[next]?.focus();
    }
  }

  const rows = options.map((option, position) => (
    <div key={option.index}>
      <button
        type="button"
        className="option"
        data-glide
        disabled={!enabled}
        aria-pressed={option === chosen}
        onClick={() => choose(option)}
        onKeyDown={(event) => handleRowKey(event, position)}
      >
        <span className="radio" />
        <span className="option-name">
          <b>{option.providerName}</b>
          {option.attributes[0] && <span className="muted"> · {option.attributes[0]}</span>}
        </span>
        <span>{option.rating ? `★ ${option.rating}` : ''}</span>
        <span className="mono small">{formatSlot(option === chosen ? slot : option.slots[0])}</span>
        <span className="mono price">{rupees(option.price)}</span>
      </button>
      {enabled && option === chosen && option.slots.length > 1 && (
        <div className="time-chips" role="group" aria-label={`Times for ${option.providerName}`}>
          {option.slots.slice(0, MAX_TIME_CHIPS).map((item) => (
            <button type="button" key={item} className="time-chip mono" aria-pressed={item === slot} onClick={() => setSlot(item)}>{formatSlot(item)}</button>
          ))}
        </div>
      )}
    </div>
  ));

  if (!current) {
    return (
      <details className="card card-past">
        <summary className="card-title">{title} <span className="muted small">{options.length} options</span></summary>
        <Glide>{rows}</Glide>
      </details>
    );
  }

  return (
    <div className="card">
      <div className="card-title">{title}</div>
      <Glide>{rows}</Glide>
      <input
        className="card-input"
        aria-label="Something else"
        placeholder="Something else…"
        disabled={!enabled}
        onKeyDown={(event) => {
          const text = event.currentTarget.value.trim();
          if (event.key === 'Enter' && text) send(text);
        }}
      />
      <div className="card-actions">
        <span className="mono small muted">{choosingProvider ? 'step 1 / 2' : ''}</span>
        <span className="button-row">
          <button type="button" className="btn" disabled={!enabled} onClick={() => send('no')}>Skip</button>
          {choosingProvider && (
            <button type="button" className="btn" disabled={!enabled} onClick={() => send(`What do people say about ${chosen.providerName}?`)}>Reviews</button>
          )}
          <button type="button" className="btn btn-primary" disabled={!enabled} onClick={confirmChoice}>Continue</button>
        </span>
      </div>
    </div>
  );
}

const OUTCOME_LABEL = { GRANTED: 'Confirmed', CONSUMED: 'Confirmed', VOID: 'Voided' };

function ApprovalCard({ approvalId, action, providerName, slot, price, note, expiresAt, send, pending, approvals }: CardOf<'approval'> & CardActions) {
  const status = approvals.find((item) => item.id === approvalId)?.status ?? 'PENDING';
  const expires = expiresAt && new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={status === 'VOID' ? 'card card-narrow card-void' : 'card card-narrow'}>
      <div className="card-title spread">
        {APPROVAL_TEXT[action].title}
        {status === 'PENDING'
          ? expires && <span className="chip chip-warn mono">hold until {expires}</span>
          : <span className={status === 'VOID' ? 'chip chip-bad' : 'chip chip-ok'}>{OUTCOME_LABEL[status]}</span>}
      </div>
      {note && <p className="card-note">{note}</p>}
      <dl className="facts">
        <dt>Provider</dt><dd className="strong">{providerName}</dd>
        <dt>Slot</dt><dd className="mono">{formatSlot(slot)}</dd>
        <dt>Price</dt><dd className="mono strong">{rupees(price)}</dd>
      </dl>
      <div className="card-actions">
        <span className="mono small muted">{status === 'PENDING' ? 'step 2 / 2' : approvalId}</span>
        {status === 'PENDING' && (
          <span className="button-row">
            <button type="button" className="btn" disabled={pending} onClick={() => send('no')}>Change</button>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => send('yes', approvalId)}>{APPROVAL_TEXT[action].button}</button>
          </span>
        )}
      </div>
    </div>
  );
}

/** React renders review text as text, so hostile markup can only ever display. */
function ReviewsCard({ providerName, reviews }: CardOf<'reviews'>) {
  return (
    <div className="review-list">
      <div className="card-title">Reviews · {providerName}</div>
      {reviews.map((review) => (
        <div className={review.flagged ? 'review review-flagged' : 'review'} key={review.id}>
          <div className="spread">
            <span className="strong small">{'★'.repeat(review.rating)} {review.title}</span>
            <span className={review.flagged ? 'tag tag-bad' : 'tag tag-ok'}>{review.flagged ? 'UNTRUSTED · FLAGGED' : 'DATA'}</span>
          </div>
          <p className={review.flagged ? 'review-quote mono' : 'review-text'}>{review.text}</p>
          {review.flagged && (
            <span className="review-source">
              <ShieldAlert size={13} />
              {review.id} · treated as text only · no effect on task, budget or approvals
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

const STEP_ICONS = { ok: Check, warn: TriangleAlert, bad: X };

function StepRow({ label, detail, status }: Step) {
  const StepIcon = STEP_ICONS[status];
  return (
    <div className={`step step-${status}`}>
      <span className="step-dot"><StepIcon size={12} /></span>
      <span className="strong">{label}</span>
      <span className="mono small muted step-detail">{detail}</span>
    </div>
  );
}

export function MessageCard({ card, current, ...actions }: { card: Card; current: boolean } & CardActions) {
  switch (card.type) {
    case 'options':
      return <OptionsCard {...card} {...actions} current={current} />;
    case 'approval':
      return <ApprovalCard {...card} {...actions} />;
    case 'reviews':
      return <ReviewsCard {...card} />;
    case 'bookings':
      return <BookingsCard bookings={actions.bookings} />;
    case 'steps':
      return <div className="steps">{card.steps.map((step) => <StepRow key={step.label + step.detail} {...step} />)}</div>;
  }
}

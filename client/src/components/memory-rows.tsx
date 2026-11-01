import { ChevronRight, Clock, Droplet, Lightbulb, MapPin, Snowflake, Sparkles, Wrench, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { factLabel, SERVICE_NAMES } from '../format.ts';
import type { Booking, Fact, SendMessage, SessionView } from '../types.ts';

export interface MemoryActions {
  send: SendMessage;
  fillComposer: (text: string) => void;
}

interface MemoryProps extends MemoryActions {
  memory: SessionView['memory'];
  bookings: Booking[];
}

const SERVICE_ICONS: Record<string, LucideIcon> = { plumber: Droplet, electrician: Zap, ac_service: Snowflake, cleaning: Sparkles };

const serviceOf = (key: string) => key.replace('technician:', '');
const isProvider = ({ key }: Fact) => key.startsWith('technician:');
const iconFor = ({ key }: Fact) => (key === 'area' ? MapPin : key === 'earliest_time' ? Clock : SERVICE_ICONS[serviceOf(key)] ?? Wrench);
const nameFor = (fact: Fact) => (isProvider(fact) ? SERVICE_NAMES[serviceOf(fact.key)] ?? serviceOf(fact.key) : factLabel(fact.key));

function bookingCount(fact: Fact, bookings: Booking[]): number {
  if (!isProvider(fact)) return 0;
  return bookings.filter(({ provider, service, status }) => provider.id === fact.value && service === serviceOf(fact.key) && status !== 'cancelled').length;
}

const times = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Plain words that still say whether the user stated a fact or the agent inferred it. */
function sourceText(fact: Fact, bookings: Booking[]): string {
  const count = bookingCount(fact, bookings);
  const origin = fact.source === 'stated' ? 'You told me' : count ? `${times(count, 'booking')} · you said yes` : 'You said yes';
  return fact.previous ? `${origin} · was ${fact.previous}` : origin;
}

/**
 * A guess the agent will not use until told to. Yes sends a command, never the word "yes",
 * because a plain confirmation would approve any booking that is waiting.
 */
function FactQuestion({ fact, bookings, send }: { fact: Fact; bookings: Booking[]; send: SendMessage }) {
  const count = bookingCount(fact, bookings);
  const usePronoun = isProvider(fact) ? 'them' : 'it';
  return (
    <div className="memory-ask">
      <Lightbulb size={16} />
      <p className="memory-ask-text">
        {isProvider(fact) && count > 0
          ? <>I noticed you booked <b>{fact.label}</b> {times(count, 'time')}.</>
          : <>I noticed your {nameFor(fact).toLowerCase()} might be <b>{fact.label}</b>.</>}
        {' '}Use {usePronoun} by default? I won't until you say yes.
      </p>
      <span className="button-row">
        <button type="button" className="btn" onClick={() => send(`/memory forget ${fact.key}`)}>No</button>
        <button type="button" className="btn btn-primary" onClick={() => send(`/memory confirm ${fact.key}`)}>Yes</button>
      </span>
    </div>
  );
}

function FactRow({ fact, bookings, send, fillComposer }: { fact: Fact; bookings: Booking[] } & MemoryActions) {
  const FactIcon = iconFor(fact);
  return (
    <div className="memory-row">
      <span className="memory-icon"><FactIcon size={14} /></span>
      <span className="memory-main">
        <span className="small muted">{nameFor(fact)}</span>
        <span className="strong">{fact.label}</span>
      </span>
      <span className="memory-side">
        <span className="small muted">{sourceText(fact, bookings)}</span>
        <button type="button" className="memory-action" onClick={() => fillComposer(`/memory set ${fact.key} `)}>Change</button>
        <button type="button" className="memory-action" onClick={() => send(`/memory forget ${fact.key}`)}>Forget</button>
      </span>
    </div>
  );
}

function FactGroup({ title, facts, ...props }: { title: string; facts: Fact[]; bookings: Booking[] } & MemoryActions) {
  if (!facts.length) return null;
  return (
    <section className="memory-group">
      <h4 className="label memory-group-title">{title}</h4>
      {facts.map((fact) => <FactRow key={fact.key} fact={fact} {...props} />)}
    </section>
  );
}

/** A forgotten value keeps only a hash, so a key can also hold a newer value the user gave later. */
function ForgottenList({ keys, facts }: { keys: string[]; facts: Fact[] }) {
  if (!keys.length) return null;
  return (
    <details className="memory-forgotten">
      <summary className="small muted"><ChevronRight className="card-chevron" size={13} />{keys.length} forgotten · never reused</summary>
      <ul>
        {keys.map((key) => (
          <li key={key} className="small muted">
            {factLabel(key)}: {facts.some((fact) => fact.key === key) ? "an earlier value was forgotten and won't be reused" : 'value deleted'}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function MemoryRows({ memory: { facts, forgottenKeys }, bookings, ...actions }: MemoryProps) {
  const inUse = facts.filter((fact) => fact.source === 'stated' || fact.confirmed);
  const questions = facts.filter((fact) => !inUse.includes(fact));
  return (
    <>
      {questions.map((fact) => <FactQuestion key={fact.key} fact={fact} bookings={bookings} send={actions.send} />)}
      <FactGroup title="Places & times" facts={inUse.filter((fact) => !isProvider(fact))} bookings={bookings} {...actions} />
      <FactGroup title="Go-to providers" facts={inUse.filter(isProvider)} bookings={bookings} {...actions} />
      <ForgottenList keys={forgottenKeys} facts={facts} />
    </>
  );
}

/** Shows the current list, so an old card cannot go stale. */
export function MemoryCard({ memory, ...props }: MemoryProps) {
  const isEmpty = !memory.facts.length && !memory.forgottenKeys.length;
  return (
    <div className="card memory-card">
      <div className="memory-head">
        <div className="card-title">What I remember</div>
        <p className="small muted">Used to fill in your requests. You can change anything.</p>
      </div>
      {isEmpty ? <p className="panel-empty">Nothing saved yet. Try "I live in Powai".</p> : <MemoryRows memory={memory} {...props} />}
    </div>
  );
}

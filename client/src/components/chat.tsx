import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { chatTitle } from '../format.ts';
import type { Card, Message, SendMessage, SessionView, WorkflowState } from '../types.ts';
import { MessageCard } from './cards.tsx';
import { Composer } from './composer.tsx';
import type { ComposerProps } from './composer.tsx';
import { ChatSkeleton } from './skeleton.tsx';

const WORKING_WORDS: Partial<Record<WorkflowState, string>> = {
  SEARCHING: 'Searching providers',
  HOLDING: 'Holding the slot',
  EXECUTING: 'Asking the provider',
  VERIFYING: 'Checking with the provider',
};

const BOOKING_LINE = /\(bk_\d+\)$/m;
const CONFIRMATION_LINE = /^(Booked|Moved|Cancelled): /;
const MEMORY_LINE = /^(Here's what I remember|I don't have any saved|Forgotten: |An earlier )/;
const REVEAL_WORD_MS = 55;
const REVEAL_MAX_MS = 1200;

/** One-click answers. Never offered at approval: confirming stays on the card or a typed yes. */
function quickReplies({ awaiting, messages }: SessionView): string[] {
  if (awaiting === 'fact') return ['No', 'Yes'];
  if (awaiting === 'budget') return ['No limit'];
  if (awaiting === 'dateRange') return ['This week', 'Saturday'];
  // Only straight after a finished action, so it does not linger once the bookings are showing.
  return messages.at(-1)?.cards.some((card) => card.type === 'confirmation') ? ['Show my bookings'] : [];
}

/** Text that a card already shows is left out, so nothing appears twice. */
function visibleText({ text, cards }: Message): string[] {
  const optionTitles = cards.flatMap((card) => (card.type === 'options' ? [card.title] : []));
  const hasApproval = cards.some((card) => card.type === 'approval');
  const hasBookings = cards.some((card) => card.type === 'bookings');
  const confirmation = cards.find((card) => card.type === 'confirmation');
  const hasMemory = cards.some((card) => card.type === 'memory');
  return text
    .split('\n\n')
    .filter((part) => !optionTitles.some((title) => part.startsWith(title)))
    .filter((part) => !(hasApproval && part.endsWith('Reply "yes" to confirm.')))
    .filter((part) => !(hasBookings && BOOKING_LINE.test(part)))
    .filter((part) => !(confirmation && (CONFIRMATION_LINE.test(part) || part === confirmation.note)))
    .filter((part) => !(hasMemory && MEMORY_LINE.test(part)));
}

/**
 * Words resolve in with CSS delays. This is presentation only: the reply is complete and
 * verified before it arrives, and all of it is in the DOM from the start.
 */
function RevealText({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  const stepMs = Math.min(REVEAL_WORD_MS, REVEAL_MAX_MS / parts.length);
  return parts.map((part, index) =>
    part.trim() ? <span className="reveal-word" key={index} style={{ animationDelay: `${index * stepMs}ms` }}>{part}</span> : part,
  );
}

interface MessageViewProps {
  message: Message;
  isNew: boolean;
  isCurrentOptions: boolean;
  approvals: SessionView['approvals'];
  bookings: SessionView['bookings'];
  memory: SessionView['memory'];
  send: SendMessage;
  fillComposer: (text: string) => void;
  pending: boolean;
}

/** Memoised, so live polling during a turn does not re-render every past message. */
const MessageView = memo(function MessageView({ message, isNew, isCurrentOptions, approvals, bookings, memory, send, fillComposer, pending }: MessageViewProps) {
  // Decided once, so a later render or a reload never replays the reveal.
  const [animate] = useState(isNew);
  if (message.role === 'user') return <div className="user-message">{message.text}</div>;

  const renderCards = (cards: Card[]) =>
    cards.map((card, index) => <MessageCard key={index} card={card} current={isCurrentOptions} send={send} pending={pending} approvals={approvals} bookings={bookings} memory={memory} fillComposer={fillComposer} />);
  // Steps and reviews lead into the text. A choice comes last, so any note explaining it reads first.
  // The receipt replaces the progress rows. The trace keeps every step, and failed runs have no receipt.
  const hasReceipt = message.cards.some((card) => card.type === 'confirmation');
  const shown = hasReceipt ? message.cards.filter((card) => card.type !== 'steps') : message.cards;
  const isChoice = ({ type }: Card) => type === 'options' || type === 'approval' || type === 'confirmation' || type === 'memory';

  return (
    <div className={animate ? 'agent-message fade-up' : 'agent-message'}>
      {renderCards(shown.filter((card) => !isChoice(card)))}
      {visibleText(message).map((part, index) => (
        <p className="agent-text" key={index}>{animate ? <RevealText text={part} /> : part}</p>
      ))}
      {renderCards(shown.filter(isChoice))}
    </div>
  );
});

function Working({ state }: { state: WorkflowState }) {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const startedAt = performance.now();
    const timer = setInterval(() => setElapsedMs(performance.now() - startedAt), 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="working" role="status">
      <span className="spinner" />
      {WORKING_WORDS[state] ?? 'Working'}
      <span className="mono small">{(elapsedMs / 1000).toFixed(1)}s</span>
    </div>
  );
}

interface ThreadProps {
  session: SessionView;
  liveState: WorkflowState;
  error: string | null;
  send: SendMessage;
  fillComposer: (text: string) => void;
  pending: boolean;
}

/** One chat's title and messages. Keyed by chat, so its scroll and reveal state start fresh. */
function Thread({ session, liveState, error, send, fillComposer, pending }: ThreadProps) {
  const { messages } = session;
  const scroller = useRef<HTMLDivElement>(null);
  const seenCount = useRef(messages.length);
  const opened = useRef(false);

  // Opening a chat lands at the bottom before the first paint, with no visible slide.
  useLayoutEffect(() => {
    seenCount.current = messages.length;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: opened.current ? 'smooth' : 'instant' });
    opened.current = true;
  }, [messages.length, pending]);

  const lastOptionsIndex = messages.findLastIndex((message) => message.cards.some((card) => card.type === 'options'));
  const replies = pending ? [] : quickReplies(session);
  const title = chatTitle(messages) ?? 'New errand';

  return (
    <>
      <header className="chat-header">
        <h1 className="chat-title" title={title}>{title}</h1>
      </header>
      <div className="messages" ref={scroller} aria-live="polite">
        <div className="messages-column">
          {messages.map((message, index) => (
            <MessageView
              key={message.id}
              message={message}
              isNew={index >= seenCount.current}
              isCurrentOptions={index === lastOptionsIndex && session.state === 'PRESENTING'}
              approvals={session.approvals}
              bookings={session.bookings}
              memory={session.memory}
              send={send}
              fillComposer={fillComposer}
              pending={pending}
            />
          ))}
          {replies.length > 0 && (
            <div className="quick-replies">
              {replies.map((text, index) => (
                <button type="button" className="btn fade-up" key={text} style={{ animationDelay: `${300 + index * 90}ms` }} onClick={() => send(text)}>{text}</button>
              ))}
            </div>
          )}
          {pending && <Working state={liveState} />}
          {error && <div className="error-banner" role="alert">{error}</div>}
        </div>
      </div>
    </>
  );
}

interface ChatProps {
  /** The selected chat. A new chat gets a new composer, so a draft does not leak across chats. */
  composerKey: string | null;
  session: SessionView;
  loading: boolean;
  liveState: WorkflowState;
  error: string | null;
  composer: ComposerProps;
  panelOpen: boolean;
  onTogglePanel: () => void;
  fillComposer: (text: string) => void;
}

export function Chat({ composerKey, session, loading, liveState, error, composer, panelOpen, onTogglePanel, fillComposer }: ChatProps) {
  return (
    <section className="chat">
      {loading
        ? <ChatSkeleton />
        : <Thread key={session.id} session={session} liveState={liveState} error={error} send={composer.onSubmit} fillComposer={fillComposer} pending={composer.pending} />}
      <button type="button" className="panel-toggle" aria-label={panelOpen ? 'Close panel' : 'Open trace'} title={panelOpen ? 'Close panel' : 'Open trace'} onClick={onTogglePanel}>
        {panelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
      </button>
      <div className="composer-wrap"><Composer key={composerKey} {...composer} /></div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import { chatTitle } from '../format.ts';
import type { Card, Message, SendMessage, SessionView, WorkflowState } from '../types.ts';
import { MessageCard } from './cards.tsx';
import { Composer } from './composer.tsx';
import type { ComposerProps } from './composer.tsx';

const WORKING_WORDS: Partial<Record<WorkflowState, string>> = {
  SEARCHING: 'Searching providers',
  HOLDING: 'Holding the slot',
  EXECUTING: 'Asking the provider',
  VERIFYING: 'Checking with the provider',
};

const BOOKING_LINE = /\(bk_\d+\)$/m;
const REVEAL_WORD_MS = 55;
const REVEAL_MAX_MS = 1200;

/** One-click answers. Never offered at approval: confirming stays on the card or a typed yes. */
function quickReplies({ awaiting, state }: SessionView): string[] {
  if (awaiting === 'fact') return ['Yes', 'No'];
  if (awaiting === 'budget') return ['No limit'];
  if (awaiting === 'dateRange') return ['This week', 'Saturday'];
  return state === 'DONE' ? ['Show my bookings'] : [];
}

/** Text that a card already shows is left out, so nothing appears twice. */
function visibleText({ text, cards }: Message): string[] {
  const optionTitles = cards.flatMap((card) => (card.type === 'options' ? [card.title] : []));
  const hasApproval = cards.some((card) => card.type === 'approval');
  const hasBookings = cards.some((card) => card.type === 'bookings');
  return text
    .split('\n\n')
    .filter((part) => !optionTitles.some((title) => part.startsWith(title)))
    .filter((part) => !(hasApproval && part.endsWith('Reply "yes" to confirm.')))
    .filter((part) => !(hasBookings && BOOKING_LINE.test(part)));
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
  session: SessionView;
  send: SendMessage;
  pending: boolean;
}

function MessageView({ message, isNew, isCurrentOptions, session, send, pending }: MessageViewProps) {
  // Decided once, so a later render or a reload never replays the reveal.
  const [animate] = useState(isNew);
  if (message.role === 'user') return <div className="user-message">{message.text}</div>;

  const renderCards = (cards: Card[]) =>
    cards.map((card, index) => <MessageCard key={index} card={card} current={isCurrentOptions} send={send} pending={pending} approvals={session.approvals} bookings={session.bookings} />);
  // Steps and reviews lead into the text. A choice comes last, so any note explaining it reads first.
  const isChoice = ({ type }: Card) => type === 'options' || type === 'approval';

  return (
    <div className={animate ? 'agent-message fade-up' : 'agent-message'}>
      {renderCards(message.cards.filter((card) => !isChoice(card)))}
      {visibleText(message).map((part, index) => (
        <p className="agent-text" key={index}>{animate ? <RevealText text={part} /> : part}</p>
      ))}
      {renderCards(message.cards.filter(isChoice))}
    </div>
  );
}

function Working({ state }: { state: WorkflowState }) {
  const [startedAt] = useState(() => performance.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="working" role="status">
      <span className="spinner" />
      {WORKING_WORDS[state] ?? 'Working'}
      <span className="mono small">{((now - startedAt) / 1000).toFixed(1)}s</span>
    </div>
  );
}

interface ChatProps {
  session: SessionView;
  liveState: WorkflowState;
  error: string | null;
  composer: Omit<ComposerProps, 'modelName'>;
}

export function Chat({ session, liveState, error, composer }: ChatProps) {
  const { messages } = session;
  const { pending, onSubmit: send } = composer;
  const scroller = useRef<HTMLDivElement>(null);
  const seenCount = useRef(messages.length);

  useEffect(() => {
    seenCount.current = messages.length;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending]);

  const lastOptionsIndex = messages.findLastIndex((message) => message.cards.some((card) => card.type === 'options'));
  const replies = pending ? [] : quickReplies(session);
  const title = chatTitle(messages) ?? 'New errand';

  return (
    <section className="chat">
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
              session={session}
              send={send}
              pending={pending}
            />
          ))}
          {replies.length > 0 && (
            <div className="quick-replies">
              {replies.map((text, index) => (
                <button type="button" className="btn btn-sm fade-up" key={text} style={{ animationDelay: `${300 + index * 90}ms` }} onClick={() => send(text)}>{text}</button>
              ))}
            </div>
          )}
          {pending && <Working state={liveState} />}
          {error && <div className="error-banner" role="alert">{error}</div>}
        </div>
      </div>
      <div className="composer-wrap"><Composer {...composer} /></div>
    </section>
  );
}

import { useEffect, useLayoutEffect, useState } from 'react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import { Glide } from './glide.tsx';
import { Icon } from './icon.tsx';

interface MenuItem {
  value: string;
  label: string;
  description: string;
  /** True when picking it should send at once. Otherwise it fills the input for more typing. */
  complete: boolean;
}

const COMMANDS: MenuItem[] = [
  { value: '/scenario', label: '/scenario', description: 'Force a mock failure: timeout_but_booked, price_change…', complete: false },
  { value: '/memory', label: '/memory', description: 'View, correct or forget saved preferences', complete: true },
  { value: '/bookings', label: '/bookings', description: 'List upcoming and past bookings', complete: true },
  { value: '/restart', label: '/restart', description: 'Kill the agent at the next book call and recover', complete: true },
];

const SCENARIO_PREFIX = '/scenario ';

function menuItems(draft: string, scenarios: string[]): MenuItem[] {
  if (draft.startsWith(SCENARIO_PREFIX)) {
    const typed = draft.slice(SCENARIO_PREFIX.length);
    return scenarios
      .filter((name) => name.startsWith(typed))
      .map((name) => ({ value: `${SCENARIO_PREFIX}${name}`, label: name, description: '', complete: true }));
  }
  return draft.startsWith('/') && !draft.includes(' ') ? COMMANDS.filter(({ value }) => value.startsWith(draft)) : [];
}

export interface ComposerProps {
  draft: string;
  onDraft: (text: string) => void;
  onSubmit: (text: string) => void;
  pending: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  scenarios: string[];
  modelName?: string; // shown on the larger home composer
}

export function Composer({ draft, onDraft, onSubmit, pending, inputRef, scenarios, modelName }: ComposerProps) {
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const items = dismissed ? [] : menuItems(draft, scenarios);

  useEffect(() => {
    setActive(0);
    setDismissed(false);
  }, [draft]);

  // Grows with the text. CSS max-height caps it, then it scrolls.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }, [draft, inputRef]);

  function send() {
    const text = draft.trim();
    if (text && !pending) onSubmit(text);
  }

  function pick({ value, complete }: MenuItem) {
    if (complete) onSubmit(value);
    else onDraft(`${value} `);
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if (items.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (items.length && event.key === 'Escape') {
      setDismissed(true);
    } else if (items.length && (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey))) {
      event.preventDefault();
      pick(items[Math.min(active, items.length - 1)]);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  return (
    <form className={modelName ? 'composer composer-large' : 'composer'} onSubmit={submit}>
      {items.length > 0 && (
        <Glide className="command-menu" activeIndex={Math.min(active, items.length - 1)}>
          {items.map((item, index) => (
            <button type="button" className="command" data-glide key={item.value} onMouseEnter={() => setActive(index)} onClick={() => pick(item)}>
              <span className="mono">{item.label}</span>
              <span className="muted">{item.description}</span>
            </button>
          ))}
        </Glide>
      )}
      <label htmlFor="message" className="visually-hidden">Message</label>
      <div className="composer-row">
        <textarea
          id="message"
          ref={inputRef}
          className="composer-input"
          placeholder="Reply, or type / for commands"
          autoComplete="off"
          rows={1}
          value={draft}
          disabled={pending}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {modelName && <span className="chip"><span className="dot dot-ok" />{modelName}</span>}
        <button type="submit" className="btn btn-primary btn-icon" aria-label="Send" disabled={pending}><Icon name="send" /></button>
      </div>
    </form>
  );
}

import { useEffect, useLayoutEffect, useState } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent, RefObject } from 'react';
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
  { value: '/scenario', label: '/scenario', description: 'Force a mock failure', complete: false },
  { value: '/memory', label: '/memory', description: 'View saved preferences', complete: true },
  { value: '/bookings', label: '/bookings', description: 'List your bookings', complete: true },
  { value: '/restart', label: '/restart', description: 'Kill the agent at the next book call', complete: true },
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

/** Keeps focus in the input when a menu control is clicked, so the menu does not close first. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

export interface ComposerProps {
  draft: string;
  onDraft: (text: string) => void;
  onSubmit: (text: string) => void;
  pending: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  scenarios: string[];
  modelName: string;
}

export function Composer({ draft, onDraft, onSubmit, pending, inputRef, scenarios, modelName }: ComposerProps) {
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // Opened by the / button. Typing then filters commands without needing to type the slash.
  const [commandsOpen, setCommandsOpen] = useState(false);
  const query = commandsOpen && !draft.startsWith('/') ? `/${draft}` : draft;
  const items = dismissed ? [] : menuItems(query, scenarios);
  const canSend = Boolean(draft.trim()) && !pending;

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
    input.style.overflowY = input.scrollHeight > input.clientHeight ? 'auto' : 'hidden';
  }, [draft, inputRef]);

  function closeMenu() {
    setDismissed(true);
    setCommandsOpen(false);
  }

  function send() {
    if (!canSend) return;
    setCommandsOpen(false);
    onSubmit(draft.trim());
  }

  function pick({ value, complete }: MenuItem) {
    setCommandsOpen(false);
    if (!complete) onDraft(`${value} `);
    else if (!pending) onSubmit(value);
    inputRef.current?.focus();
  }

  function toggleCommands() {
    if (items.length) {
      closeMenu();
    } else {
      setDismissed(false);
      setCommandsOpen(true);
    }
    inputRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing) return;
    if (items.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setActive((current) => (current + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
    } else if (items.length && event.key === 'Escape') {
      closeMenu();
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
    <form className="composer" onSubmit={submit}>
      {items.length > 0 && (
        <Glide className="command-menu" activeIndex={Math.min(active, items.length - 1)}>
          {items.map((item, index) => (
            <button type="button" className="command" data-glide key={item.value} onMouseDown={keepFocus} onMouseEnter={() => setActive(index)} onClick={() => pick(item)}>
              <span className="command-name">{item.label}</span>
              <span className="muted">{item.description}</span>
            </button>
          ))}
          <div className="command-hint">Type to search {draft.startsWith(SCENARIO_PREFIX) ? 'scenarios' : 'commands'}</div>
        </Glide>
      )}
      <label htmlFor="message" className="visually-hidden">Message</label>
      <div className="composer-row">
        <button type="button" className="composer-ghost mono" aria-label="Commands" aria-expanded={items.length > 0} title="Commands" onMouseDown={keepFocus} onClick={toggleCommands}>/</button>
        <textarea
          id="message"
          ref={inputRef}
          className="composer-input"
          placeholder="Write a message…"
          autoComplete="off"
          rows={1}
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setDismissed(false)}
          onBlur={closeMenu}
        />
        <span className="composer-model" title="Model reading your messages">{modelName}</span>
        <button type="submit" className="composer-send" aria-label="Send" disabled={!canSend}><Icon name="send" size={16} /></button>
      </div>
    </form>
  );
}

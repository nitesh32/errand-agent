import { Fragment, useEffect, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { Activity, Brain, CalendarCheck, Moon, PanelLeftClose, PanelLeftOpen, SquarePen, Sun, Wrench } from 'lucide-react';
import { RECENT_GROUPS, formatChatDate, recentGroup } from '../format.ts';
import { readStorage, THEME_KEY, writeStorage } from '../storage.ts';
import type { RecentSession } from '../storage.ts';
import type { Card, Panel, SessionView } from '../types.ts';
import { isNarrow, restingPanel } from '../viewport.ts';
import { Glide } from './glide.tsx';

type Theme = 'light' | 'dark';

interface NavButtonProps {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  /** Small text on the right edge, hidden with the label when collapsed. */
  aside?: string | number;
  /** Says what the button does, when the visible label alone does not. */
  description?: string;
}

function NavButton({ on, onClick, icon, label, aside, description }: NavButtonProps) {
  return (
    <button type="button" className={on ? 'nav nav-on' : 'nav'} data-glide title={description ?? label} aria-label={description} onClick={onClick}>
      {icon}
      <span className="nav-text">{label}</span>
      {aside !== undefined && <span className="mono nav-aside nav-text">{aside}</span>}
    </button>
  );
}

/** The tallest the card gets, so it can be kept on screen beside the last rows. */
const TIP_HEIGHT = 120;

interface RecentChatsProps {
  recent: RecentSession[];
  activeId: string | null;
  onOpenSession: (id: string) => void;
}

/** Owns the hover card, so hovering re-renders only this list. */
function RecentChats({ recent, activeId, onOpenSession }: RecentChatsProps) {
  const [tip, setTip] = useState<{ title: string; date?: string; top: number; left: number } | null>(null);
  const now = new Date();
  const hideTip = () => setTip(null);

  function showTip(row: HTMLElement, { title, lastMessageAt }: RecentSession) {
    const { top, right } = row.getBoundingClientRect();
    setTip({ title, date: lastMessageAt ? formatChatDate(lastMessageAt, now) : undefined, top: Math.min(top, window.innerHeight - TIP_HEIGHT), left: right + 8 });
  }

  return (
    <div className="sidebar-fold sidebar-recent" onScroll={hideTip}>
      <Glide className="nav-group" onMouseLeave={hideTip}>
        {RECENT_GROUPS.map((group) => {
          const chats = recent.filter((chat) => recentGroup(chat.lastMessageAt, now) === group);
          if (!chats.length) return null;
          return (
            <Fragment key={group}>
              <span className="label recent-label">{group}</span>
              {chats.map((chat) => (
                <button
                  type="button"
                  key={chat.id}
                  data-glide
                  className={chat.id === activeId ? 'nav nav-on nav-recent' : 'nav nav-recent'}
                  onMouseEnter={(event) => showTip(event.currentTarget, chat)}
                  onFocus={(event) => showTip(event.currentTarget, chat)}
                  onBlur={hideTip}
                  onClick={() => onOpenSession(chat.id)}
                >
                  {chat.title}
                </button>
              ))}
            </Fragment>
          );
        })}
      </Glide>
      {tip && (
        <div className="chat-tip" aria-hidden="true" style={{ top: tip.top, left: tip.left }}>
          <span className="chat-tip-title">{tip.title}</span>
          {tip.date && <span className="small muted">{tip.date}</span>}
        </div>
      )}
    </div>
  );
}

interface SidebarProps {
  session: SessionView;
  /** The selected chat. It can differ from `session` while that chat is loading. */
  activeId: string | null;
  isEmptyChat: boolean;
  panel: Panel;
  recent: RecentSession[];
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  onPanel: (panel: Panel) => void;
  onShow: (command: string, card: Card['type']) => void;
  onNewErrand: () => void;
  onOpenSession: (id: string) => void;
}

export function Sidebar({ session, activeId, isEmptyChat, panel, recent, collapsed, onCollapse, onPanel, onShow, onNewErrand, onOpenSession }: SidebarProps) {
  const [theme, setTheme] = useState(() => readStorage<Theme>(THEME_KEY, 'light'));
  const { scenario, seed } = session.world;
  const upcoming = session.bookings.filter((booking) => booking.status === 'upcoming').length;
  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';

  // On narrow screens the expanded sidebar is a drawer over the content, so picking a row closes it.
  function closeDrawer(event: MouseEvent) {
    if (isNarrow() && (event.target as Element).closest('.nav')) onCollapse(true);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writeStorage(THEME_KEY, theme);
  }, [theme]);

  return (
    <>
    <nav className={collapsed ? 'sidebar sidebar-collapsed' : 'sidebar'} aria-label="Sessions" onClick={closeDrawer}>
      <div className="brand">
        <span className="brand-name"><span className="brand-mark"><Wrench size={14} /></span>Errand</span>
        <button type="button" className="collapse-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => onCollapse(!collapsed)}>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>

      <Glide className="nav-group">
        <NavButton on={isEmptyChat} onClick={onNewErrand} icon={<SquarePen size={15} />} label="New" />
        <NavButton on={false} onClick={() => onShow('/bookings', 'bookings')} icon={<CalendarCheck size={15} />} label="My bookings" aside={upcoming} />
        <NavButton on={false} onClick={() => onShow('/memory', 'memory')} icon={<Brain size={15} />} label="Memory" aside={session.memory.facts.length} />
        <span className="phone-only">
          <NavButton on={panel === 'trace'} onClick={() => onPanel(panel === 'trace' ? restingPanel() : 'trace')} icon={<Activity size={15} />} label="Trace" />
        </span>
      </Glide>

      <RecentChats recent={recent} activeId={activeId} onOpenSession={onOpenSession} />

      <div className={`sidebar-fold ${scenario === 'default' ? 'world-card' : 'world-card world-card-active'}`}>
        <span className="label">Demo world</span>
        <span className="small world-line"><span className="dot dot-ok" />{session.model} · seed {seed}</span>
        <span className="mono small">scenario: {scenario}</span>
        <span className="small muted">No real bookings or payments.</span>
      </div>

      <Glide className="nav-group sidebar-footer">
        <NavButton
          on={false}
          onClick={() => setTheme(nextTheme)}
          icon={theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          label="Theme"
          aside={theme === 'dark' ? 'Light' : 'Dark'}
          description={`Switch to ${nextTheme} theme`}
        />
      </Glide>
    </nav>
    {!collapsed && <button type="button" className="drawer-backdrop" aria-label="Close sidebar" onClick={() => onCollapse(true)} />}
    </>
  );
}

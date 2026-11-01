import type { ReactNode } from 'react';
import type { RecentSession } from '../storage.ts';
import type { Panel, SessionView } from '../types.ts';
import { Glide } from './glide.tsx';
import { Icon } from './icon.tsx';

export type Theme = 'light' | 'dark';

interface NavButtonProps {
  on: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count?: number;
}

function NavButton({ on, onClick, icon, label, count }: NavButtonProps) {
  return (
    <button type="button" className={on ? 'nav nav-on' : 'nav'} data-glide title={label} onClick={onClick}>
      {icon}
      <span className="nav-text">{label}</span>
      {count !== undefined && <span className="mono nav-count nav-text">{count}</span>}
    </button>
  );
}

interface SidebarProps {
  session: SessionView;
  panel: Panel;
  recent: RecentSession[];
  theme: Theme;
  collapsed: boolean;
  onCollapse: (collapsed: boolean) => void;
  onTheme: (theme: Theme) => void;
  onPanel: (panel: Panel) => void;
  onNewErrand: () => void;
  onOpenSession: (id: string) => void;
}

export function Sidebar({ session, panel, recent, theme, collapsed, onCollapse, onTheme, onPanel, onNewErrand, onOpenSession }: SidebarProps) {
  const { scenario, seed } = session.world;
  const upcoming = session.bookings.filter((booking) => booking.status === 'upcoming').length;
  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
  const togglePanel = (target: Panel) => onPanel(panel === target ? 'trace' : target);

  return (
    <nav className={collapsed ? 'sidebar sidebar-collapsed' : 'sidebar'} aria-label="Sessions">
      <div className="brand">
        <span className="brand-name"><span className="brand-mark"><Icon name="wrench" size={14} /></span>Errand</span>
        <button type="button" className="collapse-button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => onCollapse(!collapsed)}>
          <Icon name="panel" />
        </button>
      </div>

      <Glide className="nav-group">
        <NavButton on={!session.messages.length} onClick={onNewErrand} icon={<Icon name="plus" />} label="New errand" />
        <NavButton on={panel === 'bookings'} onClick={() => togglePanel('bookings')} icon={<Icon name="calendar" />} label="My bookings" count={upcoming} />
        <NavButton on={panel === 'memory'} onClick={() => togglePanel('memory')} icon={<Icon name="pin" />} label="Memory" count={session.memory.facts.length} />
      </Glide>

      <div className="sidebar-fold">
        <span className="label nav-label">Recent</span>
        <Glide className="nav-group">
          {recent.map(({ id, title }) => (
            <button type="button" key={id} data-glide className={id === session.id ? 'nav nav-on nav-recent' : 'nav nav-recent'} title={title} onClick={() => onOpenSession(id)}>{title}</button>
          ))}
        </Glide>
      </div>

      <div className={`sidebar-fold ${scenario === 'default' ? 'world-card' : 'world-card world-card-active'}`}>
        <span className="label">Demo world</span>
        <span className="small world-line"><span className="dot dot-ok" />{session.model} · seed {seed}</span>
        <span className="mono small">scenario: {scenario}</span>
        <span className="small muted">No real bookings or payments.</span>
      </div>

      <button
        type="button"
        className="theme-button"
        aria-label={`Switch to ${nextTheme} theme`}
        title={`Switch to ${nextTheme} theme`}
        onClick={() => onTheme(nextTheme)}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
      </button>
    </nav>
  );
}

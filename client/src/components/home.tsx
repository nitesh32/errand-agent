import { CalendarClock, Droplet, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Composer } from './composer.tsx';
import type { ComposerProps } from './composer.tsx';

const USER_NAME = 'Nitesh';

const SUGGESTIONS: [LucideIcon, string][] = [
  [Droplet, 'Find a plumber for my kitchen tap this week, mornings only, under ₹1,500'],
  [CalendarClock, 'Move my AC servicing to Saturday'],
  [Zap, 'Book the same electrician as last time, but not before 10 a.m.'],
];

export function Home({ composer }: { composer: ComposerProps }) {
  return (
    <main className="home">
      <div className="home-column">
        <div>
          <h1>Hello {USER_NAME}</h1>
          <p className="muted">What should I book, move or cancel?</p>
        </div>
        <Composer {...composer} />
        <div className="suggestions">
          <span className="label">Try</span>
          {SUGGESTIONS.map(([SuggestionIcon, text]) => (
            <button type="button" className="suggestion" key={text} disabled={composer.pending} onClick={() => composer.onSubmit(text)}>
              <SuggestionIcon size={16} />
              {text}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

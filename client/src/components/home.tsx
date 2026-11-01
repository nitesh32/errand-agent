import { Composer } from './composer.tsx';
import type { ComposerProps } from './composer.tsx';
import { Icon } from './icon.tsx';
import type { IconName } from './icon.tsx';

const USER_NAME = 'Nitesh';

const SUGGESTIONS: [IconName, string][] = [
  ['tap', 'Find a plumber for my kitchen tap this week, mornings only, under ₹1,500'],
  ['move', 'Move my AC servicing to Saturday'],
  ['bolt', 'Book the same electrician as last time, but not before 10 a.m.'],
];

export function Home({ composer, modelName }: { composer: Omit<ComposerProps, 'modelName'>; modelName: string }) {
  return (
    <main className="home">
      <div className="home-column">
        <div>
          <h1>Hello {USER_NAME}</h1>
          <p className="muted">What should I book, move or cancel?</p>
        </div>
        <Composer {...composer} modelName={modelName} />
        <div className="suggestions">
          <span className="label">Try</span>
          {SUGGESTIONS.map(([icon, text]) => (
            <button type="button" className="suggestion" key={text} disabled={composer.pending} onClick={() => composer.onSubmit(text)}>
              <Icon name={icon} size={16} />
              {text}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

import { useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactNode } from 'react';

interface GlideProps {
  children: ReactNode;
  className?: string;
  /** Rest here when nothing is hovered, such as the keyboard's current row. */
  activeIndex?: number;
}

interface Box {
  top: number;
  height: number;
}

/** One highlight that slides between rows marked `data-glide`, instead of each row lighting up. */
export function Glide({ children, className = '', activeIndex }: GlideProps) {
  const container = useRef<HTMLDivElement>(null);
  const currentRow = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<Box | null>(null);

  const activeRow = () => (activeIndex === undefined ? null : container.current?.querySelectorAll<HTMLElement>('[data-glide]')[activeIndex] ?? null);

  function measure() {
    // The remembered row is gone when the list's rows are replaced, so fall back to the active one.
    if (!currentRow.current?.isConnected) currentRow.current = activeRow();
    const row = currentRow.current;
    const next = row ? { top: row.offsetTop, height: row.offsetHeight } : null;
    setBox((previous) => (previous?.top === next?.top && previous?.height === next?.height ? previous : next));
  }

  function moveTo(row: Element | null | undefined) {
    currentRow.current = row instanceof HTMLElement ? row : null;
    measure();
  }

  const follow = (event: MouseEvent | FocusEvent) => moveTo((event.target as Element).closest('[data-glide]:not(:disabled)'));
  const rest = () => moveTo(activeRow());

  useLayoutEffect(rest, [activeIndex]);
  // Rows can shift when content changes, such as time chips opening under a row.
  useLayoutEffect(measure);

  return (
    <div ref={container} className={`glide ${className}`} onMouseOver={follow} onFocus={follow} onMouseLeave={rest} onBlur={rest}>
      <span className="glide-highlight" aria-hidden="true" style={{ top: box?.top ?? 0, height: box?.height ?? 0, opacity: box ? 1 : 0 }} />
      {children}
    </div>
  );
}

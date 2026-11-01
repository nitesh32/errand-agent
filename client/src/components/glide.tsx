import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const ROW = '[data-glide]:not(:disabled)';

interface GlideProps {
  children: ReactNode;
  className?: string;
  /** Keeps the highlight on this row, for keyboard menus. */
  activeIndex?: number;
  onMouseLeave?: () => void;
}

/**
 * One hover layer that glides between rows, ported from Beautiful UI's GlideMenu. Leaving only
 * fades it, so it keeps its place and glides from there on return. Two additions: `activeIndex`,
 * and re-measuring when rows shift, such as time chips opening under a row.
 */
export function Glide({ children, className = '', activeIndex, onMouseLeave }: GlideProps) {
  const container = useRef<HTMLDivElement>(null);
  const currentRow = useRef<HTMLElement | null>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [visible, setVisible] = useState(false);

  function measure(row: HTMLElement) {
    const parent = container.current!;
    const top = row.getBoundingClientRect().top - parent.getBoundingClientRect().top - parent.clientTop;
    const height = row.getBoundingClientRect().height;
    setBox((previous) => (previous?.top === top && previous.height === height ? previous : { top, height }));
  }

  function moveTo(target: EventTarget | null | undefined) {
    if (!(target instanceof Element)) return;
    const row = target.closest<HTMLElement>(ROW);
    if (!row || !container.current?.contains(row)) return;
    currentRow.current = row;
    measure(row);
    setVisible(true);
  }

  useLayoutEffect(() => {
    if (activeIndex === undefined) setVisible(false);
    else moveTo(container.current?.querySelectorAll(ROW)[activeIndex]);
  }, [activeIndex]);

  useLayoutEffect(() => {
    if (currentRow.current?.isConnected) measure(currentRow.current);
  });

  return (
    <div
      ref={container}
      className={`glide ${className}`}
      onMouseOver={(event) => moveTo(event.target)}
      onMouseLeave={() => {
        if (activeIndex === undefined) setVisible(false);
        onMouseLeave?.();
      }}
      onFocusCapture={(event) => moveTo(event.target)}
      onBlurCapture={(event) => {
        // Clicking a chat moves focus to the input, so the pointer may still be on the row.
        const leftGroup = !container.current?.contains(event.relatedTarget);
        if (leftGroup && activeIndex === undefined && !container.current?.matches(':hover')) setVisible(false);
      }}
    >
      <span className="glide-highlight" aria-hidden="true" style={{ top: box?.top ?? 0, height: box?.height ?? 0, opacity: box && visible ? 1 : 0 }} />
      {children}
    </div>
  );
}

import type { Panel } from './types.ts';

// These widths match the media queries in app.css.
export const isNarrow = () => matchMedia('(max-width: 1100px)').matches;
export const isPhone = () => matchMedia('(max-width: 760px)').matches;
export const isTouch = () => matchMedia('(pointer: coarse)').matches;

/** What shows when no panel is opened. A phone has no room for the trace beside the chat. */
export const restingPanel = (): Panel => (isPhone() ? 'none' : 'trace');

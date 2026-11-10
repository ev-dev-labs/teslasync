import type { PackAppearance } from '../types';
import type { TimelineSlots } from './Timeline.types';
import { experimentalLayouts } from '../experimentalLayouts';

export const timelineStyles: Record<PackAppearance, TimelineSlots> = {
  ...experimentalLayouts(({ tile }, id) => ({
    feed: id === 'terminal' || id === 'cyber' ? 'space-y-2 font-mono' : 'space-y-3',
    row: tile,
  })),
  studio: { feed: 'space-y-2', row: 'border-s-2 border-[var(--border-default)] ps-3 pt-2' },
  elevated: { feed: 'space-y-3', row: 'rounded-xl bg-[var(--surface-2)] p-3' },
  precision: { feed: 'space-y-0', row: 'border-b border-[var(--border-subtle)] pt-2 last:border-b-0' },
  owner: { feed: 'space-y-3', row: 'rounded-lg border-s-2 border-[var(--border-strong)] bg-[var(--surface-2)] px-3 pt-3' },
  iconic: { feed: 'space-y-3', row: 'rounded-2xl border border-[var(--border-default)] p-3 [&_svg]:size-5' },
  expressive: { feed: 'space-y-3', row: 'rounded-t-2xl rounded-br-2xl rounded-bl-md bg-[var(--surface-2)] p-3' },
  pixel: { feed: 'space-y-2 font-mono', row: 'border-2 border-[var(--border-strong)] p-3 [&_svg]:[shape-rendering:crispEdges]' },
};

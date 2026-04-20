import type { YearReview } from '@/api/types';

export interface SlideDefinition {
  type: string;
  bg: string;
  field?: string;
}

export const SLIDE_DEFS: SlideDefinition[] = [
  { type: 'title', bg: 'from-blue-900 via-indigo-900 to-slate-900' },
  { type: 'stat-hero', field: 'distance', bg: 'from-emerald-900 via-green-900 to-teal-900' },
  { type: 'stat-chart', field: 'drives', bg: 'from-purple-900 via-violet-900 to-indigo-900' },
  { type: 'drive-highlight', field: 'longest', bg: 'from-amber-900 via-orange-900 to-yellow-900' },
  { type: 'stat-hero', field: 'energy', bg: 'from-cyan-900 via-sky-900 to-blue-900' },
  { type: 'charging-breakdown', bg: 'from-orange-900 via-red-900 to-pink-900' },
  { type: 'savings', bg: 'from-emerald-900 via-teal-900 to-cyan-900' },
  { type: 'environment', bg: 'from-green-900 via-emerald-900 to-lime-900' },
  { type: 'patterns', bg: 'from-indigo-900 via-blue-900 to-violet-900' },
  { type: 'drive-highlight', field: 'efficient', bg: 'from-teal-900 via-cyan-900 to-sky-900' },
  { type: 'comparisons', bg: 'from-pink-900 via-rose-900 to-fuchsia-900' },
  { type: 'summary', bg: 'from-blue-900 via-indigo-900 to-purple-900' },
];

export function buildSlides(data: YearReview | undefined) {
  if (!data) return SLIDE_DEFS;
  return SLIDE_DEFS;
}

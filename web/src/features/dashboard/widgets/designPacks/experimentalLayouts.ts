import { EXPERIMENTAL_PACK_IDS, type ExperimentalPackId, type PackIntensity, type PackStyle } from './types';

interface ExperimentalLayout {
  style: PackStyle;
  intensity: PackIntensity;
  order: readonly ('lead' | 'visual' | 'details')[];
  body: string;
  lead: string;
  details: string;
  visual: string;
  tile: string;
  actions: string;
  radial?: boolean;
  segmented?: boolean;
  listTires?: boolean;
}

// Slots contain the original controller-owned nodes, including their trust and command guards.
export const EXPERIMENTAL_LAYOUTS: Readonly<Record<ExperimentalPackId, ExperimentalLayout>> = {
  motorsport: {
    style: 'technical',
    intensity: 'bold',
    order: ['visual', 'lead', 'details'],
    body: 'grid items-center gap-3 @lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]',
    lead: 'flex min-w-0 items-baseline justify-between gap-3 border-s-4 border-[var(--pack-detail)] ps-3 italic',
    details: 'min-w-0 border-t-2 border-[var(--border-strong)] pt-3 @lg:col-span-2',
    visual: 'min-w-0 border-b-2 border-[var(--pack-detail)] pb-3',
    tile: 'border-s-4 border-[var(--pack-detail)] p-3',
    actions: 'grid-cols-2 gap-2 @md:grid-cols-3 [&>button]:rounded-sm [&>button]:min-h-16',
    segmented: true,
  },
  blueprint: {
    style: 'technical',
    intensity: 'balanced',
    order: ['visual', 'lead', 'details'],
    body: 'grid items-start gap-3 @lg:grid-cols-2',
    lead: 'flex min-w-0 items-center justify-between gap-3 border-b border-dashed border-[var(--border-strong)] pb-3 font-mono',
    details: 'min-w-0 border border-dashed border-[var(--border-strong)] p-3 @lg:col-span-2',
    visual: 'min-w-0 border border-[var(--border-default)] p-3',
    tile: 'border border-dashed border-[var(--border-strong)] p-3 font-mono',
    actions: 'grid-cols-2 gap-3 @md:grid-cols-3 [&>button]:rounded-none [&>button]:border-dashed [&>button]:min-h-16',
  },
  editorial: {
    style: 'minimal',
    intensity: 'mild',
    order: ['lead', 'visual', 'details'],
    body: 'flex flex-col gap-5',
    lead: 'flex min-w-0 items-baseline justify-between gap-4 border-b-2 border-[var(--text-secondary)] pb-4 font-serif',
    details: 'min-w-0 border-y border-[var(--border-default)] py-3',
    visual: 'min-w-0 py-3',
    tile: 'border-b border-[var(--border-default)] py-3',
    actions: 'grid-cols-1 gap-2 @md:grid-cols-2 [&>button]:flex-row [&>button]:justify-start [&>button]:rounded-none [&>button]:min-h-14',
  },
  ambient: {
    style: 'soft',
    intensity: 'mild',
    order: ['lead', 'visual', 'details'],
    body: 'flex flex-col gap-4',
    lead: 'flex min-w-0 flex-wrap items-center justify-center gap-4 rounded-[2rem] bg-[var(--surface-2)] p-5 text-center',
    details: 'min-w-0 rounded-2xl bg-[var(--surface-2)] p-4',
    visual: 'min-w-0 rounded-[2rem] border border-[var(--border-subtle)] p-4',
    tile: 'rounded-3xl bg-[var(--surface-2)] p-4',
    actions: 'grid-cols-2 gap-3 @md:grid-cols-3 [&>button]:rounded-3xl [&>button]:min-h-20',
    radial: true,
  },
  terminal: {
    style: 'technical',
    intensity: 'bold',
    order: ['lead', 'details', 'visual'],
    body: 'flex flex-col gap-2 font-mono',
    lead: 'flex min-w-0 items-baseline justify-between gap-3 border-y border-[var(--border-strong)] py-3',
    details: 'min-w-0 border-s-2 border-[var(--pack-detail)] ps-3',
    visual: 'min-w-0 border border-dashed border-[var(--border-strong)] p-3',
    tile: 'border-b border-dashed border-[var(--border-strong)] p-3 font-mono',
    actions: 'grid-cols-2 gap-2 @md:grid-cols-3 [&>button]:flex-row [&>button]:rounded-none [&>button]:border-dashed [&>button]:font-mono [&>button]:min-h-14',
    segmented: true, listTires: true,
  },
  atlas: {
    style: 'technical',
    intensity: 'balanced',
    order: ['visual', 'lead', 'details'],
    body: 'grid items-start gap-3 @lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]',
    lead: 'flex min-w-0 items-center justify-between gap-3 @lg:col-span-2',
    details: 'min-w-0 border-s-2 border-[var(--pack-detail)] ps-3',
    visual: 'min-w-0 rounded-lg border border-[var(--border-default)] p-3',
    tile: 'rounded-lg border-s-2 border-[var(--pack-detail)] bg-[var(--surface-2)] p-3',
    actions: 'grid-cols-2 gap-3 [&>button]:flex-row [&>button]:justify-start [&>button]:min-h-16',
  },
  analog: {
    style: 'technical',
    intensity: 'balanced',
    order: ['lead', 'visual', 'details'],
    body: 'grid items-center gap-4 @lg:grid-cols-2',
    lead: 'flex min-w-0 flex-col items-center gap-3 rounded-[2rem] border-2 border-[var(--border-strong)] p-4',
    details: 'min-w-0 border-t border-double border-[var(--border-strong)] pt-3 @lg:col-span-2',
    visual: 'min-w-0 rounded-2xl bg-[var(--surface-2)] p-3',
    tile: 'rounded-2xl border-2 border-[var(--border-default)] p-3 text-center',
    actions: 'grid-cols-2 gap-3 @md:grid-cols-3 [&>button]:rounded-2xl [&>button]:border-2 [&>button]:min-h-20',
    radial: true,
  },
  observatory: {
    style: 'technical',
    intensity: 'bold',
    order: ['lead', 'visual', 'details'],
    body: 'grid items-center gap-4 @lg:grid-cols-2',
    lead: 'flex min-w-0 flex-col items-center gap-3 rounded-full border border-dashed border-[var(--pack-detail)] p-5 text-center',
    details: 'min-w-0 rounded-xl border border-[var(--border-default)] p-3',
    visual: 'min-w-0 border-t border-dashed border-[var(--border-strong)] pt-4 @lg:col-span-2',
    tile: 'rounded-xl border border-[var(--border-default)] p-3',
    actions: 'grid-cols-2 gap-3 @md:grid-cols-3 [&>button]:rounded-full [&>button]:min-h-16',
    radial: true,
  },
  bauhaus: {
    style: 'geometric',
    intensity: 'bold',
    order: ['lead', 'visual', 'details'],
    body: 'grid items-stretch gap-3 @lg:grid-cols-2',
    lead: 'flex min-w-0 flex-col items-start justify-center gap-3 rounded-tr-[3rem] bg-[var(--surface-2)] p-4',
    details: 'min-w-0 border-s-4 border-[var(--pack-detail)] ps-3 @lg:col-span-2',
    visual: 'min-w-0 border-2 border-[var(--border-strong)] p-3',
    tile: 'rounded-tr-3xl border-2 border-[var(--border-strong)] p-3',
    actions: 'grid-cols-2 gap-3 [&>button]:rounded-none [&>button:first-child]:rounded-tr-3xl [&>button]:border-2 [&>button]:min-h-20',
    segmented: true,
  },
  quiet: {
    style: 'minimal',
    intensity: 'mild',
    order: ['lead', 'details', 'visual'],
    body: 'grid items-start gap-5 @lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]',
    lead: 'flex min-w-0 items-baseline justify-between gap-3 py-2',
    details: 'min-w-0 border-t border-[var(--border-subtle)] pt-3 @lg:border-s @lg:border-t-0 @lg:ps-4 @lg:pt-0',
    visual: 'min-w-0 border-t border-[var(--border-subtle)] pt-4 @lg:col-span-2',
    tile: 'border-b border-[var(--border-subtle)] py-3',
    actions: 'grid-cols-2 gap-3 @md:grid-cols-3 [&>button]:flex-row [&>button]:rounded-lg [&>button]:min-h-14',
    listTires: true,
  },
  warm: {
    style: 'soft',
    intensity: 'mild',
    order: ['visual', 'lead', 'details'],
    body: 'flex flex-col gap-4',
    lead: 'flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-t-3xl rounded-b-xl bg-[var(--surface-2)] p-4 font-serif',
    details: 'min-w-0 rounded-xl border border-[var(--border-default)] p-4',
    visual: 'min-w-0 rounded-t-[3rem] rounded-b-xl bg-[var(--surface-2)] p-4 pt-6',
    tile: 'rounded-2xl border border-[var(--border-default)] p-3',
    actions: 'grid-cols-2 gap-3 [&>button]:flex-row [&>button]:rounded-2xl [&>button]:min-h-16',
  },
  swiss: {
    style: 'minimal',
    intensity: 'mild',
    order: ['lead', 'details', 'visual'],
    body: 'grid items-start gap-4 @lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]',
    lead: 'flex min-w-0 items-baseline justify-between gap-3 border-t-4 border-[var(--pack-detail)] pt-3',
    details: 'min-w-0 border-t border-[var(--border-default)] pt-3',
    visual: 'min-w-0 border-y border-[var(--border-default)] py-4 @lg:col-span-2',
    tile: 'border-t-2 border-[var(--border-strong)] p-3',
    actions: 'grid-cols-2 gap-px @md:grid-cols-3 [&>button]:rounded-none [&>button]:min-h-16',
    listTires: true,
  },
  material: {
    style: 'geometric',
    intensity: 'balanced',
    order: ['lead', 'visual', 'details'],
    body: 'grid items-center gap-3 @lg:grid-cols-2',
    lead: 'flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-t-[2rem] rounded-br-[2rem] rounded-bl-lg bg-[var(--surface-2)] p-5',
    details: 'min-w-0 rounded-3xl border border-[var(--border-default)] p-4',
    visual: 'min-w-0 rounded-t-xl rounded-b-[2rem] bg-[var(--surface-2)] p-4 @lg:col-span-2',
    tile: 'rounded-t-3xl rounded-br-3xl rounded-bl-lg bg-[var(--surface-2)] p-4',
    actions: 'grid-cols-2 gap-3 [&>button]:rounded-3xl [&>button:first-child]:col-span-2 [&>button]:min-h-16',
    radial: true,
  },
  glass: {
    style: 'soft',
    intensity: 'balanced',
    order: ['lead', 'visual', 'details'],
    body: 'flex flex-col gap-4',
    lead: 'flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)] px-5 py-3',
    details: 'min-w-0 rounded-2xl border border-[var(--border-default)] p-4',
    visual: 'min-w-0 rounded-3xl border border-[var(--border-subtle)] p-4',
    tile: 'rounded-2xl border border-[var(--border-default)] bg-[var(--surface-2)] p-3',
    actions: 'grid-cols-2 gap-3 @md:grid-cols-3 [&>button]:rounded-full [&>button]:flex-row [&>button]:min-h-16',
  },
  deco: {
    style: 'geometric',
    intensity: 'bold',
    order: ['lead', 'visual', 'details'],
    body: 'flex flex-col gap-4',
    lead: 'flex min-w-0 flex-col items-center gap-3 border-y-4 border-double border-[var(--pack-detail)] py-4 text-center font-serif',
    details: 'min-w-0 border-t-4 border-double border-[var(--pack-detail)] pt-3',
    visual: 'min-w-0 rounded-t-[3rem] border-4 border-double border-[var(--pack-detail)] p-4 pt-6',
    tile: 'border-y-4 border-double border-[var(--pack-detail)] p-3 text-center',
    actions: 'grid-cols-2 gap-3 @md:grid-cols-3 [&>button]:rounded-t-2xl [&>button]:rounded-b-none [&>button]:border-double [&>button]:border-4 [&>button]:min-h-20',
    radial: true,
  },
  kinetic: {
    style: 'geometric',
    intensity: 'bold',
    order: ['lead', 'details', 'visual'],
    body: 'grid items-end gap-3 @lg:grid-cols-2',
    lead: 'flex min-w-0 flex-col items-start gap-3 border-b-4 border-[var(--pack-detail)] pb-3 italic @lg:col-span-2',
    details: 'min-w-0 border-s-4 border-[var(--border-strong)] ps-3',
    visual: 'min-w-0 py-3',
    tile: 'border-b-4 border-[var(--pack-detail)] p-3',
    actions: 'grid-cols-2 gap-2 [&>button]:rounded-none [&>button]:flex-row [&>button]:min-h-16',
    segmented: true,
  },
  brutal: {
    style: 'geometric',
    intensity: 'extreme',
    order: ['lead', 'details', 'visual'],
    body: 'grid items-stretch gap-3 @lg:grid-cols-2',
    lead: 'flex min-w-0 flex-wrap items-center justify-between gap-3 border-2 border-[var(--text-secondary)] bg-[var(--surface-2)] p-4',
    details: 'min-w-0 border-2 border-[var(--text-secondary)] p-3',
    visual: 'min-w-0 border-2 border-[var(--text-secondary)] p-3 @lg:col-span-2',
    tile: 'border-2 border-[var(--text-secondary)] p-3',
    actions: 'grid-cols-2 gap-3 [&>button]:rounded-none [&>button]:border-2 [&>button]:min-h-20',
    segmented: true, listTires: true,
  },
  cyber: {
    style: 'technical',
    intensity: 'extreme',
    order: ['visual', 'lead', 'details'],
    body: 'grid items-start gap-3 font-mono @lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]',
    lead: 'flex min-w-0 items-center justify-between gap-3 border-s-4 border-[var(--pack-detail)] ps-3 @lg:col-span-2',
    details: 'min-w-0 border border-dashed border-[var(--border-strong)] p-3',
    visual: 'min-w-0 border-y-2 border-[var(--pack-detail)] py-3',
    tile: 'border-s-4 border-[var(--pack-detail)] bg-[var(--surface-2)] p-3 font-mono',
    actions: 'grid-cols-2 gap-2 @md:grid-cols-3 [&>button]:rounded-none [&>button]:border-2 [&>button]:font-mono [&>button]:min-h-16',
    segmented: true,
  },
  memphis: {
    style: 'geometric',
    intensity: 'extreme',
    order: ['visual', 'lead', 'details'],
    body: 'grid items-center gap-4 @lg:grid-cols-2',
    lead: 'flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-tl-[2rem] rounded-br-[2rem] border-b-4 border-[var(--pack-detail)] bg-[var(--surface-2)] p-4',
    details: 'min-w-0 rounded-tr-3xl rounded-bl-3xl border-2 border-[var(--border-strong)] p-4 @lg:col-span-2',
    visual: 'min-w-0 rounded-tl-3xl rounded-br-3xl border-2 border-dashed border-[var(--border-strong)] p-3',
    tile: 'rounded-tl-3xl rounded-br-3xl border-2 border-[var(--border-strong)] p-3',
    actions: 'grid-cols-2 gap-3 [&>button]:rounded-tl-3xl [&>button]:rounded-br-3xl [&>button]:min-h-20',
    radial: true,
  },
};

export function isExperimentalAppearance(appearance: unknown): appearance is ExperimentalPackId {
  return EXPERIMENTAL_PACK_IDS.some(id => id === appearance);
}

export const EXPERIMENTAL_BAR_RADII = experimentalLayouts<[number, number, number, number]>(
  ({ radial, segmented }) => segmented ? [0, 0, 0, 0] : radial ? [14, 14, 2, 2] : [6, 6, 0, 0],
);

export function experimentalLayouts<T>(
  map: (layout: ExperimentalLayout, id: ExperimentalPackId) => T,
): Record<ExperimentalPackId, T> {
  return Object.fromEntries(EXPERIMENTAL_PACK_IDS.map(id => [id, map(EXPERIMENTAL_LAYOUTS[id], id)])) as Record<ExperimentalPackId, T>;
}

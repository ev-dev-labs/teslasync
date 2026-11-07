import { MetricBar, SegmentedMeter } from '@/components/data-display';
import { cn } from '@/lib/cn';
import type { PackAppearance } from '../types';
import type { InstrumentPresentationProps } from './Instrument.types';

const layouts: Record<PackAppearance, { body: string; lead: string; details: string }> = {
  studio: {
    body: 'grid items-center gap-3 @md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
    lead: 'flex min-w-0 items-center justify-center gap-3',
    details: 'min-w-0 border-t border-[var(--border-subtle)] pt-3 @md:col-start-2 @md:row-start-1 @md:border-s @md:border-t-0 @md:ps-3 @md:pt-0',
  },
  elevated: {
    body: 'flex flex-col gap-4',
    lead: 'flex min-w-0 items-center justify-between gap-3 rounded-xl bg-[var(--surface-2)] p-4',
    details: 'min-w-0 border-t border-[var(--border-subtle)] pt-3',
  },
  precision: {
    body: 'flex flex-col gap-5',
    lead: 'flex min-w-0 items-baseline justify-between gap-4 py-2',
    details: 'min-w-0 border-t border-[var(--border-subtle)] pt-3',
  },
  owner: {
    body: 'flex flex-col gap-3',
    lead: 'flex min-w-0 items-center justify-between gap-3',
    details: 'min-w-0 rounded-lg bg-[var(--surface-2)] p-3',
  },
  iconic: {
    body: 'grid items-center gap-4 @md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
    lead: 'flex min-w-0 flex-col items-center gap-3 rounded-2xl border-2 border-[var(--border-subtle)] p-4',
    details: 'min-w-0 @md:col-start-2 @md:row-start-1',
  },
  expressive: {
    body: 'flex flex-col gap-3',
    lead: 'flex min-w-0 items-center justify-between gap-4 rounded-t-3xl rounded-br-3xl rounded-bl-lg bg-[var(--surface-2)] p-4',
    details: 'min-w-0 px-1',
  },
  pixel: {
    body: 'flex flex-col gap-3 font-mono',
    lead: 'flex min-w-0 items-center justify-between gap-3 border-2 border-[var(--border-strong)] p-3',
    details: 'min-w-0 border-t border-dashed border-[var(--border-strong)] pt-3',
  },
};

export default function InstrumentLayout({
  appearance, family, compact, headline, reading, icon, context, instrument, details,
}: InstrumentPresentationProps) {
  const layout = layouts[appearance];
  const validScale = reading != null && Number.isFinite(reading.max) && reading.max > 0;
  const ratio = validScale && reading.value != null && Number.isFinite(reading.value)
    ? Math.max(0, Math.min(1, reading.value / reading.max))
    : null;
  const radial = family === 'ring' && reading?.value != null && Number.isFinite(reading.value)
    && (appearance === 'studio' || appearance === 'iconic');
  const hasLead = headline != null || icon != null;
  const lead = hasLead ? (
    <div key="lead" className={layout.lead}>
      {icon && <span aria-hidden="true" className={cn(
        'shrink-0 text-[var(--text-secondary)] [&>svg]:size-7',
        appearance === 'iconic' && '[&>svg]:size-10',
        appearance === 'pixel' && '[&>svg]:[shape-rendering:crispEdges]',
      )}>{icon}</span>}
      <div className={cn('relative min-w-0', radial && 'flex size-32 shrink-0 items-center justify-center p-4')}>
        {radial && <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
          <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border-subtle)" strokeWidth="5" />
          {ratio != null && <circle cx="50" cy="50" r="45" fill="none"
            stroke={reading?.color ?? 'var(--theme-primary)'} strokeWidth={appearance === 'iconic' ? 8 : 5}
            pathLength="100" strokeDasharray={`${ratio * 100} 100`} />}
        </svg>}
        <div className="relative min-w-0">{headline}</div>
      </div>
    </div>
  ) : null;
  const facts = details && <div key="details" className={layout.details}>{details}</div>;
  return (
    <div data-widget-family={family} data-widget-appearance={appearance} data-instrument-family={family} data-instrument-appearance={appearance} className="flex h-full min-w-0 flex-col gap-3">
      {context}
      <div className={cn('min-w-0', compact || !hasLead ? 'flex flex-col gap-3' : layout.body)}>
        {appearance === 'owner' && facts}
        {lead}
        {(instrument || (validScale && (appearance === 'pixel' || !radial))) && (
        <div key="instrument" className={cn('min-w-0 space-y-3', !compact && ['studio', 'iconic'].includes(appearance) && '@md:col-span-2')}>
          {validScale && appearance === 'pixel' && <SegmentedMeter value={reading.value} max={reading.max} color={reading.color} label={reading.label} />}
          {validScale && !instrument && !radial && appearance !== 'pixel' && <MetricBar
            value={reading.value} max={reading.max} ariaLabel={reading.label}
            color={reading.color ?? 'var(--theme-primary)'} fill="solid" showHeader={false}
            size={appearance === 'precision' ? 'slim' : 'default'} />}
          {instrument}
        </div>
        )}
        {appearance !== 'owner' && facts}
      </div>
    </div>
  );
}

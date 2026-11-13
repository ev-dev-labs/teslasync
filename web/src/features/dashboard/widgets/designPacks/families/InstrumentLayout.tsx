import { MetricBar, SegmentedMeter } from '@/components/data-display';
import { cn } from '@/lib/cn';
import type { PackAppearance } from '../types';
import type { InstrumentPresentationProps } from './Instrument.types';
import { EXPERIMENTAL_LAYOUTS, experimentalLayouts, isExperimentalAppearance } from '../experimentalLayouts';

const layouts: Record<PackAppearance, { body: string; lead: string; details: string }> = {
  ...experimentalLayouts(({ body, lead, details }) => ({ body, lead, details })),
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
  const experiment = isExperimentalAppearance(appearance) ? EXPERIMENTAL_LAYOUTS[appearance] : null;
  const segmented = appearance === 'pixel' || experiment?.segmented;
  const validScale = reading != null && Number.isFinite(reading.max) && reading.max > 0;
  const ratio = validScale && reading.value != null && Number.isFinite(reading.value)
    ? Math.max(0, Math.min(1, reading.value / reading.max))
    : null;
  const radial = (family === 'ring' || (family === 'meter' && experiment?.radial))
    && reading?.value != null && Number.isFinite(reading.value)
    && (appearance === 'studio' || appearance === 'iconic' || experiment?.radial);
  const needleAngle = ratio != null ? (ratio * 270 - 225) * Math.PI / 180 : null;
  const hasLead = headline != null || icon != null;
  const lead = hasLead ? (
    <div key="lead" className={layout.lead}>
      {icon && <span aria-hidden="true" className={cn(
        'shrink-0 text-[var(--text-secondary)] [&>svg]:size-7',
        appearance === 'iconic' && '[&>svg]:size-10',
        appearance === 'pixel' && '[&>svg]:[shape-rendering:crispEdges]',
      )}>{icon}</span>}
      <div data-app-part={radial ? 'metric' : undefined} data-app-metric={radial ? 'ring' : undefined}
        className={cn('relative min-w-0', radial && 'flex size-32 shrink-0 items-center justify-center p-4')}>
        {radial && <svg data-app-part="chart-gauge" data-chart-family="radial-gauge" data-chart-variant="embedded"
          data-chart-gauge-shape={appearance === 'analog' ? 'needle' : 'arc'}
          viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden="true">
          <circle data-chart-gauge-track cx="50" cy="50" r="45" fill="none" stroke="var(--border-subtle)" strokeWidth="5" />
          {appearance === 'analog' && Array.from({ length: 11 }, (_, tick) => {
            const angle = (tick * 27 - 225) * Math.PI / 180;
            return <line data-chart-gauge-tick key={tick} x1={50 + 38 * Math.cos(angle)} y1={50 + 38 * Math.sin(angle)}
              x2={50 + 43 * Math.cos(angle)} y2={50 + 43 * Math.sin(angle)}
              stroke="var(--text-secondary)" strokeWidth="1" />;
          })}
          {appearance === 'analog' && needleAngle != null && <line data-chart-gauge-marker
            x1="50" y1="50" x2={50 + 35 * Math.cos(needleAngle)} y2={50 + 35 * Math.sin(needleAngle)}
            stroke={reading?.color ?? 'var(--theme-primary)'} strokeWidth="2" />}
          {ratio != null && appearance !== 'analog' && <circle data-chart-gauge-fill cx="50" cy="50" r="45" fill="none"
            stroke={reading?.color ?? 'var(--theme-primary)'} strokeWidth={appearance === 'iconic' ? 8 : 5}
            pathLength="100" strokeDasharray={`${ratio * 100} 100`} />}
        </svg>}
        <div className="relative min-w-0">{headline}</div>
      </div>
    </div>
  ) : null;
  const facts = details && <div key="details" className={layout.details}>{details}</div>;
  const visual = (instrument || (validScale && (segmented || !radial))) && (
    <div key="instrument" className={cn(
      'min-w-0 space-y-3', experiment?.visual,
      !compact && ['studio', 'iconic'].includes(appearance) && '@md:col-span-2',
    )}>
      {validScale && segmented && <SegmentedMeter value={reading.value} max={reading.max} color={reading.color} label={reading.label} />}
      {validScale && !instrument && !radial && !segmented && <MetricBar
        value={reading.value} max={reading.max} ariaLabel={reading.label}
        color={reading.color ?? 'var(--theme-primary)'} fill="solid" showHeader={false}
        size={appearance === 'precision' || appearance === 'quiet' ? 'slim' : 'default'} />}
      {instrument}
    </div>
  );
  const slots = { lead, visual, details: facts };
  const order = experiment?.order ?? (appearance === 'owner'
    ? ['details', 'lead', 'visual'] as const
    : ['lead', 'visual', 'details'] as const);
  return (
    <div data-widget-family={family} data-widget-appearance={appearance} data-instrument-family={family} data-instrument-appearance={appearance} className="flex h-full min-w-0 flex-col gap-3">
      {context}
      <div className={cn('min-w-0', compact || !hasLead ? 'flex flex-col gap-3' : layout.body)}>
        {order.map(slot => slots[slot])}
      </div>
    </div>
  );
}

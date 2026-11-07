import { Activity } from 'lucide-react';
import { Caption, MetricLabel, MetricValue } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { LineAppearance, LineTelemetryProps } from './Line.types';

const layouts: Record<LineAppearance, {
  body: string;
  headline: string;
  details: string;
  plot: string;
  plotFirst?: boolean;
}> = {
  studio: {
    body: 'flex flex-col gap-3',
    headline: 'flex items-center gap-3 border-b border-[var(--border-subtle)] pb-3',
    details: 'grid grid-cols-1 gap-3 @xs:grid-cols-2',
    plot: 'min-h-32',
    plotFirst: true,
  },
  elevated: {
    body: 'flex flex-col gap-4',
    headline: 'rounded-xl bg-[var(--surface-2)] p-4',
    details: 'flex flex-wrap gap-x-6 gap-y-3 border-t border-[var(--border-subtle)] pt-3',
    plot: 'min-h-36',
  },
  precision: {
    body: 'grid gap-4 @lg:grid-cols-[minmax(0,1fr)_auto]',
    headline: 'py-1',
    details: 'flex flex-wrap items-end gap-x-6 gap-y-2 @lg:justify-end',
    plot: 'min-h-36 @lg:col-span-2',
  },
  owner: {
    body: 'grid gap-3 @lg:grid-cols-[minmax(0,1fr)_auto]',
    headline: '@lg:col-span-2',
    details: 'flex flex-wrap gap-3 rounded-lg bg-[var(--surface-2)] p-3 @lg:col-start-2 @lg:row-start-2 @lg:flex-col',
    plot: 'min-h-36 @lg:col-start-1 @lg:row-start-2',
    plotFirst: true,
  },
  iconic: {
    body: 'flex flex-col gap-4',
    headline: 'flex items-center gap-4 rounded-xl border border-[var(--border-subtle)] p-4',
    details: 'grid grid-cols-1 gap-3 @xs:grid-cols-2',
    plot: 'min-h-36',
  },
  expressive: {
    body: 'flex flex-col gap-3',
    headline: 'flex items-center justify-between gap-4 rounded-t-3xl rounded-br-3xl rounded-bl-lg bg-[var(--surface-2)] p-4',
    details: 'flex flex-wrap gap-x-6 gap-y-3 px-1',
    plot: 'min-h-36 rounded-t-xl border-t border-[var(--border-subtle)] pt-3',
  },
  pixel: {
    body: 'flex flex-col gap-3',
    headline: 'flex items-center gap-3 border-2 border-[var(--border-strong)] p-3 font-mono',
    details: 'grid grid-cols-1 gap-3 border-y border-dashed border-[var(--border-strong)] py-3 @xs:grid-cols-2',
    plot: 'min-h-36',
  },
};

export default function LineTelemetryLayout({
  appearance, compact, context, headline, details, chart, sourceBoundary,
}: LineTelemetryProps) {
  const layout = layouts[appearance];
  const plot = !compact && (
    <div key="plot" className={cn('min-w-0 flex-1', layout.plot)}>{chart}</div>
  );
  const facts = (
    <dl key="facts" className={layout.details}>
      {details.map(metric => (
        <div key={metric.label} className="min-w-0">
          <MetricLabel as="dt">{metric.label}</MetricLabel>
          <MetricValue as="dd" className="break-words">
            {metric.value ?? '—'}
            {metric.value != null && metric.unit && <Caption className="ms-1">{metric.unit}</Caption>}
          </MetricValue>
        </div>
      ))}
    </dl>
  );

  return (
    <div data-line-appearance={appearance} className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      {context}
      {sourceBoundary(
        <div className={cn('min-h-0 min-w-0 flex-1', compact ? 'flex flex-col gap-3' : layout.body)}>
          <div className={layout.headline}>
            {appearance === 'pixel' ? (
              <svg viewBox="0 0 16 16" className="size-8 shrink-0" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true">
                <path d="M1 2h2v11h12v2H1zM4 9h2V7h2v3h2V4h2v5h2v2h-4V8H8v4H6v-1H4z" />
              </svg>
            ) : ['studio', 'iconic', 'expressive'].includes(appearance) ? (
              <Activity className={cn('shrink-0 text-[var(--text-secondary)]', appearance === 'iconic' ? 'size-10' : 'size-6')} aria-hidden="true" />
            ) : null}
            <dl className="min-w-0">
              <MetricLabel as="dt">{headline.label}</MetricLabel>
              <MetricValue as="dd" className="break-words">
                {headline.value ?? '—'}
                {headline.value != null && headline.unit && <Caption className="ms-1">{headline.unit}</Caption>}
              </MetricValue>
            </dl>
          </div>
          {layout.plotFirst && plot}
          {facts}
          {!layout.plotFirst && plot}
        </div>,
      )}
    </div>
  );
}

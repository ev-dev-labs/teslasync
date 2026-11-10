import { Thermometer } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { PackAppearance } from '../types';
import type { ClimatePresentationProps } from './Climate.types';
import { EXPERIMENTAL_LAYOUTS, experimentalLayouts, isExperimentalAppearance } from '../experimentalLayouts';

const layouts: Record<PackAppearance, { main: string; readings: string }> = {
  ...experimentalLayouts(({ lead, details }) => ({
    main: lead, readings: cn('grid grid-cols-1 gap-3 @xs:grid-cols-2', details),
  })),
  studio: { main: 'rounded-xl border-s-4 border-[var(--border-strong)] p-3', readings: 'grid grid-cols-1 gap-3 @xs:grid-cols-2' },
  elevated: { main: 'rounded-2xl bg-[var(--surface-2)] p-4', readings: 'flex flex-wrap justify-between gap-4' },
  precision: { main: 'border-b border-[var(--border-subtle)] pb-4', readings: 'flex flex-wrap gap-x-6 gap-y-3' },
  owner: { main: 'rounded-lg bg-[var(--surface-2)] p-3', readings: 'grid grid-cols-1 gap-3 @xs:grid-cols-2' },
  iconic: { main: 'rounded-2xl border-2 border-[var(--border-subtle)] p-4', readings: 'flex flex-wrap justify-between gap-4' },
  expressive: { main: 'rounded-t-3xl rounded-br-3xl rounded-bl-lg bg-[var(--surface-2)] p-4', readings: 'grid grid-cols-1 gap-3 @xs:grid-cols-2' },
  pixel: { main: 'border-2 border-[var(--border-strong)] p-3 font-mono', readings: 'grid grid-cols-1 gap-3 border-t border-dashed border-[var(--border-strong)] pt-3 @xs:grid-cols-2' },
};

export default function ClimateStatusLayout({ appearance, headline, status, airflow, outside, setpoint }: ClimatePresentationProps) {
  const layout = layouts[appearance];
  const experiment = isExperimentalAppearance(appearance) ? EXPERIMENTAL_LAYOUTS[appearance] : null;
  const airflowFirst = appearance === 'studio' || experiment?.order[0] === 'visual';
  const ventilation = experiment ? <div key="airflow" className={experiment.visual}>{airflow}</div> : airflow;
  return (
    <div data-climate-appearance={appearance} className="flex min-w-0 flex-col gap-3">
      {appearance === 'owner' && <div className="flex flex-wrap items-center justify-between gap-3">{status}{setpoint}</div>}
      <div className={cn('flex min-w-0 flex-wrap items-center justify-between gap-3', layout.main)}>
        {appearance === 'iconic' && <Thermometer className="size-10 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />}
        {appearance === 'pixel' && <svg viewBox="0 0 16 16" className="size-8 shrink-0" fill="currentColor" aria-hidden="true" shapeRendering="crispEdges">
          <path d="M6 1h4v8h2v5H4V9h2zm2 2v8H6v1h4v-1H8V3z" />
        </svg>}
        {headline}
        {appearance !== 'owner' && status}
      </div>
      {airflowFirst && ventilation}
      <div className={layout.readings}>{outside}{appearance !== 'owner' && setpoint}</div>
      {!airflowFirst && ventilation}
    </div>
  );
}

import { Thermometer } from 'lucide-react';
import { cn } from '@/lib/cn';

export default function ClimateAirflow({ active, compact = false }: { active: boolean; compact?: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-climate-airflow={active ? 'active' : 'static'}
      className={cn(
        'relative flex w-full shrink-0 items-center overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--widget-well,var(--surface-1))] px-4',
        compact ? 'h-4' : 'h-10',
        active && 'widget-activity-active',
      )}
    >
      <Thermometer className={cn('shrink-0', compact ? 'size-3' : 'size-6', active ? 'text-[var(--semantic-info)]' : 'text-[var(--text-muted)]')} />
      <svg viewBox="0 0 400 72" preserveAspectRatio="none" className="ms-4 h-full min-w-0 flex-1 text-[var(--semantic-info)]">
        {[14, 25, 36, 47, 58].map(y => (
          <path
            key={y}
            d={`M0 ${y} C90 ${y - 10} 150 ${y + 10} 230 ${y} S330 ${y - 8} 400 ${y}`}
            stroke="currentColor"
            strokeWidth="1.5"
            strokeDasharray="24 24"
            fill="none"
            opacity={active ? 0.65 : 0.18}
            className={active ? 'widget-state-motion widget-airflow-motion' : undefined}
          />
        ))}
      </svg>
    </div>
  );
}

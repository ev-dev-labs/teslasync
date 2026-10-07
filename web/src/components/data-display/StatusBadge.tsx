import { cn } from '@/lib/cn';
import { getStateDefinition } from '@/types/fsm';
import type { VehicleStatus } from '@/api/types';

interface StatusBadgeProps {
  /**
   * Vehicle status to render. Accepts the canonical {@link VehicleStatus} union,
   * any raw string (e.g. an FSM state the union hasn't caught up with), or a
   * nullish value — nullish/blank fails closed to a neutral placeholder chip.
   */
  status: VehicleStatus | (string & {}) | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

const sizes = {
  sm: { dot: 'h-1.5 w-1.5', text: 'text-xs', gap: 'gap-1', px: 'px-1.5 py-0.5' },
  md: { dot: 'h-2 w-2', text: 'text-sm', gap: 'gap-1.5', px: 'px-2 py-1' },
} as const;

const EMPTY_LABEL = '—';

export function StatusBadge({ status, size = 'md', className }: StatusBadgeProps) {
  const s = sizes[size];
  // Fail closed: coerce nullish (and trim whitespace-only) status to '' so
  // getStateDefinition — which lowercases the state name — never throws on a
  // null/undefined value, and so we render an em-dash placeholder instead of a
  // blank, colourless chip.
  const label = typeof status === 'string' ? status.trim() : '';
  const dotColor = getStateDefinition('vehicle', label).badgeDot;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-[var(--control-border)] bg-[var(--control-bg)] font-medium',
        s.gap,
        s.px,
        s.text,
        className,
      )}
    >
      {/* Decorative colour cue — the adjacent text already names the status. */}
      <span className={cn('inline-block rounded-full', s.dot, dotColor)} aria-hidden="true" />
      <span className="capitalize text-[var(--text-secondary)]">{label || EMPTY_LABEL}</span>
    </span>
  );
}

import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
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
  /** Localized presentation only; status still owns the FSM lookup. */
  label?: string;
}

const sizes = {
  sm: { dot: 'h-1.5 w-1.5', text: typography.size.xs, gap: 'gap-1', px: 'px-1.5 py-0.5' },
  md: { dot: 'h-2 w-2', text: typography.size.sm, gap: 'gap-1.5', px: 'px-2 py-1' },
} as const;

const EMPTY_LABEL = '—';

// Adapt existing FSM hue classes, not state identities or domain thresholds.
const restrainedDot = [
  '[&.bg-green-400]:bg-[var(--semantic-success)]',
  '[&.bg-blue-500]:bg-[var(--semantic-info)]',
  '[&.bg-yellow-400]:bg-[var(--semantic-warning)]',
  '[&.bg-cyan-500]:bg-[var(--semantic-info)]',
  '[&.bg-indigo-500]:bg-[var(--semantic-info)]',
  '[&.bg-purple-500]:bg-[var(--semantic-purple)]',
  '[&.bg-red-400]:bg-[var(--semantic-danger)]',
  '[&.bg-gray-400]:bg-[var(--text-secondary)]',
].join(' ');

export function StatusBadge({ status, size = 'md', className, label: presentationLabel }: StatusBadgeProps) {
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
        'inline-flex min-w-0 max-w-full items-center rounded-full border border-[var(--control-border)] bg-[var(--control-bg)] whitespace-normal break-words forced-colors:border-[CanvasText]',
        typography.weight.medium,
        s.gap,
        s.px,
        s.text,
        className,
      )}
    >
      {/* Decorative colour cue — the adjacent text already names the status. */}
      <span className={cn('inline-block shrink-0 rounded-full', s.dot, dotColor, restrainedDot)} aria-hidden="true" />
      <span className={cn('min-w-0', typography.color.secondary)}>{label ? (presentationLabel ?? label) : EMPTY_LABEL}</span>
    </span>
  );
}

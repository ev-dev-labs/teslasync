import { cn } from '@/lib/cn';
import { getStateColor } from '@/types/fsm';

interface StateBadgeProps {
  /**
   * FSM state name (e.g. "driving"). Matching is case-insensitive and
   * surrounding whitespace is ignored. A nullish or blank value renders a
   * neutral placeholder instead of throwing.
   */
  state?: string | null;
  /** FSM type key (e.g. "vehicle"). Unknown types fall back to the vehicle FSM. */
  fsmType: string;
}

/** Rendered when the state is missing or blank so the badge is never empty. */
const EMPTY_STATE_LABEL = '—';

export function StateBadge({ state, fsmType }: StateBadgeProps) {
  const normalized = state?.trim() ?? '';
  const color = getStateColor(fsmType, normalized);
  const label = normalized || EMPTY_STATE_LABEL;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
        color.bg,
        color.text,
      )}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', color.dot)}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

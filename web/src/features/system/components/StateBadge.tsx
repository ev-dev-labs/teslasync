import { cn } from '@/lib/cn';
import { getStateColor } from '@/types/fsm';

interface StateBadgeProps {
  state: string;
  fsmType: string;
}

export function StateBadge({ state, fsmType }: StateBadgeProps) {
  const color = getStateColor(fsmType, state);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
        color.bg,
        color.text,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', color.dot)} />
      {state}
    </span>
  );
}

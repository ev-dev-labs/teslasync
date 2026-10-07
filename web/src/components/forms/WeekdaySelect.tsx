import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

export interface WeekdaySelectOption {
  readonly id: number;
  readonly label: ReactNode;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
}

export interface WeekdaySelectProps {
  readonly options: readonly WeekdaySelectOption[];
  /** Explicit selection; an empty array means no selected days. */
  readonly selectedIds: readonly number[];
  /** Appends additions and preserves the order of all remaining IDs. */
  readonly onChange: (selectedIds: number[]) => void;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function WeekdaySelect({
  options,
  selectedIds,
  onChange,
  ariaLabel,
  disabled = false,
  className,
}: WeekdaySelectProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}
    >
      {options.map(option => {
        const selected = selectedIds.includes(option.id);
        return (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={selected ? 'primary' : 'secondary'}
            disabled={disabled || option.disabled}
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            className="h-auto min-h-11 min-w-11 max-w-full whitespace-normal px-3 py-2"
            onClick={() => onChange(
              selected
                ? selectedIds.filter(id => id !== option.id)
                : [...selectedIds, option.id],
            )}
          >
            <span className="min-w-0 [overflow-wrap:anywhere]">{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

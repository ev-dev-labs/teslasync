import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface ToggleProps extends Omit<HTMLAttributes<HTMLLabelElement>, 'onChange'> {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md';
  className?: string;
}

const trackSize = {
  sm: 'h-5 w-9',
  md: 'h-6 w-11',
} as const;

const thumbSize = {
  sm: 'h-3.5 w-3.5',
  md: 'h-5 w-5',
} as const;

const thumbTranslate = {
  sm: 'translate-x-4',
  md: 'translate-x-5',
} as const;

export const Toggle = forwardRef<HTMLLabelElement, ToggleProps>(
  ({ label, checked, onChange, size = 'md', className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('inline-flex items-center gap-2 cursor-pointer select-none', className)}
      {...props}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex shrink-0 rounded-full transition-colors duration-200',
          trackSize[size],
          checked
            ? 'bg-cyan-500 dark:bg-cyan-600'
            : 'bg-gray-300 dark:bg-gray-600',
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block rounded-full bg-white shadow-sm transition-transform duration-200',
            thumbSize[size],
            'translate-y-[3px] translate-x-[3px]',
            checked && thumbTranslate[size],
          )}
        />
      </button>
      {label && (
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </span>
      )}
    </label>
  ),
);
Toggle.displayName = 'Toggle';

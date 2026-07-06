import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  color?: string;
  pulse?: boolean;
  className?: string;
}

export const StatusPill = forwardRef<HTMLSpanElement, StatusPillProps>(
  ({ color = 'bg-gray-500', pulse = false, className, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        'bg-[var(--surface-2)] text-[var(--text-primary)]',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 rounded-full shrink-0',
          color,
          pulse && 'animate-pulse',
        )}
      />
      {children}
    </span>
  ),
);
StatusPill.displayName = 'StatusPill';

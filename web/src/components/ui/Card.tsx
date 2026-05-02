import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Padding scale. Defaults to `'md'`. Pass `'auto'` to follow the user's
   * `ui_density` setting via the density-aware Tailwind utilities
   * (`px-d-pad-x py-d-pad-y`); see `useDensitySync` and `index.css`.
   * (Phase 40 / Prompt 44.)
   */
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'auto';
  hover?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ padding = 'md', hover, className, children, ...props }, ref) => {
    const paddings: Record<NonNullable<CardProps['padding']>, string> = {
      none: '',
      sm: 'p-3',
      md: 'p-4',
      lg: 'p-6',
      auto: 'px-d-pad-x py-d-pad-y',
    };
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-lg border border-[var(--glass-border)] bg-[var(--surface-1)] text-[var(--text-primary)] shadow-sm',
          paddings[padding],
          hover && 'cursor-pointer transition-shadow hover:shadow-md',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Card.displayName = 'Card';

export interface CardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-4 flex items-center justify-end gap-2 border-t border-[var(--glass-border)] pt-4', className)}>
      {children}
    </div>
  );
}

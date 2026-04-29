import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'sm' | 'md' | 'lg';
  hover?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ padding = 'md', hover, className, children, ...props }, ref) => {
    const paddings = { sm: 'p-3', md: 'p-4', lg: 'p-6' };
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

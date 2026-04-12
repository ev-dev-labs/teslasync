import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface GridProps {
  cols?: { default?: number; sm?: number; md?: number; lg?: number; xl?: number };
  gap?: number;
  children: ReactNode;
  className?: string;
}

const colsMap: Record<number, string> = {
  1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4',
  5: 'grid-cols-5', 6: 'grid-cols-6',
};

export function Grid({ cols = { default: 1 }, gap = 4, children, className }: GridProps) {
  return (
    <div
      className={cn(
        'grid',
        cols.default && colsMap[cols.default],
        cols.sm && `sm:${colsMap[cols.sm]}`,
        cols.md && `md:${colsMap[cols.md]}`,
        cols.lg && `lg:${colsMap[cols.lg]}`,
        `gap-${gap}`,
        className,
      )}
    >
      {children}
    </div>
  );
}

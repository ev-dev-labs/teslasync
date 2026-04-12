import { type ElementType, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

type StackProps<T extends ElementType = 'div'> = {
  as?: T;
  direction?: 'row' | 'col';
  gap?: 1 | 2 | 3 | 4 | 6 | 8;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
} & ComponentPropsWithoutRef<T>;

const gapMap: Record<number, string> = {
  1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 6: 'gap-6', 8: 'gap-8',
};

export function Stack<T extends ElementType = 'div'>({
  as, direction = 'col', gap = 4, align, justify, className, ...props
}: StackProps<T>) {
  const Component = as ?? 'div';
  return (
    <Component
      className={cn(
        'flex',
        direction === 'col' ? 'flex-col' : 'flex-row',
        gapMap[gap],
        align && `items-${align}`,
        justify && `justify-${justify}`,
        className,
      )}
      {...props}
    />
  );
}

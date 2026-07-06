import { type ElementType, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

type StackGap = 1 | 2 | 3 | 4 | 6 | 8;
type StackAlign = 'start' | 'center' | 'end' | 'stretch';
type StackJustify = 'start' | 'center' | 'end' | 'between';

type StackProps<T extends ElementType = 'div'> = {
  as?: T;
  direction?: 'row' | 'col';
  gap?: StackGap;
  align?: StackAlign;
  justify?: StackJustify;
} & ComponentPropsWithoutRef<T>;

// Full, literal class strings (never string-interpolated) so Tailwind's JIT
// content scanner always emits them. `items-${align}`-style interpolation is
// invisible to the scanner and can silently drop the generated CSS.
const gapMap: Record<number, string> = {
  1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 6: 'gap-6', 8: 'gap-8',
};

const alignMap: Record<StackAlign, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

const justifyMap: Record<StackJustify, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
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
        gapMap[gap] ?? gapMap[4],
        align && alignMap[align],
        justify && justifyMap[justify],
        className,
      )}
      {...props}
    />
  );
}

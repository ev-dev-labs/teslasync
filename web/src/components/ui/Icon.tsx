import { type SVGProps } from 'react';
import { cn } from '@/lib/cn';
import type { LucideIcon } from '@/lib/icons';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  /** The icon component from `Icons.<concept>` (see `@/lib/icons`). */
  icon: LucideIcon;
  /** Tailwind size token. Default `md` = h-4 w-4. */
  size?: IconSize;
  /** Extra Tailwind classes. */
  className?: string;
  /** Pass true (default) for decorative icons. Set `aria-label` for meaningful ones. */
  'aria-hidden'?: boolean;
  /** Accessible label — when set, the icon is treated as meaningful (`role=img`). */
  'aria-label'?: string;
}

const SIZE_CLASSES: Record<IconSize, string> = {
  xs: 'h-3 w-3',
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
  xl: 'h-6 w-6',
};

/**
 * Standardized icon renderer. Always use this with `Icons.<concept>` from
 * `@/lib/icons` instead of importing icons directly from `lucide-react`.
 *
 * Defaults:
 *  - size = `md` (h-4 w-4)
 *  - decorative (`aria-hidden=true`) unless an `aria-label` is provided
 *  - `shrink-0` so icons don't get squeezed inside flex containers
 *
 * @example
 *   import { Icon } from '@/components/ui';
 *   import { Icons } from '@/lib/icons';
 *   <Icon icon={Icons.battery} size="lg" />
 */
export function Icon({
  icon: IconComponent,
  size = 'md',
  className,
  'aria-label': ariaLabel,
  'aria-hidden': ariaHidden,
  ...rest
}: IconProps) {
  // Leaf design-system primitive rendered in hundreds of places — a missing
  // icon reference must degrade to rendering nothing rather than crashing the
  // whole subtree with React's "Element type is invalid" error.
  if (!IconComponent) return null;

  // Guard against out-of-range `size` values arriving from untyped/dynamic
  // data so the icon never renders without its sizing box.
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;

  const a11y = ariaLabel
    ? { 'aria-label': ariaLabel, role: 'img' as const }
    : { 'aria-hidden': ariaHidden ?? true };

  return (
    <IconComponent
      className={cn(sizeClass, 'shrink-0', className)}
      // Decorative SVGs must never become a legacy-browser tab stop; callers
      // can still override via `...rest` when the icon is genuinely focusable.
      focusable={false}
      {...a11y}
      {...rest}
    />
  );
}

import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  /**
   * Tooltip content. Strings render in a single line by default; pass JSX (or
   * set `multiline`) when the content needs to wrap.
   */
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * When true (or when `content` is non-string JSX with its own width
   * constraints), the tooltip body wraps onto multiple lines instead of
   * forcing `whitespace-nowrap`. Used by `HelpTooltip` for long help bodies.
   */
  multiline?: boolean;
  children: ReactNode;
}

const sideClasses = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
} as const;

/**
 * Hover/focus tooltip.
 *
 * Accessibility (Phase-40 / Prompt 20):
 * - Tooltip body has `role="tooltip"` + a stable id.
 * - When `children` is a single element, the tooltip id is added to that
 *   element's `aria-describedby` (preserving any existing value) so screen
 *   readers announce the tooltip text after the trigger's own name.
 * - The visibility CSS handles both `:hover` AND `:focus-within` so keyboard
 *   users (Tab into a button wrapped in a tooltip) get the same affordance as
 *   mouse users.
 *
 * Touch devices (Phase-40 / Prompt 47):
 * - Wrap a focusable trigger (e.g. <button>) and tapping it grants focus,
 *   triggering `:focus-within` on the wrapper — so the tooltip appears on
 *   tap. Tapping outside blurs the trigger and dismisses the tooltip.
 *
 * Reduced motion (Phase-40 / Prompt 47):
 * - The reveal transition is disabled globally via the `motion-reduce`
 *   variant when the user has `prefers-reduced-motion: reduce`.
 */
export function Tooltip({ content, side = 'top', multiline, children }: TooltipProps) {
  const tooltipId = useId();

  // We try to attach `aria-describedby` directly to the trigger element so
  // assistive tech reads the tooltip after the trigger name. This works when
  // children is a single React element (the common case — wrapping one
  // <button>/<IconBox>/etc.). For text-only or multiple children we fall back
  // to the wrapper span, which still satisfies role="tooltip" semantics.
  const child = Children.count(children) === 1 ? Children.only(children) : null;
  const enrichedChild =
    child && isValidElement(child)
      ? (cloneElement(child as ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': [
            (child.props as { 'aria-describedby'?: string })['aria-describedby'],
            tooltipId,
          ]
            .filter(Boolean)
            .join(' '),
        }) as ReactNode)
      : children;

  return (
    <span className="relative inline-flex group/tip">
      {enrichedChild}
      <span
        id={tooltipId}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 rounded-lg px-2.5 py-1.5 text-xs font-medium',
          multiline ? 'whitespace-normal max-w-[260px]' : 'whitespace-nowrap',
          'bg-gray-900 text-gray-100 shadow-lg dark:bg-gray-100 dark:text-gray-900',
          'opacity-0 scale-95 transition-all duration-fast motion-reduce:transition-none',
          'group-hover/tip:opacity-100 group-hover/tip:scale-100',
          'group-focus-within/tip:opacity-100 group-focus-within/tip:scale-100',
          sideClasses[side],
        )}
      >
        {content}
      </span>
    </span>
  );
}

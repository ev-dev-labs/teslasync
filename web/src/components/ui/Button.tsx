import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { useMotionPreference } from '@/hooks/useMotionPreference';

// Neutral variants resolve their chrome from the `--control-*` tokens
// (index.css → CONTROL SURFACE) rather than Tailwind's fixed `gray-*` ramp.
// Previously `secondary`/`outline`/`ghost` rendered the same slate grey on
// every one of the 140 presets, so a Dracula or Solarized user got buttons
// that did not belong to their palette. They now track the active theme.
export const BUTTON_VARIANTS = {
  primary: 'border border-transparent bg-[var(--theme-primary)] text-[var(--theme-on-primary)] shadow-sm hover:brightness-105 forced-colors:border forced-colors:border-[ButtonBorder] forced-colors:[forced-color-adjust:none] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]',
  secondary: 'bg-[var(--control-bg)] text-[var(--text-primary)] border border-[var(--control-border)] hover:bg-[var(--control-bg-hover)] hover:border-[var(--control-border-hover)] forced-colors:border forced-colors:border-[ButtonBorder]',
  outline: 'border border-[var(--control-border)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--control-bg)] hover:border-[var(--control-border-hover)] forced-colors:border-[ButtonBorder]',
  danger: 'border border-[var(--semantic-danger)] bg-[var(--semantic-danger-bg)] text-[var(--semantic-danger)] hover:bg-[var(--control-bg-hover)] active:bg-[var(--control-bg)] forced-colors:border forced-colors:border-[ButtonBorder] forced-colors:[forced-color-adjust:none] forced-colors:bg-[ButtonFace] forced-colors:text-[ButtonText]',
  ghost: 'bg-transparent text-[var(--text-primary)] hover:bg-[var(--control-bg)] forced-colors:border forced-colors:border-[ButtonBorder]',
} as const;

/**
 * Chrome shared by every Button — shape, focus outline and disabled treatment.
 *
 * Exported because a handful of CTAs must render as `<a>`/`<Link>` rather than
 * `<button>` (EmptyState's `actionTo`), and previously hand-copied these
 * classes. Those copies silently drifted when the neutral variants moved onto
 * the `--control-*` tokens, leaving link CTAs on the old slate-grey ramp. Reuse
 * this constant instead of re-deriving it.
 */
export const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-shape-sm font-medium transition-colors duration-fast ease-standard motion-reduce:transition-none ' +
  // A crisp outline remains visible when forced colors suppress box shadows.
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] forced-colors:focus-visible:outline-[Highlight] ' +
  'disabled:pointer-events-none disabled:border-[var(--border-default)] disabled:bg-[var(--surface-2)] disabled:text-[var(--text-secondary)] disabled:shadow-none disabled:opacity-100';

const variants = BUTTON_VARIANTS;

const sizes = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
  // Density-aware sizing follows the user's `ui_density` setting via the
  // density Tailwind utilities (`min-h-d-row px-d-pad-x text-d-base`).
  auto: 'min-h-d-row px-d-pad-x text-d-base',
} as const;

const wrappingSizes = {
  sm: 'h-auto min-h-9 py-1.5',
  md: 'h-auto min-h-10 py-2',
  lg: 'h-auto min-h-12 py-2.5',
  auto: 'h-auto py-d-pad-y',
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: React.ReactNode;
  /** Grow multiline labels within the allocated width; fixed/icon sizing is unchanged by default. */
  wrapLabel?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, icon, wrapLabel = false, className, children, disabled, ...props }, ref) => {
    const { reduce } = useMotionPreference();
    return (
    <button
      ref={ref}
      className={cn(
        BUTTON_BASE,
        reduce && 'transition-none',
        variants[variant],
        sizes[size],
        wrapLabel && 'min-w-0 max-w-full whitespace-normal',
        wrapLabel && wrappingSizes[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        // Decorative spinner: the loading state is already announced to
        // assistive tech via the button's aria-busy, so the SVG itself must
        // stay out of the accessibility tree.
        <svg className={cn('h-4 w-4 shrink-0 motion-reduce:animate-none', !reduce && 'animate-spin')} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : wrapLabel && icon ? <span className="inline-flex shrink-0">{icon}</span> : icon}
      {wrapLabel ? <span className="min-w-0 break-words">{children}</span> : children}
    </button>
    );
  },
);
Button.displayName = 'Button';

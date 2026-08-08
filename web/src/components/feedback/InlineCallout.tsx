import { type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export type CalloutVariant = 'info' | 'success' | 'warning' | 'danger';

const VARIANT_STYLES: Record<CalloutVariant, { bg: string; ring: string; text: string; iconText: string }> = {
  info:    { bg: 'bg-cyan-500/5',     ring: 'ring-cyan-400/20',     text: 'text-[var(--text-secondary)]', iconText: 'text-cyan-300' },
  success: { bg: 'bg-emerald-500/5',  ring: 'ring-emerald-400/20',  text: 'text-[var(--text-secondary)]', iconText: 'text-emerald-300' },
  warning: { bg: 'bg-amber-500/5',    ring: 'ring-amber-400/25',    text: 'text-amber-800 dark:text-amber-200', iconText: 'text-amber-300' },
  danger:  { bg: 'bg-rose-500/5',     ring: 'ring-rose-400/25',     text: 'text-rose-800 dark:text-rose-200',   iconText: 'text-rose-300' },
};

export interface InlineCalloutProps {
  /** Severity tier — drives colour. */
  variant: CalloutVariant;
  /** Leading icon (e.g. `<AlertTriangle />`). */
  icon?: ReactNode;
  /** Body text or rich children. */
  children: ReactNode;
  /**
   * Optional action — when provided, the whole callout becomes clickable
   * and renders a trailing chevron. Use `href` for navigation, `onClick`
   * for in-app actions; passing both prefers `href`.
   */
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  /** Additional class names on the outer container. */
  className?: string;
  /** Test hook. */
  testId?: string;
}

/**
 * `InlineCallout` — single-line, low-chrome callout for surfacing one
 * actionable insight inside a larger card (e.g. "1 anomaly in this
 * range — Apr 24 →"). Differs from `<AlertBanner>` which is a full
 * page-level banner with title/body/dismiss.
 *
 * Designed to live inside a section card footer: no rounded outer
 * shell, just a tinted background with subtle ring.
 */
export function InlineCallout({
  variant,
  icon,
  children,
  action,
  className,
  testId,
}: InlineCalloutProps) {
  const v = VARIANT_STYLES[variant];

  const content = (
    <>
      {icon && (
        <span className={cn('shrink-0 inline-flex [&>svg]:h-4 [&>svg]:w-4', v.iconText)} aria-hidden>
          {icon}
        </span>
      )}
      <span className={cn('text-xs flex-1 min-w-0', v.text)}>{children}</span>
      {action && (
        <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium shrink-0', v.iconText)}>
          {action.label}
          <ChevronRight className="h-3 w-3" aria-hidden />
        </span>
      )}
    </>
  );

  const baseClass = cn(
    'inline-flex w-full items-center gap-2 rounded-lg px-3 py-2 ring-1 transition-colors',
    v.bg,
    v.ring,
    action && 'hover:bg-[var(--surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
    className,
  );

  if (action?.href) {
    return (
      <a
        href={action.href}
        className={baseClass}
        data-testid={testId}
      >
        {content}
      </a>
    );
  }

  if (action?.onClick) {
    return (
      <button
        type="button"
        onClick={action.onClick}
        className={baseClass}
        data-testid={testId}
      >
        {content}
      </button>
    );
  }

  return (
    <div role="status" className={baseClass} data-testid={testId}>
      {content}
    </div>
  );
}

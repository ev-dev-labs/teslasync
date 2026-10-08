import { type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { neonColorMap, semanticToNeon, typography } from '@/lib/tokens';
import { Button, BUTTON_BASE } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Text } from '../ui/Typography';

export type CalloutVariant = 'info' | 'success' | 'warning' | 'danger';

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
 * `InlineCallout` — low-chrome callout for surfacing one
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
  const v = neonColorMap[semanticToNeon[variant]];

  const content = (
    <>
      {icon && (
        <span className={cn('shrink-0 inline-flex [&>svg]:h-4 [&>svg]:w-4', v.text)} aria-hidden>
          {icon}
        </span>
      )}
      <Text size="xs" color="secondary" className="flex-1 min-w-0 break-words">{children}</Text>
      {action && (
        <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1', v.text)}>
          <Text size="xs" weight="medium" className="min-w-0 break-words">{action.label}</Text>
          <Icon icon={ChevronRight} size="xs" className="rtl:rotate-180" />
        </span>
      )}
    </>
  );

  const baseClass = cn(
    action && BUTTON_BASE,
    'inline-flex w-full min-w-0 max-w-full flex-wrap items-center justify-start gap-2 rounded-shape-sm px-3 py-2 ring-1 text-start',
    typography.size.xs,
    typography.weight.regular,
    typography.color.secondary,
    v.bg,
    v.ring,
    action && 'h-auto min-h-11 md:min-h-0 hover:bg-[var(--surface-2)]',
    'forced-colors:border forced-colors:border-[CanvasText]',
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
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={action.onClick}
        className={baseClass}
        data-testid={testId}
      >
        {content}
      </Button>
    );
  }

  return (
    <div role="status" className={baseClass} data-testid={testId}>
      {content}
    </div>
  );
}

import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface EmptyStateThresholdProps {
  /** How many items the user currently has. */
  currentCount: number;
  /** Minimum items required for the section to become useful. */
  threshold: number;
  /**
   * Short noun label for the *items* (e.g. "sessions", "drives", "trips").
   * Used to compose the default "Need at least N {label}…" message.
   */
  itemNoun?: string;
  /**
   * Short label for the section being gated (e.g. "Cost Heatmap",
   * "Optimizer recommendations"). Rendered as the title.
   */
  sectionLabel: string;
  /** Optional one-line description below the title. */
  description?: ReactNode;
  /**
   * Override the auto-generated message. Use when default phrasing
   * doesn't fit (e.g. when threshold isn't a simple count).
   */
  message?: ReactNode;
  /** Optional CTA below the message (e.g. "Adjust filters"). */
  action?: ReactNode;
  className?: string;
  /** Test hook. */
  testId?: string;
}

/**
 * `EmptyStateThreshold` — non-error empty state for sections that
 * become useful only at scale (e.g. heatmap needs ≥ 30 sessions).
 *
 * Rendered with a green checkmark (the section is *healthy*, just
 * waiting for more data) and a friendly count message. Per the
 * /charging redesign spec: never silently hide a section — operators
 * should see it exists and know what unlocks it.
 *
 * Default copy:
 *   "Need at least N {itemNoun} to show meaningful patterns. You have M so far."
 */
export function EmptyStateThreshold({
  currentCount,
  threshold,
  itemNoun,
  sectionLabel,
  description,
  message,
  action,
  className,
  testId,
}: EmptyStateThresholdProps) {
  const { t } = useTranslation();
  const noun = itemNoun ?? t('emptyState.threshold.defaultItem', 'items');

  const defaultMessage = t(
    'emptyState.threshold.message',
    'Need at least {{threshold}} {{noun}} to show meaningful patterns. You have {{current}} so far.',
    { threshold, noun, current: currentCount },
  );

  return (
    <div
      data-testid={testId}
      role="status"
      aria-live="polite"
      className={cn(
        'rounded-2xl border border-[var(--glass-border)] bg-[var(--surface-1)]/40',
        'px-4 py-5 sm:px-5 sm:py-6',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <CheckCircle2
          className="h-5 w-5 shrink-0 text-emerald-400"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              {sectionLabel}
            </h3>
            <Info
              className="h-3 w-3 text-[var(--text-muted)]"
              aria-hidden
            />
          </div>
          {description && (
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {description}
            </p>
          )}
          <p className="mt-2 text-xs text-[var(--text-muted)] leading-relaxed">
            {message ?? defaultMessage}
          </p>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}

import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

/**
 * One row of the shared detail-card primitive.
 *
 * Speaks the `rows` language from the widget-redesign spec: a title with an
 * optional muted subtitle on the left, a right-aligned value with an optional
 * muted hint underneath, an optional leading status dot, and an optional
 * status pill. Plain label/value rows stay exactly that — subtitle, hint,
 * dot, and pill are all opt-in per row.
 */
export interface DetailEntry {
  id?: string | number;
  label: string;
  /** Muted secondary line under the label (e.g. "Renews Nov 14"). Caller passes translated text. */
  sublabel?: string;
  value: string | number | null;
  /** Muted secondary line under the value (e.g. "/mo", "used"). Right-aligned beside the label column. */
  hint?: string;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'info' | 'neutral' };
  /**
   * Leading status dot. Color means status only: the dot is decorative
   * (aria-hidden) and the adjacent label/value/badge text always names the
   * state, so meaning never travels by color alone.
   */
  status?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  mono?: boolean;
}

interface WidgetDetailCardProps {
  entries: DetailEntry[];
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

const badgeVariantMap = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  info: 'info',
  neutral: 'neutral',
} as const;

/** Status-dot fill per state; mirrors the shared freshness/semantic tiers. */
const statusDotClass = {
  success: 'bg-[var(--semantic-success)]',
  warning: 'bg-[var(--semantic-warning)]',
  error: 'bg-[var(--semantic-danger)]',
  info: 'bg-[var(--semantic-info)]',
  neutral: 'bg-[var(--text-secondary)]',
} as const;

export function WidgetDetailCard({
  entries,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetDetailCardProps) {
  const { t } = useTranslation('dashboard');

  // Defensive against a nullish `entries` slipping through a loosely-typed call
  // site (widgets build these lazily from optional query data). Guarding here
  // keeps `.length`/`.slice` from throwing before the empty state can render.
  const source = entries ?? [];

  if (source.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={emptyIcon}
        message={emptyMessage ?? t('widget.noDetails', 'No details available')}
        className="py-4"
      />
    );
  }

  const visible = compact ? source.slice(0, 4) : source;

  return (
    <KVList
      layout="responsive"
      wrap
      className="h-full overflow-y-auto"
      items={visible.map((entry) => ({
        id: entry.id,
        label: (
          <span className="flex min-w-0 items-center gap-2">
            {entry.status && (
              <span
                aria-hidden="true"
                className={cn('h-2 w-2 shrink-0 rounded-full', statusDotClass[entry.status])}
              />
            )}
            <span className="min-w-0">
              <span className="block whitespace-normal text-sm font-medium text-[var(--text-primary)] [overflow-wrap:anywhere]">
                {entry.label}
              </span>
              {entry.sublabel && (
                <span className="block whitespace-normal text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">
                  {entry.sublabel}
                </span>
              )}
            </span>
          </span>
        ),
        value: (
          <span className="inline-flex max-w-full flex-wrap items-center gap-2">
            <span className={cn('min-w-0 whitespace-normal [overflow-wrap:anywhere]', entry.mono && 'font-mono')}>
              {entry.value ?? '—'}
            </span>
            {entry.badge && (
              <Badge variant={badgeVariantMap[entry.badge.variant]} size="sm">
                {entry.badge.text}
              </Badge>
            )}
            {entry.hint && (
              <span className="w-full whitespace-normal text-xs text-[var(--text-muted)] [overflow-wrap:anywhere]">
                {entry.hint}
              </span>
            )}
          </span>
        ),
      }))}
    />
  );
}

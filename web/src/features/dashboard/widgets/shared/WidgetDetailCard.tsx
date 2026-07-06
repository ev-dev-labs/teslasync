import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

export interface DetailEntry {
  label: string;
  value: string | number | null;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'neutral' };
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
  neutral: 'neutral',
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
    <dl className="overflow-y-auto h-full">
      {visible.map((entry, i) => (
        <div
          key={`${entry.label}-${i}`}
          className={cn(
            'flex items-center justify-between gap-3 py-2 px-1',
            i < visible.length - 1 && 'border-b border-white/[0.06]',
          )}
        >
          <dt className="min-w-0 truncate text-2xs uppercase text-[var(--text-muted)] tracking-wide">
            {entry.label}
          </dt>
          <dd className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'truncate text-sm text-[var(--text-primary)]',
                entry.mono && 'font-mono',
              )}
            >
              {entry.value ?? '—'}
            </span>
            {entry.badge && (
              <Badge
                variant={badgeVariantMap[entry.badge.variant]}
                size="sm"
              >
                {entry.badge.text}
              </Badge>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

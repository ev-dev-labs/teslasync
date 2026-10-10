import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

export interface DetailEntry {
  id?: string | number;
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
    <KVList
      layout="responsive"
      wrap
      className="h-full overflow-y-auto"
      items={visible.map((entry) => ({
        id: entry.id,
        label: entry.label,
        value: (
          <span className="inline-flex max-w-full flex-wrap items-center gap-2">
            <span className={cn('min-w-0 [overflow-wrap:anywhere]', entry.mono && 'font-mono')}>
              {entry.value ?? '—'}
            </span>
            {entry.badge && (
              <Badge variant={badgeVariantMap[entry.badge.variant]} size="sm">
                {entry.badge.text}
              </Badge>
            )}
          </span>
        ),
      }))}
    />
  );
}

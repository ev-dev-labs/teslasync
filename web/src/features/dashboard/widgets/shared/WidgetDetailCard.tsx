import { type ReactNode } from 'react';
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
  if (entries.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={emptyIcon}
        message={emptyMessage ?? 'No details available'}
        className="py-4"
      />
    );
  }

  const visible = compact ? entries.slice(0, 4) : entries;

  return (
    <div className="overflow-y-auto h-full">
      {visible.map((entry, i) => (
        <div
          key={entry.label}
          className={cn(
            'flex items-center justify-between gap-3 py-2 px-1',
            i < visible.length - 1 && 'border-b border-white/[0.06]',
          )}
        >
          <span className="min-w-0 truncate text-[10px] uppercase text-[var(--text-muted)] tracking-wide">
            {entry.label}
          </span>
          <span className="flex min-w-0 items-center gap-2">
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
          </span>
        </div>
      ))}
    </div>
  );
}

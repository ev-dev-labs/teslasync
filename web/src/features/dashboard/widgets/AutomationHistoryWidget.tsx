import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PlayCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useAutomationHistory } from '@/api/hooks/useAutomations';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { AutomationHistoryStatus } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDateLabels } from '@/hooks/useDateLabels';
import { cn } from '@/lib/cn';

type TranslateFn = (key: string, fallback: string) => string;

export type AutomationStatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export function automationStatusVariant(status: AutomationHistoryStatus | null | undefined): AutomationStatusVariant {
  switch (status) {
    case 'success': return 'success';
    case 'failed': return 'danger';
    case 'partial': return 'warning';
    case 'running': return 'info';
    default: return 'neutral';
  }
}

export function automationStatusLabel(status: AutomationHistoryStatus | null | undefined, t: TranslateFn): string {
  switch (status) {
    case 'success': return t('automations:historyPage.status.success', 'Succeeded');
    case 'failed': return t('automations:historyPage.status.failed', 'Failed');
    case 'partial': return t('automations:historyPage.status.partial', 'Partial');
    case 'running': return t('automations:historyPage.status.running', 'Running');
    case 'skipped': return t('automations:historyPage.status.skipped', 'Skipped');
    case 'cancelled': return t('automations:historyPage.status.cancelled', 'Cancelled');
    case 'test': return t('automations:historyPage.status.test', 'Test');
    case 'undo': return t('automations:historyPage.status.undo', 'Undone');
    default: return typeof status === 'string' && status.trim() ? status.trim() : '—';
  }
}

// ── Main widget ──────────────────────────────────────────────────────

export default function AutomationHistoryWidget({ size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { formatDateTime, formatTime } = useDateFormat();
  const { formatRelativeDays } = useDateLabels();
  const query = useAutomationHistory();
  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const state = useDataState({ ...query, data: data ?? undefined }, { provenance: 'historical' });
  const isCompact = size.cols <= 1;
  const items = data?.items ?? [];
  const rows = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const at = new Date(a.triggered_at ?? '').getTime();
      const bt = new Date(b.triggered_at ?? '').getTime();
      const ae = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
      const be = Number.isFinite(bt) ? bt : Number.NEGATIVE_INFINITY;
      return ae === be ? 0 : ae > be ? -1 : 1;
    });
    return sorted.slice(0, isCompact ? 4 : 10);
  }, [items, isCompact]);

  const formatExecutionTime = (timestamp: string | null | undefined): string => {
    if (!timestamp) return '—';
    const ms = new Date(timestamp).getTime();
    if (!Number.isFinite(ms)) return '—';
    const day = formatRelativeDays(timestamp);
    if (day === 'Today' || day === 'Yesterday') return `${day} ${formatTime(timestamp)}`;
    return formatDateTime(timestamp);
  };

  const formatExecutionDuration = (durationMs: number | null | undefined): string => {
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return '—';
    if (durationMs < 1000) return `${fmtNumber(durationMs, 0)} ms`;
    return `${fmtNumber(durationMs / 1000, 1)} s`;
  };

  return (
    <WidgetShell
      title={t('widget.automationHistory', 'Automation history')}
      icon={<PlayCircle className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={{ ...state, status: state.status === 'initial' && !isLoading ? 'unavailable' : state.status }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<PlayCircle className="h-5 w-5" aria-hidden="true" />}
          message={t('widget.noAutomationRuns', 'No automation runs yet')}
          className="py-4"
        />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto" role="list" aria-label={t('widget.automationHistory', 'Automation history')}>
          {rows.map((entry, index) => (
            <div
              key={entry.id ?? `${entry.triggered_at ?? 'unknown'}-${index}`}
              role="listitem"
              className={cn(
                'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-b border-[var(--border-subtle)] py-2 first:pt-0 last:border-b-0',
                'md:grid-cols-[minmax(0,1fr)_auto_auto]',
              )}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-[var(--text-primary)]" title={entry.automation_name ?? '—'}>
                  {entry.automation_name?.trim() || '—'}
                </p>
                <p className="truncate text-xs text-[var(--text-muted)]">
                  {formatExecutionTime(entry.triggered_at)}
                </p>
              </div>
              <Badge variant={automationStatusVariant(entry.status)} size="sm">
                {automationStatusLabel(entry.status, (key, fallback) => t(key, fallback))}
              </Badge>
              <span className="col-start-2 mt-1 text-right text-xs tabular-nums text-[var(--text-secondary)] md:col-start-auto md:mt-0">
                {formatExecutionDuration(entry.duration_ms)}
              </span>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

import { useTranslation } from 'react-i18next';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Icons } from '@/lib/icons';
import type { DayLogSource } from '@/api/types';
import { DAY_LOG_SOURCE_STATUS } from '../../lib/daylog';

export interface DayLogSourcesProps {
  sources: DayLogSource[] | null;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

const STATUS_VARIANT = {
  ok: 'success',
  empty: 'neutral',
  unavailable: 'warning',
} as const;

/**
 * Section 4 — source honesty. Every stream the day was rebuilt from,
 * what it contributed, and what is missing (with the reason, not a
 * guess). The shell always renders: loading, error, and empty states
 * are explicit.
 */
export function DayLogSources({ sources, isLoading, error, onRetry }: DayLogSourcesProps) {
  const { t } = useTranslation();
  const rows = sources ?? [];

  return (
    <GlassPanel className="p-6" data-testid="daylog-sources">
      <PanelTitle>{t('dayLog.sources.title', 'Sources')}</PanelTitle>
      <div className="mt-4">
        {isLoading ? (
          <div role="status" aria-label={t('dayLog.sources.loading', 'Loading sources')}>
            <Skeleton lines={5} />
          </div>
        ) : error ? (
          <QueryError error={error} onRetry={onRetry} resourceName={t('dayLog.sources.title', 'Sources')} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Icons.database className="h-8 w-8" />}
            message={t('dayLog.sources.empty', 'No source information for this day.')}
            actionTo={{
              label: t('dayLog.sources.chargingCta', 'Open charging'),
              to: '/charging',
            }}
          />
        ) : (
          <>
          <Text variant="caption" className="mb-2">
            {t(
              'dayLog.sources.feedNote',
              'Signal feeds record transitions only — states between samples were never captured and cannot be reconstructed.',
            )}
          </Text>
          <ul className="divide-y divide-white/[0.06]">
            {rows.map((row) => (
              <li key={row.source} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <Text size="sm" weight="medium" color="primary">{t(`dayLog.sources.names.${row.source}`, row.source)}</Text>
                  {row.status === 'unavailable' ? (
                    <Text variant="caption">
                      {t(`dayLog.sources.reasons.${row.source}`, row.reason ?? t('dayLog.sources.noReason', 'Not available'))}
                    </Text>
                  ) : (
                    <Text variant="caption">
                      {t('dayLog.sources.rows', '{{count}} rows', { count: row.count })}
                    </Text>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[row.status] ?? 'neutral'}>
                  {t(`dayLog.sources.status.${row.status}`, DAY_LOG_SOURCE_STATUS[row.status] ?? row.status)}
                </Badge>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>
    </GlassPanel>
  );
}

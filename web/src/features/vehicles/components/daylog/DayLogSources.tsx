import { useTranslation } from 'react-i18next';
import { Badge, DataTable, GlassPanel, PanelTitle, Text } from '@/components/ui';
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
            <DataTable
              tableId="daylog:sources"
              caption={t('dayLog.sources.title', 'Sources')}
              data={rows.map((row) => ({
                key: row.source,
                source: t(`dayLog.sources.names.${row.source}`, row.source),
                detail: row.status === 'unavailable'
                  ? t(`dayLog.sources.reasons.${row.source}`, row.reason ?? t('dayLog.sources.noReason', 'Not available'))
                  : t('dayLog.sources.rows', '{{count}} rows', { count: row.count }),
                status: t(`dayLog.sources.status.${row.status}`, DAY_LOG_SOURCE_STATUS[row.status] ?? row.status),
              }))}
              columns={[
                {
                  key: 'source',
                  header: t('dayLog.sources.title', 'Sources'),
                  defaultWidth: 180,
                  minWidth: 140,
                  render: (row) => <Text size="sm" weight="medium" color="primary">{row.source}</Text>,
                },
                {
                  key: 'detail',
                  header: t('dayLog.sources.feedNote', 'Feed note'),
                  defaultWidth: 260,
                  minWidth: 200,
                  render: (row) => <Text variant="caption">{row.detail}</Text>,
                },
                {
                  key: 'status',
                  header: t('dayLog.sources.status', 'Status'),
                  defaultWidth: 120,
                  minWidth: 100,
                  align: 'right',
                  render: (row) => <Badge variant={row.status === 'ok' ? 'success' : row.status === 'empty' ? 'neutral' : row.status === 'unavailable' ? 'warning' : 'neutral'}>{row.status}</Badge>,
                },
              ]}
              keyExtractor={(row) => row.key}
              variant="embedded"
              stickyHeader={false}
              showColumnsMenu={false}
              columnVisibility={false}
              searchable={false}
              exportable={false}
            />
          </>
        )}
      </div>
    </GlassPanel>
  );
}

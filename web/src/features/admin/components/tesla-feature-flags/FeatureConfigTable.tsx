import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListChecks, Search, Flag } from 'lucide-react';

import { GlassPanel, Badge, Input, Select, DataTable, type Column } from '@/components/ui';
import { PanelTitle, Caption, Code } from '@/components/ui/Typography';
import { EmptyState, QueryError, TableSkeleton } from '@/components/feedback';
import { fmtInt } from '@/lib/numberFormat';
import type { FeatureFlagEntry, FeatureFlagKind } from './parseFeatureFlags';

interface FeatureConfigTableProps {
  entries: FeatureFlagEntry[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

type StatusFilter = 'all' | 'enabled' | 'disabled';

/**
 * Full-width detail band: the searchable, filterable, paginated list of
 * every feature-config entry. Preserves the original Feature / Status /
 * Details columns and adds a Type column, free-text search, and a status
 * filter. Owns loading / error / empty states independently.
 */
export function FeatureConfigTable({ entries, isLoading, error, onRetry }: FeatureConfigTableProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const kindLabel = useMemo<Record<FeatureFlagKind, string>>(
    () => ({
      flag: t('featureConfig.type.flag', 'Boolean flags'),
      configured: t('featureConfig.type.configured', 'Configured'),
    }),
    [t],
  );

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t('featureConfig.filter.all', 'All statuses') },
      { value: 'enabled', label: t('featureConfig.enabled', 'Enabled') },
      { value: 'disabled', label: t('featureConfig.disabled', 'Disabled') },
    ],
    [t],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (status === 'enabled' && !entry.enabled) return false;
      if (status === 'disabled' && entry.enabled) return false;
      if (term.length === 0) return true;
      const haystack = `${entry.key} ${entry.details ?? ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [entries, search, status]);

  const columns = useMemo<Column<FeatureFlagEntry>[]>(
    () => [
      {
        key: 'key',
        header: t('featureConfig.feature', 'Feature'),
        sortable: true,
        visibleOnMobile: true,
        render: (row) => (
          <Code className="block max-w-[18rem] truncate" title={row.key}>
            {row.key}
          </Code>
        ),
      },
      {
        key: 'kind',
        header: t('featureConfig.typeColumn', 'Type'),
        sortable: true,
        render: (row) => (
          <Badge variant={row.kind === 'configured' ? 'info' : 'neutral'} size="sm">
            {kindLabel[row.kind]}
          </Badge>
        ),
      },
      {
        key: 'enabled',
        header: t('featureConfig.status', 'Status'),
        sortable: true,
        visibleOnMobile: true,
        render: (row) => (
          <Badge variant={row.enabled ? 'success' : 'neutral'} size="sm" dot>
            {row.enabled ? t('featureConfig.enabled', 'Enabled') : t('featureConfig.disabled', 'Disabled')}
          </Badge>
        ),
      },
      {
        key: 'details',
        header: t('featureConfig.details', 'Details'),
        render: (row) => (
          <Caption className="block max-w-[26rem] truncate" title={row.details ?? undefined}>
            {row.details ?? '—'}
          </Caption>
        ),
      },
    ],
    [t, kindLabel],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('featureConfig.tableTitle', 'Feature Flags')}
        </PanelTitle>
        {entries.length > 0 && (
          <Caption>
            {t('featureConfig.showing', 'Showing {{shown}} of {{total}}', {
              shown: fmtInt(filtered.length),
              total: fmtInt(entries.length),
            })}
          </Caption>
        )}
      </div>

      {isLoading ? (
        <TableSkeleton rows={8} cols={4} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : entries.length === 0 ? (
        <EmptyState
          /* no-action: transient — nothing synced from Tesla yet; the header Refresh CTA owns recovery */
          icon={<Flag className="h-10 w-10" aria-hidden="true" />}
          message={t('featureConfig.noData', 'No feature config data yet. Click Refresh to fetch from Tesla.')}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="sm:flex-1">
              <Input
                type="search"
                icon={<Search className="h-4 w-4" aria-hidden="true" />}
                placeholder={t('featureConfig.searchPlaceholder', 'Search features…')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label={t('featureConfig.searchLabel', 'Search features')}
              />
            </div>
            <div className="sm:w-52">
              <Select
                options={statusOptions}
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusFilter)}
                aria-label={t('featureConfig.statusFilterLabel', 'Filter by status')}
              />
            </div>
          </div>

          <DataTable
            tableId="admin:tesla-feature-flags"
            columns={columns}
            data={filtered}
            keyExtractor={(row) => row.key}
            mobileColumns={['key', 'enabled']}
            emptyMessage={t('featureConfig.noMatch', 'No features match your filters.')}
            pagination
          />
        </>
      )}
    </GlassPanel>
  );
}

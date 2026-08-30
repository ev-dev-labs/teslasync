import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  RepairCase,
  RepairCaseFilters,
} from '@/api/hooks/useDataRepair';
import {
  Badge,
  Button,
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { ListSkeleton, QueryError } from '@/components/feedback';
import { RepairCaseFiltersBar } from './RepairCaseFiltersBar';
import { RepairRefreshWarning } from './RepairRefreshWarning';
import { useRepairCaseColumns } from './useRepairCaseColumns';
import { repairCodeLabel } from './repairCasePresentation';

interface RepairCaseQueueProps {
  cases: RepairCase[];
  filters: RepairCaseFilters;
  selectedCaseIds: number[];
  loading: boolean;
  hasData: boolean;
  busy?: boolean;
  error: unknown;
  hasMore: boolean;
  hasPrevious: boolean;
  onFiltersChange: (filters: RepairCaseFilters) => void;
  onSelectionChange: (ids: number[]) => void;
  onOpenCase: (id: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onRetry: () => void;
  onBeginReview: (ids: number[]) => void;
  onDismiss: (ids: number[]) => void;
  bulkPending?: boolean;
}

export function RepairCaseQueue({
  cases,
  filters,
  selectedCaseIds,
  loading,
  hasData,
  busy = false,
  error,
  hasMore,
  hasPrevious,
  onFiltersChange,
  onSelectionChange,
  onOpenCase,
  onPrevious,
  onNext,
  onRetry,
  onBeginReview,
  onDismiss,
  bulkPending = false,
}: RepairCaseQueueProps) {
  const { t } = useTranslation();
  const columns = useRepairCaseColumns(onOpenCase);

  return (
    <GlassPanel className="min-w-0 p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <PanelTitle>{t('dataRepair.cases.queueTitle', 'Repair case queue')}</PanelTitle>
            {busy ? (
              <Badge variant="info" dot aria-live="polite">
                {t('dataRepair.cases.updating', 'Updating')}
              </Badge>
            ) : null}
          </div>
          <Text as="p" variant="bodySm" className="mt-1">
            {t(
              'dataRepair.cases.queueDescription',
              'Durable findings stay visible until an operator reviews and resolves them.',
            )}
          </Text>
        </div>
        <RepairCaseFiltersBar filters={filters} onChange={onFiltersChange} />
      </div>

      {error && !hasData ? (
        <QueryError
          error={error}
          resourceName={t('dataRepair.cases.resourceName', 'Repair cases')}
          onRetry={onRetry}
        />
      ) : loading && !hasData ? (
        <ListSkeleton
          rows={6}
          label={t('dataRepair.cases.loading', 'Loading repair cases…')}
          testId="repair-case-queue-skeleton"
        />
      ) : (
        <>
          {error ? (
            <RepairRefreshWarning
              message={t(
                'dataRepair.cases.refreshFailed',
                'Repair cases could not refresh. Showing the most recently loaded queue.',
              )}
              onRetry={onRetry}
              testId="repair-case-refresh-warning"
            />
          ) : null}
          <DataTable
            tableId="data-repair:cases"
            columns={columns}
            data={cases}
            keyExtractor={(item) => item.id}
            selectable="multi"
            rowLabel={(item) =>
              t('dataRepair.cases.rowLabel', 'Case #{{id}}, {{rule}}', {
                id: item.id,
                rule: repairCodeLabel(t, item.rule),
              })
            }
            selectedKeys={selectedCaseIds}
            onSelectionChange={(keys) => onSelectionChange(keys.map(Number))}
            mobileColumns={['case', 'actions']}
            emptyMessage={t('dataRepair.cases.empty', 'No repair cases match these filters.')}
            maxHeight={620}
            stickyHeader
            bulkActions={(selected) => {
              const hasReviewable = selected.some((item) => item.status === 'open');
              const hasDismissible = selected.some(
                (item) => item.status === 'open' || item.status === 'in_review',
              );
              return (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={bulkPending || busy || !hasReviewable}
                    title={!hasReviewable
                      ? t(
                          'dataRepair.cases.bulk.noReviewable',
                          'Only open cases can begin review.',
                        )
                      : undefined}
                    onClick={() => onBeginReview(selected.map((item) => item.id))}
                  >
                    {t('dataRepair.cases.bulk.beginReview', 'Begin review')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={bulkPending || busy || !hasDismissible}
                    title={!hasDismissible
                      ? t(
                          'dataRepair.cases.bulk.noDismissible',
                          'Only open or in-review cases can be dismissed.',
                        )
                      : undefined}
                    onClick={() => onDismiss(selected.map((item) => item.id))}
                  >
                    {t('dataRepair.cases.bulk.dismiss', 'Dismiss selected')}
                  </Button>
                </>
              );
            }}
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
              onClick={onPrevious}
              disabled={!hasPrevious || loading || busy}
            >
              {t('pagination.previous', 'Previous')}
            </Button>
            <Text as="span" variant="caption" aria-live="polite">
              {t('dataRepair.cases.pageCount', '{{count}} cases on this page', { count: cases.length })}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
              onClick={onNext}
              disabled={!hasMore || loading || busy}
            >
              {t('pagination.next', 'Next')}
            </Button>
          </div>
        </>
      )}
    </GlassPanel>
  );
}

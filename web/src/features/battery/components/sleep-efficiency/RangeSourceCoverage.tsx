import { CalendarRange, Database } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import {
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import { rangeStatusLabel } from './labels';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from './types';

interface AccountingRow {
  key: string;
  source: string;
  category: string;
  count: number;
}

export function RangeSourceCoverage({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const stateAccounting = analysis.stateAccounting;
  const eventAccounting = analysis.events.accounting;
  const rows = useMemo<AccountingRow[]>(
    () => [
      {
        key: 'state-included',
        source: t('sleep.coverage.stateRows', 'State rows'),
        category: t('sleep.coverage.included', 'Included'),
        count: stateAccounting.categories.included,
      },
      {
        key: 'state-missing',
        source: t('sleep.coverage.stateRows', 'State rows'),
        category: t('sleep.coverage.missingState', 'Missing state'),
        count: stateAccounting.categories.missing_state,
      },
      {
        key: 'state-count',
        source: t('sleep.coverage.stateRows', 'State rows'),
        category: t('sleep.coverage.invalidCount', 'Invalid count'),
        count: stateAccounting.categories.invalid_count,
      },
      {
        key: 'state-minutes',
        source: t('sleep.coverage.stateRows', 'State rows'),
        category: t('sleep.coverage.invalidMinutes', 'Invalid minutes'),
        count: stateAccounting.categories.invalid_minutes,
      },
      {
        key: 'state-duplicate',
        source: t('sleep.coverage.stateRows', 'State rows'),
        category: t('sleep.coverage.duplicateState', 'Duplicate state'),
        count: stateAccounting.categories.duplicate_state,
      },
      {
        key: 'event-included',
        source: t('sleep.coverage.eventRows', 'Event rows'),
        category: t('sleep.coverage.included', 'Included'),
        count: eventAccounting.categories.included,
      },
      {
        key: 'event-timestamp',
        source: t('sleep.coverage.eventRows', 'Event rows'),
        category: t(
          'sleep.coverage.invalidTimestamp',
          'Invalid timestamp',
        ),
        count: eventAccounting.categories.invalid_timestamp,
      },
      {
        key: 'event-future',
        source: t('sleep.coverage.eventRows', 'Event rows'),
        category: t('sleep.coverage.future', 'Future event'),
        count: eventAccounting.categories.future,
      },
      {
        key: 'event-duration',
        source: t('sleep.coverage.eventRows', 'Event rows'),
        category: t('sleep.coverage.invalidDuration', 'Invalid duration'),
        count: eventAccounting.categories.invalid_duration,
      },
      {
        key: 'event-battery',
        source: t('sleep.coverage.eventRows', 'Event rows'),
        category: t(
          'sleep.coverage.invalidBattery',
          'Invalid battery fields',
        ),
        count: eventAccounting.categories.invalid_battery,
      },
      {
        key: 'event-duplicate',
        source: t('sleep.coverage.eventRows', 'Event rows'),
        category: t('sleep.coverage.duplicateEvent', 'Duplicate event ID'),
        count: eventAccounting.categories.duplicate_id,
      },
    ],
    [eventAccounting.categories, stateAccounting.categories, t],
  );
  const columns = useMemo<Column<AccountingRow>[]>(
    () => [
      {
        key: 'source',
        header: t('sleep.coverage.source', 'Source'),
        visibleOnMobile: true,
        render: (row) => <Text variant="bodySm">{row.source}</Text>,
      },
      {
        key: 'category',
        header: t('sleep.coverage.category', 'Mutually exclusive category'),
        visibleOnMobile: true,
        render: (row) => <Text variant="bodySm">{row.category}</Text>,
      },
      {
        key: 'count',
        header: t('sleep.coverage.rows', 'Rows'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {fmtInt(row.count)}
          </Text>
        ),
      },
    ],
    [t],
  );
  const requestedWindow =
    analysis.range.requestedStart && analysis.range.requestedEnd
      ? t(
          'sleep.coverage.windowValue',
          '{{start}} to {{end}}',
          {
            start: analysis.range.requestedStart,
            end: analysis.range.requestedEnd,
          },
        )
      : '—';

  return (
    <section data-testid="sleep-efficiency-range-source-coverage">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <CalendarRange
            className="h-4 w-4 text-blue-300"
            aria-hidden="true"
          />
          {t(
            'sleep.coverage.title',
            'Range, source coverage, and exact accounting',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.coverage.subtitle',
            'Requested UTC dates, backend coverage, exclusions, duplicate policy, display caps, and the frozen analysis clock are disclosed together.',
          )}
        </Text>
        <SleepEfficiencySectionBody state={state} skeletonHeight={300}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={<CalendarRange className="h-4 w-4" aria-hidden="true" />}
              label={t('sleep.coverage.requested', 'Requested UTC dates')}
              value={requestedWindow}
              color="cyan"
              subtitle={t(
                'sleep.coverage.rangeStatus',
                'Range status: {{status}}',
                { status: rangeStatusLabel(t, analysis.range.status) },
              )}
            />
            <MetricCard
              icon={<CalendarRange className="h-4 w-4" aria-hidden="true" />}
              label={t(
                'sleep.coverage.inclusiveDays',
                'Inclusive day count',
              )}
              value={
                analysis.range.inclusiveDays != null
                  ? fmtInt(analysis.range.inclusiveDays)
                  : '—'
              }
              color="blue"
              subtitle={t(
                'sleep.coverage.utcSafe',
                'Computed from UTC calendar dates',
              )}
            />
            <MetricCard
              icon={<Database className="h-4 w-4" aria-hidden="true" />}
              label={t(
                'sleep.coverage.backendPeriod',
                'Backend period_days',
              )}
              value={
                analysis.source.backendPeriodDays != null
                  ? fmtInt(analysis.source.backendPeriodDays)
                  : '—'
              }
              color="purple"
              subtitle={t(
                'sleep.coverage.backendEcho',
                'Response coverage field',
              )}
            />
            <MetricCard
              icon={<Database className="h-4 w-4" aria-hidden="true" />}
              label={t('sleep.coverage.vehicle', 'Response vehicle_id')}
              value={
                analysis.source.vehicleId != null
                  ? fmtInt(analysis.source.vehicleId)
                  : '—'
              }
              color="green"
              subtitle={t(
                'sleep.coverage.responseIdentity',
                'Sanitized response identity',
              )}
            />
            <MetricCard
              icon={<Database className="h-4 w-4" aria-hidden="true" />}
              label={t('sleep.coverage.stateCap', 'State directory cap')}
              value={fmtInt(stateAccounting.directoryCap)}
              color="amber"
              subtitle={t(
                'sleep.coverage.omitted',
                '{{count}} valid rows omitted from display',
                { count: stateAccounting.omittedRows },
              )}
            />
            <MetricCard
              icon={<Database className="h-4 w-4" aria-hidden="true" />}
              label={t('sleep.coverage.eventCap', 'Event directory cap')}
              value={fmtInt(eventAccounting.directoryCap)}
              color="amber"
              subtitle={t(
                'sleep.coverage.omitted',
                '{{count}} valid rows omitted from display',
                { count: eventAccounting.omittedRows },
              )}
            />
            <MetricCard
              icon={<Database className="h-4 w-4" aria-hidden="true" />}
              label={t('sleep.coverage.clock', 'Frozen analysis clock')}
              value={analysis.source.frozenNowIso ?? '—'}
              color="red"
              subtitle={t(
                'sleep.coverage.clockPurpose',
                'Used for future and recency classification',
              )}
            />
            <MetricCard
              icon={<Database className="h-4 w-4" aria-hidden="true" />}
              label={t('sleep.coverage.summaryScope', 'Summary scope')}
              value={t('sleep.coverage.allValidRows', 'All valid rows')}
              color="cyan"
              subtitle={t(
                'sleep.coverage.capDoesNotAffect',
                'Directory caps do not affect summaries',
              )}
            />
          </div>
          <div className="mt-4">
            <DataTable<AccountingRow>
              tableId="battery:sleep-source-accounting"
              columns={columns}
              data={rows}
              keyExtractor={(row) => row.key}
              mobileColumns={['source', 'category']}
              density="compact"
              emptyMessage={t(
                'sleep.coverage.empty',
                'No source accounting rows',
              )}
            />
          </div>
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'sleep.coverage.policy',
              'State duplicates use the first valid normalized state row. Event duplicates use the first valid event ID before newest-first sorting.',
            )}
          </Text>
        </SleepEfficiencySectionBody>
      </GlassPanel>
    </section>
  );
}

import { Flame } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Table,
  Text,
} from '@/components/ui';


import type { UtilizationSummary } from '../../lib/utilization';
import type { UtilizationSectionState } from './types';
import { useUtilizationDisplay } from './useUtilizationDisplay';
import { UtilizationSectionBody } from './UtilizationSectionBody';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface BusiestDaysProps {
  summary: UtilizationSummary;
  state: UtilizationSectionState;
}

export function BusiestDays({
  summary,
  state,
}: BusiestDaysProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const {
    formatDay,
    formatDistance,
    formatDuration,
    formatEnergy,
  } = useUtilizationDisplay();
  const guard = summary.sampleGuards.busiestDays;

  return (
    <GlassPanel
      className="p-4 sm:p-5"
      role="region"
      aria-label={t(
        'utilization.sections.busiest',
        'Ranked busiest observed days',
      )}
      data-testid="utilization-busiest"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <PanelTitle className="flex items-center gap-2">
            <Flame
              className="h-4 w-4 text-theme-accent"
              aria-hidden="true"
            />
            {t(
              'utilization.busiest.title',
              'Busiest observed days',
            )}
          </PanelTitle>
          <Text variant="caption" as="p">
            {t(
              'utilization.busiest.subtitle',
              'Ranked by logged driving time, then distance, drive count, and date.',
            )}
          </Text>
        </div>
        <Badge variant={guard.sufficient ? 'success' : 'warning'} dot>
          {guard.sufficient
            ? t(
                'utilization.sample.supported',
                '{{count}} observations',
                { count: guard.sampleSize },
              )
            : t(
                'utilization.sample.limited',
                'Limited sample: {{count}} of {{minimum}}',
                {
                  count: guard.sampleSize,
                  minimum: guard.minimum,
                },
              )}
        </Badge>
      </div>

      <UtilizationSectionBody state={state} className="mt-4 min-h-64">
        {summary.busiestDays.length === 0 ? (
          <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
            icon={<Flame className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'utilization.busiest.empty',
              'No active observed days are available to rank.',
            )}
          />
        ) : (
          <>
          <div className="hidden sm:block">
            <Table aria-label={t('utilization.sections.busiest', 'Ranked busiest observed days')}>
              <thead data-app-part="table-head">
                <tr data-app-part="table-row">
                  <th data-app-part="table-cell" scope="col" className="text-right">#</th>
                  <th data-app-part="table-cell" scope="col">{t('common.date', 'Date')}</th>
                  <th data-app-part="table-cell" scope="col" className="text-right">{t('utilization.busiest.drivingTime', 'Driving time')}</th>
                  <th data-app-part="table-cell" scope="col" className="text-right">{t('utilization.busiest.distance', 'Distance')}</th>
                  <th data-app-part="table-cell" scope="col" className="text-right">{t('utilization.busiest.drives', 'Drives')}</th>
                  <th data-app-part="table-cell" scope="col" className="text-right">{t('utilization.busiest.energy', 'Energy')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.busiestDays.map((day, index) => (
                  <tr data-app-part="table-row" key={day.day}>
                    <td data-app-part="table-cell" className="text-right tabular-nums">
                      <Badge variant="neutral">{t('utilization.busiest.rank', '#{{rank}}', { rank: index + 1 })}</Badge>
                    </td>
                    <th data-app-part="table-cell" scope="row" className="font-normal">{formatDay(day.day)}</th>
                    <td data-app-part="table-cell" className="text-right tabular-nums">{formatDuration(day.drivingS)}</td>
                    <td data-app-part="table-cell" className="text-right tabular-nums">{formatDistance(day.distanceM)}</td>
                    <td data-app-part="table-cell" className="text-right tabular-nums">{fmtInt(day.driveCount)}</td>
                    <td data-app-part="table-cell" className="text-right tabular-nums">
                      {day.energyWh > 0 ? formatEnergy(day.energyWh) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          <div className="sm:hidden">
          <ol data-app-part="list" data-app-list="ranked" className="space-y-3">
            {summary.busiestDays.map((day, index) => (
              <li
                key={day.day}
                data-app-part="list-row"
                className="grid gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <Badge data-app-part="badge metric-context" variant="neutral">
                  {t(
                    'utilization.busiest.rank',
                    '#{{rank}}',
                    { rank: index + 1 },
                  )}
                </Badge>
                <Text
                  data-app-part="metric-label"
                  size="sm"
                  weight="semibold"
                  color="primary"
                >
                  {formatDay(day.day)}
                </Text>
                <div data-app-part="metric" data-app-metric="inline">
                  <MetricLabel data-app-part="metric-label">
                    {t(
                      'utilization.busiest.drivingTime',
                      'Driving time',
                    )}
                  </MetricLabel>
                  <Text data-app-part="metric-value" variant="bodySm" mono>
                    {formatDuration(day.drivingS)}
                  </Text>
                </div>
                <div data-app-part="metric" data-app-metric="inline">
                  <MetricLabel data-app-part="metric-label">
                    {t(
                      'utilization.busiest.distance',
                      'Distance',
                    )}
                  </MetricLabel>
                  <Text data-app-part="metric-value" variant="bodySm" mono>
                    {formatDistance(day.distanceM)}
                  </Text>
                </div>
                <div data-app-part="metric" data-app-metric="inline">
                  <MetricLabel data-app-part="metric-label">
                    {t('utilization.busiest.drives', 'Drives')}
                  </MetricLabel>
                  <Text data-app-part="metric-value" variant="bodySm" mono>
                    {fmtInt(day.driveCount)}
                  </Text>
                </div>
                <div data-app-part="metric" data-app-metric="inline">
                  <MetricLabel data-app-part="metric-label">
                    {t('utilization.busiest.energy', 'Energy')}
                  </MetricLabel>
                  <Text data-app-part="metric-value" variant="bodySm" mono>
                    {day.energyWh > 0
                      ? formatEnergy(day.energyWh)
                      : '—'}
                  </Text>
                </div>
              </li>
            ))}
          </ol>
          </div>
          </>
        )}
      </UtilizationSectionBody>
    </GlassPanel>
  );
}

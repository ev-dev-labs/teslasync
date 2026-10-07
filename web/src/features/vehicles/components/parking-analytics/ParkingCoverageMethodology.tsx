import { Database, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
} from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { ParkingSummary } from '../../lib/parkingDwell';
import { ParkingMethodCaveats } from './ParkingMethodCaveats';
import { ParkingSectionBody } from './ParkingSectionBody';
import type { ParkingSectionState } from './types';

interface ParkingCoverageMethodologyProps {
  summary: ParkingSummary;
  state: ParkingSectionState;
  rangeStart: string;
  rangeEnd: string;
  className?: string;
}

/** Coverage accounting and the caveats required to interpret every chart. */
export function ParkingCoverageMethodology({
  summary,
  state,
  rangeStart,
  rangeEnd,
  className,
}: ParkingCoverageMethodologyProps) {
  const { t } = useTranslation();
  const coverage = summary.coverage;
  const locationCoverage =
    summary.stints.length > 0
      ? (coverage.knownLocationStints / summary.stints.length) * 100
      : null;

  return (
    <section
      className={className}
      aria-label={t(
        'parking.sections.coverage',
        'Parking coverage and methodology',
      )}
      data-testid="parking-coverage"
    >
      <GlassPanel className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-purple-300" aria-hidden="true" />
            {t('parking.coverage.title', 'Coverage & Method')}
          </PanelTitle>
          <Badge
            variant={coverage.possiblyCapped ? 'warning' : 'success'}
            dot
          >
            {coverage.possiblyCapped
              ? t('parking.coverage.cappedBadge', 'Potentially capped')
              : t('parking.coverage.withinCapBadge', 'Within request cap')}
          </Badge>
        </div>

        <ParkingSectionBody state={state} className="mt-4 min-h-64">
          {coverage.recordsReturned === 0 ? (
            <EmptyState
              className="py-6"
              icon={<Info className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'parking.coverage.empty',
                'No drive records were returned for this selected UTC window.',
              )}
              actionTo={{
                label: t('parking.browseDrives', 'Browse drives'),
                to: '/drives',
              }}
            />
          ) : (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <MetricValue>{fmtInt(coverage.recordsReturned)}</MetricValue>
                <MetricLabel>
                  {t('parking.coverage.returned', 'Records returned')}
                </MetricLabel>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <MetricValue>{fmtInt(coverage.validDrives)}</MetricValue>
                <MetricLabel>
                  {t('parking.coverage.usable', 'Usable drives')}
                </MetricLabel>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <MetricValue>{fmtInt(summary.stints.length)}</MetricValue>
                <MetricLabel>
                  {t('parking.coverage.reconstructed', 'Reconstructed stints')}
                </MetricLabel>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <MetricValue>
                  {locationCoverage != null
                    ? `${fmtNumber(locationCoverage, 0)}%`
                    : '—'}
                </MetricValue>
                <MetricLabel>
                  {t('parking.coverage.located', 'Location coverage')}
                </MetricLabel>
              </div>
            </div>
          )}

          <ParkingMethodCaveats
            summary={summary}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
          />
        </ParkingSectionBody>
      </GlassPanel>
    </section>
  );
}

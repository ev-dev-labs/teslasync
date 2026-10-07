import { Database, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  PanelTitle,
} from '@/components/ui';


import type { ParkingSummary } from '../../lib/parkingDwell';
import { ParkingMethodCaveats } from './ParkingMethodCaveats';
import { ParkingSectionBody } from './ParkingSectionBody';
import type { ParkingSectionState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DataStatus } from '@/api/dataState';
import { VehicleEvidenceBrief } from '../operationalbrief-n-z/VehicleEvidenceBrief';

interface ParkingCoverageMethodologyProps {
  summary: ParkingSummary;
  state: ParkingSectionState;
  rangeStart: string;
  rangeEnd: string;
  className?: string;
  sourceStatus?: DataStatus;
  hasSource?: boolean;
}

/** Coverage accounting and the caveats required to interpret every chart. */
export function ParkingCoverageMethodology({
  summary,
  state,
  rangeStart,
  rangeEnd,
  className,
  sourceStatus,
  hasSource = true,
}: ParkingCoverageMethodologyProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const coverage = summary.coverage;
  const locationCoverage =
    summary.stints.length > 0
      ? (coverage.knownLocationStints / summary.stints.length) * 100
      : null;
  const status = sourceStatus ?? (state.isLoading ? 'initial' : state.error ? 'initialFailure' : hasSource ? 'ok' : 'unavailable');

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
            {t('parking.coverage.title', 'Coverage & method')}
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

        <VehicleEvidenceBrief id="parking-coverage-summary"
          title={t('parking.coverage.title', 'Coverage & method')}
          description={t('parking.briefDescription', 'Parking is reconstructed between usable drives, not observed continuously. Missing locations and incomplete history remain explicit.')}
          status={status === 'ok' && coverage.possiblyCapped ? 'partial' : status}
          loading={state.isLoading}
          provenance={t('parking.briefSource', 'Drive-derived parking reconstruction')}
          scope={t('parking.coverage.briefWindow', 'Requested UTC window: {{start}} → {{end}}', { start: rangeStart, end: rangeEnd })}
          metrics={[
            { metricId: 'count', occurrenceId: 'returned', label: t('parking.coverage.returned', 'Records returned'), rawValue: hasSource ? coverage.recordsReturned : null },
            { metricId: 'count', occurrenceId: 'usable', label: t('parking.coverage.usable', 'Usable drives'), rawValue: hasSource ? coverage.validDrives : null },
            { metricId: 'count', occurrenceId: 'stints', label: t('parking.coverage.reconstructed', 'Reconstructed stints'), rawValue: hasSource ? summary.stints.length : null },
            { metricId: 'percent', occurrenceId: 'located', label: t('parking.coverage.located', 'Location coverage'), rawValue: hasSource ? locationCoverage : null,
              display: { formatter: raw => ({ value: `${fmtNumber(raw)}%`, unit: '' }) },
              context: t('parking.kpis.locationQuality', '{{known}} located · {{missing}} missing', { known: coverage.knownLocationStints, missing: coverage.missingLocationStints }) },
          ]} />
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
          ) : null}

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

import { Activity, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { UseUnitsResult } from '@/hooks/useUnits';

import type { DriveDnaModel } from '../../lib/driveDNA';
import { DriveDnaCadenceMetrics } from './DriveDnaCadenceMetrics';
import { DriveDnaSectionBody } from './DriveDnaSectionBody';
import { DriveDnaSignalCoverageGrid } from './DriveDnaSignalCoverageGrid';
import type { DriveDnaSectionState } from './types';

interface DriveDnaCoverageCadenceProps {
  model: DriveDnaModel;
  state: DriveDnaSectionState;
  units: UseUnitsResult;
}

export function DriveDnaCoverageCadence({
  model,
  state,
  units,
}: DriveDnaCoverageCadenceProps) {
  const { t } = useTranslation();
  const hasPartialCoverage = Object.values(model.coverage).some(
    (channel) =>
      model.sample.validRows > 0 &&
      channel.availableCount < model.sample.validRows,
  );
  const hasTimestampIssues =
    model.sample.invalidTimestampCount > 0 ||
    model.sample.duplicateTimestampCount > 0;
  const hasLargeIrregularGap =
    model.sample.largestGapS != null &&
    model.sample.medianIntervalS != null &&
    model.sample.medianIntervalS > 0 &&
    model.sample.largestGapS > model.sample.medianIntervalS * 3;

  return (
    <section
      aria-label={t(
        'driveDna.coverage.sectionAria',
        'Signal coverage and emission cadence',
      )}
      data-testid="drive-dna-coverage"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('driveDna.coverage.title', 'Signal coverage & cadence')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mt-1">
          {t(
            'driveDna.coverage.subtitle',
            'Availability means a value was present after StateReader forward-folding at an emission; it does not prove a fresh measurement on every row.',
          )}
        </Text>

        <DriveDnaSectionBody
          state={state}
          validRows={model.sample.validRows}
          returnedRows={model.sample.returnedRows}
          allowZeroRows
          className="mt-4"
        >
          <DriveDnaCadenceMetrics model={model} units={units} />
          <Text as="h4" variant="subhead" className="mb-3 mt-5">
            {t(
              'driveDna.coverage.channelTitle',
              'Forward-folded channel availability',
            )}
          </Text>
          <DriveDnaSignalCoverageGrid model={model} />

          {model.sample.validRows === 0 ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              className="py-6"
              icon={<AlertTriangle className="h-7 w-7" aria-hidden="true" />}
              message={
                model.sample.returnedRows > 0
                  ? t(
                      'driveDna.coverage.invalidOnly',
                      'All returned rows were excluded from the analytical timeline because their timestamps were invalid.',
                    )
                  : t(
                      'driveDna.coverage.noRows',
                      'No telemetry rows were returned for cadence or channel coverage.',
                    )
              }
            />
          ) : null}
          {hasTimestampIssues ? (
            <AlertBanner className="mt-4" variant="warning">
              <Text as="p" variant="caption">
                {t(
                  'driveDna.coverage.timestampWarning',
                  'Invalid timestamps are excluded; duplicate timestamps are retained as separate emissions and reported explicitly.',
                )}
              </Text>
            </AlertBanner>
          ) : null}
          {hasPartialCoverage ? (
            <AlertBanner className="mt-4" variant="info">
              <Text as="p" variant="caption">
                {t(
                  'driveDna.coverage.partialWarning',
                  'Partial channels remain unavailable rather than being replaced with measured zero.',
                )}
              </Text>
            </AlertBanner>
          ) : null}
          {hasLargeIrregularGap ? (
            <AlertBanner className="mt-4" variant="warning">
              <Text as="p" variant="caption">
                {t(
                  'driveDna.coverage.gapWarning',
                  'The largest emission gap is more than three times the median interval; emission counts must not be interpreted as time shares.',
                )}
              </Text>
            </AlertBanner>
          ) : null}
        </DriveDnaSectionBody>
      </GlassPanel>
    </section>
  );
}

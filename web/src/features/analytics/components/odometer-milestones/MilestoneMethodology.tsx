import { BookOpen, Database, RouteOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/numberFormat';

import type { OdometerMilestoneResult } from '../../lib/odometerMilestones';
import { MilestoneSectionBody } from './MilestoneSectionBody';
import type { MilestoneSectionState } from './types';
import { useOdometerMilestoneDisplay } from './useOdometerMilestoneDisplay';

const COVERAGE_COLUMNS = { default: 1, sm: 3 } as const;

interface MilestoneMethodologyProps {
  summary: OdometerMilestoneResult;
  state: MilestoneSectionState;
}

export function MilestoneMethodology({
  summary,
  state,
}: MilestoneMethodologyProps) {
  const { t } = useTranslation();
  const { accounting, method } = summary;
  const { distanceUnit, formatDateMs } = useOdometerMilestoneDisplay();
  const coverage =
    accounting.firstEligibleMs != null
      ? t(
          'milestones.method.coverageWindow',
          '{{from}} to {{to}} eligible drive starts',
          {
            from: formatDateMs(accounting.firstEligibleMs),
            to: formatDateMs(accounting.lastEligibleMs),
          },
        )
      : t(
          'milestones.method.noCoverage',
          'No eligible drive timestamps in the returned window',
        );

  return (
    <section
      aria-label={t(
        'milestones.sections.method',
        'Coverage calibration and methodology',
      )}
      data-testid="milestone-method"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'milestones.method.title',
            'Coverage, calibration & methodology',
          )}
        </PanelTitle>
        <MilestoneSectionBody state={state}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Text variant="caption">{coverage}</Text>
            <Badge variant={accounting.capReached ? 'warning' : 'info'}>
              {accounting.capReached
                ? t(
                    'milestones.method.capReached',
                    '{{limit}}-row cap reached',
                    { limit: fmtInt(method.historyLimit) },
                  )
                : t(
                    'milestones.method.belowCap',
                    'Returned window below API cap',
                  )}
            </Badge>
          </div>
          <Grid cols={COVERAGE_COLUMNS} gap={3}>
            {[
              {
                label: t('milestones.method.returned', 'Rows returned'),
                value: accounting.returnedRows,
              },
              {
                label: t('milestones.method.eligible', 'Eligible drives'),
                value: accounting.eligibleRows,
              },
              {
                label: t(
                  'milestones.method.excludedDetail',
                  'Excluded: {{invalid}} date · {{future}} future · {{nonFinite}} non-finite · {{zero}} zero · {{negative}} negative',
                  {
                    invalid: accounting.exclusions.invalidTimestampRows,
                    future: accounting.exclusions.futureRows,
                    nonFinite:
                      accounting.exclusions.nonFiniteDistanceRows,
                    zero: accounting.exclusions.zeroDistanceRows,
                    negative: accounting.exclusions.negativeDistanceRows,
                  },
                ),
                value: accounting.excludedRows,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <Text variant="caption">{item.label}</Text>
                <MetricValue className="mt-1">
                  {fmtInt(item.value)}
                </MetricValue>
              </div>
            ))}
          </Grid>
          <div
            className={cn(
              'mt-4 flex gap-2 rounded-xl border p-3',
              accounting.capReached
                ? 'border-amber-400/20 bg-amber-400/5'
                : 'border-cyan-400/15 bg-cyan-400/5',
            )}
          >
            <Database
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0',
                accounting.capReached
                  ? 'text-amber-300'
                  : 'text-cyan-300',
              )}
              aria-hidden="true"
            />
            <Text variant="bodySm">
              {accounting.capReached
                ? t(
                    'milestones.method.capped',
                    'Exactly {{limit}} rows were returned. Older drives may be absent, so calibration and odometer completeness cannot be assumed.',
                    { limit: fmtInt(method.historyLimit) },
                  )
                : t(
                    'milestones.method.window',
                    'Results describe this returned history window, not guaranteed lifetime history.',
                  )}
            </Text>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Text
              as="ul"
              size="sm"
              color="secondary"
              className="space-y-2"
            >
              <li>
                {t(
                  'milestones.method.calibration',
                  'Calibration is stored canonically in kilometres and means the odometer immediately before the chronologically first eligible returned drive.',
                )}
              </li>
              <li>
                {t(
                  'milestones.method.ladder',
                  'The ladder is round in {{unit}}: every 10,000 through 100,000, then every 50,000.',
                  { unit: distanceUnit },
                )}
              </li>
              <li>
                {t(
                  'milestones.method.inclusion',
                  'Eligible rows need a valid non-future start time and a finite, positive distance; every other row is excluded once.',
                )}
              </li>
              <li>
                {t(
                  'milestones.method.months',
                  'Monthly context groups eligible drive starts by UTC calendar month.',
                )}
              </li>
            </Text>
            <Text
              as="ul"
              size="sm"
              color="secondary"
              className="space-y-2"
            >
              <li>
                {t(
                  'milestones.method.pace',
                  'Each pace needs at least {{minimum}} eligible drives. Its denominator is the elapsed time from the later of its boundary or first eligible row through the frozen as-of time.',
                  { minimum: method.minimumPaceDrives },
                )}
              </li>
              <li>
                {t(
                  'milestones.method.forecast',
                  'Roadmap dates use unrounded trailing-90-day pace; scenario ranges show sensitivity to other supported windows.',
                )}
              </li>
              <li>
                {t(
                  'milestones.method.horizon',
                  'Invalid or extreme projections beyond {{days}} days are withheld.',
                  { days: fmtInt(method.maxForecastDays) },
                )}
              </li>
              <li className="flex gap-2">
                <RouteOff
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
                  aria-hidden="true"
                />
                {t(
                  'milestones.method.uncertainty',
                  'Driving frequency changes. Every ETA is a projection, never a guarantee.',
                )}
              </li>
            </Text>
          </div>
        </MilestoneSectionBody>
      </GlassPanel>
    </section>
  );
}

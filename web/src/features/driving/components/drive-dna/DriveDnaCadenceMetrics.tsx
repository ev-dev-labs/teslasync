import {
  AlertTriangle,
  Clock3,
  Copy,
  Rows3,
  Timer,
  TimerReset,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';

import type { DriveDnaModel } from '../../lib/driveDNA';

const CADENCE_COLUMNS = { default: 2, md: 4, xl: 6 } as const;

interface DriveDnaCadenceMetricsProps {
  model: DriveDnaModel;
  units: UseUnitsResult;
}

export function DriveDnaCadenceMetrics({
  model,
  units,
}: DriveDnaCadenceMetricsProps) {
  const { t } = useTranslation();
  const evidence = model.sample;
  return (
    <Grid cols={CADENCE_COLUMNS} gap={3}>
      <MetricCard
        label={t('driveDna.coverage.returnedRows', 'Rows returned')}
        value={fmtInt(evidence.returnedRows)}
        subtitle={t('driveDna.coverage.returnedRowsHint', 'Endpoint response')}
        icon={<Rows3 className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('driveDna.coverage.validRows', 'Valid timestamp rows')}
        value={fmtInt(evidence.validRows)}
        subtitle={t('driveDna.coverage.validRowsHint', 'Analytical timeline')}
        icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t('driveDna.coverage.observedSpan', 'Observed span')}
        value={units.formatDuration(evidence.observedSpanS, { precision: 2 })}
        subtitle={t('driveDna.coverage.observedSpanHint', 'First to last timestamp')}
        icon={<Timer className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('driveDna.coverage.medianInterval', 'Median interval')}
        value={units.formatDuration(evidence.medianIntervalS, { precision: 3 })}
        subtitle={t('driveDna.coverage.medianIntervalHint', 'Adjacent emissions')}
        icon={<TimerReset className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t('driveDna.coverage.largestGap', 'Largest gap')}
        value={units.formatDuration(evidence.largestGapS, { precision: 3 })}
        subtitle={t('driveDna.coverage.largestGapHint', 'Irregular cadence evidence')}
        icon={<Timer className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('driveDna.coverage.timestampIssues', 'Timestamp issues')}
        value={t('driveDna.coverage.timestampIssueValue', '{{invalid}} / {{duplicate}}', {
          invalid: fmtInt(evidence.invalidTimestampCount),
          duplicate: fmtInt(evidence.duplicateTimestampCount),
        })}
        subtitle={t('driveDna.coverage.timestampIssueHint', 'Invalid / duplicate')}
        icon={
          evidence.invalidTimestampCount > 0 ? (
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Copy className="h-5 w-5" aria-hidden="true" />
          )
        }
        color={evidence.invalidTimestampCount > 0 ? 'amber' : 'cyan'}
      />
    </Grid>
  );
}

import { useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, DataTable, GlassPanel, PanelTitle, Text, type Column } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';
import type { FsdInsights } from '@/types/fsd';

import {
  buildFsdCommuteExperiment,
  type CommuteExperimentRow,
  type ExperimentVerdict,
} from '../../lib/fsdCommuteExperiment';
import { FsdSectionBody } from './FsdSectionBody';
import type { FsdSectionState } from './types';

const verdictVariant: Record<ExperimentVerdict, 'success' | 'info' | 'warning' | 'neutral'> = {
  changed: 'info',
  unchanged: 'success',
  underpowered: 'warning',
  unknown: 'neutral',
};

export function FsdCommuteExperimentPanel({
  insights,
  state,
}: {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
}) {
  const { t } = useTranslation();
  const experiment = useMemo(() => buildFsdCommuteExperiment(insights), [insights]);
  const rows = [...experiment.firmware, ...experiment.commutes];

  const columns = useMemo<Column<CommuteExperimentRow>[]>(() => [
    {
      key: 'label',
      header: t('fsd.experiment.route', 'Control route'),
      render: (row) => (
        <div>
          <div>{row.label}</div>
          <Text as="p" variant="caption">{row.windowLabel || `${row.fromLabel} → ${row.toLabel}`}</Text>
        </div>
      ),
    },
    {
      key: 'fromSharePct',
      header: t('fsd.experiment.before', 'Before'),
      render: (row) => row.fromSharePct == null
        ? t('fsd.experiment.unknown', 'Unknown')
        : `${fmtNumber(row.fromSharePct, 1)}% · ${row.fromDrives}`,
    },
    {
      key: 'toSharePct',
      header: t('fsd.experiment.after', 'After'),
      render: (row) => row.toSharePct == null
        ? t('fsd.experiment.unknown', 'Unknown')
        : `${fmtNumber(row.toSharePct, 1)}% · ${row.toDrives}`,
    },
    {
      key: 'verdict',
      header: t('fsd.experiment.verdict', 'Verdict'),
      render: (row) => (
        <Badge variant={verdictVariant[row.verdict]} size="sm">
          {row.verdict === 'changed'
            ? t('fsd.experiment.changed', 'Changed')
            : row.verdict === 'unchanged'
              ? t('fsd.experiment.unchanged', 'No change')
              : row.verdict === 'underpowered'
                ? t('fsd.experiment.thin', 'Too thin')
                : t('fsd.experiment.unknown', 'Unknown')}
        </Badge>
      ),
    },
  ], [t]);

  return (
    <GlassPanel className="p-4 sm:p-5" data-testid="fsd-commute-experiment">
      <PanelTitle className="mb-1 flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('fsd.experiment.title', 'Same-route experiment')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mb-3">
        {experiment.firmwarePair
          ? t(
              'fsd.experiment.subtitle',
              'Did {{to}} change this commute versus {{from}}? Same geofence, same window. Unknown km stay unknown.',
              experiment.firmwarePair,
            )
          : t(
              'fsd.experiment.subtitleEmpty',
              'Month-over-month share without a control route is vibes. This panel only compares the same route and window.',
            )}
      </Text>
      {(experiment.unknownDayCount > 0 || experiment.resetCount > 0) && (
        <Text as="p" variant="caption" className="mb-3">
          {t(
            'fsd.experiment.honesty',
            '{{unknown}} days with no counter · {{resets}} resets. Those km are not zero.',
            { unknown: experiment.unknownDayCount, resets: experiment.resetCount },
          )}
        </Text>
      )}
      <FsdSectionBody state={state} className="min-h-40">
        {rows.length > 0 ? (
          <DataTable
            tableId="fsd-commute-experiment"
            name="FsdCommuteExperiment"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.key}
            mobileColumns={['label', 'verdict']}
            pagination
          />
        ) : (
          <EmptyState
            icon={<FlaskConical className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'fsd.experiment.empty',
              'Need the same commute window on two firmware versions, with high-confidence drives, before this is an experiment.',
            )}
          />
        )}
      </FsdSectionBody>
    </GlassPanel>
  );
}

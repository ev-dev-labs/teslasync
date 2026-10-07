import { BookOpen } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { SleepStateEvidence } from '../../lib/sleepEfficiencyAnalysis';
import { sleepStateLabel } from './labels';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from './types';

export function StateEvidenceDirectory({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => [...analysis.transitions.directory],
    [analysis.transitions.directory],
  );
  const columns = useMemo<Column<SleepStateEvidence>[]>(
    () => [
      {
        key: 'state',
        header: t('sleep.stateDirectory.state', 'State'),
        visibleOnMobile: true,
        render: (row) => (
          <div className="flex items-center gap-2">
            <Text variant="bodySm">{sleepStateLabel(t, row.state)}</Text>
            {!row.known && (
              <Badge variant="warning" size="sm">
                {t('sleep.stateDirectory.unknown', 'Unknown')}
              </Badge>
            )}
          </div>
        ),
      },
      {
        key: 'count',
        header: t(
          'sleep.stateDirectory.count',
          'Valid transition count',
        ),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {fmtInt(row.count)}
          </Text>
        ),
      },
      {
        key: 'share',
        header: t('sleep.stateDirectory.share', 'Count share'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {row.countShare != null
              ? t('sleep.stateDirectory.percent', '{{value}}%', {
                  value: fmtNumber(row.countShare * 100),
                })
              : '—'}
          </Text>
        ),
      },
      {
        key: 'minutes',
        header: t('sleep.stateDirectory.minutes', 'total_minutes'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {t('sleep.stateDirectory.minuteValue', '{{value}} min', {
              value: fmtNumber(row.totalMinutes),
            })}
          </Text>
        ),
      },
      {
        key: 'durationEvidence',
        header: t(
          'sleep.stateDirectory.durationEvidence',
          'Duration evidence',
        ),
        render: (row) => (
          <Badge
            variant={row.totalMinutes > 0 ? 'success' : 'neutral'}
            size="sm"
          >
            {row.totalMinutes > 0
              ? t('sleep.stateDirectory.positive', 'Positive')
              : t('sleep.stateDirectory.validZero', 'Valid zero')}
          </Badge>
        ),
      },
      {
        key: 'semantics',
        header: t('sleep.stateDirectory.semantics', 'Source semantics'),
        render: () => (
          <Text variant="caption">
            {t(
              'sleep.stateDirectory.destinationSemantics',
              'fsm_transitions.to_state destination bucket',
            )}
          </Text>
        ),
      },
    ],
    [t],
  );

  return (
    <section data-testid="sleep-efficiency-state-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('sleep.stateDirectory.title', 'State evidence directory')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.stateDirectory.subtitle',
            'Counts and duration fields are displayed independently with their source meaning.',
          )}
        </Text>
        <SleepEfficiencySectionBody state={state} skeletonHeight={260}>
          {rows.length > 0 ? (
            <DataTable<SleepStateEvidence>
              tableId="battery:sleep-state-evidence"
              columns={columns}
              data={rows}
              keyExtractor={(row) => row.state}
              mobileColumns={['state', 'count']}
              density="compact"
              emptyMessage={t(
                'sleep.stateDirectory.empty',
                'No valid state evidence rows',
              )}
            />
          ) : (
            // no-action: state rows are read-only source evidence
            <EmptyState
              className="py-8"
              icon={<BookOpen className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'sleep.stateDirectory.empty',
                'No valid state evidence rows',
              )}
            />
          )}
        </SleepEfficiencySectionBody>
      </GlassPanel>
    </section>
  );
}

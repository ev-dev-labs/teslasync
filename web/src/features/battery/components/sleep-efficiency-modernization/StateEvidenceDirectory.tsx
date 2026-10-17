import { BookOpen } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, DataTable, Text, type Column } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { SleepStateEvidence } from '../../lib/sleepEfficiencyAnalysis';
import { sleepStateLabel } from '../sleep-efficiency/labels';
import { SleepEfficiencySectionBody } from '../sleep-efficiency/SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from '../sleep-efficiency';

export function StateEvidenceDirectory({ analysis, state }: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const rows = useMemo(() => [...analysis.transitions.directory], [analysis.transitions.directory]);
  const percent = (row: SleepStateEvidence) => row.countShare != null
    ? t('sleep.stateDirectory.percent', '{{value}}%', { value: fmtNumber(row.countShare * 100) }) : '—';
  const minutes = (row: SleepStateEvidence) =>
    t('sleep.stateDirectory.minuteValue', '{{value}} min', { value: fmtNumber(row.totalMinutes) });
  const evidence = (row: SleepStateEvidence) => row.totalMinutes > 0
    ? t('sleep.stateDirectory.positive', 'Positive')
    : t('sleep.stateDirectory.validZero', 'Valid zero');
  const semantics = t('sleep.stateDirectory.destinationSemantics', 'fsm_transitions.to_state destination bucket');
  const columns: Column<SleepStateEvidence>[] = [
    {
      key: 'state', header: t('sleep.stateDirectory.state', 'State'), visibleOnMobile: true,
      render: row => (
        <div className="flex items-center gap-2">
          <Text variant="bodySm">{sleepStateLabel(t, row.state)}</Text>
          {!row.known && <Badge variant="warning" size="sm">{t('sleep.stateDirectory.unknown', 'Unknown')}</Badge>}
        </div>
      ),
    },
    {
      key: 'count', header: t('sleep.stateDirectory.count', 'Valid transition count'),
      align: 'right', visibleOnMobile: true,
      render: row => <Text variant="bodySm" className="font-mono tabular-nums">{fmtInt(row.count)}</Text>,
    },
    {
      key: 'share', header: t('sleep.stateDirectory.share', 'Count share'), align: 'right',
      render: row => <Text variant="bodySm" className="font-mono tabular-nums">{percent(row)}</Text>,
    },
    {
      key: 'minutes', header: t('sleep.stateDirectory.minutes', 'total_minutes'), align: 'right',
      render: row => <Text variant="bodySm" className="font-mono tabular-nums">{minutes(row)}</Text>,
    },
    {
      key: 'durationEvidence', header: t('sleep.stateDirectory.durationEvidence', 'Duration evidence'),
      render: row => <Badge variant={row.totalMinutes > 0 ? 'success' : 'neutral'} size="sm">{evidence(row)}</Badge>,
    },
    {
      key: 'semantics', header: t('sleep.stateDirectory.semantics', 'Source semantics'),
      render: () => <Text variant="caption">{semantics}</Text>,
    },
  ];
  return (
    <section data-testid="sleep-efficiency-state-directory">
      <LayoutCard title={t('sleep.stateDirectory.title', 'State evidence directory')}>
        <Text as="p" variant="caption">
          {t('sleep.stateDirectory.subtitle', 'Counts and duration fields are displayed independently with their source meaning.')}
        </Text>
        <SleepEfficiencySectionBody state={state} skeletonHeight={260}>
          {rows.length > 0 ? (
            <DataTable<SleepStateEvidence>
              variant="embedded"
              tableId="battery:sleep-state-evidence"
              columns={columns}
              data={rows}
              keyExtractor={row => row.state}
              mobileColumns={['state', 'count']}
              density="compact"
              mobilePresentation={{
                roles: { state: 'title', count: 'primary', share: 'meta', minutes: 'meta', durationEvidence: 'badge', semantics: 'meta' },
                displayValue: (row, key) => {
                  switch (key) {
                    case 'state': return sleepStateLabel(t, row.state);
                    case 'count': return fmtInt(row.count);
                    case 'share': return percent(row);
                    case 'minutes': return minutes(row);
                    case 'durationEvidence': return evidence(row);
                    case 'semantics': return semantics;
                    default: return '—';
                  }
                },
              }}
              emptyMessage={t('sleep.stateDirectory.empty', 'No valid state evidence rows')}
            />
          ) : (
            <EmptyState
              // no-action: validated transition evidence is recorded by the backend; workspace controls already own vehicle and range selection.
              className="py-8"
              icon={<BookOpen className="h-8 w-8" aria-hidden="true" />}
              message={t('sleep.stateDirectory.empty', 'No valid state evidence rows')}
            />
          )}
        </SleepEfficiencySectionBody>
      </LayoutCard>
    </section>
  );
}

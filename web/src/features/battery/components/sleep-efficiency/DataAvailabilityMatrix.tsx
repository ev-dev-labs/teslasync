import { DatabaseZap } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import type { SleepAvailabilityRow } from '../../lib/sleepEfficiencyAnalysis';
import {
  availabilityKeyLabel,
  availabilityReasonLabel,
  availabilityStatusLabel,
} from './labels';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from './types';

export function DataAvailabilityMatrix({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => [...analysis.availability],
    [analysis.availability],
  );
  const columns = useMemo<Column<SleepAvailabilityRow>[]>(
    () => [
      {
        key: 'source',
        header: t('sleep.availability.sourceHeader', 'Evidence source'),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm">{availabilityKeyLabel(t, row.key)}</Text>
        ),
      },
      {
        key: 'status',
        header: t('sleep.availability.statusHeader', 'Status'),
        visibleOnMobile: true,
        render: (row) => (
          <Badge
            variant={
              row.status === 'available'
                ? 'success'
                : row.status === 'partial'
                  ? 'warning'
                  : 'neutral'
            }
            size="sm"
          >
            {availabilityStatusLabel(t, row.status)}
          </Badge>
        ),
      },
      {
        key: 'reason',
        header: t('sleep.availability.reasonHeader', 'Evidence rule'),
        render: (row) => (
          <Text variant="caption">
            {availabilityReasonLabel(t, row.reason)}
          </Text>
        ),
      },
    ],
    [t],
  );

  return (
    <section data-testid="sleep-efficiency-availability-matrix">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <DatabaseZap
            className="h-4 w-4 text-emerald-300"
            aria-hidden="true"
          />
          {t('sleep.availability.title', 'Data-availability matrix')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.availability.subtitle',
            'Availability follows explicit evidence gates. The breadth score awards one point for available and half a point for partial sources.',
          )}
        </Text>
        <SleepEfficiencySectionBody state={state} skeletonHeight={260}>
          <DataTable<SleepAvailabilityRow>
            tableId="battery:sleep-availability"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.key}
            mobileColumns={['source', 'status']}
            density="compact"
            emptyMessage={t(
              'sleep.availability.empty',
              'No availability rules',
            )}
          />
        </SleepEfficiencySectionBody>
      </GlassPanel>
    </section>
  );
}

import { useMemo } from 'react';
import { ListTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import type {
  CapacityObservation,
  CapacityState,
  PackCapacityResult,
} from '../../lib/packCapacity';
import {
  packCapacityNumber,
  packCapacityPercent,
} from './labels';
import { PackCapacitySectionBody } from './PackCapacitySectionBody';
import type { PackCapacityQueryState } from './types';

interface PackCapacityDirectoryProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  locale: string;
  formatEnergy: UnitFormatter;
}

interface DirectoryRow {
  key: string;
  observation: CapacityObservation;
  state: CapacityState;
}

export function PackCapacityDirectory({
  result,
  state,
  locale,
  formatEnergy,
}: PackCapacityDirectoryProps) {
  const { t } = useTranslation();
  const rows = useMemo<DirectoryRow[]>(
    () =>
      result.recentMeasurements.map((measurement, index) => ({
        ...measurement,
        key: `${measurement.observation.sessionId}:${measurement.observation.endMs}:${index}`,
      })),
    [result.recentMeasurements],
  );
  const columns = useMemo<Column<DirectoryRow>[]>(
    () => [
      {
        key: 'completed',
        header: t('packCapacity.directory.completed', 'Completed'),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm">
            {formatDateTime(new Date(row.observation.endMs), {
              locale,
              tz: result.timeZone,
            })}
          </Text>
        ),
      },
      {
        key: 'window',
        header: t('packCapacity.directory.window', 'SoC gain'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {packCapacityNumber(
              row.observation.socDeltaPct,
              locale,
              1,
            )}
            pp
          </Text>
        ),
      },
      {
        key: 'energy',
        header: t('packCapacity.directory.energy', 'Energy added'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {formatEnergy(row.observation.energyAddedWh, {
              precision: 2,
            })}
          </Text>
        ),
      },
      {
        key: 'raw',
        header: t('packCapacity.directory.raw', 'Raw capacity'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {formatEnergy(row.observation.capacityWh, {
              precision: 2,
            })}
          </Text>
        ),
      },
      {
        key: 'filtered',
        header: t('packCapacity.directory.filtered', 'Filtered'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {formatEnergy(row.state.capacityWh, { precision: 2 })}
          </Text>
        ),
      },
      {
        key: 'sigma',
        header: t('packCapacity.directory.sigma', 'Posterior sigma'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {formatEnergy(row.state.sigmaWh, { precision: 2 })}
          </Text>
        ),
      },
      {
        key: 'gain',
        header: t('packCapacity.directory.gain', 'Gain'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {packCapacityPercent(row.state.gain, locale, 1)}
          </Text>
        ),
      },
      {
        key: 'innovation',
        header: t(
          'packCapacity.directory.innovation',
          'Std. innovation',
        ),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {packCapacityNumber(
              row.state.standardizedInnovation,
              locale,
              2,
            )}
          </Text>
        ),
      },
      {
        key: 'location',
        header: t('packCapacity.directory.location', 'Location'),
        render: (row) => (
          <Text variant="bodySm">
            {row.observation.locationLabel ?? '—'}
          </Text>
        ),
      },
    ],
    [formatEnergy, locale, result.timeZone, t],
  );

  return (
    <section data-testid="pack-capacity-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListTree
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'packCapacity.directory.title',
            'Recent measurement directory',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'packCapacity.directory.subtitle',
            'Newest qualified charging windows with raw evidence and each filter update exposed.',
          )}
        </Text>
        <PackCapacitySectionBody result={result} state={state}>
          <DataTable
            tableId="battery:pack-capacity-directory"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.key}
            mobileColumns={['completed', 'window', 'raw']}
            emptyMessage={t(
              'packCapacity.directory.empty',
              'No qualified capacity measurements are available.',
            )}
          />
        </PackCapacitySectionBody>
      </GlassPanel>
    </section>
  );
}

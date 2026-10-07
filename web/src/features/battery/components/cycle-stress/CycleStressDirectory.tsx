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
import {
  formatDateTime,
  formatDurationMsCompact,
} from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type {
  CycleStressResult,
  RainflowCycle,
} from '../../lib/cycleStress';
import {
  cycleStressNumber,
  cycleStressPercent,
  cycleStressSourceLabel,
} from './labels';
import { CycleStressSectionBody } from './CycleStressSectionBody';
import type { CycleStressQueryState } from './types';

interface CycleStressDirectoryProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
  locale: string;
}

interface DirectoryRow extends RainflowCycle {
  key: string;
}

export function CycleStressDirectory({
  result,
  state,
  locale,
}: CycleStressDirectoryProps) {
  const { t } = useTranslation();
  const rows = useMemo<DirectoryRow[]>(
    () =>
      result.recentCycles.map((cycle, index) => ({
        ...cycle,
        key: `${cycle.segmentId}:${cycle.closedAtMs}:${cycle.startMs}:${index}`,
      })),
    [result.recentCycles],
  );
  const columns = useMemo<Column<DirectoryRow>[]>(
    () => [
      {
        key: 'closed',
        header: t('cycleStress.directory.closed', 'Closed / observed'),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm">
            {formatDateTime(new Date(row.closedAtMs), {
              locale,
              tz: result.timeZone,
            })}
          </Text>
        ),
      },
      {
        key: 'depth',
        header: t('cycleStress.directory.depth', 'Depth'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text
            variant="bodySm"
            className={cn(
              'font-mono tabular-nums',
              row.depthPct >= result.config.deepThresholdPct
                ? 'text-amber-300'
                : 'text-[var(--text-primary)]',
            )}
          >
            {cycleStressPercent(row.depthPct, locale)}
          </Text>
        ),
      },
      {
        key: 'meanSoc',
        header: t('cycleStress.directory.meanSoc', 'Mean SoC'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {cycleStressPercent(row.meanSocPct, locale)}
          </Text>
        ),
      },
      {
        key: 'closure',
        header: t('cycleStress.directory.closure', 'Closure'),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm">
            {row.count === 1
              ? t('cycleStress.directory.full', 'Full')
              : t('cycleStress.directory.half', 'Boundary half')}
          </Text>
        ),
      },
      {
        key: 'duration',
        header: t('cycleStress.directory.duration', 'Closure duration'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {formatDurationMsCompact(row.durationS * 1_000)}
          </Text>
        ),
      },
      {
        key: 'sources',
        header: t('cycleStress.directory.sources', 'Range sources'),
        render: (row) => (
          <Text variant="bodySm">
            {t(
              'cycleStress.directory.sourcePair',
              '{{start}} to {{end}}',
              {
                start: cycleStressSourceLabel(t, row.startSource),
                end: cycleStressSourceLabel(t, row.endSource),
              },
            )}
          </Text>
        ),
      },
      {
        key: 'efc',
        header: t('cycleStress.directory.efc', 'EFC'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {cycleStressNumber(row.equivalentFullCycles, locale, 3)}
          </Text>
        ),
      },
      {
        key: 'index',
        header: t('cycleStress.directory.index', 'Depth index'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {cycleStressNumber(row.depthWeightedIndex, locale, 3)}
          </Text>
        ),
      },
      {
        key: 'segment',
        header: t('cycleStress.directory.segment', 'Segment'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {cycleStressNumber(row.segmentId, locale, 0)}
          </Text>
        ),
      },
    ],
    [
      locale,
      result.config.deepThresholdPct,
      result.timeZone,
      t,
    ],
  );

  return (
    <section data-testid="cycle-stress-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListTree
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'cycleStress.directory.title',
            'Recent reconstructed-cycle directory',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cycleStress.directory.subtitle',
            'Newest reconstructed ranges, including boundary residues; closure timing is descriptive and does not identify battery damage.',
          )}
        </Text>
        <CycleStressSectionBody
          result={result}
          state={state}
          requirement="cycles"
        >
          <DataTable
            tableId="battery:cycle-stress-directory"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.key}
            mobileColumns={['closed', 'depth', 'closure']}
            emptyMessage={t(
              'cycleStress.directory.empty',
              'No reconstructed cycles are available.',
            )}
          />
        </CycleStressSectionBody>
      </GlassPanel>
    </section>
  );
}

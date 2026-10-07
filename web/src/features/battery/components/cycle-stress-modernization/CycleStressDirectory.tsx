import { useMemo, type ComponentProps } from 'react';
import { ListTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DataTable, GlassPanel, PanelTitle, Text, type Column,
} from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { CycleStressResult, RainflowCycle } from '../../lib/cycleStress';
import {
  cycleStressNumber, cycleStressPercent, cycleStressSourceLabel,
} from '../cycle-stress/labels';
import { CycleStressSectionBody } from '../cycle-stress/CycleStressSectionBody';
import type { CycleStressQueryState } from '../cycle-stress/types';

interface Props {
  result: CycleStressResult;
  state: CycleStressQueryState;
  locale: string;
}
interface DirectoryRow extends RainflowCycle {
  key: string;
}
type MobilePresentation = NonNullable<ComponentProps<typeof DataTable<DirectoryRow>>['mobilePresentation']>;

export function CycleStressDirectory({ result, state, locale }: Props) {
  const { formatDurationMsCompact } = useNumberFormatting();
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
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
        filterValue: (row) => row.depthPct ?? null,
        filterValueLabel: (_, row) => cycleStressPercent(row.depthPct, locale),
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
        filterValue: (row) => row.meanSocPct ?? null,
        filterValueLabel: (_, row) => cycleStressPercent(row.meanSocPct, locale),
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
        filterValue: (row) => row.count ?? null,
        filterValueLabel: (_, row) => row.count === 1 ? t('cycleStress.directory.full', 'Full') : t('cycleStress.directory.half', 'Boundary half'),
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
        filterValue: (row) => row.durationS ?? null,
        filterValueLabel: (_, row) => formatDurationMsCompact(row.durationS * 1_000),
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
            {cycleStressNumber(row.equivalentFullCycles, locale)}
          </Text>
        ),
      },
      {
        key: 'index',
        header: t('cycleStress.directory.index', 'Depth index'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {cycleStressNumber(row.depthWeightedIndex, locale)}
          </Text>
        ),
      },
      {
        key: 'segment',
        filterValue: (row) => row.segmentId ?? null,
        filterValueLabel: (_, row) => cycleStressNumber(row.segmentId, locale, 0),
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
      t, displayPrecision, displayLocale, formatDurationMsCompact,
    ],
  );
  const mobilePresentation = useMemo<MobilePresentation>(() => ({
    roles: {
      closed: 'title', depth: 'primary', closure: 'badge',
      meanSoc: 'meta', duration: 'meta', sources: 'meta',
      efc: 'hidden', index: 'hidden', segment: 'hidden',
    },
    displayValue: (row, key) => {
      switch (key) {
        case 'closed': return formatDateTime(new Date(row.closedAtMs), { locale, tz: result.timeZone });
        case 'depth': return cycleStressPercent(row.depthPct, locale);
        case 'meanSoc': return cycleStressPercent(row.meanSocPct, locale);
        case 'closure': return row.count === 1
          ? t('cycleStress.directory.full', 'Full')
          : t('cycleStress.directory.half', 'Boundary half');
        case 'duration': return formatDurationMsCompact(row.durationS * 1_000);
        case 'sources': return t('cycleStress.directory.sourcePair', '{{start}} to {{end}}', {
          start: cycleStressSourceLabel(t, row.startSource),
          end: cycleStressSourceLabel(t, row.endSource),
        });
        case 'efc': return cycleStressNumber(row.equivalentFullCycles, locale);
        case 'index': return cycleStressNumber(row.depthWeightedIndex, locale);
        case 'segment': return cycleStressNumber(row.segmentId, locale, 0);
        default: return null;
      }
    },
  }), [locale, result.timeZone, t, displayPrecision, displayLocale, formatDurationMsCompact]);

  return (
    <section data-testid="cycle-stress-directory">
      <GlassPanel className="min-w-0 p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListTree className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('cycleStress.directory.title', 'Recent reconstructed-cycle directory')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('cycleStress.directory.subtitle',
            'Newest reconstructed ranges, including boundary residues; closure timing is descriptive and does not identify battery damage.')}
        </Text>
        <CycleStressSectionBody result={result} state={state} requirement="cycles">
          <DataTable enableValueFilters variant="embedded"
            tableId="battery:cycle-stress-directory"
            columns={columns}
            data={rows}
            keyExtractor={(row) => row.key}
            mobileColumns={['closed', 'depth', 'closure']}
            mobilePresentation={mobilePresentation}
            emptyMessage={t('cycleStress.directory.empty', 'No reconstructed cycles are available.')}
          />
        </CycleStressSectionBody>
      </GlassPanel>
    </section>
  );
}

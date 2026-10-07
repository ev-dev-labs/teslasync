import { ListTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import type {
  ComfortConsistencySummary,
  ComfortRunBoundary,
} from '../../lib/comfortConsistency';
import { ComfortConsistencySectionBody } from './ComfortConsistencySectionBody';
import type {
  ComfortConsistencyQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface ComfortConsistencyWindowDirectoryProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  locale: string;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="bodySm" mono className="mt-0.5">{value}</Text>
    </div>
  );
}

export function ComfortConsistencyWindowDirectory({
  summary,
  state,
  locale,
  formatDuration,
  formatDelta,
}: ComfortConsistencyWindowDirectoryProps) {
  const { t } = useTranslation();
  const directory = summary.windowDirectory;
  const boundaryLabel = (boundary: ComfortRunBoundary) => {
    if (boundary === 'hvac_inactive') {
      return t('comfortConsistency.directory.boundary.inactive', 'Observed HVAC inactive');
    }
    if (boundary === 'missing_evidence') {
      return t('comfortConsistency.directory.boundary.missing', 'Censored - missing evidence');
    }
    if (boundary === 'long_gap') {
      return t('comfortConsistency.directory.boundary.gap', 'Censored - long gap');
    }
    if (boundary === 'target_shift') {
      return t('comfortConsistency.directory.boundary.target', 'Observed target shift');
    }
    return t('comfortConsistency.directory.boundary.dataset', 'Censored - dataset edge');
  };

  return (
    <section data-testid="comfort-consistency-window-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListTree className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('comfortConsistency.directory.title', 'Stabilization-window directory')}
        </PanelTitle>
        <Text as="p" variant="caption">
          {t(
            'comfortConsistency.directory.subtitle',
            'Newest first; each outside-band fragment discloses sample support, boundaries, stabilization, and observed overshoot.',
          )}
        </Text>
        <Text as="p" variant="caption" className="mb-4 mt-1">
          {t(
            'comfortConsistency.directory.cap',
            'Showing {{shown}} of {{total}} windows; {{omitted}} omitted by the {{cap}}-window display cap.',
            {
              shown: fmtInt(directory.displayed),
              total: fmtInt(directory.total),
              omitted: fmtInt(directory.omitted),
              cap: fmtInt(directory.cap),
            },
          )}
        </Text>
        <ComfortConsistencySectionBody
          summary={summary}
          state={state}
          requirement="windows"
        >
          <ol className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
            {directory.items.map((window) => (
              <li
                key={window.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Text as="p" variant="label">
                      {t('comfortConsistency.directory.window', 'Chronological window {{index}}', {
                        index: fmtInt(window.index),
                      })}
                    </Text>
                    <Text as="p" variant="caption">
                      {formatDateTime(new Date(window.startMs), { locale })}
                    </Text>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={window.direction === 'hot' ? 'warning' : 'info'}>
                      {window.direction === 'hot'
                        ? t('comfortConsistency.directory.hot', 'Hot fragment')
                        : t('comfortConsistency.directory.cold', 'Cold fragment')}
                    </Badge>
                    <Badge variant={window.timeToBandS != null ? 'success' : 'neutral'}>
                      {window.timeToBandS != null
                        ? t('comfortConsistency.directory.stabilized', 'Sustained band observed')
                        : t('comfortConsistency.directory.notObserved', 'Not observed stabilized')}
                    </Badge>
                    <Badge variant={window.rightCensored ? 'warning' : 'success'}>
                      {window.rightCensored
                        ? t('comfortConsistency.directory.censored', 'Right-censored')
                        : t('comfortConsistency.directory.observedEnd', 'Observed end gate')}
                    </Badge>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                  <Detail
                    label={t('comfortConsistency.directory.end', 'Last sample')}
                    value={formatDateTime(new Date(window.endMs), { locale })}
                  />
                  <Detail
                    label={t('comfortConsistency.directory.span', 'Sample span')}
                    value={formatDuration(window.sampleSpanS, { precision: 2 })}
                  />
                  <Detail
                    label={t('comfortConsistency.directory.samples', 'Samples')}
                    value={fmtInt(window.samples)}
                  />
                  <Detail
                    label={t('comfortConsistency.directory.startDelta', 'Start deviation')}
                    value={formatDelta(window.startDeviationC)}
                  />
                  <Detail
                    label={t('comfortConsistency.directory.timeToBand', 'Observed time to sustained band')}
                    value={formatDuration(window.timeToBandS, { precision: 2 })}
                  />
                  <Detail
                    label={t('comfortConsistency.directory.overshoot', 'Observed overshoot')}
                    value={formatDelta(window.overshootC)}
                  />
                  <Detail
                    label={t('comfortConsistency.directory.left', 'Left boundary')}
                    value={boundaryLabel(window.leftBoundary)}
                  />
                  <Detail
                    label={t('comfortConsistency.directory.right', 'Right boundary')}
                    value={boundaryLabel(window.rightBoundary)}
                  />
                </div>
              </li>
            ))}
          </ol>
        </ComfortConsistencySectionBody>
      </GlassPanel>
    </section>
  );
}

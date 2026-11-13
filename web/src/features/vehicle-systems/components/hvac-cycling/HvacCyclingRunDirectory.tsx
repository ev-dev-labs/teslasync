import { LayoutCard } from '@/components/layout';
import { useTranslation } from 'react-i18next';

import { Badge, MetricLabel, Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';

import type {
  HvacCyclingSummary,
  HvacRunBoundary,
} from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface HvacCyclingRunDirectoryProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  locale: string;
  formatDuration: UnitFormatter;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div data-app-part="list-row">
      <MetricLabel data-app-part="metric-label" as="dt">{label}</MetricLabel>
      <dd data-app-part="metric-reading" className="mt-0.5">
        <Text data-app-part="metric-value" as="p" variant="bodySm" mono>
          {value}
        </Text>
      </dd>
    </div>
  );
}

export function HvacCyclingRunDirectory({
  summary,
  state,
  formatDuration,
}: HvacCyclingRunDirectoryProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat('utc');
  const date = (ms: number) => formatDateTime(new Date(ms), { tz: summary.timeZone });
  const directory = summary.runDirectory;
  const resolved = state.vehicleSelected && state.isResolved && !state.isLoading && !state.error;
  const unknownCount = t('common.unknown', 'Unknown');
  const boundaryLabel = (boundary: HvacRunBoundary) => {
    if (boundary === 'observed_transition') {
      return t('hvacCycling.directory.boundary.transition', 'Observed transition');
    }
    if (boundary === 'long_gap') {
      return t('hvacCycling.directory.boundary.gap', 'Censored · long gap');
    }
    if (boundary === 'unknown_state') {
      return t('hvacCycling.directory.boundary.unknown', 'Censored · unknown state');
    }
    return t('hvacCycling.directory.boundary.dataset', 'Censored · dataset edge');
  };

  return (
    <section data-testid="hvac-cycling-run-directory">
      <LayoutCard title={t('hvacCycling.directory.title', 'Run evidence directory')}>
        <Text as="p" variant="caption">
          {t(
            'hvacCycling.directory.subtitle',
            'Newest first; each fragment discloses state, observed duration, interval support, boundaries, and eligibility.',
          )}
        </Text>
        <Text as="p" variant="caption" className="mb-4 mt-1">
          {t(
            'hvacCycling.directory.cap',
            'Showing {{shown}} of {{total}} runs; {{omitted}} omitted by the {{cap}}-run display cap.',
            {
              shown: resolved ? fmtInt(directory.displayed) : unknownCount,
              total: resolved ? fmtInt(directory.total) : unknownCount,
              omitted: resolved ? fmtInt(directory.omitted) : unknownCount,
              cap: fmtInt(directory.cap),
            },
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state} requirement="runs">
          <ol data-app-part="list" data-app-list="records" className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
            {directory.items.map((run) => {
              const classification = !run.eligibleForShortCycle
                ? t('hvacCycling.directory.notEligible', 'Not short-cycle eligible')
                : run.shortCycle
                  ? t('hvacCycling.directory.short', 'Qualified short run')
                  : t('hvacCycling.directory.notShort', 'Qualified above threshold');
              return (
                <li
                  key={run.id}
                  data-app-part="card list-row"
                  data-app-card-kind="record"
                  data-surface-variant="standalone"
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div data-app-part="record-header" className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Text data-app-part="record-title" as="p" variant="label">
                        {t('hvacCycling.directory.run', 'Chronological run {{index}}', {
                          index: fmtInt(run.index),
                        })}
                      </Text>
                      <Text data-app-part="record-context" as="p" variant="caption">
                        {date(run.startMs)}
                      </Text>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={run.on ? 'info' : 'neutral'}>
                        {run.on
                          ? t('hvacCycling.directory.on', 'On')
                          : t('hvacCycling.directory.off', 'Off')}
                      </Badge>
                      <Badge variant={run.complete ? 'success' : 'warning'}>
                        {run.complete
                          ? t('hvacCycling.directory.complete', 'Complete support')
                          : t('hvacCycling.directory.partial', 'Partial support')}
                      </Badge>
                      <Badge
                        variant={
                          !run.eligibleForShortCycle
                            ? 'neutral'
                            : run.shortCycle
                              ? 'warning'
                              : 'success'
                        }
                      >
                        {classification}
                      </Badge>
                    </div>
                  </div>
                  <dl data-app-part="list record-body" data-app-list="definitions" className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <Detail
                      label={t('hvacCycling.directory.start', 'Start')}
                      value={date(run.startMs)}
                    />
                    <Detail
                      label={t('hvacCycling.directory.end', 'End')}
                      value={date(run.endMs)}
                    />
                    <Detail
                      label={t('hvacCycling.directory.duration', 'Observed duration')}
                      value={formatDuration(run.durationS)}
                    />
                    <Detail
                      label={t('hvacCycling.directory.intervals', 'Intervals')}
                      value={fmtInt(run.intervals)}
                    />
                    <Detail
                      label={t('hvacCycling.directory.left', 'Left boundary')}
                      value={boundaryLabel(run.leftBoundary)}
                    />
                    <Detail
                      label={t('hvacCycling.directory.right', 'Right boundary')}
                      value={boundaryLabel(run.rightBoundary)}
                    />
                  </dl>
                </li>
              );
            })}
          </ol>
        </HvacCyclingSectionBody>
      </LayoutCard>
    </section>
  );
}

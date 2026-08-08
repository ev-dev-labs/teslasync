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
  HvacCyclingSummary,
  HvacRunBoundary,
} from '../../lib/hvacCycling';
import { HvacCyclingSectionBody } from './HvacCyclingSectionBody';
import type { HvacCyclingQueryState } from './types';

interface HvacCyclingRunDirectoryProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  locale: string;
  formatDuration: UnitFormatter;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="bodySm" mono className="mt-0.5">
        {value}
      </Text>
    </div>
  );
}

export function HvacCyclingRunDirectory({
  summary,
  state,
  locale,
  formatDuration,
}: HvacCyclingRunDirectoryProps) {
  const { t } = useTranslation();
  const directory = summary.runDirectory;
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
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListTree className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('hvacCycling.directory.title', 'Run evidence directory')}
        </PanelTitle>
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
              shown: fmtInt(directory.displayed),
              total: fmtInt(directory.total),
              omitted: fmtInt(directory.omitted),
              cap: fmtInt(directory.cap),
            },
          )}
        </Text>
        <HvacCyclingSectionBody summary={summary} state={state} requirement="runs">
          <ol className="max-h-[42rem] space-y-2 overflow-y-auto pr-1">
            {directory.items.map((run) => {
              const classification = !run.eligibleForShortCycle
                ? t('hvacCycling.directory.notEligible', 'Not short-cycle eligible')
                : run.shortCycle
                  ? t('hvacCycling.directory.short', 'Qualified short run')
                  : t('hvacCycling.directory.notShort', 'Qualified above threshold');
              return (
                <li
                  key={run.id}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Text as="p" variant="label">
                        {t('hvacCycling.directory.run', 'Chronological run {{index}}', {
                          index: fmtInt(run.index),
                        })}
                      </Text>
                      <Text as="p" variant="caption">
                        {formatDateTime(new Date(run.startMs), { locale })}
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
                  <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                    <Detail
                      label={t('hvacCycling.directory.start', 'Start')}
                      value={formatDateTime(new Date(run.startMs), { locale })}
                    />
                    <Detail
                      label={t('hvacCycling.directory.end', 'End')}
                      value={formatDateTime(new Date(run.endMs), { locale })}
                    />
                    <Detail
                      label={t('hvacCycling.directory.duration', 'Observed duration')}
                      value={formatDuration(run.durationS, { precision: 1 })}
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
                  </div>
                </li>
              );
            })}
          </ol>
        </HvacCyclingSectionBody>
      </GlassPanel>
    </section>
  );
}

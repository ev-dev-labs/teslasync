import { CalendarRange, CheckCircle2, Database, Info, Ruler, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import {
  Badge, GlassPanel, HelpTooltip, MetricLabel, MetricValue, PanelTitle, Text,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { useDriveHistory } from '@/api/hooks/useDriving';
import { useDataState } from '@/hooks/useDataState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';

import type { TargetSummary } from '../../lib/efficiencyTarget';
import { EfficiencyTargetSectionBody } from './EfficiencyTargetSectionBody';
import type { EfficiencyTargetSectionState } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface TargetMethodologyProps {
  summary: TargetSummary;
  historyLimit: number;
  state: EfficiencyTargetSectionState;
  className?: string;
}

export function TargetMethodology(
  { summary, historyLimit, state, className }: TargetMethodologyProps,
) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const history = useDriveHistory(vehicleId != null ? String(vehicleId) : undefined, historyLimit);
  const source = useDataState(history, { provenance: 'historical' });
  const hasCoverage = source.hasData && !state.isLoading && !state.error;
  const retained = source.status === 'stale';
  const coverageState = {
    ...state,
    isLoading: state.isLoading || (!source.hasData && !source.fatalError),
    error: source.fatalError ?? state.error,
  };
  const coverage = [
    {
      value: fmtInt(summary.observed),
      label: t('effTarget.method.returned', 'Rows returned'),
    },
    {
      value: fmtInt(summary.analyzed),
      label: t('effTarget.method.eligible', 'Eligible drives'),
    },
    {
      value: fmtInt(summary.completedWeeks.length),
      label: t('effTarget.method.graded', 'Completed weeks'),
    },
  ];
  const methods = [
    {
      icon: <CalendarRange className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'effTarget.method.calendar',
        'Weeks run Monday through Sunday in local browser time.',
      ),
    },
    {
      icon: <Ruler className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'effTarget.method.eligibility',
        'A drive qualifies with measured positive energy and at least 1 km of distance.',
      ),
    },
    {
      icon: <Scale className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'effTarget.method.weighting',
        'Consumption is total energy divided by total distance, not an average of drive averages.',
      ),
    },
    {
      icon: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'effTarget.method.activeExclusion',
        'The active week stays visible as a snapshot but is excluded from hit rate, streaks, bands, and ranking.',
      ),
    },
    {
      icon: <Database className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'effTarget.method.rolling',
        'The rolling line weights eligible energy and distance observed in the current and previous three calendar weeks.',
      ),
    },
  ];

  return (
    <GlassPanel
      className={cn('p-5 sm:p-6', className)}
      role="region"
      aria-label={t(
        'effTarget.sections.method',
        'Confidence, methodology, and coverage',
      )}
      data-testid="efficiency-target-method"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Database className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
          {t('effTarget.method.title', 'Coverage & methodology')}
          <HelpTooltip
            size="xs"
            i18nKey="help.efficiencyTarget.body"
            defaultValue="Weekly consumption is total measured energy divided by total eligible distance. The active local week is descriptive until Sunday ends."
            ariaLabel={t(
              'help.efficiencyTarget.iconLabel',
              'More info about the target math',
            )}
          />
        </PanelTitle>
        <Badge
          variant={hasCoverage && (retained || summary.historyCapReached) ? 'warning' : 'neutral'}
          dot
        >
          {!hasCoverage
            ? coverageState.error
              ? t('driveCalendar.brief.unavailable', 'Drive history unavailable')
              : t('driveCalendar.brief.loading', 'Loading drive history')
            : <>
              {retained && <>{t('driveCalendar.brief.retained', 'Retained drive history')} · </>}
              {summary.historyCapReached
            ? t('effTarget.method.capReached', '{{limit}}-drive cap reached', {
                limit: fmtInt(historyLimit),
              })
            : t('effTarget.method.belowCap', 'Observed window below API cap')}
            </>}
        </Badge>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <EfficiencyTargetSectionBody state={coverageState} className="min-h-64">
            <div className="grid grid-cols-3 gap-2">
              {coverage.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl bg-[var(--surface-2)] p-3"
                >
                  <MetricValue>{item.value}</MetricValue>
                  <MetricLabel>{item.label}</MetricLabel>
                </div>
              ))}
            </div>
            {summary.observed === 0 ? (
              <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
                className="py-6"
                icon={<Info className="h-7 w-7" aria-hidden="true" />}
                message={t(
                  'effTarget.method.empty',
                  'Coverage will appear when drive history is returned for the selected vehicle.',
                )}
              />
            ) : (
              <div className="mt-4 rounded-xl border border-[var(--border-subtle)] p-3">
                <Text as="p" variant="bodySm">
                  {t(
                    'effTarget.method.coverage',
                    '{{eligible}} eligible and {{excluded}} excluded across {{observed}} returned rows.',
                    {
                      eligible: fmtInt(summary.analyzed),
                      excluded: fmtInt(summary.excluded),
                      observed: fmtInt(summary.observed),
                    },
                  )}
                </Text>
              </div>
            )}
            <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <Text as="p" variant="caption">
                {summary.historyCapReached
                  ? t(
                      'effTarget.method.capped',
                      'This request reached the {{limit}}-drive API cap. Results describe the returned history window; older drives may not be represented.',
                      { limit: fmtInt(historyLimit) },
                    )
                  : t(
                      'effTarget.method.window',
                      'Results describe the {{count}} drives returned in this observed history window, up to the {{limit}}-drive API limit.',
                      {
                        count: summary.observed,
                        limit: fmtInt(historyLimit),
                      },
                    )}
              </Text>
            </div>
          </EfficiencyTargetSectionBody>

          <ul className="space-y-3">
            {methods.map((method) => (
              <li
                key={method.text}
                className="flex items-start gap-2 text-[var(--text-secondary)]"
              >
                <span className="mt-0.5 shrink-0 text-[var(--text-secondary)]">
                  {method.icon}
                </span>
                <Text as="span" variant="bodySm">
                  {method.text}
                </Text>
              </li>
            ))}
          </ul>
        </div>
    </GlassPanel>
  );
}

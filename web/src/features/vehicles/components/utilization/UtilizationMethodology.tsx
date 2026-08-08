import {
  Activity,
  CalendarRange,
  Database,
  Info,
  Ruler,
  Wallet,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  HelpTooltip,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { UtilizationSummary } from '../../lib/utilization';
import type { UtilizationSectionState } from './types';
import { UtilizationSectionBody } from './UtilizationSectionBody';

interface UtilizationMethodologyProps {
  summary: UtilizationSummary;
  historyLimit: number;
  state: UtilizationSectionState;
}

export function UtilizationMethodology({
  summary,
  historyLimit,
  state,
}: UtilizationMethodologyProps) {
  const { t } = useTranslation();
  const accounting = summary.accounting;
  const observedDays =
    summary.observedDays != null
      ? fmtNumber(summary.observedDays, 1)
      : '—';
  const coverage = [
    {
      value: fmtInt(accounting.returnedRows),
      label: t(
        'utilization.method.returned',
        'Rows returned',
      ),
    },
    {
      value: fmtInt(accounting.eligibleRows),
      label: t(
        'utilization.method.eligible',
        'Eligible drives',
      ),
    },
    {
      value: fmtInt(accounting.excludedRows),
      label: t(
        'utilization.method.excluded',
        'Timestamp exclusions',
      ),
    },
    {
      value: observedDays,
      label: t(
        'utilization.method.observedDays',
        'Exact observed days',
      ),
    },
  ];
  const exclusions = [
    {
      label: t(
        'utilization.method.invalidTimestamp',
        'Invalid or missing timestamp',
      ),
      value: accounting.invalidTimestampRows,
    },
    {
      label: t(
        'utilization.method.futureTimestamp',
        'At or after frozen as-of time',
      ),
      value: accounting.futureTimestampRows,
    },
    {
      label: t(
        'utilization.method.beforeRange',
        'Before selected start',
      ),
      value: accounting.beforeRangeRows,
    },
    {
      label: t(
        'utilization.method.afterRange',
        'After selected end',
      ),
      value: accounting.afterRangeRows,
    },
  ];
  const fieldCoverage = [
    {
      label: t(
        'utilization.method.durationCoverage',
        'Usable duration ({{truncated}} boundary-clipped)',
        { truncated: accounting.truncatedDurationRows },
      ),
      usable: accounting.usableDurationRows,
      excluded: accounting.excludedDurationRows,
    },
    {
      label: t(
        'utilization.method.distanceCoverage',
        'Usable positive distance',
      ),
      usable: accounting.usableDistanceRows,
      excluded: accounting.excludedDistanceRows,
    },
    {
      label: t(
        'utilization.method.energyCoverage',
        'Usable positive energy',
      ),
      usable: accounting.usableEnergyRows,
      excluded: accounting.excludedEnergyRows,
    },
  ];
  const methods = [
    {
      icon: <CalendarRange className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'utilization.method.scope',
        'The API request uses the selected inclusive UTC dates. The model converts the selected end to exclusive next-midnight and never analyzes past the frozen page clock.',
      ),
    },
    {
      icon: <Activity className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'utilization.method.window',
        'The observed window begins at the first eligible returned drive, avoiding claims about time before the first in-range record.',
      ),
    },
    {
      icon: <Ruler className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'utilization.method.si',
        'Distance and energy remain canonical meters and watt-hours in the model; display units are applied only while rendering.',
      ),
    },
    {
      icon: <Database className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'utilization.method.rollups',
        'Drive counts are attributed to the UTC start day, and logged duration is clipped at the analysis boundary and split across crossed UTC days. For a boundary-crossing drive, full-drive distance, energy, and duration-band evidence are withheld because they cannot be apportioned safely.',
      ),
    },
    {
      icon: <Wallet className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'utilization.method.cost',
        'Total cost applies the Settings electricity rate to usable energy. Per-distance and per-hour costs use only energy from rows with the matching usable distance or duration, and exclude non-energy ownership costs.',
      ),
    },
    {
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'utilization.method.nonCausal',
        'Time without a recorded drive and inactive observed days are descriptive; this workspace does not infer waste, availability, telemetry health, or why the vehicle was not driven.',
      ),
    },
  ];

  return (
    <GlassPanel
      className="p-5 sm:p-6"
      role="region"
      aria-label={t(
        'utilization.sections.method',
        'Coverage and methodology',
      )}
      data-testid="utilization-method"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Database
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'utilization.method.title',
            'Coverage & methodology',
          )}
          <HelpTooltip
            size="xs"
            i18nKey="help.utilization.methodology"
            defaultValue="Coverage separates timestamp eligibility from field-level metric usability, and flags when the ranged request reaches its row cap."
            ariaLabel={t(
              'help.utilization.methodologyLabel',
              'More info about utilization coverage',
            )}
          />
        </PanelTitle>
        <Badge
          variant={
            accounting.historyCapReached ? 'warning' : 'neutral'
          }
          dot
        >
          {accounting.historyCapReached
            ? t(
                'utilization.method.capReached',
                '{{limit}}-drive cap reached',
                { limit: fmtInt(historyLimit) },
              )
            : t(
                'utilization.method.belowCap',
                'Ranged response below API cap',
              )}
        </Badge>
      </div>

      <UtilizationSectionBody state={state} className="mt-4 min-h-72">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(20rem,2fr)]">
          <div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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

            {accounting.returnedRows === 0 ? (
              <EmptyState
                className="py-6"
                icon={<Database className="h-7 w-7" aria-hidden="true" />}
                message={t(
                  'utilization.method.empty',
                  'Coverage will appear when ranged drive history is returned for the selected vehicle.',
                )}
              />
            ) : (
              <>
                <div className="mt-4 rounded-xl border border-[var(--border-subtle)] p-3">
                  <Text as="p" variant="bodySm">
                    {t(
                      'utilization.method.selectedScope',
                      'Selected UTC scope: {{start}} to {{end}}. Analysis as-of is frozen for this page mount.',
                      {
                        start: summary.window.rangeStart,
                        end: summary.window.rangeEnd,
                      },
                    )}
                  </Text>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-[var(--border-subtle)] p-3">
                    <Text as="p" variant="label">
                      {t(
                        'utilization.method.timestampExclusions',
                        'Timestamp eligibility',
                      )}
                    </Text>
                    <ul className="mt-2 space-y-2">
                      {exclusions.map((item) => (
                        <li
                          key={item.label}
                          className="flex items-center justify-between gap-3"
                        >
                          <Text variant="bodySm">{item.label}</Text>
                          <Text variant="bodySm" mono>
                            {fmtInt(item.value)}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-[var(--border-subtle)] p-3">
                    <Text as="p" variant="label">
                      {t(
                        'utilization.method.fieldCoverageTitle',
                        'Metric field coverage',
                      )}
                    </Text>
                    <ul className="mt-2 space-y-2">
                      {fieldCoverage.map((item) => (
                        <li key={item.label}>
                          <Text as="p" variant="bodySm">
                            {item.label}
                          </Text>
                          <Text as="p" variant="caption">
                            {t(
                              'utilization.method.fieldCoverageValue',
                              '{{usable}} usable · {{excluded}} excluded',
                              {
                                usable: fmtInt(item.usable),
                                excluded: fmtInt(item.excluded),
                              },
                            )}
                          </Text>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}

            <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3">
              <Text as="p" variant="caption">
                {accounting.historyCapReached
                  ? t(
                      'utilization.method.capped',
                      'The request returned {{limit}} rows. Results describe that capped ranged response; additional matching drives may exist.',
                      { limit: fmtInt(historyLimit) },
                    )
                  : t(
                      'utilization.method.uncapped',
                      'The ranged response returned {{count}} rows below the {{limit}}-drive API limit.',
                      {
                        count: accounting.returnedRows,
                        limit: fmtInt(historyLimit),
                      },
                    )}
              </Text>
            </div>
          </div>

          <ul className="space-y-3">
            {methods.map((method) => (
              <li
                key={method.text}
                className="flex items-start gap-2"
              >
                <span className="mt-0.5 shrink-0 text-cyan-300">
                  {method.icon}
                </span>
                <Text as="span" variant="bodySm">
                  {method.text}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      </UtilizationSectionBody>
    </GlassPanel>
  );
}

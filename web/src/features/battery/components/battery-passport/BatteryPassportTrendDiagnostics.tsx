import {
  Activity,
  CalendarClock,
  CalendarRange,
  CircleDot,
  Clock3,
  ShieldCheck,
  Sigma,
  TrendingDown,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import type {
  BatteryPassportAnalysis,
  BatteryPassportFitStatus,
  BatteryPassportTrendCategory,
} from '../../lib/batteryPassportAnalysis';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type { BatteryPassportQueryState } from './types';

interface BatteryPassportTrendDiagnosticsProps {
  analysis: BatteryPassportAnalysis;
  state: BatteryPassportQueryState;
}

function fitLabel(
  status: BatteryPassportFitStatus,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (status) {
    case 'available':
      return t(
        'batteryPassport.diagnostics.fitAvailable',
        'Gates passed; descriptive fit available',
      );
    case 'insufficient_span':
      return t(
        'batteryPassport.diagnostics.fitSpan',
        'Withheld: less than 90 days',
      );
    default:
      return t(
        'batteryPassport.diagnostics.fitPoints',
        'Withheld: fewer than 12 points',
      );
  }
}

function supportLabel(
  band: BatteryPassportAnalysis['support']['band'],
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (band) {
    case 'broad':
      return t(
        'batteryPassport.diagnostics.supportBroad',
        'Broad returned evidence',
      );
    case 'developing':
      return t(
        'batteryPassport.diagnostics.supportDeveloping',
        'Developing returned evidence',
      );
    case 'thin':
      return t(
        'batteryPassport.diagnostics.supportThin',
        'Thin returned evidence',
      );
    default:
      return t(
        'batteryPassport.diagnostics.supportNone',
        'No returned evidence',
      );
  }
}

export function BatteryPassportTrendDiagnostics({
  analysis,
  state,
}: BatteryPassportTrendDiagnosticsProps) {
  const { t } = useTranslation();
  const diagnostics = analysis.trend.diagnostics;
  const accounting = analysis.trend.accounting;
  const annualized =
    diagnostics.fit.status === 'available'
      ? diagnostics.fit.annualizedChangePctPoints
      : null;
  const categories: Array<{
    key: BatteryPassportTrendCategory;
    label: string;
  }> = [
    {
      key: 'included',
      label: t(
        'batteryPassport.diagnostics.included',
        'Included points',
      ),
    },
    {
      key: 'invalid_date',
      label: t(
        'batteryPassport.diagnostics.invalidDate',
        'Invalid UTC dates',
      ),
    },
    {
      key: 'future_date',
      label: t(
        'batteryPassport.diagnostics.futureDate',
        'Future UTC dates',
      ),
    },
    {
      key: 'invalid_soh',
      label: t(
        'batteryPassport.diagnostics.invalidSoh',
        'Invalid SoH values',
      ),
    },
    {
      key: 'duplicate_date',
      label: t(
        'batteryPassport.diagnostics.duplicateDate',
        'Duplicate UTC dates',
      ),
    },
  ];

  return (
    <section data-testid="battery-passport-trend-diagnostics">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Activity
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'batteryPassport.diagnostics.title',
            'Trend diagnostics and exact accounting',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.diagnostics.subtitle',
            'Coverage, UTC cadence, recency to the frozen page clock, variability, quantiles, and gated linear description.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={t(
                'batteryPassport.diagnostics.points',
                'Analyzed points',
              )}
              value={fmtNumber(diagnostics.pointCount, 0)}
              subtitle={t(
                'batteryPassport.diagnostics.returned',
                '{{count}} returned before checks',
                { count: accounting.returnedPoints },
              )}
              icon={<CircleDot className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'batteryPassport.diagnostics.span',
                'UTC date span',
              )}
              value={diagnostics.spanDays != null
                ? t(
                    'batteryPassport.values.days',
                    '{{value}} days',
                    { value: fmtNumber(diagnostics.spanDays, 0) },
                  )
                : '—'}
              subtitle={t(
                'batteryPassport.diagnostics.spanHint',
                'first through latest included date',
              )}
              icon={<CalendarRange className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t(
                'batteryPassport.diagnostics.recency',
                'Recency',
              )}
              value={diagnostics.daysSinceLatest != null
                ? t(
                    'batteryPassport.values.days',
                    '{{value}} days',
                    { value: fmtNumber(diagnostics.daysSinceLatest, 0) },
                  )
                : '—'}
              subtitle={t(
                'batteryPassport.diagnostics.recencyHint',
                'latest UTC date to frozen page clock',
              )}
              icon={<CalendarClock className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t(
                'batteryPassport.diagnostics.cadence',
                'Median UTC cadence',
              )}
              value={diagnostics.medianCadenceDays != null
                ? t(
                    'batteryPassport.values.days',
                    '{{value}} days',
                    {
                      value: fmtNumber(
                        diagnostics.medianCadenceDays,
                        1,
                      ),
                    },
                  )
                : '—'}
              subtitle={t(
                'batteryPassport.diagnostics.cadenceHint',
                'between included dates',
              )}
              icon={<Clock3 className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'batteryPassport.diagnostics.change',
                'Start-to-end change',
              )}
              value={diagnostics.startToEndChangePctPoints != null
                ? t(
                    'batteryPassport.values.percentagePoints',
                    '{{value}} pp',
                    {
                      value: fmtNumber(
                        diagnostics.startToEndChangePctPoints,
                        2,
                      ),
                    },
                  )
                : '—'}
              subtitle={t(
                'batteryPassport.diagnostics.changeHint',
                'descriptive endpoint difference',
              )}
              icon={<TrendingDown className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'batteryPassport.diagnostics.quantiles',
                'P10 / median / P90',
              )}
              value={
                diagnostics.p10SohPct != null
                && diagnostics.medianSohPct != null
                && diagnostics.p90SohPct != null
                  ? t(
                      'batteryPassport.diagnostics.quantileValue',
                      '{{p10}} / {{median}} / {{p90}}%',
                      {
                        p10: fmtNumber(diagnostics.p10SohPct, 1),
                        median: fmtNumber(
                          diagnostics.medianSohPct,
                          1,
                        ),
                        p90: fmtNumber(diagnostics.p90SohPct, 1),
                      },
                    )
                  : '—'
              }
              subtitle={t(
                'batteryPassport.diagnostics.quantilesHint',
                'included certificate points',
              )}
              icon={<Activity className="h-5 w-5" />}
              color="red"
            />
            <MetricCard
              label={t(
                'batteryPassport.diagnostics.variability',
                'Population variability',
              )}
              value={diagnostics.standardDeviationPctPoints != null
                ? t(
                    'batteryPassport.values.percentagePoints',
                    '{{value}} pp',
                    {
                      value: fmtNumber(
                        diagnostics.standardDeviationPctPoints,
                        2,
                      ),
                    },
                  )
                : '—'}
              subtitle={t(
                'batteryPassport.diagnostics.variabilityHint',
                'standard deviation; not uncertainty',
              )}
              icon={<Sigma className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'batteryPassport.diagnostics.linear',
                'Annualized linear description',
              )}
              value={annualized != null
                ? t(
                    'batteryPassport.diagnostics.annualValue',
                    '{{value}} pp/year',
                    { value: fmtNumber(annualized, 2) },
                  )
                : '—'}
              subtitle={fitLabel(diagnostics.fit.status, t)}
              icon={<TrendingDown className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'batteryPassport.diagnostics.support',
                'Evidence breadth',
              )}
              value={t(
                'batteryPassport.diagnostics.supportValue',
                '{{value}} / 100',
                { value: analysis.support.index },
              )}
              subtitle={supportLabel(analysis.support.band, t)}
              icon={<ShieldCheck className="h-5 w-5" />}
              color="green"
            />
          </div>
          <Text as="p" variant="caption" className="mt-3">
            {t(
              'batteryPassport.diagnostics.supportHelp',
              'The evidence-breadth indicator uses valid core fields, trend volume and span, thermal evidence, and digest presence. It is not confidence or accuracy.',
            )}
          </Text>
          <div className="mt-4 grid gap-2 sm:grid-cols-5">
            {categories.map((category) => (
              <div
                key={category.key}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <Text as="p" variant="caption">
                  {category.label}
                </Text>
                <Text
                  as="p"
                  variant="bodySm"
                  className="font-mono tabular-nums"
                >
                  {fmtNumber(
                    accounting.categories[category.key],
                    0,
                  )}
                </Text>
              </div>
            ))}
          </div>
          {analysis.trend.cap.backendCapReached ? (
            <AlertBanner
              className="mt-4"
              variant="warning"
              icon={
                <TriangleAlert
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              }
            >
              <Text as="p" variant="caption">
                {t(
                  'batteryPassport.diagnostics.cap',
                  'The response reached the 180-point server maximum. Earlier qualifying UTC dates may be absent; {{omitted}} additional valid points were omitted by the defensive display cap.',
                  {
                    omitted:
                      analysis.trend.cap.omittedByDisplayCap,
                  },
                )}
              </Text>
            </AlertBanner>
          ) : null}
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}

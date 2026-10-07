import { BarChart3, BetweenHorizontalStart, Sigma } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricBar, MetricCard } from '@/components/data-display';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type {
  BatteryPassportAnalysis,
  BatteryPassportDistributionBin,
} from '../../lib/batteryPassportAnalysis';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type { BatteryPassportQueryState } from './types';

interface BatteryPassportTrendDistributionProps {
  analysis: BatteryPassportAnalysis;
  state: BatteryPassportQueryState;
}

function binLabel(
  bin: BatteryPassportDistributionBin,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (bin.key) {
    case 'below_60':
      return t(
        'batteryPassport.distribution.below60',
        '0% to below 60%',
      );
    case '60_70':
      return t(
        'batteryPassport.distribution.sixtyToSeventy',
        '60% to below 70%',
      );
    case '70_80':
      return t(
        'batteryPassport.distribution.seventyToEighty',
        '70% to below 80%',
      );
    case '80_90':
      return t(
        'batteryPassport.distribution.eightyToNinety',
        '80% to below 90%',
      );
    default:
      return t(
        'batteryPassport.distribution.ninetyToHundred',
        '90% through 100%',
      );
  }
}

export function BatteryPassportTrendDistribution({
  analysis,
  state,
}: BatteryPassportTrendDistributionProps) {
  const { t } = useTranslation();
  const diagnostics = analysis.trend.diagnostics;

  return (
    <section data-testid="battery-passport-trend-distribution">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BarChart3
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'batteryPassport.distribution.title',
            'Trend distribution and range bands',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.distribution.subtitle',
            'Counts and shares of included certificate points in fixed SoH bands; no normal distribution is assumed.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              {analysis.trend.distribution.map((bin) => (
                <MetricBar
                  key={bin.key}
                  label={binLabel(bin, t)}
                  value={(bin.share ?? 0) * 100}
                  max={100}
                  color="#22d3ee"
                  sublabel={bin.share != null
                    ? t(
                        'batteryPassport.distribution.binValue',
                        '{{share}} · {{count}} points',
                        {
                          share: fmtPercent(bin.share * 100, 1),
                          count: bin.count,
                        },
                      )
                    : '—'}
                />
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MetricCard
                label={t(
                  'batteryPassport.distribution.minimum',
                  'Observed minimum',
                )}
                value={diagnostics.minimumSohPct != null
                  ? fmtPercent(diagnostics.minimumSohPct, 1)
                  : '—'}
                subtitle={t(
                  'batteryPassport.distribution.includedOnly',
                  'included points only',
                )}
                icon={<BetweenHorizontalStart className="h-5 w-5" />}
                color="blue"
              />
              <MetricCard
                label={t(
                  'batteryPassport.distribution.maximum',
                  'Observed maximum',
                )}
                value={diagnostics.maximumSohPct != null
                  ? fmtPercent(diagnostics.maximumSohPct, 1)
                  : '—'}
                subtitle={t(
                  'batteryPassport.distribution.includedOnly',
                  'included points only',
                )}
                icon={<BetweenHorizontalStart className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t(
                  'batteryPassport.distribution.range',
                  'Observed range',
                )}
                value={diagnostics.rangePctPoints != null
                  ? t(
                      'batteryPassport.values.percentagePoints',
                      '{{value}} pp',
                      {
                        value: fmtNumber(
                          diagnostics.rangePctPoints,
                          2,
                        ),
                      },
                    )
                  : '—'}
                subtitle={t(
                  'batteryPassport.distribution.rangeHint',
                  'maximum minus minimum',
                )}
                icon={<BarChart3 className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t(
                  'batteryPassport.distribution.iqr',
                  'Interquartile range',
                )}
                value={
                  diagnostics.interquartileRangePctPoints != null
                    ? t(
                        'batteryPassport.values.percentagePoints',
                        '{{value}} pp',
                        {
                          value: fmtNumber(
                            diagnostics.interquartileRangePctPoints,
                            2,
                          ),
                        },
                      )
                    : '—'
                }
                subtitle={t(
                  'batteryPassport.distribution.iqrHint',
                  'P75 minus P25',
                )}
                icon={<Sigma className="h-5 w-5" />}
                color="purple"
              />
            </div>
          </div>
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}

import {
  Flame,
  Snowflake,
  Sun,
  Thermometer,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricBar, MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type {
  BatteryPassportAnalysis,
  BatteryPassportThermalBand,
} from '../../lib/batteryPassportAnalysis';
import { BatteryPassportSectionBody } from './BatteryPassportSectionBody';
import type { BatteryPassportQueryState } from './types';

interface BatteryPassportThermalProfileProps {
  analysis: BatteryPassportAnalysis;
  state: BatteryPassportQueryState;
}

function thermalLabel(
  band: BatteryPassportThermalBand,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  switch (band.key) {
    case 'cold':
      return t(
        'batteryPassport.thermal.cold',
        'Cold drive share (below 10°C)',
      );
    case 'nominal':
      return t(
        'batteryPassport.thermal.nominal',
        'Nominal drive share (10°C through 30°C)',
      );
    default:
      return t(
        'batteryPassport.thermal.hot',
        'Hot drive share (above 30°C)',
      );
  }
}

function thermalColor(band: BatteryPassportThermalBand): string {
  switch (band.key) {
    case 'cold':
      return '#3b82f6';
    case 'nominal':
      return '#10b981';
    default:
      return '#ef4444';
  }
}

export function BatteryPassportThermalProfile({
  analysis,
  state,
}: BatteryPassportThermalProfileProps) {
  const { t } = useTranslation();
  const thermal = analysis.thermal;

  return (
    <section data-testid="battery-passport-thermal-profile">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Thermometer
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'batteryPassport.thermal.title',
            'Thermal exposure profile',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'batteryPassport.thermal.subtitle',
            'Reported shares of drives with ambient readings in three server bands; shares are not normalized in this workspace.',
          )}
        </Text>
        <BatteryPassportSectionBody state={state}>
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-4">
              {thermal.bands.map((band) => (
                <MetricBar
                  key={band.key}
                  label={thermalLabel(band, t)}
                  value={band.valuePct ?? 0}
                  max={100}
                  color={thermalColor(band)}
                  sublabel={band.valuePct != null
                    ? fmtPercent(band.valuePct, 1)
                    : '—'}
                />
              ))}
              <div className="flex flex-wrap items-center gap-4 pt-1">
                <Text as="span" variant="caption" className="flex items-center gap-1">
                  <Snowflake className="h-3.5 w-3.5 text-blue-300" aria-hidden="true" />
                  {t('batteryPassport.thermal.coldShort', 'Cold')}
                </Text>
                <Text as="span" variant="caption" className="flex items-center gap-1">
                  <Sun className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                  {t('batteryPassport.thermal.nominalShort', 'Nominal')}
                </Text>
                <Text as="span" variant="caption" className="flex items-center gap-1">
                  <Flame className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" />
                  {t('batteryPassport.thermal.hotShort', 'Hot')}
                </Text>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <MetricCard
                label={t(
                  'batteryPassport.thermal.sum',
                  'Exact reported sum',
                )}
                value={thermal.sumPct != null
                  ? fmtPercent(thermal.sumPct, 1)
                  : '—'}
                subtitle={t(
                  'batteryPassport.thermal.sumHint',
                  'cold + nominal + hot',
                )}
                icon={<Thermometer className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t(
                  'batteryPassport.thermal.balance',
                  'Difference from 100%',
                )}
                value={thermal.differenceFrom100PctPoints != null
                  ? t(
                      'batteryPassport.values.percentagePoints',
                      '{{value}} pp',
                      {
                        value: fmtNumber(
                          thermal.differenceFrom100PctPoints,
                          1,
                        ),
                      },
                    )
                  : '—'}
                subtitle={t(
                  'batteryPassport.thermal.balanceHint',
                  'rounding and accounting check',
                )}
                icon={<Thermometer className="h-5 w-5" />}
                color="purple"
              />
            </div>
          </div>
          {thermal.status === 'no_data' ? (
            <EmptyState
              className="py-6"
              icon={
                <Thermometer
                  className="h-7 w-7"
                  aria-hidden="true"
                />
              }
              message={t(
                'batteryPassport.thermal.noData',
                'No temperature-carrying drives are represented; all three reported shares are zero or the profile is absent.',
              )}
            />
          ) : thermal.status === 'invalid' ? (
            <EmptyState
              className="py-6"
              message={t(
                'batteryPassport.thermal.invalid',
                'At least one thermal share is non-finite or outside 0% through 100%; the exact sum is withheld.',
              )}
            />
          ) : null}
        </BatteryPassportSectionBody>
      </GlassPanel>
    </section>
  );
}

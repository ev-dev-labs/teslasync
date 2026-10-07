import { ArrowDownUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  GlassPanel,
  MetricLabel,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { TemperatureUnitPref } from '@/lib/unitConversion';
import type { CabinThermalSummary, SoakEvent } from '../../lib/cabinThermal';
import { formatTemperatureDelta } from './labels';
import { CabinThermalSectionBody } from './CabinThermalSectionBody';
import type { CabinThermalQueryState } from './types';

interface CabinThermalDirectionProfileProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
  locale: string;
  temperatureUnit: TemperatureUnitPref;
  formatDuration: UnitFormatter;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function DirectionCard({
  label,
  events,
  tauMin,
  locale,
  temperatureUnit,
  formatDuration,
}: {
  label: string;
  events: SoakEvent[];
  tauMin: number | null;
  locale: string;
  temperatureUnit: TemperatureUnitPref;
  formatDuration: UnitFormatter;
}) {
  const { t } = useTranslation();
  const meanR2 = events.length > 0
    ? events.reduce((sum, event) => sum + event.r2, 0) / events.length
    : null;
  const medianGap = median(events.map((event) => event.startInsideC - event.ambientC));

  return (
    <article className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
      <Text as="h4" variant="label">{label}</Text>
      <Grid cols={{ default: 3 }} gap={3} className="mt-3">
        <div>
          <MetricLabel>{t('cabinThermal.profile.fits', 'Accepted fits')}</MetricLabel>
          <Text
            as="div"
            size="base"
            weight="semibold"
            color="primary"
            className="mt-1"
          >
            {fmtInt(events.length)}
          </Text>
        </div>
        <div>
          <MetricLabel>{t('cabinThermal.profile.medianTau', 'Median τ')}</MetricLabel>
          <Text
            as="div"
            size="base"
            weight="semibold"
            color="primary"
            className="mt-1"
          >
            {tauMin != null ? formatDuration(tauMin * 60, { precision: 1 }) : '—'}
          </Text>
        </div>
        <div>
          <MetricLabel>{t('cabinThermal.profile.meanR2', 'Mean R²')}</MetricLabel>
          <Text
            as="div"
            size="base"
            weight="semibold"
            color="primary"
            className="mt-1"
          >
            {meanR2 != null ? fmtPercent(meanR2 * 100, 1) : '—'}
          </Text>
        </div>
      </Grid>
      <Text as="p" variant="caption" className="mt-3">
        {t('cabinThermal.profile.medianGap', 'Median accepted starting gap: {{value}}', {
          value: formatTemperatureDelta(medianGap, temperatureUnit, locale),
        })}
      </Text>
    </article>
  );
}

export function CabinThermalDirectionProfile({
  summary,
  state,
  locale,
  temperatureUnit,
  formatDuration,
}: CabinThermalDirectionProfileProps) {
  const { t } = useTranslation();
  const cooling = summary.events.filter((event) => event.cooling);
  const warming = summary.events.filter((event) => !event.cooling);

  return (
    <section data-testid="cabin-thermal-direction-profile">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ArrowDownUp className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.profile.title', 'Cooling versus warming profile')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cabinThermal.profile.subtitle',
            'Direction-specific accepted evidence remains separate because heat loss and heat gain need not share one τ.',
          )}
        </Text>
        <CabinThermalSectionBody summary={summary} state={state} requirement="accepted">
          <Grid cols={{ default: 1, xl: 2 }} gap={3}>
            <DirectionCard label={t('cabinThermal.direction.cooling', 'Cooling')} events={cooling} tauMin={summary.coolingTauMin} locale={locale} temperatureUnit={temperatureUnit} formatDuration={formatDuration} />
            <DirectionCard label={t('cabinThermal.direction.warming', 'Warming')} events={warming} tauMin={summary.warmingTauMin} locale={locale} temperatureUnit={temperatureUnit} formatDuration={formatDuration} />
          </Grid>
        </CabinThermalSectionBody>
      </GlassPanel>
    </section>
  );
}

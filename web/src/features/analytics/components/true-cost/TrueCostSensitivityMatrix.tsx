import { useMemo } from 'react';
import { Grid3X3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { DataTable, type Column, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { TcoSensitivityRow } from '../../lib/trueCost';
import { TrueCostSectionBody } from './TrueCostSectionBody';
import type { TrueCostSectionProps } from './types';

interface MatrixRow {
  priceFactor: number;
  lowMpg: TcoSensitivityRow | null;
  baselineMpg: TcoSensitivityRow | null;
  highMpg: TcoSensitivityRow | null;
}

export function TrueCostSensitivityMatrix({
  analysis,
  state,
  display,
}: TrueCostSectionProps) {
  const { t } = useTranslation();
  const rows = useMemo<MatrixRow[]>(
    () => [0.8, 1, 1.2].map((priceFactor) => ({
      priceFactor,
      lowMpg: analysis.sensitivity.find((row) =>
        row.priceFactor === priceFactor && row.mpgFactor === 0.8) ?? null,
      baselineMpg: analysis.sensitivity.find((row) =>
        row.priceFactor === priceFactor && row.mpgFactor === 1) ?? null,
      highMpg: analysis.sensitivity.find((row) =>
        row.priceFactor === priceFactor && row.mpgFactor === 1.2) ?? null,
    })).filter((row) => row.lowMpg || row.baselineMpg || row.highMpg),
    [analysis.sensitivity],
  );
  const cell = (scenario: TcoSensitivityRow | null) => scenario ? (
    <div>
      <Text
        as="p"
        variant="bodySm"
        mono
        className={cn(
          scenario.disposition === 'savings' && 'text-emerald-300',
          scenario.disposition === 'loss' && 'text-rose-300',
          scenario.disposition === 'balanced' && 'text-amber-300',
        )}
      >
        {display.formatSignedCurrency(scenario.fuelDelta)}
      </Text>
      <Text as="p" variant="caption" mono>
        {t('tco.sensitivity.gasCost', 'Gas {{value}}', {
          value: display.formatCurrency(scenario.modeledGasCost),
        })}
      </Text>
    </div>
  ) : <Text variant="bodySm">—</Text>;
  const columns = useMemo<Column<MatrixRow>[]>(() => [
    {
      key: 'price',
      header: t('tco.sensitivity.priceFactor', 'Gas-price factor'),
      render: (row) => (
        <Text variant="label" mono>
          {t('tco.sensitivity.factorValue', '{{value}}×', {
            value: display.formatNumber(row.priceFactor, 1),
          })}
        </Text>
      ),
      visibleOnMobile: true,
    },
    {
      key: 'lowMpg',
      header: t('tco.sensitivity.lowMpg', '0.8× MPG'),
      render: (row) => cell(row.lowMpg),
      visibleOnMobile: true,
    },
    {
      key: 'baselineMpg',
      header: t('tco.sensitivity.baselineMpg', '1.0× MPG'),
      render: (row) => cell(row.baselineMpg),
      visibleOnMobile: true,
    },
    {
      key: 'highMpg',
      header: t('tco.sensitivity.highMpg', '1.2× MPG'),
      render: (row) => cell(row.highMpg),
    },
  ], [display, t]);

  return (
    <section
      data-testid="tco-sensitivity"
      aria-label={t('tco.sensitivity.aria', 'Bounded gas-price and MPG sensitivity matrix')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-2 flex items-center gap-2">
          <Grid3X3 className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('tco.sensitivity.title', 'Bounded sensitivity matrix')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t('tco.sensitivity.subtitle', 'Algebraic scenarios scale baseline gas cost by price factor ÷ MPG factor. They are not forecasts.')}
        </Text>
        <TrueCostSectionBody state={state}>
          {rows.length > 0 ? (
            <DataTable
              tableId="analytics:true-cost-sensitivity"
              columns={columns}
              data={rows}
              keyExtractor={(row) => row.priceFactor}
              density="compact"
              mobileColumns={['price', 'lowMpg', 'baselineMpg']}
            />
          ) : (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ message={t('tco.sensitivity.empty', 'A supported baseline fuel comparison is required for scenarios.')} />
          )}
        </TrueCostSectionBody>
      </GlassPanel>
    </section>
  );
}

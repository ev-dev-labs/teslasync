import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle, Table, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { useSettings } from '@/hooks/useSettings';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';

import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';
import { driveEnergyEvidence } from './energyEvidence';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function CostSavingsPanel({ drive, stats }: { drive: DriveDetail; stats: DriveStats }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { settings, settingsUnavailable } = useSettings();
  const { unitPrefs } = useUnits();
  const { costPerKwh, currencySymbol, formatEnergyCost, formatCurrency, costPerDistanceUnit, estimateGasCost } = useFormatting();
  const { energyWh } = driveEnergyEvidence(drive, stats);
  const kwh = energyWh != null && Number.isFinite(energyWh) ? energyWh / 1000 : null;
  const distanceM = drive.distanceM ?? 0;
  const gasCost = estimateGasCost(distanceM);
  const evCost = kwh != null && costPerKwh != null ? kwh * costPerKwh : null;
  const savings = gasCost != null && evCost != null ? gasCost - evCost : null;
  const savingsPct = gasCost != null && gasCost > 0 && savings != null ? savings / gasCost * 100 : null;
  const costPerUnit = kwh != null ? costPerDistanceUnit(kwh, distanceM) : null;
  const rows = [
    { id: 'ev', label: t('driveDetail.tripCost', 'Trip cost'), value: kwh != null ? formatEnergyCost(kwh) : '—' },
    { id: 'per-unit', label: t('driveDetail.costPerUnit', 'Cost / {{unit}}', { unit: unitPrefs.distance }), value: costPerUnit != null ? formatCurrency(costPerUnit) : '—' },
    { id: 'gas', label: t('driveDetail.gasCostEquiv', 'Gas cost (equivalent)'), value: gasCost != null ? formatCurrency(gasCost) : '—' },
    { id: 'savings', label: t('driveDetail.gasSavings', 'Savings vs gas'), value: savings != null ? formatCurrency(savings) : '—' },
    { id: 'percentage', label: t('driveDetail.savingsPct', 'Savings %'), value: savingsPct != null ? `${fmtNumber(savingsPct)}%` : '—' },
  ];
  return (
    <FadeIn className="h-full">
      <GlassPanel className="h-full space-y-3 p-4 sm:p-5" data-testid="drive-cost-estimate">
        <PanelTitle>{t('driveDetail.costSavings', 'Cost and savings')}</PanelTitle>
        <Text as="p" variant="caption">
          {t('driveDetail.report.costMethod', 'Estimate using configured rates, not a charging invoice. Energy source is listed in energy evidence.')}
        </Text>
        <Table variant="embedded" aria-label={t('driveDetail.costSavings', 'Cost and savings')}>
          <thead><tr><th scope="col">{t('driveDetail.report.metric', 'Metric')}</th><th scope="col">{t('driveDetail.whyEnded.signal.cols.value', 'Value')}</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={row.id}><th scope="row">{row.label}</th><td className="whitespace-nowrap tabular-nums">{row.value}</td></tr>
          ))}</tbody>
        </Table>
        <Text as="p" variant="caption">
          {t('driveDetail.atRate', 'at {{currencySymbol}}{{costPerKwh}}/kWh', { currencySymbol, costPerKwh: costPerKwh ?? '—' })}
          {' · '}{t('driveDetail.atMpg', 'at {{mpg}} MPG', { mpg: settingsUnavailable ? '—' : settings.gas_efficiency_mpg ?? '—' })}
        </Text>
      </GlassPanel>
    </FadeIn>
  );
}

import { useTranslation } from 'react-i18next';
import { type StatMetric } from '@/components/data-display/stat-reference';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';
import type { TeslaEnergySite } from '@/types/energy';
import { fmtEnergy } from './helpers';

export function SummaryBand({ sites, isLoading, retained, hasData }: {
  sites: TeslaEnergySite[]; isLoading: boolean; retained: boolean; hasData: boolean;
}) {
  const { t } = useTranslation();
  const completeCapacity = sites.every(site =>
    site.total_pack_energy != null && Number.isFinite(site.total_pack_energy));
  const totalCapacity = hasData && completeCapacity
    ? sites.reduce((sum, site) => sum + (site.total_pack_energy ?? 0), 0)
    : null;
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'sites', label: t('energy.products.totalSites', 'Energy Sites'), rawValue: hasData ? sites.length : null },
    { metricId: 'count', occurrenceId: 'solar', label: t('energy.products.withSolar', 'With Solar'), rawValue: hasData ? sites.filter(site => site.has_solar).length : null },
    { metricId: 'count', occurrenceId: 'battery', label: t('energy.products.withBattery', 'With Battery'), rawValue: hasData ? sites.filter(site => site.has_battery).length : null },
    { metricId: 'count', occurrenceId: 'backup', label: t('energy.products.backupCapable', 'Backup Capable'), rawValue: hasData ? sites.filter(site => site.backup_capable).length : null },
    { metricId: 'count', occurrenceId: 'storm', label: t('energy.products.stormReady', 'Storm-Ready'), rawValue: hasData ? sites.filter(site => site.storm_mode_capable).length : null },
    // The existing energy-product formatter deliberately scales by magnitude.
    { metricId: 'energy', occurrenceId: 'capacity', label: t('energy.products.totalCapacity', 'Total Capacity'), rawValue: totalCapacity,
      display: { formatter: raw => ({ value: fmtEnergy(raw), unit: '' }) } },
  ];
  return (
    <section>
        <BatteryEvidenceBrief
          id="energy-products-summary"
          title={t('energy.products.summary', 'Energy summary')}
          metrics={metrics}
          loading={isLoading}
          retained={retained}
          period={{
            kind: 'snapshot',
            label: t('energy.products.modernization.snapshot', 'Discovered energy sites snapshot'),
            observedAt: null,
            provenance: t('energy.products.modernization.snapshotSource', 'Cached Tesla products; site timestamps are shown on each card.'),
          }}
        />
    </section>
  );
}

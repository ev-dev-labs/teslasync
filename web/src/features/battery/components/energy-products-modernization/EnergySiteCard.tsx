import { useTranslation } from 'react-i18next';
import { Sun, Battery, Grid3x3, Shield, CloudLightning } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { Badge, Label, Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDateTime } from '@/lib/dateFormat';
import type { TeslaEnergySite } from '@/types/energy';
import { CapBadge } from './CapBadge';
import { SiteInfoSection } from './SiteInfoSection';
import { fmtEnergy, resourceLabel } from './helpers';

export function EnergySiteCard({ site, retained }: { site: TeslaEnergySite; retained: boolean }) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const metrics: StatMetric[] = [
    { metricId: 'text', occurrenceId: 'charge', label: t('energy.products.charge', 'Charge'),
      rawValue: site.percentage_charged != null && Number.isFinite(site.percentage_charged) ? `${fmtNumber(site.percentage_charged)}%` : null },
    { metricId: 'text', occurrenceId: 'capacity', label: t('energy.products.capacity', 'Capacity'),
      rawValue: site.total_pack_energy == null || !Number.isFinite(site.total_pack_energy) ? null : fmtEnergy(site.total_pack_energy) },
    { metricId: 'text', occurrenceId: 'type', label: t('energy.products.type', 'Type'), rawValue: resourceLabel(site.resource_type, t) },
  ];
  return (
    <LayoutCard title={site.site_name || t('energy.products.unnamed', 'Unnamed Site')}
      actions={site.battery_type ? <Badge variant="info">{site.battery_type}</Badge> : undefined}
      footer={<Text as="p" variant="caption">
        {t('energy.products.lastFetched', 'Last fetched')}: {formatDateTime(site.fetched_at)}
      </Text>}>
      <Text variant="caption">
        {resourceLabel(site.resource_type, t)} · {t('energy.products.siteId', 'ID')} {site.energy_site_id}
      </Text>
      <StatStrip id={`energy-site-${site.energy_site_id}-summary`} variant="embedded" metrics={metrics} retained={retained}
        period={{ kind: 'snapshot', label: t('energy.products.modernization.siteSnapshot', 'Site snapshot'),
          observedAt: site.fetched_at,
          provenance: t('energy.products.modernization.siteSource', 'Cached Tesla products discovery') }} />
      <div>
        <Label className="mb-2 block">{t('energy.products.capabilities', 'Capabilities')}</Label>
        <div className="flex flex-wrap gap-2">
          <CapBadge active={site.has_solar} label={t('energy.products.solar', 'Solar')} icon={Sun} />
          <CapBadge active={site.has_battery} label={t('energy.products.battery', 'Battery')} icon={Battery} />
          <CapBadge active={site.has_grid} label={t('energy.products.grid', 'Grid')} icon={Grid3x3} />
          <CapBadge active={site.backup_capable} label={t('energy.products.backup', 'Backup')} icon={Shield} />
          <CapBadge active={site.storm_mode_capable} label={t('energy.products.stormWatch', 'Storm Watch')} icon={CloudLightning} />
          {site.storm_mode_enabled && <Badge variant="warning">
            <CloudLightning className="h-3 w-3" aria-hidden="true" />
            {t('energy.products.stormActive', 'Storm Mode Active')}
          </Badge>}
        </div>
      </div>
      <SiteInfoSection siteId={site.energy_site_id} touCapable={site.tou_capable} />
    </LayoutCard>
  );
}

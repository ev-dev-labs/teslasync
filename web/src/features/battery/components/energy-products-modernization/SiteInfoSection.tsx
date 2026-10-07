import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Cpu, RefreshCw, Settings } from 'lucide-react';
import { Button, Badge, PanelTitle, Text } from '@/components/ui';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { LinearGauge } from '@/components/charts';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { useTeslaEnergySiteInfo, useRefreshTeslaEnergySiteInfo } from '@/api/hooks/useEnergy';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDateTime } from '@/lib/dateFormat';
import { TOUSettingsModal } from '../TOUSettingsModal';
import { InfoTile } from './InfoTile';
import { fmtEnergy, fmtPower, operationModeLabel } from './helpers';
import { SourceTrustNotice } from '../projected-range-modernization/SourceTrustNotice';

export function SiteInfoSection({ siteId, touCapable }: { siteId: number; touCapable: boolean }) {
  const { precision } = useNumberFormatting();
  const { t } = useTranslation();
  const infoQuery = useTeslaEnergySiteInfo(siteId);
  const source = useDataState(infoQuery);
  const response = source.data;
  const info = response?.data ?? null;
  const refreshMutation = useRefreshTeslaEnergySiteInfo();
  const [touModalOpen, setTouModalOpen] = useState(false);
  const showTou = touCapable || Boolean(info?.components?.tou_capable);
  const tariff = info?.tariff_content_v2;
  const settings = info?.tou_settings;
  const nestedTariff = settings && typeof settings === 'object' && 'tariff_content_v2' in settings
    ? settings.tariff_content_v2 : undefined;
  const tariffName = tariff && typeof tariff === 'object' && 'name' in tariff && typeof tariff.name === 'string' ? tariff.name
    : nestedTariff && typeof nestedTariff === 'object' && 'name' in nestedTariff && typeof nestedTariff.name === 'string'
      ? nestedTariff.name : undefined;
  const metrics: StatMetric[] = [
    { metricId: 'count', occurrenceId: 'powerwalls', label: t('energy.siteInfo.batteryCount', 'Powerwalls'), rawValue: info?.battery_count },
    { metricId: 'text', occurrenceId: 'power', label: t('energy.siteInfo.ratedPower', 'Rated Power'), rawValue: info?.nameplate_power == null || !Number.isFinite(info.nameplate_power) ? null : fmtPower(info.nameplate_power) },
    { metricId: 'text', occurrenceId: 'energy', label: t('energy.siteInfo.ratedEnergy', 'Rated Energy'), rawValue: info?.nameplate_energy == null || !Number.isFinite(info.nameplate_energy) ? null : fmtEnergy(info.nameplate_energy) },
  ];

  return (
    <section className="min-w-0 space-y-4 border-t border-[var(--border-subtle)] pt-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-1.5">
          <Settings className="h-4 w-4" aria-hidden="true" />
          {t('energy.siteInfo.title', 'Site Configuration')}
        </PanelTitle>
        <Button variant="ghost" size="sm" className="min-h-11 min-w-11"
          onClick={() => refreshMutation.mutate(siteId)}
          loading={refreshMutation.isPending} disabled={refreshMutation.isPending}
          aria-label={t('energy.siteInfo.refresh', 'Refresh site info')}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      <SourceTrustNotice source={source} label={t('energy.siteInfo.title', 'Site Configuration')} />
      {infoQuery.isLoading && !source.hasData ? <Skeleton className="h-40 rounded-xl" />
        : source.fatalError ? <QueryError error={source.fatalError} onRetry={() => refreshMutation.mutate(siteId)} />
        : info ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoTile label={t('energy.siteInfo.operationMode', 'Operation Mode')}>
                <Text variant="body" className="font-medium">{operationModeLabel(info.default_real_mode, t)}</Text>
              </InfoTile>
              <InfoTile label={t('energy.siteInfo.backupReserve', 'Backup Reserve')}>
                {info.backup_reserve_percent != null && Number.isFinite(info.backup_reserve_percent) ? (
                  <LinearGauge value={info.backup_reserve_percent} max={100} size={36} label=""
                    ariaLabel={t('energy.siteInfo.backupReserve', 'Backup Reserve')} unit="%" decimals={precision} tone="info" />
                ) : <Text size="sm" color="muted">—</Text>}
              </InfoTile>
            </div>
            <StatStrip id={`energy-site-${siteId}-configuration`} variant="embedded" metrics={metrics}
              retained={source.status === 'stale'}
              period={{ kind: 'snapshot', label: t('energy.products.modernization.siteSnapshot', 'Site snapshot'),
                observedAt: response?.fetched_at ?? null,
                provenance: t('energy.products.modernization.configurationSource', 'Cached Tesla site configuration') }} />
            {(info.version || info.installation_time_zone) && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {info.version && <Text variant="caption" className="inline-flex items-center gap-1 break-words">
                  <Cpu className="h-3 w-3" aria-hidden="true" />
                  {t('energy.siteInfo.firmware', 'Firmware')}: {info.version}
                </Text>}
                {info.installation_time_zone && <Text variant="caption" className="break-words">· {info.installation_time_zone}</Text>}
              </div>
            )}
            {info.components && <div className="flex flex-wrap gap-1.5">
              {Object.entries(info.components).map(([key, value]) => typeof value === 'boolean' ? (
                <Badge key={key} variant={value ? 'success' : 'neutral'} size="sm">{key.replace(/_/g, ' ')}</Badge>
              ) : null)}
            </div>}
            {showTou && (
              <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <Text as="p" variant="caption" className="mb-0.5 inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden="true" />{t('energy.tou.sectionTitle', 'Rate Plan')}
                    </Text>
                    <Text as="p" variant="body" className="break-words font-medium">
                      {tariffName ?? t('energy.tou.noPlan', 'No rate plan configured')}
                    </Text>
                  </div>
                  <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setTouModalOpen(true)}
                    aria-label={t('energy.tou.editPlan', 'Update rate plan')}>
                    {t('energy.tou.updateButton', 'Update')}
                  </Button>
                </div>
              </div>
            )}
            {response?.fetched_at && <Text as="p" variant="caption">
              {t('energy.siteInfo.lastFetched', 'Site info fetched')}: {formatDateTime(response.fetched_at)}
            </Text>}
          </div>
        ) : /* no-action: This section's Refresh site info button above owns recovery. */
          <EmptyState message={t('energy.siteInfo.empty', 'No site configuration loaded yet. Use refresh to fetch from Tesla.')} />}
      <TOUSettingsModal open={touModalOpen} onClose={() => setTouModalOpen(false)} siteId={siteId} />
    </section>
  );
}

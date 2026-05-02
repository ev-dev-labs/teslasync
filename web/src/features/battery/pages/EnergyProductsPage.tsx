import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import {
  Sun, Battery, Zap, Grid3x3, RefreshCw, Shield,
  CloudLightning, Gauge, Activity, Settings, Cpu, Info, Clock,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Button } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState, Skeleton } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { RadialGauge } from '@/components/charts';

import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';

import {
  useTeslaEnergySites,
  useRefreshTeslaEnergySites,
  useTeslaEnergySiteInfo,
  useRefreshTeslaEnergySiteInfo,
} from '@/api/hooks/useEnergy';

import type { TeslaEnergySite, TeslaEnergySiteInfo } from '@/types/energy';
import { TOUSettingsModal } from '../components/TOUSettingsModal';

/* ───────── Helpers ───────── */

function fmtEnergy(wh: number | null | undefined): string {
  if (wh == null) return '—';
  if (wh >= 1000) return `${fmtNumber(wh / 1000, 1)} kWh`;
  return `${fmtNumber(wh, 0)} Wh`;
}

function fmtPower(w: number | null | undefined): string {
  if (w == null) return '—';
  if (w >= 1000) return `${fmtNumber(w / 1000, 1)} kW`;
  return `${fmtNumber(w, 0)} W`;
}

function resourceIcon(type: string) {
  if (type === 'battery') return Battery;
  if (type === 'solar') return Sun;
  return Zap;
}

function resourceLabel(type: string): string {
  if (type === 'battery') return 'Powerwall';
  if (type === 'solar') return 'Solar';
  return type;
}

function operationModeLabel(mode: string | undefined): string {
  if (mode === 'self_consumption') return 'Self-Powered';
  if (mode === 'autonomous') return 'Time-Based Control';
  if (mode === 'backup') return 'Backup Only';
  return mode ?? '—';
}

/* ───────── Capability Badge ───────── */

interface CapBadgeProps {
  active: boolean;
  label: string;
  icon: React.ElementType;
}

function CapBadge({ active, label, icon: Icon }: CapBadgeProps) {
  return (
    <Badge variant={active ? 'success' : 'neutral'}>
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Badge>
  );
}

/* ───────── Site Info Section ───────── */

function SiteInfoSection({ siteId, touCapable }: { siteId: number; touCapable: boolean }) {
  const { t } = useTranslation();
  const { data: response, isLoading } = useTeslaEnergySiteInfo(siteId);
  const refreshMutation = useRefreshTeslaEnergySiteInfo();
  const [touModalOpen, setTouModalOpen] = useState(false);

  const info: TeslaEnergySiteInfo | null = response?.data ?? null;

  // Extract current tariff name from site_info if available
  const tariffName =
    (info?.tariff_content_v2 as Record<string, unknown> | undefined)?.name as string | undefined ??
    (info?.tou_settings as Record<string, unknown> | undefined)?.tariff_content_v2 != null
      ? ((info?.tou_settings as Record<string, unknown>)?.tariff_content_v2 as Record<string, unknown>)?.name as string | undefined
      : undefined;

  if (isLoading) {
    return <Skeleton className="h-32 mt-4" />;
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-[var(--text-secondary)] flex items-center gap-1.5">
          <Settings className="h-3.5 w-3.5" />
          {t('energy.siteInfo.title', 'Site Configuration')}
        </h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refreshMutation.mutate(siteId)}
          loading={refreshMutation.isPending}
          disabled={refreshMutation.isPending}
          aria-label={t('energy.siteInfo.refresh', 'Refresh site info')}
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {info ? (
        <div className="space-y-3">
          {/* Operation mode + backup reserve */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
              <p className="text-xs text-[var(--text-muted)] mb-1">
                {t('energy.siteInfo.operationMode', 'Operation Mode')}
              </p>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {operationModeLabel(info.default_real_mode)}
              </p>
            </div>
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
              <p className="text-xs text-[var(--text-muted)] mb-1">
                {t('energy.siteInfo.backupReserve', 'Backup Reserve')}
              </p>
              {info.backup_reserve_percent != null ? (
                <div className="flex items-center gap-2">
                  <RadialGauge
                    value={info.backup_reserve_percent}
                    max={100}
                    size={32}
                    label=""
                  />
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    {fmtNumber(info.backup_reserve_percent, 0)}%
                  </span>
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">—</p>
              )}
            </div>
          </div>

          {/* Battery count + capacity */}
          <Grid cols={{ default: 2, md: 3 }} gap={3}>
            {info.battery_count != null && (
              <StatCard
                label={t('energy.siteInfo.batteryCount', 'Powerwalls')}
                value={info.battery_count}
                icon={<Battery className="h-4 w-4" />}
              />
            )}
            {info.nameplate_power != null && (
              <StatCard
                label={t('energy.siteInfo.ratedPower', 'Rated Power')}
                value={fmtPower(info.nameplate_power)}
                icon={<Zap className="h-4 w-4" />}
              />
            )}
            {info.nameplate_energy != null && (
              <StatCard
                label={t('energy.siteInfo.ratedEnergy', 'Rated Energy')}
                value={fmtEnergy(info.nameplate_energy)}
                icon={<Gauge className="h-4 w-4" />}
              />
            )}
          </Grid>

          {/* Firmware + timezone */}
          <div className="flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
            {info.version && (
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3" /> {t('energy.siteInfo.firmware', 'Firmware')}: {info.version}
              </span>
            )}
            {info.installation_time_zone && (
              <span>· {info.installation_time_zone}</span>
            )}
          </div>

          {/* Component badges from site_info (may differ from /products) */}
          {info.components && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(info.components).map(([key, val]) =>
                typeof val === 'boolean' ? (
                  <Badge key={key} variant={val ? 'success' : 'neutral'} className="text-xs">
                    {key.replace(/_/g, ' ')}
                  </Badge>
                ) : null,
              )}
            </div>
          )}

          {/* Time-of-Use Rate Plan */}
          {(touCapable || info.components?.tou_capable) && (
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-[var(--text-muted)] mb-0.5 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {t('energy.tou.sectionTitle', 'Rate Plan')}
                  </p>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {tariffName ?? t('energy.tou.noPlan', 'No rate plan configured')}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setTouModalOpen(true)}
                  aria-label={t('energy.tou.editPlan', 'Update rate plan')}
                >
                  {t('energy.tou.updateButton', 'Update')}
                </Button>
              </div>
            </div>
          )}

          {/* Fetched timestamp */}
          {response?.fetched_at && (
            <p className="text-xs text-[var(--text-muted)]">
              {t('energy.siteInfo.lastFetched', 'Site info fetched')}: {formatDateTime(response.fetched_at)}
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-4">
          <EmptyState
            icon={<Info className="h-5 w-5" />}
            message={t(
              'energy.siteInfo.empty',
              'No site configuration loaded yet. Click refresh to fetch from Tesla.',
            )}
          />
        </div>
      )}

      <TOUSettingsModal
        open={touModalOpen}
        onClose={() => setTouModalOpen(false)}
        siteId={siteId}
      />
    </div>
  );
}

/* ───────── Site Card ───────── */

function EnergySiteCard({ site }: { site: TeslaEnergySite }) {
  const { t } = useTranslation();
  const Icon = resourceIcon(site.resource_type);

  return (
    <GlassPanel className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-500/10">
            <Icon className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">
              {site.site_name || t('energy.products.unnamed', 'Unnamed Site')}
            </h3>
            <p className="text-sm text-[var(--text-muted)]">
              {resourceLabel(site.resource_type)} · ID {site.energy_site_id}
            </p>
          </div>
        </div>
        {site.battery_type && (
          <Badge variant="info">{site.battery_type}</Badge>
        )}
      </div>

      {/* Stats row */}
      <Grid cols={{ default: 2, md: 3 }} gap={3}>
        <StatCard
          label={t('energy.products.charge', 'Charge')}
          value={site.percentage_charged != null ? `${fmtNumber(site.percentage_charged, 1)}%` : '—'}
          icon={<Gauge className="h-4 w-4" />}
        />
        <StatCard
          label={t('energy.products.capacity', 'Capacity')}
          value={fmtEnergy(site.total_pack_energy)}
          icon={<Battery className="h-4 w-4" />}
        />
        <StatCard
          label={t('energy.products.type', 'Type')}
          value={resourceLabel(site.resource_type)}
          icon={<Activity className="h-4 w-4" />}
        />
      </Grid>

      {/* Capability badges */}
      <div className="flex flex-wrap gap-2">
        <CapBadge active={site.has_solar} label={t('energy.products.solar', 'Solar')} icon={Sun} />
        <CapBadge active={site.has_battery} label={t('energy.products.battery', 'Battery')} icon={Battery} />
        <CapBadge active={site.has_grid} label={t('energy.products.grid', 'Grid')} icon={Grid3x3} />
        <CapBadge active={site.backup_capable} label={t('energy.products.backup', 'Backup')} icon={Shield} />
        <CapBadge active={site.storm_mode_capable} label={t('energy.products.stormWatch', 'Storm Watch')} icon={CloudLightning} />
        {site.storm_mode_enabled && (
          <Badge variant="warning">
            <CloudLightning className="h-3 w-3 mr-1" />
            {t('energy.products.stormActive', 'Storm Mode Active')}
          </Badge>
        )}
      </div>

      {/* Site Info section */}
      <SiteInfoSection siteId={site.energy_site_id} touCapable={site.tou_capable} />

      {/* Footer */}
      <p className="text-xs text-[var(--text-muted)]">
        {t('energy.products.lastFetched', 'Last fetched')}: {formatDateTime(site.fetched_at)}
      </p>
    </GlassPanel>
  );
}

/* ───────── Page ───────── */

export default function EnergyProductsPage() {
  const { t } = useTranslation();
  usePageTitle(t('energy.products.title', 'Energy Products'));

  const { data, isLoading, error } = useTeslaEnergySites();
  const refreshMutation = useRefreshTeslaEnergySites();

  const sites = data ?? [];

  return (
    <PageContainer
      title={t('energy.products.title', 'Energy Products')}
      subtitle={t('energy.products.subtitle', 'Powerwalls, Solar Panels & Wall Connectors discovered from Tesla')}
      loading={isLoading}
      error={error instanceof Error ? error : error ? new Error(String(error)) : null}
      actions={
        <Button
          onClick={() => refreshMutation.mutate()}
          loading={refreshMutation.isPending}
          disabled={refreshMutation.isPending}
          aria-label={t('energy.products.refresh', 'Refresh from Tesla')}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          {t('energy.products.refresh', 'Refresh from Tesla')}
        </Button>
      }
    >
      {/* Summary stats */}
      <FadeIn>
        <Grid cols={{ default: 2, md: 4 }} gap={4}>
          <StatCard
            label={t('energy.products.totalSites', 'Energy Sites')}
            value={sites.length}
            icon={<Zap className="h-4 w-4" />}
          />
          <StatCard
            label={t('energy.products.withSolar', 'With Solar')}
            value={sites.filter(s => s.has_solar).length}
            icon={<Sun className="h-4 w-4" />}
          />
          <StatCard
            label={t('energy.products.withBattery', 'With Battery')}
            value={sites.filter(s => s.has_battery).length}
            icon={<Battery className="h-4 w-4" />}
          />
          <StatCard
            label={t('energy.products.backupCapable', 'Backup Capable')}
            value={sites.filter(s => s.backup_capable).length}
            icon={<Shield className="h-4 w-4" />}
          />
        </Grid>
      </FadeIn>

      {/* Site cards */}
      <FadeIn delay={0.05}>
        {isLoading ? (
          <Grid cols={{ default: 1, lg: 2 }} gap={4}>
            {[1, 2].map(i => (
              <GlassPanel key={i} className="p-6">
                <Skeleton className="h-48" />
              </GlassPanel>
            ))}
          </Grid>
        ) : sites.length > 0 ? (
          <StaggerContainer>
            <Grid cols={{ default: 1, lg: 2 }} gap={4}>
              {sites.map(site => (
                <StaggerItem key={site.id}>
                  <EnergySiteCard site={site} />
                </StaggerItem>
              ))}
            </Grid>
          </StaggerContainer>
        ) : (
          <GlassPanel className="p-6">
            <EmptyState
              icon={<Zap className="h-8 w-8" />}
              message={t(
                'energy.products.empty',
                'No energy products found. Click "Refresh from Tesla" to discover your Powerwalls and Solar installations.',
              )}
            />
          </GlassPanel>
        )}
      </FadeIn>
    </PageContainer>
  );
}

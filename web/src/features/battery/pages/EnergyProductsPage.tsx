import { useTranslation } from 'react-i18next';
import {
  Sun, Battery, Zap, Grid3x3, RefreshCw, Shield,
  CloudLightning, Gauge, Activity,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Button } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { EmptyState, Skeleton } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';

import {
  useTeslaEnergySites,
  useRefreshTeslaEnergySites,
} from '@/api/hooks/useEnergy';

import type { TeslaEnergySite } from '@/types/energy';

/* ───────── Helpers ───────── */

function fmtEnergy(wh: number | null | undefined): string {
  if (wh == null) return '—';
  if (wh >= 1000) return `${fmtNumber(wh / 1000, 1)} kWh`;
  return `${fmtNumber(wh, 0)} Wh`;
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
            <h3 className="text-lg font-semibold text-white/90">
              {site.site_name || t('energy.products.unnamed', 'Unnamed Site')}
            </h3>
            <p className="text-sm text-white/50">
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

      {/* Footer */}
      <p className="text-xs text-white/30">
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

import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sun, Battery, Zap, Grid3x3, RefreshCw, Shield,
  CloudLightning, Gauge, Activity, Settings, Cpu, Info, Clock, Layers,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, SectionTitle, PanelTitle, Text, Label } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { LinearGauge } from '@/components/charts';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

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

/** Minimal translate signature (key + English fallback) threaded into the
 *  label helpers so their user-visible strings stay i18n-driven while the
 *  helpers remain pure and unit-testable. */
type TranslateFn = (key: string, fallback: string) => string;

/** Format a Wh energy value as SI-scaled Wh/kWh; nullish → em dash. */
export function fmtEnergy(wh: number | null | undefined): string {
  if (wh == null) return '—';
  if (Math.abs(wh) >= 1000) return `${fmtNumber(wh / 1000, 1)} kWh`;
  return `${fmtNumber(wh, 0)} Wh`;
}

/** Format a W power value as SI-scaled W/kW; nullish → em dash. */
export function fmtPower(w: number | null | undefined): string {
  if (w == null) return '—';
  if (Math.abs(w) >= 1000) return `${fmtNumber(w / 1000, 1)} kW`;
  return `${fmtNumber(w, 0)} W`;
}

/** Map a Tesla resource_type to its lucide icon (defaults to a generic bolt). */
export function resourceIcon(type: string) {
  if (type === 'battery') return Battery;
  if (type === 'solar') return Sun;
  return Zap;
}

/** Human label for a Tesla resource_type. Unknown types echo the raw
 *  (dynamic) value rather than a hardcoded English literal. */
export function resourceLabel(type: string, t: TranslateFn): string {
  if (type === 'battery') return t('energy.products.resourceType.powerwall', 'Powerwall');
  if (type === 'solar') return t('energy.products.resourceType.solar', 'Solar');
  return type;
}

/** Human label for a site's `default_real_mode`. Unknown/absent modes echo
 *  the raw value or degrade to an em dash. */
export function operationModeLabel(mode: string | undefined, t: TranslateFn): string {
  if (mode === 'self_consumption') return t('energy.siteInfo.mode.selfConsumption', 'Self-Powered');
  if (mode === 'autonomous') return t('energy.siteInfo.mode.autonomous', 'Time-Based Control');
  if (mode === 'backup') return t('energy.siteInfo.mode.backup', 'Backup Only');
  return mode ?? '—';
}

/* ───────── Small surfaces ───────── */

/** Labeled inner surface used for single key/value facts inside a card. */
function InfoTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <Text as="p" variant="caption" className="mb-1">{label}</Text>
      {children}
    </div>
  );
}

interface CapBadgeProps {
  active: boolean;
  label: string;
  icon: React.ElementType;
}

/** Capability chip — colour AND text/aria convey the on/off state (a11y). */
function CapBadge({ active, label, icon: Icon }: CapBadgeProps) {
  const { t } = useTranslation();
  const state = active
    ? t('energy.products.capAvailable', 'available')
    : t('energy.products.capUnavailable', 'unavailable');
  return (
    <Badge variant={active ? 'success' : 'neutral'} aria-label={`${label}: ${state}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}

/* ───────── Site Info Section ───────── */

function SiteInfoSection({ siteId, touCapable }: { siteId: number; touCapable: boolean }) {
  const { t } = useTranslation();
  const infoQuery = useTeslaEnergySiteInfo(siteId);
  const { data: response, isLoading, isError, error } = infoQuery;
  const refreshMutation = useRefreshTeslaEnergySiteInfo();
  const [touModalOpen, setTouModalOpen] = useState(false);

  const info: TeslaEnergySiteInfo | null = response?.data ?? null;

  // Tariff name may live at the top level or nested under tou_settings.
  const touContent = info?.tariff_content_v2 as Record<string, unknown> | undefined;
  const touSettings = info?.tou_settings as Record<string, unknown> | undefined;
  const nestedTariff = touSettings?.tariff_content_v2 as Record<string, unknown> | undefined;
  const tariffName =
    (touContent?.name as string | undefined) ?? (nestedTariff?.name as string | undefined);

  const showTou = touCapable || Boolean(info?.components?.tou_capable);

  return (
    <div className="space-y-4 border-t border-white/[0.06] pt-4">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-1.5">
          <Settings className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('energy.siteInfo.title', 'Site Configuration')}
        </PanelTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refreshMutation.mutate(siteId)}
          loading={refreshMutation.isPending}
          disabled={refreshMutation.isPending}
          aria-label={t('energy.siteInfo.refresh', 'Refresh site info')}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : isError ? (
        <QueryError error={error} onRetry={() => refreshMutation.mutate(siteId)} />
      ) : info ? (
        <div className="space-y-3">
          {/* Operation mode + backup reserve */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <InfoTile label={t('energy.siteInfo.operationMode', 'Operation Mode')}>
              <Text variant="body" className="font-medium">
                {operationModeLabel(info.default_real_mode, t)}
              </Text>
            </InfoTile>
            <InfoTile label={t('energy.siteInfo.backupReserve', 'Backup Reserve')}>
              {info.backup_reserve_percent != null ? (
                <LinearGauge
                  value={info.backup_reserve_percent}
                  max={100}
                  size={36}
                  label=""
                  ariaLabel={t('energy.siteInfo.backupReserve', 'Backup Reserve')}
                  unit="%"
                  decimals={0}
                  color="#06b6d4"
                />
              ) : (
                <Text size="sm" color="muted">—</Text>
              )}
            </InfoTile>
          </div>

          {/* Battery count + rated power/energy — always shown with placeholders */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MetricCard
              label={t('energy.siteInfo.batteryCount', 'Powerwalls')}
              value={info.battery_count ?? '—'}
              icon={<Battery className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('energy.siteInfo.ratedPower', 'Rated Power')}
              value={info.nameplate_power != null ? fmtPower(info.nameplate_power) : '—'}
              icon={<Zap className="h-4 w-4" />}
              color="amber"
            />
            <MetricCard
              label={t('energy.siteInfo.ratedEnergy', 'Rated Energy')}
              value={info.nameplate_energy != null ? fmtEnergy(info.nameplate_energy) : '—'}
              icon={<Gauge className="h-4 w-4" />}
              color="cyan"
            />
          </div>

          {/* Firmware + timezone */}
          {(info.version || info.installation_time_zone) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {info.version && (
                <Text variant="caption" className="inline-flex items-center gap-1">
                  <Cpu className="h-3 w-3" aria-hidden="true" />
                  {t('energy.siteInfo.firmware', 'Firmware')}: {info.version}
                </Text>
              )}
              {info.installation_time_zone && (
                <Text variant="caption">· {info.installation_time_zone}</Text>
              )}
            </div>
          )}

          {/* Component badges reported by site_info (may differ from /products) */}
          {info.components && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(info.components).map(([key, val]) =>
                typeof val === 'boolean' ? (
                  <Badge key={key} variant={val ? 'success' : 'neutral'} size="sm">
                    {key.replace(/_/g, ' ')}
                  </Badge>
                ) : null,
              )}
            </div>
          )}

          {/* Time-of-Use rate plan */}
          {showTou && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <Text as="p" variant="caption" className="mb-0.5 inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {t('energy.tou.sectionTitle', 'Rate Plan')}
                  </Text>
                  <Text as="p" variant="body" className="truncate font-medium">
                    {tariffName ?? t('energy.tou.noPlan', 'No rate plan configured')}
                  </Text>
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
            <Text as="p" variant="caption">
              {t('energy.siteInfo.lastFetched', 'Site info fetched')}: {formatDateTime(response.fetched_at)}
            </Text>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-4">
          <EmptyState /* no-action: transient empty state — site config is fetched on demand; the section refresh button above is the recovery affordance */
            icon={<Info className="h-5 w-5" />}
            message={t(
              'energy.siteInfo.empty',
              'No site configuration loaded yet. Use refresh to fetch from Tesla.',
            )}
          />
        </div>
      )}

      <TOUSettingsModal open={touModalOpen} onClose={() => setTouModalOpen(false)} siteId={siteId} />
    </div>
  );
}

/* ───────── Site Card ───────── */

function EnergySiteCard({ site }: { site: TeslaEnergySite }) {
  const { t } = useTranslation();
  const Icon = resourceIcon(site.resource_type);

  return (
    <GlassPanel className="space-y-4 p-4 sm:space-y-5 sm:p-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neon-cyan/10 ring-1 ring-neon-cyan/20">
            <Icon className="h-5 w-5 text-cyan-300" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <SectionTitle className="truncate">
              {site.site_name || t('energy.products.unnamed', 'Unnamed Site')}
            </SectionTitle>
            <Text variant="caption" className="block truncate">
              {resourceLabel(site.resource_type, t)} · {t('energy.products.siteId', 'ID')} {site.energy_site_id}
            </Text>
          </div>
        </div>
        {site.battery_type && <Badge variant="info">{site.battery_type}</Badge>}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard
          label={t('energy.products.charge', 'Charge')}
          value={site.percentage_charged != null ? `${fmtNumber(site.percentage_charged, 1)}%` : '—'}
          icon={<Gauge className="h-4 w-4" />}
          color="cyan"
        />
        <MetricCard
          label={t('energy.products.capacity', 'Capacity')}
          value={fmtEnergy(site.total_pack_energy)}
          icon={<Battery className="h-4 w-4" />}
          color="green"
        />
        <MetricCard
          label={t('energy.products.type', 'Type')}
          value={resourceLabel(site.resource_type, t)}
          icon={<Activity className="h-4 w-4" />}
          color="blue"
        />
      </div>

      {/* Capability badges */}
      <div>
        <Label className="mb-2 block">{t('energy.products.capabilities', 'Capabilities')}</Label>
        <div className="flex flex-wrap gap-2">
          <CapBadge active={site.has_solar} label={t('energy.products.solar', 'Solar')} icon={Sun} />
          <CapBadge active={site.has_battery} label={t('energy.products.battery', 'Battery')} icon={Battery} />
          <CapBadge active={site.has_grid} label={t('energy.products.grid', 'Grid')} icon={Grid3x3} />
          <CapBadge active={site.backup_capable} label={t('energy.products.backup', 'Backup')} icon={Shield} />
          <CapBadge active={site.storm_mode_capable} label={t('energy.products.stormWatch', 'Storm Watch')} icon={CloudLightning} />
          {site.storm_mode_enabled && (
            <Badge variant="warning">
              <CloudLightning className="h-3 w-3" aria-hidden="true" />
              {t('energy.products.stormActive', 'Storm Mode Active')}
            </Badge>
          )}
        </div>
      </div>

      {/* Site configuration (own loading / empty / error) */}
      <SiteInfoSection siteId={site.energy_site_id} touCapable={site.tou_capable} />

      {/* Footer */}
      <Text as="p" variant="caption">
        {t('energy.products.lastFetched', 'Last fetched')}: {formatDateTime(site.fetched_at)}
      </Text>
    </GlassPanel>
  );
}

/* ───────── KPI band ───────── */

interface SummaryKpi {
  key: string;
  label: string;
  value: string | number;
  icon: ReactNode;
  color: 'cyan' | 'amber' | 'green' | 'blue' | 'purple';
}

function SummaryBand({ sites, isLoading }: { sites: TeslaEnergySite[]; isLoading: boolean }) {
  const { t } = useTranslation();

  const kpis = useMemo<SummaryKpi[]>(() => {
    const totalCapacity = sites.reduce((sum, s) => sum + (s.total_pack_energy ?? 0), 0);
    return [
      { key: 'sites', label: t('energy.products.totalSites', 'Energy Sites'), value: sites.length, icon: <Zap className="h-5 w-5" />, color: 'cyan' },
      { key: 'solar', label: t('energy.products.withSolar', 'With Solar'), value: sites.filter((s) => s.has_solar).length, icon: <Sun className="h-5 w-5" />, color: 'amber' },
      { key: 'battery', label: t('energy.products.withBattery', 'With Battery'), value: sites.filter((s) => s.has_battery).length, icon: <Battery className="h-5 w-5" />, color: 'green' },
      { key: 'backup', label: t('energy.products.backupCapable', 'Backup Capable'), value: sites.filter((s) => s.backup_capable).length, icon: <Shield className="h-5 w-5" />, color: 'blue' },
      { key: 'storm', label: t('energy.products.stormReady', 'Storm-Ready'), value: sites.filter((s) => s.storm_mode_capable).length, icon: <CloudLightning className="h-5 w-5" />, color: 'purple' },
      { key: 'capacity', label: t('energy.products.totalCapacity', 'Total Capacity'), value: fmtEnergy(totalCapacity), icon: <Layers className="h-5 w-5" />, color: 'cyan' },
    ];
  }, [sites, t]);

  return (
    <section
      aria-label={t('energy.products.summary', 'Energy summary')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 3xl:grid-cols-6"
    >
      {isLoading && sites.length === 0
        ? Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))
        : kpis.map((k) => (
            <MetricCard key={k.key} label={k.label} value={k.value} icon={k.icon} color={k.color} />
          ))}
    </section>
  );
}

/* ───────── Page ───────── */

export default function EnergyProductsPage() {
  const { t } = useTranslation();
  usePageTitle(t('energy.products.title', 'Energy Products'));

  const sitesQuery = useTeslaEnergySites();
  const { data, isLoading, isError, error, refetch } = sitesQuery;
  const refreshMutation = useRefreshTeslaEnergySites();

  const sites = data ?? [];

  return (
    <PageContainer
      title={t('energy.products.title', 'Energy Products')}
      subtitle={t('energy.products.subtitle', 'Powerwalls, Solar Panels & Wall Connectors discovered from Tesla')}
      query={sitesQuery}
      actions={
        <Button
          onClick={() => refreshMutation.mutate()}
          loading={refreshMutation.isPending}
          disabled={refreshMutation.isPending}
          aria-label={t('energy.products.refresh', 'Refresh from Tesla')}
        >
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('energy.products.refresh', 'Refresh from Tesla')}
        </Button>
      }
    >
      {isError ? (
        <FadeIn>
          <GlassPanel className="p-4 sm:p-5">
            <QueryError error={error} onRetry={() => refetch()} />
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          {/* KPI band — full-width responsive metric grid */}
          <FadeIn>
            <SummaryBand sites={sites} isLoading={isLoading} />
          </FadeIn>

          {/* Site cards — bento grid that adds columns on wide screens */}
          <FadeIn delay={0.05}>
            {isLoading && sites.length === 0 ? (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 3xl:grid-cols-3">
                {[0, 1].map((i) => (
                  <GlassPanel key={i} className="p-4 sm:p-5">
                    <Skeleton className="h-72 rounded-xl" />
                  </GlassPanel>
                ))}
              </div>
            ) : sites.length > 0 ? (
              <StaggerContainer>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 3xl:grid-cols-3">
                  {sites.map((site) => (
                    <StaggerItem key={site.id}>
                      <EnergySiteCard site={site} />
                    </StaggerItem>
                  ))}
                </div>
              </StaggerContainer>
            ) : (
              <GlassPanel className="p-6">
                <EmptyState /* no-action: transient empty state — discovery is triggered by the header "Refresh from Tesla" action */
                  icon={<Zap className="h-8 w-8" />}
                  message={t(
                    'energy.products.empty',
                    'No energy products found. Use "Refresh from Tesla" to discover your Powerwalls and Solar installations.',
                  )}
                />
              </GlassPanel>
            )}
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}

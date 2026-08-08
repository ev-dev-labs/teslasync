/**
 * DataRepairPage — triage worklist for incomplete (stale) charging sessions
 * and drive records.
 *
 * Full-width modern-ui redesign: a KPI band, an opt-in AI suggestion surface,
 * and a two-column worklist bento (charging + drives side-by-side on wide
 * screens, stacked on mobile). Each stale record expands into an inline SI
 * repair form to update, close, or discard it. All data flows through the
 * `@/api/hooks/useDataRepair` TanStack hooks; values are read as SI and
 * formatted at the display boundary via `useUnits()`.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, BatteryCharging, CheckCircle, RefreshCw, Route, ShieldAlert, Wrench,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Badge, Button, GlassPanel, PanelTitle } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { EmptyState, InlineCallout, QueryError, Skeleton } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useUnits } from '@/hooks/useUnits';
import { AIDataRepairSuggestions } from '@/components/ai/AIDataRepairSuggestions';
import {
  useStaleSessions,
  type StaleChargingSession,
  type StaleDrive,
} from '@/api/hooks/useDataRepair';

import { StaleSessionRow, type StaleRowMetric } from '../components/StaleSessionRow';
import { ChargingRepairForm } from '../components/ChargingRepairForm';
import { DriveRepairForm } from '../components/DriveRepairForm';

export default function DataRepairPage() {
  const { t } = useTranslation();
  usePageTitle(t('dataRepair.title', 'Data Repair'));

  const { formatEnergy, formatPower, formatDistance, formatSpeed } = useUnits();

  const staleQuery = useStaleSessions();
  const { data, isLoading, isError, error, refetch, isFetching } = staleQuery;

  const staleCharging = data?.stale_charging ?? [];
  const staleDrives = data?.stale_drives ?? [];
  const totalStale = staleCharging.length + staleDrives.length;

  // A single expanded key across both panels so only one repair form is open
  // at a time (keyed `charging-<id>` / `drive-<id>`).
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const toggle = (key: string) => setExpandedKey((cur) => (cur === key ? null : key));
  const collapse = () => setExpandedKey(null);

  const chargingMetrics = (s: StaleChargingSession): StaleRowMetric[] => [
    { key: 'energy', label: t('dataRepair.metric.energy', 'Energy'), value: formatEnergy(s.total_energy_added_wh) },
    { key: 'peak', label: t('dataRepair.metric.peak', 'Peak'), value: formatPower(s.peak_power_w) },
  ];
  const driveMetrics = (d: StaleDrive): StaleRowMetric[] => [
    { key: 'distance', label: t('dataRepair.metric.distance', 'Distance'), value: formatDistance(d.distance_m) },
    { key: 'max', label: t('dataRepair.metric.maxSpeed', 'Max'), value: formatSpeed(d.max_speed_mps) },
  ];

  const subtitle =
    totalStale > 0
      ? t('dataRepair.subtitle.count', '{{count}} incomplete session(s) found', { count: totalStale })
      : t('dataRepair.subtitle.clean', 'Fix incomplete or stale sessions');

  const actions = (
    <Button
      variant="ghost"
      onClick={() => refetch()}
      loading={isFetching}
      icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      aria-label={t('common.refresh', 'Refresh')}
      className="min-h-11"
      data-testid="data-repair-refresh"
    />
  );

  return (
    <PageContainer
      title={t('dataRepair.title', 'Data Repair')}
      subtitle={subtitle}
      actions={actions}
      query={staleQuery}
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('dataRepair.kpis', 'Repair summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <MetricCard
            label={t('dataRepair.kpi.total', 'Total Stale')}
            value={totalStale}
            icon={<AlertTriangle className="h-4 w-4" />}
            color="amber"
          />
          <MetricCard
            label={t('dataRepair.kpi.charging', 'Stale Charging')}
            value={staleCharging.length}
            icon={<BatteryCharging className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('dataRepair.kpi.drives', 'Stale Drives')}
            value={staleDrives.length}
            icon={<Route className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('dataRepair.kpi.status', 'Status')}
            value={totalStale === 0 ? t('dataRepair.status.clean', 'Clean') : t('dataRepair.status.needsRepair', 'Needs Repair')}
            icon={<Wrench className="h-4 w-4" />}
            color={totalStale === 0 ? 'green' : 'red'}
          />
        </section>
      </FadeIn>

      {/* 2 — AI repair suggestions (opt-in; the HOC renders null when ai_mode='off') */}
      <FadeIn delay={0.1}>
        <AIDataRepairSuggestions />
      </FadeIn>

      {/* 3 — Context callout: what "stale" means + the privileged-action warning */}
      <FadeIn delay={0.15}>
        <InlineCallout variant="warning" icon={<ShieldAlert />}>
          {t(
            'dataRepair.callout',
            'Sessions open for more than 24 hours are shown here. Editing, closing, or discarding a record is a privileged action and may prompt re-authentication.',
          )}
        </InlineCallout>
      </FadeIn>

      {/* 4 — Worklist bento: charging + drives side-by-side on wide screens */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('dataRepair.worklist', 'Repair worklist')}
          className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2 xl:gap-5"
        >
          {/* Charging sessions */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <BatteryCharging className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('dataRepair.charging.title', 'Charging Sessions')}
              {staleCharging.length > 0 && (
                <Badge variant="warning" size="sm">{staleCharging.length}</Badge>
              )}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={44} lines={3} />
            ) : isError ? (
              <QueryError
                error={error}
                onRetry={() => refetch()}
                resourceName={t('dataRepair.charging.resource', 'Charging sessions')}
              />
            ) : staleCharging.length === 0 ? (
              // no-action: transient — the charging worklist re-polls every 30s (useStaleSessions' refetchInterval); this is a positive "all clear" state, not a failure to retry.
              <EmptyState
                icon={<CheckCircle className="h-8 w-8" />}
                title={t('dataRepair.charging.emptyTitle', 'All charging sessions are complete')}
                message={t('dataRepair.charging.empty', 'No stale charging sessions found.')}
              />
            ) : (
              <ul className="space-y-2">
                {staleCharging.map((s) => {
                  const key = `charging-${s.id}`;
                  const formId = `repair-form-${key}`;
                  const expanded = expandedKey === key;
                  return (
                    <li key={s.id}>
                      <StaleSessionRow
                        id={s.id}
                        timestamp={s.started_at}
                        batteryPct={s.start_soc_pct}
                        vehicleId={s.vehicle_id}
                        metrics={chargingMetrics(s)}
                        expanded={expanded}
                        onToggle={() => toggle(key)}
                        controlsId={formId}
                      />
                      {expanded && (
                        <ChargingRepairForm session={s} formId={formId} onClose={collapse} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </GlassPanel>

          {/* Drives */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('dataRepair.drives.title', 'Drives')}
              {staleDrives.length > 0 && (
                <Badge variant="warning" size="sm">{staleDrives.length}</Badge>
              )}
            </PanelTitle>
            {isLoading ? (
              <Skeleton height={44} lines={3} />
            ) : isError ? (
              <QueryError
                error={error}
                onRetry={() => refetch()}
                resourceName={t('dataRepair.drives.resource', 'Drives')}
              />
            ) : staleDrives.length === 0 ? (
              // no-action: transient — the drives worklist re-polls every 30s (useStaleSessions' refetchInterval); this is a positive "all clear" state, not a failure to retry.
              <EmptyState
                icon={<CheckCircle className="h-8 w-8" />}
                title={t('dataRepair.drives.emptyTitle', 'All drives are complete')}
                message={t('dataRepair.drives.empty', 'No stale drives found.')}
              />
            ) : (
              <ul className="space-y-2">
                {staleDrives.map((d) => {
                  const key = `drive-${d.id}`;
                  const formId = `repair-form-${key}`;
                  const expanded = expandedKey === key;
                  return (
                    <li key={d.id}>
                      <StaleSessionRow
                        id={d.id}
                        timestamp={d.start_ts}
                        batteryPct={d.start_battery_pct}
                        vehicleId={d.vehicle_id}
                        metrics={driveMetrics(d)}
                        expanded={expanded}
                        onToggle={() => toggle(key)}
                        controlsId={formId}
                      />
                      {expanded && (
                        <DriveRepairForm drive={d} formId={formId} onClose={collapse} />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}

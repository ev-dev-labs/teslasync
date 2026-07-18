import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, BatteryCharging, Zap, Gauge,
  Thermometer, Download, Fingerprint, Activity, Award, AlertTriangle,
  CheckCircle2, Snowflake, Flame, Sun,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import { GlassPanel, Badge, PanelTitle, Text, Caption, Button, CopyButton } from '@/components/ui';
import { MetricCard, MetricBar } from '@/components/data-display';
import { RadialGauge, AreaChartWrapper } from '@/components/charts';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import {
  useBatteryPassport,
  useVerifyPassport,
  type BatteryPassport,
} from '@/api/hooks/useBatteryPassport';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { fmtNumber, fmtInt, fmtPercent } from '@/lib/numberFormat';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { NeonColor } from '@/lib/tokens';

/* ── Types ─────────────────────────────────────────────── */

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

/* ── Grade / SoH visual helpers (pure) ─────────────────── */

/** Hex accent for the SoH gauge — green ≥90, amber ≥80, red below. */
function sohHex(soh: number): string {
  if (soh >= 90) return '#10b981';
  if (soh >= 80) return '#f59e0b';
  return '#ef4444';
}

/** Toned 300-level text class for the big grade glyph. */
function gradeTextClass(grade: string): string {
  switch (grade.toUpperCase()) {
    case 'A': return 'text-emerald-300';
    case 'B': return 'text-cyan-300';
    case 'C': return 'text-blue-300';
    case 'D': return 'text-amber-300';
    case 'E': return 'text-orange-300';
    case 'F': return 'text-rose-300';
    default: return 'text-[var(--text-muted)]';
  }
}

function gradeNeon(grade: string): NeonColor {
  switch (grade.toUpperCase()) {
    case 'A': return 'green';
    case 'B': return 'cyan';
    case 'C': return 'blue';
    case 'D':
    case 'E': return 'amber';
    case 'F': return 'red';
    default: return 'cyan';
  }
}

/* ── Certificate export (clean snake_case, no camel duplicates) ── */

/**
 * The `request()` client mirrors every key into camelCase, so the live
 * passport object carries both `soh_pct` and `sohPct`. Rebuild a clean,
 * canonical snake_case artifact before download so the exported certificate
 * matches the wire contract (and the fields the provenance hash was computed
 * over) exactly — not a doubled convenience blob.
 */
function toCertificate(p: BatteryPassport): Record<string, unknown> {
  return {
    vehicle_id: p.vehicle_id,
    vin_masked: p.vin_masked,
    issued_at: p.issued_at,
    first_observed_at: p.first_observed_at,
    soh_pct: p.soh_pct,
    capacity_kwh: p.capacity_kwh,
    original_capacity_kwh: p.original_capacity_kwh,
    equivalent_full_cycles: p.equivalent_full_cycles,
    fast_charge_ratio: p.fast_charge_ratio,
    avg_charge_limit_pct: p.avg_charge_limit_pct,
    thermal_exposure: {
      cold_pct: p.thermal_exposure.cold_pct,
      nominal_pct: p.thermal_exposure.nominal_pct,
      hot_pct: p.thermal_exposure.hot_pct,
    },
    health_grade: p.health_grade,
    degradation_trend: (p.degradation_trend ?? []).map((d) => ({
      date: d.date,
      soh_pct: d.soh_pct,
    })),
    recommendations: p.recommendations ?? [],
    provenance_hash: p.provenance_hash,
  };
}

function downloadCertificate(p: BatteryPassport): void {
  const blob = new Blob([JSON.stringify(toCertificate(p), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `battery-passport-${p.vehicle_id}-${p.provenance_hash.slice(0, 12)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/* ── Page ──────────────────────────────────────────────── */

export default function BatteryPassportPage() {
  const { t } = useTranslation();
  usePageTitle(t('batteryPassport.title', 'Battery Passport'));

  /* Vehicle selector: header picker is the source of truth. */
  const { vehicleId: activeId } = useSelectedVehicle();
  const activeIdStr = activeId != null ? String(activeId) : null;

  const passportQuery = useBatteryPassport(activeIdStr);
  const passport = passportQuery.data ?? null;

  /* Tamper-evidence: recompute the current hash server-side and compare it to
     the one the certificate just returned. Only fires once the passport has
     loaded and yielded a provenance hash. */
  const verifyQuery = useVerifyPassport(activeIdStr, passport?.provenance_hash ?? null);

  const trendData = useMemo(
    () =>
      (passport?.degradation_trend ?? []).map((d) => ({
        date: formatDate(d.date),
        soh_pct: d.soh_pct,
      })),
    [passport],
  );

  const onExport = useCallback(() => {
    if (passport) downloadCertificate(passport);
  }, [passport]);

  const { isLoading, error } = passportQuery;
  const noVehicle = activeIdStr === null;
  const recommendations = passport?.recommendations ?? [];
  const thermal = passport?.thermal_exposure ?? null;

  /* Verified badge state derived from the verify query. */
  const verifyState: { variant: BadgeVariant; label: string; Icon: typeof ShieldCheck } =
    (() => {
      if (verifyQuery.isLoading) {
        return {
          variant: 'neutral',
          label: t('batteryPassport.verifying', 'Verifying…'),
          Icon: ShieldQuestion,
        };
      }
      if (verifyQuery.error) {
        return {
          variant: 'warning',
          label: t('batteryPassport.verifyUnavailable', 'Unverified'),
          Icon: ShieldQuestion,
        };
      }
      if (verifyQuery.data?.valid) {
        return {
          variant: 'success',
          label: t('batteryPassport.verified', 'Verified'),
          Icon: ShieldCheck,
        };
      }
      if (verifyQuery.data && !verifyQuery.data.valid) {
        return {
          variant: 'danger',
          label: t('batteryPassport.tampered', 'Tampered'),
          Icon: ShieldAlert,
        };
      }
      return {
        variant: 'neutral',
        label: t('batteryPassport.unverified', 'Unverified'),
        Icon: ShieldQuestion,
      };
    })();

  /* ── Render ──────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('batteryPassport.title', 'Battery Passport')}
      subtitle={t(
        'batteryPassport.subtitle',
        'A verifiable, tamper-evident State-of-Health provenance certificate for this battery.',
      )}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <VehicleSelect />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={<Download className="h-4 w-4" />}
            onClick={onExport}
            disabled={!passport}
          >
            {t('batteryPassport.export', 'Export certificate')}
          </Button>
        </div>
      }
    >
      {noVehicle ? (
        <GlassPanel className="p-6">
          <EmptyState
            icon={<BatteryCharging className="h-8 w-8" />}
            title={t('batteryPassport.noVehicleTitle', 'No vehicle selected')}
            message={t(
              'batteryPassport.noVehicle',
              'Choose a vehicle to issue its Battery Passport certificate.',
            )}
          />
        </GlassPanel>
      ) : (
        <>
          {/* ── 1 · Certificate masthead ───────────────────── */}
          <FadeIn>
            <section aria-label={t('batteryPassport.masthead', 'Certificate header')}>
              <GlassPanel className="relative overflow-hidden p-5 sm:p-6">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400/70 via-cyan-400/60 to-purple-400/70" />
                {error ? (
                  <QueryError error={error} onRetry={() => passportQuery.refetch()} />
                ) : isLoading ? (
                  <Skeleton height={112} />
                ) : passport ? (
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-emerald-300">
                        <Award className="h-4 w-4" aria-hidden="true" />
                        <Caption className="uppercase tracking-wide">
                          {t('batteryPassport.eyebrow', 'EU Battery Passport')}
                        </Caption>
                      </div>
                      <Text as="p" size="xl" weight="bold" color="primary" mono className="mt-1 truncate">
                        {passport.vin_masked || t('batteryPassport.unknownVin', 'VIN unavailable')}
                      </Text>
                      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                        <div>
                          <Caption>{t('batteryPassport.issued', 'Issued')}</Caption>
                          <Text as="p" size="sm" color="secondary">
                            {formatDateTime(passport.issued_at)}
                          </Text>
                        </div>
                        <div>
                          <Caption>
                            {t('batteryPassport.firstObserved', 'First observed')}
                          </Caption>
                          <Text as="p" size="sm" color="secondary">
                            {passport.first_observed_at
                              ? formatDate(passport.first_observed_at)
                              : '—'}
                          </Text>
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge variant={verifyState.variant} size="lg" className="gap-1.5">
                        <verifyState.Icon className="h-4 w-4" aria-hidden="true" />
                        {verifyState.label}
                      </Badge>
                      <div className="flex flex-col items-center">
                        <span
                          className={cn('text-5xl font-bold leading-none', gradeTextClass(passport.health_grade))}
                          aria-hidden="true"
                        >
                          {passport.health_grade}
                        </span>
                        <Caption className="mt-1">
                          {t('batteryPassport.grade', 'Health grade')}
                        </Caption>
                      </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    message={t('batteryPassport.empty', 'No passport could be issued for this vehicle yet.')}
                  />
                )}
              </GlassPanel>
            </section>
          </FadeIn>

          {/* ── 2 · Hero: SoH gauge + key metrics ──────────── */}
          <FadeIn delay={0.05}>
            <section
              aria-label={t('batteryPassport.overview', 'Health overview')}
              className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-3"
            >
              {/* SoH gauge */}
              <GlassPanel className="flex flex-col p-4 sm:p-5">
                <PanelTitle className="mb-4 flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                  {t('batteryPassport.soh', 'State of Health')}
                </PanelTitle>
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-2">
                  {error ? (
                    <QueryError error={error} />
                  ) : isLoading ? (
                    <Skeleton height={200} />
                  ) : passport && passport.soh_pct > 0 ? (
                    <>
                      <RadialGauge
                        value={passport.soh_pct}
                        max={100}
                        label={t('batteryPassport.soh', 'State of Health')}
                        unit="%"
                        color={sohHex(passport.soh_pct)}
                        size={180}
                      />
                      <Caption className="text-center">
                        {t('batteryPassport.capacityLine', '{{cap}} kWh of {{orig}} kWh original', {
                          cap: fmtNumber(passport.capacity_kwh, 1),
                          orig: fmtNumber(passport.original_capacity_kwh, 0),
                        })}
                      </Caption>
                    </>
                  ) : (
                    <EmptyState
                      message={t(
                        'batteryPassport.noSoh',
                        'Not enough charge/capacity history to estimate SoH yet.',
                      )}
                    />
                  )}
                </div>
              </GlassPanel>

              {/* Key metric cards */}
              <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:col-span-2">
                {error ? (
                  <div className="col-span-2">
                    <GlassPanel className="p-4">
                      <QueryError error={error} />
                    </GlassPanel>
                  </div>
                ) : isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={92} />)
                ) : passport ? (
                  <>
                    <MetricCard
                      label={t('batteryPassport.cycles', 'Equivalent full cycles')}
                      value={fmtInt(passport.equivalent_full_cycles)}
                      icon={<Activity className="h-4 w-4" />}
                      color="purple"
                      help={{
                        i18nKey: 'batteryPassport.help.cycles',
                        defaultValue:
                          'Total energy throughput expressed as full 0→100% charge-discharge cycles. A proxy for cycle-fade wear that is independent of how the pack was topped up.',
                      }}
                    />
                    <MetricCard
                      label={t('batteryPassport.fastCharge', 'Fast-charge ratio')}
                      value={fmtPercent(passport.fast_charge_ratio * 100, 0)}
                      icon={<Zap className="h-4 w-4" />}
                      color="amber"
                      help={{
                        i18nKey: 'batteryPassport.help.fastCharge',
                        defaultValue:
                          'Share of charging sessions that were DC fast-charges. Frequent fast-charging accelerates degradation, so a lower ratio is healthier.',
                      }}
                    />
                    <MetricCard
                      label={t('batteryPassport.avgLimit', 'Avg charge limit')}
                      value={`${fmtNumber(passport.avg_charge_limit_pct, 0)}%`}
                      icon={<BatteryCharging className="h-4 w-4" />}
                      color="cyan"
                      help={{
                        i18nKey: 'batteryPassport.help.avgLimit',
                        defaultValue:
                          'Average state of charge the pack was charged up to. Habitually charging to 100% stresses the cells; ~80% is gentler for daily use.',
                      }}
                    />
                    <MetricCard
                      label={t('batteryPassport.grade', 'Health grade')}
                      value={passport.health_grade}
                      icon={<Award className="h-4 w-4" />}
                      color={gradeNeon(passport.health_grade)}
                      subtitle={t('batteryPassport.gradeScale', 'A (best) → F')}
                    />
                  </>
                ) : (
                  <div className="col-span-2">
                    <EmptyState message={t('batteryPassport.empty', 'No passport could be issued for this vehicle yet.')} />
                  </div>
                )}
              </div>
            </section>
          </FadeIn>

          {/* ── 3 · Degradation trend ──────────────────────── */}
          <FadeIn delay={0.1}>
            <section aria-label={t('batteryPassport.trendTitle', 'Degradation trend')}>
              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  {t('batteryPassport.trendTitle', 'Degradation trend')}
                </PanelTitle>
                {error ? (
                  <QueryError error={error} />
                ) : isLoading ? (
                  <Skeleton height={240} />
                ) : trendData.length > 0 ? (
                  <AreaChartWrapper
                    data={trendData}
                    xKey="date"
                    height={240}
                    ariaLabel={t('batteryPassport.trendAria', 'State of Health over time')}
                    yFormatter={(v) => `${fmtNumber(v, 0)}%`}
                    series={[
                      {
                        key: 'soh_pct',
                        label: t('batteryPassport.soh', 'State of Health'),
                        color: '#22d3ee',
                      },
                    ]}
                  />
                ) : (
                  <EmptyState
                    icon={<Activity className="h-8 w-8" />}
                    message={t(
                      'batteryPassport.noTrend',
                      'No day-over-day SoH history is available for this vehicle yet.',
                    )}
                  />
                )}
              </GlassPanel>
            </section>
          </FadeIn>

          {/* ── 4 · Thermal exposure + Recommendations ─────── */}
          <FadeIn delay={0.15}>
            <section
              aria-label={t('batteryPassport.usageTitle', 'Usage & recommendations')}
              className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2"
            >
              {/* Thermal exposure */}
              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-4 flex items-center gap-2">
                  <Thermometer className="h-4 w-4 text-amber-300" aria-hidden="true" />
                  {t('batteryPassport.thermalTitle', 'Thermal exposure')}
                </PanelTitle>
                {error ? (
                  <QueryError error={error} />
                ) : isLoading ? (
                  <Skeleton height={140} />
                ) : thermal ? (
                  <div className="space-y-4">
                    <MetricBar
                      label={t('batteryPassport.thermalCold', 'Cold (< 10°C)')}
                      value={thermal.cold_pct}
                      max={100}
                      color="#3b82f6"
                      sublabel={fmtPercent(thermal.cold_pct, 1)}
                    />
                    <MetricBar
                      label={t('batteryPassport.thermalNominal', 'Nominal (10–30°C)')}
                      value={thermal.nominal_pct}
                      max={100}
                      color="#10b981"
                      sublabel={fmtPercent(thermal.nominal_pct, 1)}
                    />
                    <MetricBar
                      label={t('batteryPassport.thermalHot', 'Hot (> 30°C)')}
                      value={thermal.hot_pct}
                      max={100}
                      color="#ef4444"
                      sublabel={fmtPercent(thermal.hot_pct, 1)}
                    />
                    <div className="flex items-center gap-4 pt-1 text-[var(--text-muted)]">
                      <span className="flex items-center gap-1">
                        <Snowflake className="h-3.5 w-3.5 text-blue-300" aria-hidden="true" />
                        <Caption>{t('batteryPassport.thermalColdShort', 'Cold')}</Caption>
                      </span>
                      <span className="flex items-center gap-1">
                        <Sun className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                        <Caption>{t('batteryPassport.thermalNominalShort', 'Nominal')}</Caption>
                      </span>
                      <span className="flex items-center gap-1">
                        <Flame className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" />
                        <Caption>{t('batteryPassport.thermalHotShort', 'Hot')}</Caption>
                      </span>
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Thermometer className="h-8 w-8" />}
                    message={t(
                      'batteryPassport.noThermal',
                      'No ambient-temperature readings recorded for this vehicle yet.',
                    )}
                  />
                )}
              </GlassPanel>

              {/* Recommendations */}
              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-4 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                  {t('batteryPassport.recommendationsTitle', 'Recommendations')}
                </PanelTitle>
                {error ? (
                  <QueryError error={error} />
                ) : isLoading ? (
                  <Skeleton height={140} />
                ) : recommendations.length > 0 ? (
                  <ul className="space-y-2.5">
                    {recommendations.map((rec, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <AlertTriangle
                          className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
                          aria-hidden="true"
                        />
                        <Text as="span" size="sm" color="secondary">
                          {rec}
                        </Text>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    icon={<CheckCircle2 className="h-8 w-8" />}
                    message={t(
                      'batteryPassport.noRecommendations',
                      'No recommendations — this pack is being treated well.',
                    )}
                  />
                )}
              </GlassPanel>
            </section>
          </FadeIn>

          {/* ── 5 · Provenance ─────────────────────────────── */}
          <FadeIn delay={0.2}>
            <section aria-label={t('batteryPassport.provenanceTitle', 'Provenance')}>
              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-2 flex items-center gap-2">
                  <Fingerprint className="h-4 w-4 text-purple-300" aria-hidden="true" />
                  {t('batteryPassport.provenanceTitle', 'Provenance')}
                </PanelTitle>
                <Text as="p" size="sm" color="muted" className="mb-3">
                  {t(
                    'batteryPassport.provenanceBlurb',
                    'A SHA-256 fingerprint over the certificate’s immutable core facts. Any change to the underlying data yields a different hash — that is what makes this passport tamper-evident.',
                  )}
                </Text>
                {error ? (
                  <QueryError error={error} />
                ) : isLoading ? (
                  <Skeleton height={72} />
                ) : passport ? (
                  <div className="space-y-3">
                    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 sm:flex-row sm:items-center sm:justify-between">
                      <Text
                        as="code"
                        mono
                        size="xs"
                        color="secondary"
                        className="break-all"
                      >
                        {passport.provenance_hash}
                      </Text>
                      <CopyButton
                        text={passport.provenance_hash}
                        withToast
                        label={t('batteryPassport.copyHash', 'Copy hash')}
                        className="shrink-0"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={verifyState.variant} className="gap-1.5">
                        <verifyState.Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        {verifyState.label}
                      </Badge>
                      {verifyQuery.data && (
                        <Caption>
                          {verifyQuery.data.valid
                            ? t('batteryPassport.hashMatches', 'Recomputed hash matches the certificate.')
                            : t('batteryPassport.hashMismatch', 'Recomputed hash does not match.')}
                        </Caption>
                      )}
                    </div>
                    <div className="pt-1">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        icon={<Download className="h-4 w-4" />}
                        onClick={onExport}
                      >
                        {t('batteryPassport.export', 'Export certificate')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    message={t('batteryPassport.noProvenance', 'No provenance hash available yet.')}
                  />
                )}
              </GlassPanel>
            </section>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}

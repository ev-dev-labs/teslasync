// Native parity port of web/src/features/vehicles/pages/VehicleDetailPage.tsx.
//
// The web page is the Vehicles > Vehicle Detail dashboard. It reads a vehicle by
// its `:id` route segment, fans out into ten live/historical queries plus a wake
// command mutation, derives the vehicle `status`, and renders a `PageContainer`
// (title from the nickname override or display name, a compact `<LiveIndicator>`
// action, breadcrumb override, and a top `<LiveStaleDataBanner>`) whose body is
// the vehicle header followed by — once live `state` is present — fourteen
// ordered, individually error-boundaried + fade-in sections (battery/range,
// live-state, quick-stats, motor, climate, security, tire-pressure,
// charging-telemetry, battery charts, recent drives, recent charges,
// vehicle-config, the Helix paint preview, quick links, and the per-vehicle
// settings tab). While the vehicle record loads it shows a matching skeleton.
//
// This port preserves the identical data reads, state/derived names, API paths,
// unit handling (the section components own their own SI->display conversion),
// i18n key/fallback intent, and the same ordered section stack using React
// Native primitives instead of DOM / web UI components.
//
// Behaviour preserved verbatim:
//   * State / derived names: `id`, `vehicleId`, `vehicle`/`vehicleLoading`/
//     `vehicleError`, `vehicleSettings`, `nicknameSetting`, `effectiveName`,
//     `stateData`/`refetchState`, `motorData`, `climateData`, `securityData`,
//     `tireData`, `chargingTelemetry`, `drives`, `sessions`, `vehicleConfig`,
//     `toast`, `wakeMutation`, `state`, `status`.
//   * Every query key, query function URL, `enabled` guard, and
//     `refetchInterval` (state 30s, motor/climate/security 15s, tire 30s,
//     charging-telemetry 5s, vehicle-config 30s) is copied unchanged. The
//     request() client still auto-prefixes `/api/v1`, so the paths stay
//     prefix-free and use snake_case `vehicle_id` query params + `limit=5`.
//   * The wake mutation POSTs `/vehicles/{id}/wake`, toasts success/failure, and
//     re-fetches the live state after 5s.
//   * `status = vehicle ? deriveStatus(state) : 'offline'` and the
//     `if (vehicleLoading) return <VehicleDetailSkeleton />` short-circuit.
//   * Every i18n key + English fallback (the page title, the wake toasts, and
//     all sixteen section error-boundary fallback titles).
//
// Platform dependency swaps (no DOM, Recharts, Leaflet, framer-motion,
// react-router, or web UI components in native output — contract rule 4); each
// documented in the parity sidecar:
//   * react-router `useParams<{id}>()` -> `useNativeVehicleIdParam`, which has no
//     URL route segment on native so it defaults to the first vehicle in the
//     fleet (via the ported `useVehicles`) to keep the detail page functional.
//   * react-i18next `useTranslation()` -> `useNativeT`, a `t(key, fallback)` that
//     returns the English fallback (the page uses no interpolation vars).
//   * `usePageTitle` (document.title) -> `useNativePageTitle` no-op; the page
//     header still renders the title.
//   * `useToast` (@/components/feedback/Toast) -> `useNativeToast`, mapping
//     success/error to React Native's `Alert.alert` (the native feedback
//     primitive) while keeping the same message intent.
//   * `PageContainer` (@/components/layout, not yet ported) -> an inline native
//     ScrollView layout with the same title/actions/error/children precedence
//     and the `space-y-6` (24px) section rhythm; `breadcrumbLabels` is accepted
//     for source parity but is a no-op (router-only).
//   * `LiveIndicator variant="compact"` (@/components/data-display, not ported)
//     -> an inline native compact chip (the live SSE wiring is browser-only, so
//     it renders the static compact form).
//   * `FadeIn` (@/components/motion, not ported) -> an inline passthrough that
//     accepts `delay` for source parity but renders children directly (no timers
//     — keeps the `--detectOpenHandles` test gate deterministic).
//   * The feedback skeletons `Skeleton` / `StatGridSkeleton` /
//     `ChartBlockSkeleton` / `PageHeaderSkeleton` (not ported) -> inline native
//     skeleton primitives reproducing the same composition (heights, line counts,
//     card counts, rounded-xl radii); `grid-cols-1 lg:grid-cols-2` collapses to a
//     mobile-first stacked column.
//   * `LiveStaleDataBanner` + `SectionErrorBoundary` (@/components/feedback) ->
//     the already-ported native parity components (reused, not re-implemented).
//   * `AIVehiclePaintPreview` (@/components/ai) -> the already-ported native
//     parity component (reused).
//   * The fourteen `../components/vehicle-detail` sections -> the native-safe
//     `../components/vehicle-detail` barrel (BatteryRangePanel + QuickStatsGrid
//     are real ports; the rest are "native port pending" placeholders).
//   * `VehicleSettingsTab` (../components/VehicleSettingsTab, not ported) -> an
//     inline native-safe placeholder that still threads `vehicleId` through.
//   * `deriveStatus` / `StateResponse` (../components/vehicle-detail/helpers, not
//     ported) -> `deriveVehicleStatus` from the native api/types (the helper
//     re-export) + an inline `StateResponse` interface.
//   * DOM `<div data-tour=...>` -> a plain RN `<View>` (no tour attribute).

import React, {
  useCallback,
  useMemo,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useMutation, useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {
  findEffectiveSetting,
  useVehicleSettings,
} from '../../../api/hooks/useVehicleSettings';
import {deriveVehicleStatus} from '../../../api/types';
import type {
  ChargingSession,
  ChargingTelemetry,
  ClimateSnapshot,
  Drive,
  MotorSnapshot,
  SecurityEvent,
  TirePressureSnapshot,
  Vehicle,
  VehicleConfigSnapshot,
  VehicleState,
  VehicleStatus,
} from '../../../api/types';
import {AIVehiclePaintPreview} from '../../../components/ai/AIVehiclePaintPreview';
import {LiveStaleDataBanner} from '../../../components/feedback/LiveStaleDataBanner';
import {SectionErrorBoundary} from '../../../components/feedback/SectionErrorBoundary';
import {
  BatteryRangeCharts,
  BatteryRangePanel,
  ChargingTelemetrySection,
  ClimateSection,
  LiveStateIndicators,
  MotorSection,
  QuickLinksSection,
  QuickStatsGrid,
  RecentChargesSection,
  RecentDrivesSection,
  SecuritySection,
  TirePressureSection,
  VehicleConfigSection,
  VehicleHeader,
} from '../components/vehicle-detail';

/* ── helpers swap (../components/vehicle-detail/helpers) ─────────────────── */

// Inlined from the not-yet-ported helpers module: the `/vehicles/{id}/state`
// response shape (the page only reads `.state`). `deriveStatus` is the web
// helper's re-export of `deriveVehicleStatus`, imported directly above.
interface StateResponse {
  state: VehicleState;
  live: boolean;
}

const deriveStatus = deriveVehicleStatus;

/* ── i18n / page-title swaps ─────────────────────────────────────────────── */

type NativeT = (key: string, fallback: string) => string;

// react-i18next swap: the page calls `t(key, fallback)` with no interpolation
// vars, so the native shim simply returns the English fallback.
function useNativeT(): NativeT {
  return useCallback<NativeT>((_key, fallback) => fallback, []);
}

// Native no-op for the web `usePageTitle` (which set `document.title`). There is
// no document on native; the page header still renders the title.
function useNativePageTitle(_title: string): void {
  // Intentionally empty — see note above.
}

/* ── useToast swap (@/components/feedback/Toast) ─────────────────────────── */

interface NativeToast {
  success: (message: string) => void;
  error: (message: string) => void;
}

// The web `useToast()` showed a transient popup. Native parity has no ported
// toast surface; this maps both channels onto React Native's `Alert.alert`, the
// platform feedback primitive, keeping the same message intent.
function useNativeToast(): NativeToast {
  return useMemo<NativeToast>(
    () => ({
      success: (message: string) => Alert.alert('', message),
      error: (message: string) => Alert.alert('', message),
    }),
    [],
  );
}

/* ── useParams swap (react-router) ───────────────────────────────────────── */

// react-router `useParams<{id}>()` reads the `:id` URL segment, which has no
// native web-parity equivalent. To keep the detail page functional, default to
// the first vehicle in the fleet (via the ported useVehicles), mirroring how the
// other ported pages resolve a working vehicle id (documented in the sidecar).
function useNativeVehicleIdParam(): string | undefined {
  const {data: vehicles} = useVehicles();
  const list = vehicles ?? [];
  const first = list.length > 0 ? list[0] : undefined;
  return first ? String(first.id) : undefined;
}

/* ── Skeleton primitives (@/components/feedback PageSkeleton) ─────────────── */

interface SkeletonProps {
  height?: number;
  width?: DimensionValue;
  radius?: number;
  lines?: number;
  style?: StyleProp<ViewStyle>;
}

// Native mirror of the web <Skeleton>: a single pulsing block, or — when
// `lines > 1` — a stacked column whose last line is 60% wide (matching the web
// multi-line skeleton). `radius` carries the Tailwind rounded-xl (12) override;
// the default 4 mirrors the web `rounded`.
function Skeleton({
  height = 16,
  width = '100%',
  radius = 4,
  lines = 1,
  style,
}: SkeletonProps): ReactElement {
  if (lines > 1) {
    return (
      <View style={[styles.skeletonLines, style]}>
        {Array.from({length: lines}).map((_, i) => (
          <View
            key={i}
            style={[
              styles.skeletonBlock,
              {
                height,
                width: i === lines - 1 ? '60%' : '100%',
                borderRadius: radius,
              },
            ]}
          />
        ))}
      </View>
    );
  }
  return (
    <View
      style={[styles.skeletonBlock, {height, width, borderRadius: radius}, style]}
    />
  );
}

// Native mirror of <StatGridSkeleton cards>: a wrapping 2-up grid of h-24
// (96px) rounded-xl cards (the web grid is grid-cols-2 on mobile, the native
// target).
function StatGridSkeleton({cards = 4}: {cards?: number}): ReactElement {
  return (
    <View style={styles.statGrid}>
      {Array.from({length: cards}).map((_, i) => (
        <View key={i} style={styles.statGridCell}>
          <Skeleton height={96} radius={12} />
        </View>
      ))}
    </View>
  );
}

// Native mirror of <ChartBlockSkeleton height>: a full-width rounded-xl block.
function ChartBlockSkeleton({height = 320}: {height?: number}): ReactElement {
  return <Skeleton height={height} radius={12} />;
}

// Native mirror of <PageHeaderSkeleton>: a title bar (h-8 w-64) over a subtitle
// bar (h-4), stacked with the web space-y-2 rhythm.
function PageHeaderSkeleton(): ReactElement {
  return (
    <View style={styles.pageHeaderSkeleton}>
      <Skeleton height={32} width={240} />
      <Skeleton height={16} width="90%" />
    </View>
  );
}

/**
 * Mirrors the VehicleDetailPage layout while the vehicle record loads:
 * page header -> battery & range panel -> live state indicators ->
 * 4-card quick-stats grid -> motor/climate/security/tire panels ->
 * battery-range chart -> recent drives + charges tables -> quick links.
 */
function VehicleDetailSkeleton(): ReactElement {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.skeletonContent}
      testID="vehicle-detail-skeleton">
      <PageHeaderSkeleton />
      <Skeleton height={160} radius={12} />
      <StatGridSkeleton cards={4} />
      <StatGridSkeleton cards={4} />
      <View style={styles.twoColStack}>
        <Skeleton height={176} radius={12} />
        <Skeleton height={176} radius={12} />
      </View>
      <ChartBlockSkeleton height={320} />
      <View style={styles.twoColStack}>
        <Skeleton height={224} radius={12} />
        <Skeleton height={224} radius={12} />
      </View>
      <StatGridSkeleton cards={6} />
    </ScrollView>
  );
}

/* ── FadeIn swap (@/components/motion) ───────────────────────────────────── */

// framer-motion <FadeIn> swap: native parity keeps the entrance simple and
// timer-free (the `delay` is accepted for source parity but not animated) so the
// `--detectOpenHandles` gate stays deterministic.
function FadeIn({
  children,
  delay: _delay,
}: {
  children: ReactNode;
  delay?: number;
}): ReactElement {
  return <View>{children}</View>;
}

/* ── LiveIndicator swap (@/components/data-display) ──────────────────────── */

type LiveIndicatorVariant = 'pill' | 'dot' | 'compact';

// <LiveIndicator variant="compact"> swap: the live SSE health wiring is
// browser-only, so the native chip renders the static compact form (dot +
// "Live" label) the web `compact` variant shows.
function LiveIndicator({
  variant: _variant = 'pill',
}: {
  variant?: LiveIndicatorVariant;
}): ReactElement {
  return (
    <View style={styles.liveChip}>
      <View style={styles.liveDot} />
      <AppText variant="caption" tone="secondary">
        Live
      </AppText>
    </View>
  );
}

/* ── VehicleSettingsTab swap (../components/VehicleSettingsTab) ───────────── */

// No native port exists yet; render a native-safe placeholder that still threads
// `vehicleId` through so the call site stays faithful.
function VehicleSettingsTab({
  vehicleId: _vehicleId,
}: {
  vehicleId: number;
}): ReactElement {
  return (
    <GlassPanel style={styles.placeholderPanel}>
      <AppText variant="caption" tone="muted" style={styles.placeholderKicker}>
        Vehicle detail
      </AppText>
      <AppText weight="semibold">Per-vehicle settings</AppText>
      <AppText variant="caption" tone="muted">
        Native port pending
      </AppText>
    </GlassPanel>
  );
}

/* ── PageContainer swap (@/components/layout) ────────────────────────────── */

interface PageContainerProps {
  title: string;
  error?: Error | null;
  actions?: ReactNode;
  breadcrumbLabels?: Partial<Record<string, string>>;
  children: ReactNode;
}

// `<PageContainer title error actions breadcrumbLabels>` -> native scroll
// layout. `error` shows the message instead of the body; otherwise the children
// render with the web `space-y-6` (24px) rhythm. `breadcrumbLabels` is router-
// only and intentionally ignored on native.
function PageContainer({
  title,
  error,
  actions,
  breadcrumbLabels: _breadcrumbLabels,
  children,
}: PageContainerProps): ReactElement {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {error ? (
        <View style={styles.errorBox}>
          <AppText tone="danger">{error.message}</AppText>
        </View>
      ) : (
        <View style={styles.body}>{children}</View>
      )}
    </ScrollView>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function VehicleDetailPage(): ReactElement {
  const t = useNativeT();
  const id = useNativeVehicleIdParam();
  const vehicleId = Number(id);
  useNativePageTitle(t('vehicles.detail.title', 'Vehicle Detail'));

  /* ─── Queries ─── */

  const {
    data: vehicle,
    isLoading: vehicleLoading,
    error: vehicleError,
  } = useQuery({
    queryKey: ['vehicles', String(vehicleId)],
    queryFn: () => request<Vehicle>(`/vehicles/${vehicleId}`),
    enabled: vehicleId > 0,
  });

  // Nickname override feeds the page title and breadcrumb; falls back to
  // vehicles.display_name when no override is present.
  const {data: vehicleSettings} = useVehicleSettings(vehicleId);
  const nicknameSetting = findEffectiveSetting(vehicleSettings, 'nickname');
  const effectiveName =
    typeof nicknameSetting?.value === 'string' && nicknameSetting.value !== ''
      ? nicknameSetting.value
      : vehicle?.display_name;

  const {data: stateData, refetch: refetchState} = useQuery({
    queryKey: ['vehicle-state', vehicleId],
    queryFn: () => request<StateResponse>(`/vehicles/${vehicleId}/state`),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  });

  const {data: motorData} = useQuery({
    queryKey: ['motor-latest', vehicleId],
    queryFn: () =>
      request<MotorSnapshot | null>(`/motor/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  });

  const {data: climateData} = useQuery({
    queryKey: ['climate-latest', vehicleId],
    queryFn: () =>
      request<ClimateSnapshot | null>(`/climate/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  });

  const {data: securityData} = useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: () =>
      request<SecurityEvent | null>(`/security/latest?vehicle_id=${vehicleId}`),
    enabled: vehicleId > 0,
    refetchInterval: 15_000,
  });

  const {data: tireData} = useQuery({
    queryKey: ['tire-latest', vehicleId],
    queryFn: () =>
      request<TirePressureSnapshot | null>(
        `/tire-pressure/latest?vehicle_id=${vehicleId}`,
      ),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  });

  const {data: chargingTelemetry} = useQuery({
    queryKey: ['charging-telemetry-latest', vehicleId],
    queryFn: () =>
      request<ChargingTelemetry | null>(
        `/charging-telemetry/latest?vehicle_id=${vehicleId}`,
      ),
    enabled: vehicleId > 0,
    refetchInterval: 5_000,
  });

  const {data: drives} = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${vehicleId}&limit=5`),
    enabled: vehicleId > 0,
  });

  const {data: sessions} = useQuery({
    queryKey: ['charging', vehicleId],
    queryFn: () =>
      request<ChargingSession[]>(`/charging?vehicle_id=${vehicleId}&limit=5`),
    enabled: vehicleId > 0,
  });

  const {data: vehicleConfig} = useQuery({
    queryKey: ['vehicle-config-latest', vehicleId],
    queryFn: () =>
      request<VehicleConfigSnapshot | null>(
        `/vehicle-config/latest?vehicle_id=${vehicleId}`,
      ),
    enabled: vehicleId > 0,
    refetchInterval: 30_000,
  });

  const toast = useNativeToast();
  const wakeMutation = useMutation({
    mutationFn: () =>
      request<{status: string}>(`/vehicles/${vehicleId}/wake`, {
        method: 'POST',
      }),
    onSuccess: () => {
      toast.success(t('vehicles.detail.wakeSuccess', 'Wake command sent'));
      setTimeout(() => {
        refetchState();
      }, 5000);
    },
    onError: (err: Error) => {
      toast.error(
        err.message || t('vehicles.detail.wakeFailed', 'Failed to wake vehicle'),
      );
    },
  });

  /* ─── Derived state ─── */

  const state = stateData?.state;
  const status: VehicleStatus = vehicle ? deriveStatus(state) : 'offline';

  /* ─── Loading short-circuit ─────────── */
  if (vehicleLoading) {
    return <VehicleDetailSkeleton />;
  }

  /* ─── Render ─── */

  return (
    <PageContainer
      title={effectiveName ?? t('vehicles.detail.title', 'Vehicle Detail')}
      error={vehicleError as Error | null}
      breadcrumbLabels={{
        '/vehicles/:id': effectiveName ?? `Vehicle #${id}`,
      }}
      actions={<LiveIndicator variant="compact" />}>
      <LiveStaleDataBanner />
      <SectionErrorBoundary
        name="vehicle-detail:header"
        fallbackTitle={t(
          'vehicles.detail.section.headerFailed',
          'Vehicle header failed to load',
        )}>
        <FadeIn>
          <View>
            <VehicleHeader
              vehicle={vehicle}
              status={status}
              onWake={() => wakeMutation.mutate()}
              waking={wakeMutation.isPending}
            />
          </View>
        </FadeIn>
      </SectionErrorBoundary>

      {!state ? (
        <FadeIn delay={0.05}>
          <GlassPanel style={styles.statePanel}>
            <Skeleton lines={5} height={20} />
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          <SectionErrorBoundary
            name="vehicle-detail:battery-range"
            fallbackTitle={t(
              'vehicles.detail.section.batteryRangeFailed',
              'Battery & range section failed to load',
            )}>
            <FadeIn delay={0.04}>
              <BatteryRangePanel state={state} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:live-state"
            fallbackTitle={t(
              'vehicles.detail.section.liveStateFailed',
              'Live state indicators failed to load',
            )}>
            <FadeIn delay={0.06}>
              <LiveStateIndicators state={state} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:quick-stats"
            fallbackTitle={t(
              'vehicles.detail.section.quickStatsFailed',
              'Quick stats failed to load',
            )}>
            <FadeIn delay={0.08}>
              <QuickStatsGrid state={state} status={status} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:motor"
            fallbackTitle={t(
              'vehicles.detail.section.motorFailed',
              'Motor section failed to load',
            )}>
            <FadeIn delay={0.1}>
              <MotorSection motorData={motorData} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:climate"
            fallbackTitle={t(
              'vehicles.detail.section.climateFailed',
              'Climate section failed to load',
            )}>
            <FadeIn delay={0.12}>
              <ClimateSection climateData={climateData} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:security"
            fallbackTitle={t(
              'vehicles.detail.section.securityFailed',
              'Security section failed to load',
            )}>
            <FadeIn delay={0.14}>
              <SecuritySection securityData={securityData} state={state} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:tire-pressure"
            fallbackTitle={t(
              'vehicles.detail.section.tireFailed',
              'Tire pressure section failed to load',
            )}>
            <FadeIn delay={0.16}>
              <TirePressureSection tireData={tireData} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:charging-telemetry"
            fallbackTitle={t(
              'vehicles.detail.section.chargingTelemetryFailed',
              'Charging telemetry failed to load',
            )}>
            <FadeIn delay={0.18}>
              <ChargingTelemetrySection chargingTelemetry={chargingTelemetry} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:battery-charts"
            fallbackTitle={t(
              'vehicles.detail.section.batteryChartsFailed',
              'Battery & range charts failed to load',
            )}>
            <FadeIn delay={0.2}>
              <BatteryRangeCharts state={state} drives={drives} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:recent-drives"
            fallbackTitle={t(
              'vehicles.detail.section.recentDrivesFailed',
              'Recent drives failed to load',
            )}>
            <FadeIn delay={0.22}>
              <RecentDrivesSection drives={drives} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:recent-charges"
            fallbackTitle={t(
              'vehicles.detail.section.recentChargesFailed',
              'Recent charges failed to load',
            )}>
            <FadeIn delay={0.24}>
              <RecentChargesSection sessions={sessions} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:vehicle-config"
            fallbackTitle={t(
              'vehicles.detail.section.vehicleConfigFailed',
              'Vehicle config section failed to load',
            )}>
            <FadeIn delay={0.26}>
              <VehicleConfigSection
                vehicleConfig={vehicleConfig}
                softwareVersion={state.software_version}
              />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:ai-paint-preview"
            fallbackTitle={t(
              'vehicles.detail.section.aiPaintPreviewFailed',
              'Helix paint preview failed to load',
            )}>
            <FadeIn delay={0.27}>
              <AIVehiclePaintPreview vehicleId={vehicleId} />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:quick-links"
            fallbackTitle={t(
              'vehicles.detail.section.quickLinksFailed',
              'Quick links failed to load',
            )}>
            <FadeIn delay={0.28}>
              <QuickLinksSection />
            </FadeIn>
          </SectionErrorBoundary>
          <SectionErrorBoundary
            name="vehicle-detail:settings"
            fallbackTitle={t(
              'vehicles.detail.section.settingsFailed',
              'Per-vehicle settings failed to load',
            )}>
            <FadeIn delay={0.3}>
              <VehicleSettingsTab vehicleId={vehicleId} />
            </FadeIn>
          </SectionErrorBoundary>
        </>
      )}
    </PageContainer>
  );
}

// space-y-6 (1.5rem = 24px) vertical rhythm between the stacked sections.
const SECTION_GAP = 24;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    padding: spacing.lg,
    gap: SECTION_GAP,
  },
  skeletonContent: {
    padding: spacing.lg,
    gap: SECTION_GAP,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerText: {
    flexShrink: 1,
    minWidth: 0,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  body: {
    gap: SECTION_GAP,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    padding: spacing.md,
  },
  // GlassPanel p-8 around the loading skeleton shown until live state arrives.
  statePanel: {
    padding: 32,
  },
  // space-y-2 between the two header skeleton bars.
  pageHeaderSkeleton: {
    gap: spacing.sm,
  },
  // grid grid-cols-2 gap-4 of stat-card skeletons (mobile-first 2-up).
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -spacing.sm,
  },
  statGridCell: {
    width: '50%',
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  // grid grid-cols-1 gap-4 lg:grid-cols-2 -> mobile-first stacked column.
  twoColStack: {
    gap: spacing.md,
  },
  skeletonBlock: {
    backgroundColor: colors.surfaceRaised,
  },
  skeletonLines: {
    gap: spacing.sm,
  },
  liveChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.success,
  },
  placeholderPanel: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  placeholderKicker: {
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

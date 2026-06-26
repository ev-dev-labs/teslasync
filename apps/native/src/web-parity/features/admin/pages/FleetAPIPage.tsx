/**
 * Native parity port of
 * web/src/features/admin/pages/FleetAPIPage.tsx.
 *
 * The web file is the Fleet-API settings page: Tesla Fleet API polling
 * configuration + endpoint management. It (1) shows a master "Tesla API Polling"
 * suspend/resume switch (`useSettings().api_suspended` + `useToggleAPISuspend`)
 * with a paused-state explanatory banner, (2) renders the "API Endpoint
 * Controls" panel that toggles every individual polling / on-demand / command
 * endpoint plus the MongoDB-gated telemetry-capture switch (`usePollingConfig`
 * + `useUpdatePollingConfig` + `useCaptureStats`) including a retention-days
 * Select and a captured-signal-count chip, and (3) lists the server's
 * "Configured Endpoints" (`useVersionInfo`). This native port preserves that
 * contract 1:1 — the same `settings` / `pollingConfig` / `captureStats` /
 * `version` queries, the same `suspendMut` / `pollingConfigMut` mutations, the
 * verbatim `toggleEndpoint` callback (`{ ...pollingConfig, [key]:
 * !pollingConfig[key] }` then `mutate` with success/error toasts), the verbatim
 * `pollingEndpoints` / `onDemandEndpoints` / `commandEndpoints` arrays, the
 * `allEndpointKeys` `useMemo` Set + `enabledCount` / `totalCount` derivation,
 * the retention-Select `mutate({ ...pollingConfig,
 * telemetry_capture_retention_days })`, and the configured-endpoint key list —
 * using React Native primitives + the existing native AppText / GlassPanel /
 * IconBox + design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L9): native-safe `t(key, fallback?)`
 *     fallback (the EndpointSidebar / MaintenanceBanner precedent) returning the
 *     English default (else the key). Every web key is preserved verbatim,
 *     including the `t('common.noData', 'No data available')` default.
 *   - `@/components/layout` `PageContainer` (web L10): no native parity port
 *     exists yet, so a minimal native-safe `PageScaffold` is reproduced locally
 *     (title / subtitle / children — the only props this page uses), the
 *     established "reproduce locally when no native parity port exists"
 *     precedent (ApiPlaygroundPage).
 *   - `@/components/ui` `GlassPanel` (web L11): the existing native GlassPanel.
 *   - `@/components/ui` `IconBox` (web L12): the already-ported native IconBox
 *     (../../../components/ui/IconBox) whose `color` neon variants line up with
 *     the web red/green/cyan/purple usage.
 *   - `@/components/ui` `Toggle` / `Select` / `Badge` (web L13-15): no native
 *     parity ports exist yet, so minimal native-safe equivalents are reproduced
 *     locally — a `Toggle` (Pressable switch, role="switch", `onChange(!checked)`
 *     on press, sm/md sizes), a `Select` (Pressable option chips, the
 *     SignalQueryControls per-page-selector precedent; web `onChange(e =>
 *     e.target.value)` -> `onValueChange(value)`), and a `Badge`
 *     (success/neutral chip).
 *   - `@/components/motion` `FadeIn` (web L16): framer-motion entrance -> a
 *     static passthrough View (the Layout framer-motion -> static precedent).
 *   - `@/components/feedback` `EmptyState` (web L17): a minimal local native-safe
 *     equivalent (decorative glyph + message), matching the web `icon` +
 *     `message` + `className` usage.
 *   - `@/components/feedback` `useToast` (web L18): no native Toast provider yet,
 *     so a local `useToast()` bridges to React Native `Alert.alert(title,
 *     message?)` (the `_toastHelpers` Alert precedent), preserving the page's
 *     `success` / `error` / `info` (title, message?) feedback calls.
 *   - `@/hooks/usePageTitle` (web L19): `document.title` is browser-only, so the
 *     native hook is a documented no-op (the native navigator owns the title).
 *   - `@/lib/numberFormat` `fmtInt` (web L20): a local native `fmtInt` mirroring
 *     `fmtNumber(v, 0)` — `safeNumber` guard + `toLocaleString` with 0 fraction
 *     digits — so the captured-signal count keeps its thousands grouping.
 *   - `@/api/hooks/useSettings` `useSettings` / `useToggleAPISuspend` /
 *     `usePollingConfig` / `useUpdatePollingConfig` / `useCaptureStats` /
 *     `useVersionInfo` (web L21-24): the already-ported native hooks
 *     (../../../api/hooks/useSettings), same API paths + response shapes.
 *   - lucide-react `Shield` / `Pause` / `Play` / `Globe` / `Link` / `Activity`
 *     (web L25): rendered as decorative AppText glyphs — the established native
 *     inline-icon stand-in. The IconBox glyphs inherit its neon tint; the
 *     standalone glyphs are marked importantForAccessibility="no-hide-descendants"
 *     (the aria-hidden analog).
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {IconBox} from '../../../components/ui/IconBox';
import {
  useCaptureStats,
  usePollingConfig,
  useSettings,
  useToggleAPISuspend,
  useUpdatePollingConfig,
  useVersionInfo,
  type PollingConfig,
} from '../../../api/hooks/useSettings';

/* ─── decorative glyph stand-ins for the lucide-react icons ───────────────── */

const SHIELD_GLYPH = '\uD83D\uDEE1'; // 🛡 (lucide Shield)
const PAUSE_GLYPH = '\u23F8'; // ⏸ (lucide Pause)
const PLAY_GLYPH = '\u25B6'; // ▶ (lucide Play)
const GLOBE_GLYPH = '\uD83C\uDF10'; // 🌐 (lucide Globe)
const LINK_GLYPH = '\uD83D\uDD17'; // 🔗 (lucide Link)
const ACTIVITY_GLYPH = '\uD83D\uDCC8'; // 📈 (lucide Activity)

/* ─── Tailwind palette literals that cannot apply on native ───────────────── */

const CYAN_300 = '#67e8f9'; // web text-cyan-300
const NEON_RED = '#fda4af'; // toned-down neon-red (web text-neon-red, rose-300)
const NEON_RED_SURFACE = 'rgba(239, 68, 68, 0.05)'; // web bg-neon-red/5
const NEON_RED_BORDER = 'rgba(239, 68, 68, 0.2)'; // web border-neon-red/20
const NEON_CYAN_SURFACE = 'rgba(0, 240, 255, 0.05)'; // web bg-neon-cyan/5
const NEON_CYAN_BORDER = 'rgba(0, 240, 255, 0.1)'; // web border-neon-cyan/10
const TOGGLE_ON = '#06b6d4'; // web bg-cyan-500
const TOGGLE_OFF = '#4b5563'; // web dark bg-gray-600
const TOGGLE_THUMB = '#ffffff';

/* ─── native translation fallback (native-safe port of react-i18next) ─────── */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: returns the English default else the key. */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ─── native-safe usePageTitle (web document.title is browser-only) ───────── */

function usePageTitle(title: string): void {
  useEffect(() => {
    // The web hook writes document.title; on native the navigator owns the
    // header title, so the resolved title is intentionally not applied here.
    void title;
  }, [title]);
}

/* ─── native-safe useToast (web in-house Toast provider) ──────────────────── */

interface NativeToast {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

/**
 * The web `useToast()` enqueues a transient in-app toast. The native parity
 * layer has no Toast provider yet, so feedback bridges to React Native
 * `Alert.alert(title, message?)` (the `_toastHelpers` precedent), preserving the
 * page's `success` / `error` / `info` (title, message?) call sites.
 */
function useToast(): NativeToast {
  return useMemo<NativeToast>(
    () => ({
      success: (title, message) => Alert.alert(title, message),
      error: (title, message) => Alert.alert(title, message),
      info: (title, message) => Alert.alert(title, message),
    }),
    [],
  );
}

/* ─── native-safe fmtInt (web @/lib/numberFormat) ─────────────────────────── */

/**
 * Mirrors the web `fmtInt(v) = fmtNumber(v, 0)`: a `safeNumber` guard (0 for a
 * non-finite value) then `toLocaleString` with zero fraction digits, so the
 * captured-signal count keeps its thousands grouping.
 */
function fmtInt(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/* ─── native Toggle stand-in (`@/components/ui` Toggle) ───────────────────── */

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  size?: 'sm' | 'md';
  testID?: string;
}

const TOGGLE_DIMS = {
  sm: {track: 36, height: 20, thumb: 14, travel: 16},
  md: {track: 44, height: 24, thumb: 20, travel: 20},
} as const;

function Toggle({checked, onChange, size = 'md', testID}: ToggleProps) {
  const dims = TOGGLE_DIMS[size];
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked}}
      hitSlop={8}
      onPress={() => onChange(!checked)}
      style={[
        styles.toggleTrack,
        {
          width: dims.track,
          height: dims.height,
          borderRadius: dims.height / 2,
          backgroundColor: checked ? TOGGLE_ON : TOGGLE_OFF,
        },
      ]}
      testID={testID}>
      <View
        style={[
          styles.toggleThumb,
          {
            width: dims.thumb,
            height: dims.thumb,
            borderRadius: dims.thumb / 2,
            transform: [{translateX: checked ? dims.travel : 0}],
          },
        ]}
      />
    </Pressable>
  );
}

/* ─── native Select stand-in (`@/components/ui` Select) ───────────────────── */

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  testID?: string;
}

function Select({value, onValueChange, options, disabled, testID}: SelectProps) {
  return (
    <View style={[styles.select, disabled && styles.selectDisabled]} testID={testID}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: active, disabled: !!disabled}}
            disabled={disabled}
            key={opt.value}
            onPress={() => onValueChange(opt.value)}
            style={[styles.selectOption, active && styles.selectOptionActive]}
            testID={testID ? `${testID}-option-${opt.value}` : undefined}>
            <AppText
              style={active ? styles.selectOptionTextActive : styles.selectOptionText}
              variant="caption"
              weight={active ? 'semibold' : 'regular'}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── native Badge stand-in (`@/components/ui` Badge) ─────────────────────── */

interface BadgeProps {
  variant: 'success' | 'neutral';
  children: string;
  testID?: string;
}

function Badge({variant, children, testID}: BadgeProps) {
  return (
    <View
      style={[styles.badge, variant === 'success' ? styles.badgeSuccess : styles.badgeNeutral]}
      testID={testID}>
      <AppText
        style={variant === 'success' ? styles.badgeSuccessText : styles.badgeNeutralText}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── native EmptyState stand-in (`@/components/feedback` EmptyState) ──────── */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function EmptyState({icon, message, style, testID}: EmptyStateProps) {
  return (
    <View style={[styles.emptyState, style]} testID={testID}>
      {icon ? <View style={styles.emptyStateIcon}>{icon}</View> : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ─── native FadeIn stand-in (`@/components/motion` FadeIn) ────────────────── */

function FadeIn({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

/* ─── native-safe page scaffold (web PageContainer) ───────────────────────── */

interface PageScaffoldProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

function PageScaffold({title, subtitle, children}: PageScaffoldProps) {
  return (
    <ScrollView contentContainerStyle={styles.scaffold} testID="fleet-api-page">
      <View style={styles.scaffoldHeader}>
        <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.scaffoldSubtitle} tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={styles.scaffoldBody}>{children}</View>
    </ScrollView>
  );
}

/* ─── EndpointToggle sub-component (ported verbatim) ──────────────────────── */

function EndpointToggle({
  label,
  desc,
  enabled,
  onToggle,
  testID,
}: {
  label: string;
  desc: string;
  enabled: boolean;
  onToggle: () => void;
  testID?: string;
}) {
  return (
    <GlassPanel style={styles.endpointToggle}>
      <View style={styles.endpointToggleText}>
        <AppText numberOfLines={1} style={styles.endpointToggleLabel} weight="semibold">
          {label}
        </AppText>
        <AppText numberOfLines={1} style={styles.endpointToggleDesc} tone="muted">
          {desc}
        </AppText>
      </View>
      <View style={styles.endpointToggleSwitch}>
        <Toggle checked={enabled} onChange={() => onToggle()} size="sm" testID={testID} />
      </View>
    </GlassPanel>
  );
}

/* ─── Page component ──────────────────────────────────────────────────────── */

export default function FleetAPIPage() {
  const t = useNativeTranslationFallback();
  usePageTitle(t('Fleet API'));
  const toast = useToast();

  // Queries
  const {data: settings} = useSettings();
  const {data: pollingConfig} = usePollingConfig();
  const {data: captureStats} = useCaptureStats();
  const {data: version} = useVersionInfo();

  // Mutations
  const suspendMut = useToggleAPISuspend();
  const pollingConfigMut = useUpdatePollingConfig();

  const toggleEndpoint = useCallback(
    (key: string) => {
      if (!pollingConfig) {
        return;
      }
      const updated: PollingConfig = {...pollingConfig, [key]: !pollingConfig[key]};
      pollingConfigMut.mutate(updated, {
        onSuccess: () => toast.success(t('Polling config updated')),
        onError: () => toast.error(t('Failed to update polling config')),
      });
    },
    [pollingConfig, pollingConfigMut, toast, t],
  );

  // The web file recreates these label/desc arrays on every render (each entry
  // calls t(...)). Native eslint treats react-hooks/exhaustive-deps as an error,
  // so each array is memoised on the stable `t` — identical data + render output,
  // and the downstream allEndpointKeys useMemo deps stay stable.
  const pollingEndpoints = useMemo(
    () => [
      {key: 'vehicle_discovery', label: t('Vehicle Discovery'), desc: t('List vehicles from Tesla')},
      {key: 'charge_state', label: t('Charge State'), desc: t('Battery & charging data')},
      {key: 'climate_state', label: t('Climate State'), desc: t('Climate & temperature data')},
      {key: 'drive_state', label: t('Drive State'), desc: t('Location & speed data')},
      {key: 'location_data', label: t('Location Data'), desc: t('GPS coordinates')},
      {key: 'vehicle_state', label: t('Vehicle State'), desc: t('Locks, doors, odometer')},
      {key: 'vehicle_config', label: t('Vehicle Config'), desc: t('Model, trim, options')},
    ],
    [t],
  );

  const onDemandEndpoints = useMemo(
    () => [
      {key: 'on_demand_vehicle_discovery', label: t('Vehicle Discovery'), desc: t('Sync vehicles from Tesla')},
      {key: 'on_demand_charge_state', label: t('Charge State'), desc: t('Battery & charging data')},
      {key: 'on_demand_climate_state', label: t('Climate State'), desc: t('Climate & temperature data')},
      {key: 'on_demand_drive_state', label: t('Drive State'), desc: t('Location & speed data')},
      {key: 'on_demand_location_data', label: t('Location Data'), desc: t('GPS coordinates')},
      {key: 'on_demand_vehicle_state', label: t('Vehicle State'), desc: t('Locks, doors, odometer')},
      {key: 'on_demand_vehicle_config', label: t('Vehicle Config'), desc: t('Model, trim, options')},
      {key: 'nearby_charging_sites', label: t('Nearby Charging'), desc: t('Supercharger locations')},
      {key: 'release_notes', label: t('Release Notes'), desc: t('Firmware release notes')},
      {key: 'recent_alerts', label: t('Recent Alerts'), desc: t('Vehicle alert history')},
      {key: 'service_data', label: t('Service Data'), desc: t('Service history & status')},
    ],
    [t],
  );

  const commandEndpoints = useMemo(
    () => [
      {key: 'wake_up', label: t('Wake Up'), desc: t('Wake vehicle from sleep')},
      {key: 'commands', label: t('Vehicle Commands'), desc: t('Lock, unlock, climate, etc.')},
    ],
    [t],
  );

  const allEndpointKeys = useMemo(() => {
    const keys = new Set([
      ...pollingEndpoints.map(e => e.key),
      ...onDemandEndpoints.map(e => e.key),
      ...commandEndpoints.map(e => e.key),
      'telemetry_capture',
    ]);
    return keys;
  }, [pollingEndpoints, onDemandEndpoints, commandEndpoints]);

  const enabledCount = pollingConfig
    ? Array.from(allEndpointKeys).filter(k => pollingConfig[k]).length
    : 0;
  const totalCount = allEndpointKeys.size;

  return (
    <PageScaffold
      subtitle={t('Control Tesla Fleet API polling, endpoint toggles, and telemetry capture')}
      title={t('Fleet API Settings')}>
      {/* ── Tesla API Polling ────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.pollingHeader}>
            <View style={styles.pollingHeaderLeft}>
              <IconBox color={settings?.api_suspended ? 'red' : 'green'}>
                {settings?.api_suspended ? PAUSE_GLYPH : PLAY_GLYPH}
              </IconBox>
              <View style={styles.pollingHeaderText}>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('Tesla API Polling')}
                </AppText>
                <AppText style={styles.panelSubtitle} tone="muted" variant="caption">
                  {settings?.api_suspended
                    ? t('All Tesla Fleet API calls are suspended')
                    : t('Vehicle data is being polled from Tesla')}
                </AppText>
              </View>
            </View>
            <Toggle
              checked={!settings?.api_suspended}
              onChange={() =>
                suspendMut.mutate(!settings?.api_suspended, {
                  onSuccess: (_data, suspended) => {
                    if (suspended) {
                      toast.info(t('API suspended'), t('All Tesla API calls have been paused'));
                    } else {
                      toast.success(t('API resumed'), t('Tesla API polling has been re-enabled'));
                    }
                  },
                  onError: () => toast.error(t('Failed'), t('Could not toggle API suspension')),
                })
              }
              testID="fleet-api-suspend-toggle"
            />
          </View>

          {settings?.api_suspended ? (
            <GlassPanel style={styles.warningPanel} testID="fleet-api-suspended-banner">
              <AppText
                importantForAccessibility="no-hide-descendants"
                style={styles.warningGlyph}>
                {PAUSE_GLYPH}
              </AppText>
              <AppText style={styles.warningText} variant="caption">
                {t(
                  "Polling and commands are paused. Token refresh continues so you won't need to re-authenticate. Useful when your vehicle is in service.",
                )}
              </AppText>
            </GlassPanel>
          ) : null}
        </GlassPanel>
      </FadeIn>

      {/* ── API Endpoint Controls ────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panelWide}>
          <View style={styles.panelHeaderRow}>
            <IconBox color="cyan">{SHIELD_GLYPH}</IconBox>
            <View style={styles.panelHeaderText}>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('API Endpoint Controls')}
              </AppText>
              <AppText style={styles.panelSubtitle} tone="muted" variant="caption">
                {t('Toggle individual Tesla Fleet API endpoints on or off')}
                {pollingConfig ? (
                  <AppText style={styles.enabledCount} variant="caption">
                    {` (${enabledCount}/${totalCount} ${t('enabled')})`}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          </View>

          {pollingConfig ? (
            <View style={styles.controlsBody}>
              {/* Polling Endpoints */}
              <View>
                <AppText style={styles.groupLabel} variant="caption" weight="semibold">
                  {t('Polling Endpoints')}
                </AppText>
                <View style={styles.endpointGrid}>
                  {pollingEndpoints.map(ep => (
                    <EndpointToggle
                      desc={ep.desc}
                      enabled={!!pollingConfig[ep.key]}
                      key={ep.key}
                      label={ep.label}
                      onToggle={() => toggleEndpoint(ep.key)}
                      testID={`fleet-api-endpoint-toggle-${ep.key}`}
                    />
                  ))}
                </View>
              </View>

              {/* On-Demand Endpoints */}
              <View>
                <AppText style={styles.groupLabel} variant="caption" weight="semibold">
                  {t('On-Demand Endpoints')}
                </AppText>
                <View style={styles.endpointGrid}>
                  {onDemandEndpoints.map(ep => (
                    <EndpointToggle
                      desc={ep.desc}
                      enabled={!!pollingConfig[ep.key]}
                      key={ep.key}
                      label={ep.label}
                      onToggle={() => toggleEndpoint(ep.key)}
                      testID={`fleet-api-endpoint-toggle-${ep.key}`}
                    />
                  ))}
                </View>
              </View>

              {/* Commands */}
              <View>
                <AppText style={styles.groupLabel} variant="caption" weight="semibold">
                  {t('Commands')}
                </AppText>
                <View style={styles.endpointGrid}>
                  {commandEndpoints.map(ep => (
                    <EndpointToggle
                      desc={ep.desc}
                      enabled={!!pollingConfig[ep.key]}
                      key={ep.key}
                      label={ep.label}
                      onToggle={() => toggleEndpoint(ep.key)}
                      testID={`fleet-api-endpoint-toggle-${ep.key}`}
                    />
                  ))}
                </View>
              </View>

              {/* Telemetry Capture */}
              <View style={captureStats && !captureStats.mongodb_enabled ? styles.dimmed : undefined}>
                <View style={styles.telemetryHeader}>
                  <AppText style={styles.groupLabel} variant="caption" weight="semibold">
                    {t('Telemetry Capture')}
                  </AppText>
                  {captureStats ? (
                    <Badge
                      testID="fleet-api-mongo-badge"
                      variant={captureStats.mongodb_enabled ? 'success' : 'neutral'}>
                      {captureStats.mongodb_enabled
                        ? t('MongoDB Connected')
                        : t('MongoDB Not Configured')}
                    </Badge>
                  ) : null}
                </View>
                <View style={styles.telemetryBody}>
                  <EndpointToggle
                    desc={
                      captureStats && !captureStats.mongodb_enabled
                        ? t('Set MONGODB_ENABLED=true and configure MONGODB_URI to enable')
                        : t('Capture every fleet telemetry signal to MongoDB for debugging')
                    }
                    enabled={!!pollingConfig.telemetry_capture}
                    label={t('Raw Signal Recording')}
                    onToggle={() => toggleEndpoint('telemetry_capture')}
                    testID="fleet-api-endpoint-toggle-telemetry_capture"
                  />
                  {pollingConfig.telemetry_capture && captureStats?.mongodb_enabled ? (
                    <>
                      <GlassPanel style={styles.retentionRow}>
                        <View style={styles.retentionText}>
                          <AppText style={styles.endpointToggleLabel} weight="semibold">
                            {t('Retention Period')}
                          </AppText>
                          <AppText style={styles.endpointToggleDesc} tone="muted">
                            {t('Auto-delete captured signals after this many days')}
                          </AppText>
                        </View>
                        <Select
                          disabled={pollingConfigMut.isPending}
                          onValueChange={value => {
                            pollingConfigMut.mutate({
                              ...pollingConfig,
                              telemetry_capture_retention_days: parseInt(value, 10),
                            });
                          }}
                          options={[
                            {value: '1', label: t('1 day')},
                            {value: '3', label: t('3 days')},
                            {value: '7', label: t('7 days')},
                            {value: '14', label: t('14 days')},
                            {value: '30', label: t('30 days')},
                          ]}
                          testID="fleet-api-retention-select"
                          value={String(pollingConfig.telemetry_capture_retention_days || 7)}
                        />
                      </GlassPanel>
                      {captureStats.total_documents > 0 ? (
                        <GlassPanel style={styles.captureStatsPanel}>
                          <AppText style={styles.captureStatsText} variant="caption">
                            {`${fmtInt(captureStats.total_documents)} ${t('signals captured from')} ${
                              captureStats.distinct_vins.length
                            } ${t('vehicle')}${captureStats.distinct_vins.length !== 1 ? 's' : ''}`}
                          </AppText>
                        </GlassPanel>
                      ) : null}
                    </>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}
        </GlassPanel>
      </FadeIn>

      {/* ── Configured Endpoints ─────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.panelHeaderRow}>
            <IconBox color="purple">{GLOBE_GLYPH}</IconBox>
            <View style={styles.panelHeaderText}>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('API Endpoints')}
              </AppText>
              <AppText style={styles.panelSubtitle} tone="muted" variant="caption">
                {version
                  ? `v${version.chart_version} · ${version.go_version} · ${version.os}/${version.arch}`
                  : ''}
              </AppText>
            </View>
          </View>

          {version?.endpoints && Object.keys(version.endpoints).length > 0 ? (
            <View style={styles.endpointsBody}>
              <View style={styles.configuredHeader}>
                <AppText
                  importantForAccessibility="no-hide-descendants"
                  style={styles.configuredGlyph}
                  tone="muted">
                  {LINK_GLYPH}
                </AppText>
                <AppText style={styles.configuredLabel} tone="muted" variant="caption" weight="semibold">
                  {t('Configured Endpoints')}
                </AppText>
              </View>
              <View style={styles.configuredGrid}>
                {[
                  {key: 'api', label: t('API (Internal)')},
                  {key: 'web', label: t('Web Frontend')},
                  {key: 'oauth_callback', label: t('OAuth Callback')},
                  {key: 'tesla_api', label: t('Tesla Fleet API')},
                ].map(ep =>
                  version.endpoints[ep.key] ? (
                    <GlassPanel
                      key={ep.key}
                      style={styles.configuredRow}
                      testID={`fleet-api-endpoint-${ep.key}`}>
                      <AppText style={styles.configuredRowLabel} tone="muted" variant="caption" weight="semibold">
                        {ep.label}
                      </AppText>
                      <AppText style={styles.configuredRowValue} variant="caption">
                        {version.endpoints[ep.key]}
                      </AppText>
                    </GlassPanel>
                  ) : null,
                )}
              </View>
            </View>
          ) : (
            <EmptyState
              icon={
                <AppText
                  importantForAccessibility="no-hide-descendants"
                  style={styles.emptyGlyph}>
                  {ACTIVITY_GLYPH}
                </AppText>
              }
              message={t('common.noData', 'No data available')}
              style={styles.endpointsEmpty}
              testID="fleet-api-endpoints-empty"
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  scaffold: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  scaffoldHeader: {
    gap: spacing.xs,
  },
  scaffoldTitle: {
    letterSpacing: -0.5,
  },
  scaffoldSubtitle: {
    fontSize: typography.caption,
  },
  scaffoldBody: {
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelWide: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  panelTitle: {
    fontSize: typography.body,
  },
  panelSubtitle: {
    fontSize: typography.caption,
  },
  pollingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pollingHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexShrink: 1,
  },
  pollingHeaderText: {
    flexShrink: 1,
  },
  warningPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: NEON_RED_SURFACE,
    borderColor: NEON_RED_BORDER,
  },
  warningGlyph: {
    color: NEON_RED,
    flexShrink: 0,
  },
  warningText: {
    color: NEON_RED,
    flex: 1,
    fontSize: typography.caption,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  panelHeaderText: {
    flexShrink: 1,
  },
  enabledCount: {
    color: CYAN_300,
  },
  controlsBody: {
    gap: spacing.md,
  },
  groupLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  endpointGrid: {
    gap: spacing.sm,
  },
  endpointToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  endpointToggleText: {
    flexShrink: 1,
    minWidth: 0,
  },
  endpointToggleLabel: {
    fontSize: typography.caption,
  },
  endpointToggleDesc: {
    fontSize: 11,
  },
  endpointToggleSwitch: {
    flexShrink: 0,
    marginLeft: spacing.sm,
  },
  telemetryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  telemetryBody: {
    gap: spacing.sm,
  },
  dimmed: {
    opacity: 0.5,
  },
  retentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  retentionText: {
    flexShrink: 1,
    minWidth: 0,
  },
  captureStatsPanel: {
    padding: spacing.sm,
    backgroundColor: NEON_CYAN_SURFACE,
    borderColor: NEON_CYAN_BORDER,
  },
  captureStatsText: {
    color: CYAN_300,
    fontSize: 11,
  },
  endpointsBody: {
    gap: spacing.md,
  },
  configuredHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  configuredGlyph: {
    fontSize: typography.caption,
  },
  configuredLabel: {
    fontSize: typography.caption,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  configuredGrid: {
    gap: spacing.sm,
  },
  configuredRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  configuredRowLabel: {
    fontSize: typography.caption,
  },
  configuredRowValue: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: typography.caption,
    fontFamily: 'monospace',
    textAlign: 'right',
  },
  endpointsEmpty: {
    paddingVertical: spacing.xl,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  emptyStateIcon: {
    opacity: 0.2,
  },
  emptyStateMessage: {
    fontSize: typography.caption,
    textAlign: 'center',
  },
  emptyGlyph: {
    fontSize: 28,
  },
  toggleTrack: {
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleThumb: {
    backgroundColor: TOGGLE_THUMB,
  },
  select: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'flex-end',
    flexShrink: 1,
  },
  selectDisabled: {
    opacity: 0.5,
  },
  selectOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  selectOptionActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  selectOptionText: {
    color: colors.textSecondary,
  },
  selectOptionTextActive: {
    color: colors.accent,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeSuccess: {
    backgroundColor: colors.successSurface,
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceRaised,
  },
  badgeSuccessText: {
    color: colors.success,
  },
  badgeNeutralText: {
    color: colors.textSecondary,
  },
});

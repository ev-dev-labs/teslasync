// Native parity port of web/src/features/system/pages/CommandsPage.tsx.
//
// CommandsPage — the remote-control center for the Tesla fleet. The page's own
// responsibilities are ported one-for-one from the web source:
//   - Both React Query reads keep their exact query keys, query fns, API paths,
//     enabled guard, and 15s refetch: ['vehicles'] -> GET /vehicles, and
//     ['command-vehicle-states', vehicles?.map(v => v.id)] -> a Promise.all over
//     GET /vehicles/{id}/state that swallows per-vehicle failures and folds the
//     results into a Record<number, VehicleState | null> via Object.fromEntries
//     (web L27-50). State names (vehicles, isLoading, statesMap, statesError,
//     states, onlineCount) and the `states = statesMap ?? {}` /
//     `onlineCount = vehicles?.filter(v => v.state !== 'asleep' && v.state !==
//     'offline').length ?? 0` derivations are preserved verbatim (web L52-53).
//   - The PageContainer header (title/subtitle/actions), the "View History" link
//     + online-count action, the four-up stats grid (Vehicles/Online/Asleep/
//     Refresh with cyan/green/amber/purple + their values), the states-error
//     banner, the loading skeleton pair, the vehicle command-center list, and
//     both empty states are all reproduced with the same data and branch order
//     (web L55-122).
//   - The page carries no physical units (battery % and the 15s literal are
//     unit-free), so there is no unit conversion — matching the source.
//   - Every i18n key keeps its English default string (intent preserved).
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation (web L10) -> inlined useNativeTranslation():
//     a stable (key, fallback?, options?) => fallback ?? key shim (the AuditLog/
//     Geofences precedent) that also reproduces i18next `{{name}}` interpolation;
//     single-arg t('Vehicles') / t('online') calls return the key verbatim.
//   - react-router-dom Link to="/command-history" (web L11, L62-68) -> a React
//     Native Pressable with accessibilityRole='link' calling the optional
//     onNavigate('/command-history') prop (no in-app router on the native
//     web-parity surface; the route target is preserved on the prop — the
//     RecentActivity/PeriodCompare precedent).
//   - @/components/layout PageContainer (web L12) -> inline native PageContainer
//     (ScrollView page; title + subtitle + actions header; a centred spinner
//     while loading that hides children exactly like the web loading branch).
//   - @/components/ui GlassPanel (web L13) -> the shared native GlassPanel (the
//     states-error banner surface).
//   - @/components/data-display MetricCard (web L14) -> the ported native parity
//     MetricCard (same label/value/icon/color contract; NeonColor cyan/green/
//     amber/purple all exist).
//   - @/components/feedback EmptyState + Skeleton (web L15) -> inline native
//     EmptyState (icon + optional title + message; the web `className` padding
//     hint has no native analogue and is dropped) and inline Skeleton (token
//     bar at the web h-72 = 288px height).
//   - @/components/motion FadeIn/StaggerContainer/StaggerItem (web L16) ->
//     FadeIn = Animated.View opacity 0->1 mount fade; StaggerContainer/
//     StaggerItem collapse to a gap: spacing.lg column (the web space-y-6),
//     matching the PowerFlow precedent.
//   - @/hooks/usePageTitle (web L17) -> native-safe usePageTitle (feature-detects
//     document.title; writes "{title} — TeslaSync"; restores on unmount).
//   - @/api/client request (web L18) -> the ported native web-parity request<T>.
//   - lucide-react Car/Wifi/Power/Loader2/Activity/AlertTriangle/History
//     (web L19) -> SemanticIcon glyphs vehicle/wifi/power/refresh/activity/
//     warning/history.
//   - ../commands Vehicle/VehicleState types (web L20) -> inlined as native
//     interfaces (no native commands.ts module yet; it ports on its own turn).
//   - ../components/VehicleCommandCenter (web L21) -> a native-safe inline
//     VehicleCommandCenter that preserves the {vehicle, state} prop contract and
//     surfaces the real vehicle identity + live VehicleState summary (name,
//     state badge, model · vin, freshness, battery %, lock/charge/climate/sentry
//     chips). Its full config-driven interactive command grid (search,
//     favorites, collapsible categories, command mutations, dialogs, toasts) is
//     a separate 389-line component slated for its own conversion turn, so per
//     contract rule 7 that interactive surface is represented with an explicit
//     pending note rather than a transplanted partial port. The unit-formatted
//     range/temperature in the web header are likewise deferred to that
//     component's port (they require useUnits, which this unit-free page does
//     not own).
//
// No DOM-only modules, HTML elements, react-router-dom, react-i18next,
// lucide-react, Recharts, or Leaflet are imported — only react-native
// primitives, @tanstack/react-query, the ported web-parity request client +
// MetricCard, and the shared native SemanticIcon/AppText/GlassPanel + theme
// tokens.

import {useCallback, useEffect, useRef, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {MetricCard} from '../../../components/data-display/MetricCard';
import {request} from '../../../api/client';

// ─── inline native-safe types (web ../commands Vehicle / VehicleState) ──────
interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
  model: string;
  state: string;
  battery_level: number;
  battery_range: number;
  updated_at: string;
}

interface VehicleState {
  battery_level: number;
  rated_range: number;
  is_locked: boolean;
  is_charging: boolean;
  is_climate_on: boolean;
  sentry_mode: boolean;
  inside_temp: number;
  speed: number;
}

// ─── i18n shim (web react-i18next useTranslation) ───────────────────────────
type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback?: string,
  options?: NativeTOptions,
) => string;

function useNativeTranslation(): NativeTFunction {
  return useCallback((key: string, fallback?: string, options?: NativeTOptions) => {
    const base = fallback ?? key;
    if (!options) {
      return base;
    }
    return Object.keys(options).reduce(
      (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
      base,
    );
  }, []);
}

// ─── usePageTitle shim (web @/hooks/usePageTitle) ───────────────────────────
function usePageTitle(title: string): void {
  useEffect(() => {
    const doc = (globalThis as {document?: {title?: string}}).document;
    if (doc && typeof doc.title === 'string') {
      const prev = doc.title;
      doc.title = `${title} — TeslaSync`;
      return () => {
        doc.title = prev;
      };
    }
    return undefined;
  }, [title]);
}

// ─── relative time (ported from VehicleCommandCenter timeAgo) ───────────────
function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `${hrs}h ago`;
  }
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Tailwind shades / neon tints absent from the native theme -> literals ──
const RED_SURFACE = 'rgba(239, 68, 68, 0.05)'; // bg-neon-red/5
const RED_BORDER = 'rgba(239, 68, 68, 0.2)'; // border-neon-red/20
const EMERALD_300 = '#6ee7b7'; // text-emerald-300
const AMBER_300 = '#fcd34d'; // text-amber-300
const ROSE_300 = '#fda4af'; // text-rose-300

// ─── FadeIn (web @/components/motion FadeIn) ────────────────────────────────
function FadeIn({children, style}: {children: ReactNode; style?: StyleProp<ViewStyle>}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [opacity]);
  return <Animated.View style={[{opacity}, style]}>{children}</Animated.View>;
}

// ─── Spinner (web @/components/feedback Spinner) ────────────────────────────
function Spinner() {
  return <ActivityIndicator color={colors.accent} size="large" />;
}

// ─── Skeleton (web @/components/feedback Skeleton) ──────────────────────────
function Skeleton({height}: {height: number}) {
  return <View style={[styles.skeleton, {height}]} />;
}

// ─── EmptyState (web @/components/feedback EmptyState) ───────────────────────
function EmptyState({
  icon,
  title,
  message,
}: {
  icon?: ReactNode;
  title?: string;
  message: string;
}) {
  return (
    <View style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      {title ? <AppText weight="semibold">{title}</AppText> : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ─── PageContainer (web @/components/layout PageContainer, used subset) ──────
function PageContainer({
  actions,
  children,
  loading,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  loading?: boolean;
  subtitle?: string;
  title: string;
}) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {loading ? (
        <View style={styles.pageSpinner}>
          <Spinner />
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

// ─── StateBadge (web @/components/ui Badge) ─────────────────────────────────
function StateBadge({asleep, label}: {asleep: boolean; label: string}) {
  return (
    <View style={[styles.badge, asleep ? styles.badgeNeutral : styles.badgeSuccess]}>
      <AppText
        style={asleep ? styles.badgeTextNeutral : styles.badgeTextSuccess}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

function StateChip({label}: {label: string}) {
  return (
    <View style={styles.stateChip}>
      <AppText tone="secondary" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

// ─── VehicleCommandCenter (web ../components/VehicleCommandCenter) ───────────
// Native-safe summary preserving the {vehicle, state} prop contract. The full
// interactive command grid is its own conversion file; per contract rule 7 the
// interactive surface is surfaced as an explicit pending note (see sidecar).
function VehicleCommandCenter({vehicle, state}: {vehicle: Vehicle; state: VehicleState | null}) {
  const t = useNativeTranslation();
  const name = vehicle.display_name || vehicle.vin;
  const isAsleep = vehicle.state === 'asleep' || vehicle.state === 'offline';
  const batteryColor = (state?.battery_level ?? 0) > 50 ? EMERALD_300 : AMBER_300;

  return (
    <GlassPanel style={styles.commandPanel}>
      <View style={styles.commandHeader}>
        <View style={styles.commandHeaderText}>
          <View style={styles.commandTitleRow}>
            <AppText variant="body" weight="semibold">
              {name}
            </AppText>
            <StateBadge asleep={isAsleep} label={vehicle.state} />
          </View>
          <AppText tone="muted" variant="caption">
            {`${vehicle.model} · ${vehicle.vin}`}
          </AppText>
          <AppText tone="muted" variant="caption">
            {`${t('Updated')} ${timeAgo(vehicle.updated_at)}`}
          </AppText>
        </View>
        {state ? (
          <View style={styles.commandBattery}>
            <SemanticIcon decorative name="battery" size="sm" />
            <AppText style={{color: batteryColor}} weight="semibold">
              {`${state.battery_level}%`}
            </AppText>
          </View>
        ) : null}
      </View>

      {state ? (
        <View style={styles.stateChips}>
          <StateChip label={state.is_locked ? t('Locked') : t('Unlocked')} />
          {state.is_charging ? <StateChip label={t('Charging')} /> : null}
          {state.is_climate_on ? <StateChip label={t('Climate On')} /> : null}
          {state.sentry_mode ? <StateChip label={t('Sentry')} /> : null}
        </View>
      ) : (
        <AppText tone="muted" variant="caption">
          {t('commands.noState', 'Live state unavailable')}
        </AppText>
      )}

      <View style={styles.commandNote}>
        <SemanticIcon decorative name="info" size="sm" />
        <AppText style={styles.commandNoteText} tone="muted" variant="caption">
          {t(
            'commands.center.nativePending',
            'Interactive command controls are provided by the dedicated command center.',
          )}
        </AppText>
      </View>
    </GlassPanel>
  );
}

interface CommandsPageProps {
  onNavigate?: (path: string) => void;
}

export default function CommandsPage({onNavigate}: CommandsPageProps = {}) {
  const t = useNativeTranslation();
  usePageTitle(t('commands.title', 'Commands'));

  const {data: vehicles, isLoading} = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const {data: statesMap, error: statesError} = useQuery({
    queryKey: ['command-vehicle-states', vehicles?.map(v => v.id)],
    queryFn: async () => {
      if (!vehicles) {
        return {} as Record<number, VehicleState | null>;
      }
      const entries = await Promise.all(
        vehicles.map(async v => {
          try {
            const data = await request<{state: VehicleState}>(`/vehicles/${v.id}/state`);
            return [v.id, data.state ?? null] as const;
          } catch {
            return [v.id, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<number, VehicleState | null>;
    },
    enabled: !!vehicles && vehicles.length > 0,
    refetchInterval: 15_000,
  });

  const states = statesMap ?? {};
  const onlineCount =
    vehicles?.filter(v => v.state !== 'asleep' && v.state !== 'offline').length ?? 0;

  const actions = (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="link"
        onPress={() => onNavigate?.('/command-history')}
        style={styles.historyLink}>
        <SemanticIcon decorative name="history" size="sm" />
        <AppText style={styles.historyLinkText} variant="caption">
          {t('commands.viewHistory', 'View History')}
        </AppText>
      </Pressable>
      {vehicles && vehicles.length > 0 ? (
        <AppText tone="muted" variant="caption">
          <AppText style={styles.onlineCount} variant="caption" weight="semibold">
            {onlineCount}
          </AppText>
          {`/${vehicles.length} ${t('online')}`}
        </AppText>
      ) : null}
    </View>
  );

  return (
    <PageContainer
      actions={actions}
      loading={isLoading}
      subtitle={t('commands.subtitle', 'Remote control center for your Tesla fleet')}
      title={t('commands.pageTitle', 'Vehicle Commands')}>
      <View style={styles.content}>
        {/* Stats */}
        <FadeIn>
          {vehicles && vehicles.length > 0 ? (
            <View style={styles.statsGrid}>
              <View style={styles.statsCell}>
                <MetricCard
                  color="cyan"
                  icon={<SemanticIcon decorative name="vehicle" size="sm" />}
                  label={t('Vehicles')}
                  value={vehicles.length}
                />
              </View>
              <View style={styles.statsCell}>
                <MetricCard
                  color="green"
                  icon={<SemanticIcon decorative name="wifi" size="sm" />}
                  label={t('Online')}
                  value={onlineCount}
                />
              </View>
              <View style={styles.statsCell}>
                <MetricCard
                  color="amber"
                  icon={<SemanticIcon decorative name="power" size="sm" />}
                  label={t('Asleep')}
                  value={(vehicles?.length ?? 0) - onlineCount}
                />
              </View>
              <View style={styles.statsCell}>
                <MetricCard
                  color="purple"
                  icon={<SemanticIcon decorative name="refresh" size="sm" />}
                  label={t('Refresh')}
                  value="15s"
                />
              </View>
            </View>
          ) : (
            <EmptyState
              icon={<SemanticIcon decorative name="activity" size="md" />}
              message={t('common.noData', 'No data available')}
            />
          )}
        </FadeIn>

        {statesError ? (
          <GlassPanel style={styles.errorPanel}>
            <SemanticIcon decorative name="warning" size="sm" />
            <AppText style={styles.errorText} variant="caption">
              {`${t('commands.statesError', 'Failed to load vehicle states')}: ${
                (statesError as Error).message
              }`}
            </AppText>
          </GlassPanel>
        ) : null}

        {/* Vehicle Command Centers */}
        {isLoading ? (
          <View style={styles.commandList}>
            <Skeleton height={288} />
            <Skeleton height={288} />
          </View>
        ) : vehicles && vehicles.length > 0 ? (
          <View style={styles.commandList}>
            {vehicles.map(v => (
              <VehicleCommandCenter key={v.id} state={states[v.id] ?? null} vehicle={v} />
            ))}
          </View>
        ) : (
          <EmptyState
            icon={<SemanticIcon decorative name="vehicle" size="md" />}
            message={t(
              'commands.connectFleet',
              'Connect your Tesla account and sync your fleet to start sending commands.',
            )}
            title={t('commands.noVehicles', 'No vehicles found')}
          />
        )}
      </View>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pageHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageActions: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  pageSpinner: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  content: {
    gap: spacing.lg,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  historyLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  historyLinkText: {
    color: colors.textSecondary,
  },
  onlineCount: {
    color: EMERALD_300,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statsCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  errorPanel: {
    alignItems: 'center',
    backgroundColor: RED_SURFACE,
    borderColor: RED_BORDER,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorText: {
    color: ROSE_300,
    flex: 1,
  },
  commandList: {
    gap: spacing.lg,
  },
  commandPanel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  commandHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  commandHeaderText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  commandTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  commandBattery: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  stateChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stateChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  commandNote: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  commandNoteText: {
    flex: 1,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  badgeTextSuccess: {
    color: colors.success,
  },
  badgeTextNeutral: {
    color: colors.textMuted,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    opacity: 0.6,
  },
  emptyMessage: {
    textAlign: 'center',
  },
});

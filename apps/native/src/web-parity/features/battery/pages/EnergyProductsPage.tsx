/**
 * Native parity port of web/src/features/battery/pages/EnergyProductsPage.tsx.
 *
 * The web page is the "Energy Products" surface that discovers Tesla Powerwalls,
 * Solar installations, and Wall Connectors from the Fleet API: a PageContainer
 * header with a "Refresh from Tesla" action, four summary StatCards (energy
 * sites / with-solar / with-battery / backup-capable), and a 2-up grid of
 * EnergySiteCards. Each site card has a header (resource icon + name + type +
 * battery-type badge), a 3-up stats row (charge / capacity / type), a row of
 * capability badges (solar / battery / grid / backup / storm-watch + an active
 * storm chip), an embedded SiteInfoSection, and a "last fetched" footer. The
 * SiteInfoSection lazily loads `/tesla/energy-sites/{id}/site-info`, showing the
 * operation mode, a backup-reserve RadialGauge, battery-count / rated-power /
 * rated-energy StatCards, firmware + timezone, component badges, a Time-of-Use
 * rate-plan tile (opening the TOUSettingsModal), and a fetched timestamp — or an
 * Info EmptyState when nothing is loaded yet. It reads the four canonical
 * TanStack Query hooks (useTeslaEnergySites / useRefreshTeslaEnergySites /
 * useTeslaEnergySiteInfo / useRefreshTeslaEnergySiteInfo) and the TOU mutation
 * (useUpdateTOUSettings) against the exact `/tesla/energy-sites*` paths.
 *
 * This native port preserves that contract 1:1 — the same four queries + TOU
 * mutation and exact API paths (via the already-ported native hooks), the
 * verbatim fmtEnergy / fmtPower / resourceLabel / operationModeLabel helpers, the
 * `touModalOpen` / `selectedPreset` / `customJSON` / `activeTab` / `error` state
 * names, the same summary rollups (`sites.length`, `sites.filter(...).length`),
 * the same null-safe value strings, the convoluted `tariffName` precedence, every
 * section, badge, and empty state — using React Native primitives, the existing
 * native AppText / GlassPanel + design tokens, the already-ported web-parity
 * MetricCard (the StatCard analog) and the native-safe charts-barrel RadialGauge.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L1): no native i18next runtime, so an
 *     inline native-safe `useNativeTranslation()` returns `t(key, fallback?) =
 *     fallback ?? key`, preserving every i18n key + English default verbatim.
 *   - lucide-react Sun/Battery/Zap/Grid3x3/RefreshCw/Shield/CloudLightning/Gauge/
 *     Activity/Settings/Cpu/Info/Clock + the modal's FileJson (web L3-6):
 *     DOM SVG icons → semantic unicode glyph constants (the DrivingPerformance
 *     Cards / TeslaRegionPage icon→glyph precedent), passed as MetricCard/Badge/
 *     Button string glyphs. `resourceIcon` (which returned a component) becomes
 *     `resourceGlyph` returning the glyph string.
 *   - `@/components/layout` PageContainer/Grid (web L8): no native parity port
 *     yet, so minimal native-safe PageContainer (ScrollView scaffold gating
 *     children behind a loading spinner / error box, exactly as the web gates
 *     children behind <Spinner>) + Grid (a wrapped flex grid using the `default`
 *     column count, the MileagePage precedent) are reproduced locally.
 *   - `@/components/ui` GlassPanel/Badge/Button (web L9): native GlassPanel is the
 *     existing port; Badge (success/neutral/info/warning pill) + Button (primary/
 *     ghost, sm size, loading spinner, optional leading glyph) are reproduced
 *     locally as native-safe equivalents (the TeslaRegionPage Button precedent).
 *   - `@/components/data-display` StatCard (web L10): the web StatCard (label/
 *     value/icon tile) maps onto the already-ported web-parity MetricCard, the
 *     canonical native metric tile; the lucide icon becomes the MetricCard string
 *     glyph + a neon `color` tint.
 *   - `@/components/feedback` EmptyState/Skeleton (web L11): native-safe local
 *     EmptyState (icon?/message) + Skeleton (static placeholder block; the web
 *     animate-pulse is visual-only, dropped).
 *   - `@/components/motion` FadeIn/StaggerContainer/StaggerItem (web L12):
 *     framer-motion entrance/stagger has no native equivalent here → static
 *     passthrough Views (the Layout framer-motion → static precedent); `delay` is
 *     accepted but inert.
 *   - `@/components/charts` RadialGauge (web L13): imported from the native-safe
 *     web-parity charts barrel (Recharts/SVG has no RN backend; the barrel gauge
 *     approximates the arc with positioned Views). Same value/max/size/label props.
 *   - `@/hooks/usePageTitle` (web L15): `document.title` is browser-only → a
 *     documented no-op (the native navigator owns the title).
 *   - `@/lib/numberFormat` fmtNumber (web L16) + `@/lib/dateFormat` formatDateTime
 *     (web L17): ported verbatim into native-safe helpers (safeNumber guard +
 *     toLocaleString at the web default precision; ISO → localized date-time,
 *     nullish/invalid → "—").
 *   - `@/api/hooks/useEnergy` useTeslaEnergySites/useRefreshTeslaEnergySites/
 *     useTeslaEnergySiteInfo/useRefreshTeslaEnergySiteInfo (web L19-24) +
 *     useUpdateTOUSettings (modal): the already-ported native hooks, same
 *     `/tesla/energy-sites*` paths + response shapes.
 *   - `@/types/energy` TeslaEnergySite/TeslaEnergySiteInfo + the modal's
 *     TOUSettingsPayload/TOUPreset (web L26): re-exported by the native useEnergy
 *     hook module; imported from there.
 *   - `../components/TOUSettingsModal` (web L27): the shared TOU editor has no
 *     native parity port yet (its own future conversion target), so it is
 *     reproduced locally as a native-safe `TOUSettingsModal` — the verbatim
 *     PRESETS tariffs + presetOptions/tabs/getPayload/handleSubmit/handleClose
 *     logic wired to the native useUpdateTOUSettings/useRefreshTeslaEnergySiteInfo
 *     hooks, with the web Modal/Tabs/Select/Textarea/Button reduced to an RN
 *     <Modal> + Pressable tab switcher + Pressable preset list + multiline
 *     <TextInput> + local Button. The lucide Clock/FileJson/Zap icons become
 *     decorative glyphs.
 */
import React, {useMemo, useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type DimensionValue,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {RadialGauge} from '../../../components/charts';
import {MetricCard, type NeonColor} from '../../../components/data-display/MetricCard';
import {
  useRefreshTeslaEnergySiteInfo,
  useRefreshTeslaEnergySites,
  useTeslaEnergySiteInfo,
  useTeslaEnergySites,
  useUpdateTOUSettings,
  type TeslaEnergySite,
  type TeslaEnergySiteInfo,
  type TOUPreset,
  type TOUSettingsPayload,
} from '../../../api/hooks/useEnergy';

/* ------------------------------------------------------------------ */
/*  lucide-react icon stand-ins (web L3-6)                             */
/* ------------------------------------------------------------------ */

const ICON_SUN = '\u2600\uFE0F'; // ☀️ (Sun)
const ICON_BATTERY = '\uD83D\uDD0B'; // 🔋 (Battery)
const ICON_ZAP = '\u26A1'; // ⚡ (Zap)
const ICON_GRID = '\u25A6'; // ▦ (Grid3x3)
const ICON_REFRESH = '\u21BB'; // ↻ (RefreshCw)
const ICON_SHIELD = '\uD83D\uDEE1\uFE0F'; // 🛡️ (Shield)
const ICON_STORM = '\u26C8\uFE0F'; // ⛈️ (CloudLightning)
const ICON_GAUGE = '\uD83D\uDCCF'; // 📏 (Gauge)
const ICON_ACTIVITY = '\uD83D\uDCC8'; // 📈 (Activity)
const ICON_SETTINGS = '\u2699\uFE0F'; // ⚙️ (Settings)
const ICON_CPU = '\uD83E\uDDE9'; // 🧩 (Cpu)
const ICON_INFO = '\u24D8'; // ⓘ (Info)
const ICON_CLOCK = '\uD83D\uDD52'; // 🕒 (Clock)
const ICON_FILE_JSON = '\uD83D\uDCC4'; // 📄 (FileJson)

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L1)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  native-safe usePageTitle (web document.title is browser-only)      */
/* ------------------------------------------------------------------ */

function usePageTitle(_title: string): void {
  // The web hook writes document.title; on native the navigator owns the header
  // title, so the resolved title is intentionally not applied.
}

/* ------------------------------------------------------------------ */
/*  native-safe number/date formatters (web @/lib/numberFormat,        */
/*  @/lib/dateFormat)                                                  */
/* ------------------------------------------------------------------ */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Port of web fmtNumber — locale-aware separators at the web default precision. */
function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

/** Port of web formatDateTime — "Apr 4, 2026, 2:30 AM"; nullish/invalid → "—". */
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/*  Helpers (web L29-60)                                               */
/* ------------------------------------------------------------------ */

function fmtEnergy(wh: number | null | undefined): string {
  if (wh == null) {
    return '\u2014';
  }
  if (wh >= 1000) {
    return `${fmtNumber(wh / 1000, 1)} kWh`;
  }
  return `${fmtNumber(wh, 0)} Wh`;
}

function fmtPower(w: number | null | undefined): string {
  if (w == null) {
    return '\u2014';
  }
  if (w >= 1000) {
    return `${fmtNumber(w / 1000, 1)} kW`;
  }
  return `${fmtNumber(w, 0)} W`;
}

function resourceGlyph(type: string): string {
  if (type === 'battery') {
    return ICON_BATTERY;
  }
  if (type === 'solar') {
    return ICON_SUN;
  }
  return ICON_ZAP;
}

function resourceLabel(type: string): string {
  if (type === 'battery') {
    return 'Powerwall';
  }
  if (type === 'solar') {
    return 'Solar';
  }
  return type;
}

function operationModeLabel(mode: string | undefined): string {
  if (mode === 'self_consumption') {
    return 'Self-Powered';
  }
  if (mode === 'autonomous') {
    return 'Time-Based Control';
  }
  if (mode === 'backup') {
    return 'Backup Only';
  }
  return mode ?? '\u2014';
}

/* ------------------------------------------------------------------ */
/*  native Badge (web @/components/ui Badge)                           */
/* ------------------------------------------------------------------ */

type BadgeVariant = 'success' | 'neutral' | 'info' | 'warning';

const BADGE_VARIANT: Record<
  BadgeVariant,
  {bg: string; border: string; text: string}
> = {
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
  info: {bg: colors.accentSoft, border: colors.borderAccent, text: colors.accent},
  warning: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    text: colors.warning,
  },
};

interface BadgeProps {
  variant?: BadgeVariant;
  icon?: string;
  children: string;
  testID?: string;
}

function Badge({variant = 'neutral', icon, children, testID}: BadgeProps) {
  const v = BADGE_VARIANT[variant];
  return (
    <View
      style={[styles.badge, {backgroundColor: v.bg, borderColor: v.border}]}
      testID={testID}>
      {icon ? (
        <AppText style={[styles.badgeGlyph, {color: v.text}]}>{icon}</AppText>
      ) : null}
      <AppText style={[styles.badgeText, {color: v.text}]}>{children}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native Button (web @/components/ui Button)                         */
/* ------------------------------------------------------------------ */

interface ButtonProps {
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  size?: 'sm' | 'md';
  loading?: boolean;
  disabled?: boolean;
  icon?: string;
  children?: string;
  accessibilityLabel?: string;
  testID?: string;
}

function Button({
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  children,
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const isGhost = variant === 'ghost';
  const tint = isGhost ? colors.textPrimary : colors.background;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{disabled: disabled || loading}}
      disabled={disabled || loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        size === 'sm' ? styles.buttonSm : styles.buttonMd,
        isGhost ? styles.buttonGhost : styles.buttonPrimary,
        (disabled || loading) && styles.buttonDisabled,
        pressed && !disabled && !loading && styles.buttonPressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={tint} size="small" />
      ) : icon ? (
        <AppText style={[styles.buttonGlyph, {color: tint}]}>{icon}</AppText>
      ) : null}
      {children ? (
        <AppText style={[styles.buttonText, {color: tint}]} weight="semibold">
          {children}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: string;
  message: string;
  testID?: string;
}

function EmptyState({icon, message, testID}: EmptyStateProps) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon ? (
        <AppText style={styles.emptyStateIcon} tone="muted">
          {icon}
        </AppText>
      ) : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native Skeleton (web @/components/feedback Skeleton)                */
/* ------------------------------------------------------------------ */

function Skeleton({height = 16}: {height?: number}) {
  return <View style={[styles.skeleton, {height}]} />;
}

/* ------------------------------------------------------------------ */
/*  native motion shims (web @/components/motion FadeIn/Stagger*)       */
/* ------------------------------------------------------------------ */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

function StaggerContainer({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

function StaggerItem({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  native StatCard (web @/components/data-display StatCard → MetricCard) */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  color?: NeonColor;
  testID?: string;
}

function StatCard({label, value, icon, color = 'cyan', testID}: StatCardProps) {
  return (
    <MetricCard
      color={color}
      icon={icon}
      label={label}
      testID={testID}
      value={value}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  native Grid (web @/components/layout Grid)                          */
/* ------------------------------------------------------------------ */

interface GridProps {
  cols?: {default?: number; md?: number; lg?: number};
  gap?: number;
  children: ReactNode;
}

function Grid({cols, gap = 4, children}: GridProps) {
  // Native phone is single-column; lay out using the web `default` count.
  const count = cols?.default ?? 1;
  const gapPx = gap * 4;
  const basisPct = count <= 1 ? 100 : 100 / count - 2;
  const basis = `${basisPct}%` as DimensionValue;
  const items = React.Children.toArray(children);
  return (
    <View style={[styles.grid, {columnGap: gapPx, rowGap: gapPx}]}>
      {items.map((child, i) => (
        <View key={i} style={[styles.gridCell, {flexBasis: basis}]}>
          {child}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native PageContainer (web @/components/layout PageContainer)        */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  actions?: ReactNode;
  children: ReactNode;
  testID?: string;
}

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  actions,
  children,
  testID,
}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'energy-products-page'}>
      <View style={styles.scaffoldHeader}>
        <View style={styles.scaffoldHeaderText}>
          <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.scaffoldSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.scaffoldActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.loading} testID="energy-products-loading">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox} testID="energy-products-error">
          <AppText style={styles.errorText} variant="caption">
            {error.message}
          </AppText>
        </View>
      ) : (
        <View style={styles.scaffoldBody}>{children}</View>
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  Capability Badge (web L62-77)                                      */
/* ------------------------------------------------------------------ */

interface CapBadgeProps {
  active: boolean;
  label: string;
  icon: string;
}

function CapBadge({active, label, icon}: CapBadgeProps) {
  return (
    <Badge icon={icon} variant={active ? 'success' : 'neutral'}>
      {label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Preset Tariffs (web TOUSettingsModal L12-125)                      */
/* ------------------------------------------------------------------ */

const PRESETS: TOUPreset[] = [
  {
    id: 'pge-ev2a',
    name: 'PG&E EV2-A',
    utility: 'Pacific Gas & Electric',
    settings: {
      tou_settings: {
        optimization_strategy: 'economics',
        tariff_content_v2: {
          name: 'PG&E EV2-A',
          utility: 'Pacific Gas & Electric',
          daily_charges: [{amount: 0.32854, name: 'Charge'}],
          demand_charges: {ALL: {ALL: 0}},
          energy_charges: {
            Summer: {
              ON_PEAK: [{rate: 0.49, start: 16, end: 21}],
              OFF_PEAK: [
                {rate: 0.35, start: 0, end: 16},
                {rate: 0.35, start: 21, end: 24},
              ],
            },
            Winter: {
              ON_PEAK: [{rate: 0.42, start: 16, end: 21}],
              OFF_PEAK: [
                {rate: 0.36, start: 0, end: 16},
                {rate: 0.36, start: 21, end: 24},
              ],
            },
          },
          seasons: {
            Summer: {fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30},
            Winter: {fromMonth: 10, fromDay: 1, toMonth: 5, toDay: 31},
          },
        },
      },
    },
  },
  {
    id: 'sce-tou-d',
    name: 'SCE TOU-D',
    utility: 'Southern California Edison',
    settings: {
      tou_settings: {
        optimization_strategy: 'economics',
        tariff_content_v2: {
          name: 'SCE TOU-D',
          utility: 'Southern California Edison',
          daily_charges: [{amount: 0.031, name: 'Charge'}],
          demand_charges: {ALL: {ALL: 0}},
          energy_charges: {
            Summer: {
              ON_PEAK: [{rate: 0.54, start: 16, end: 21}],
              MID_PEAK: [
                {rate: 0.41, start: 8, end: 16},
                {rate: 0.41, start: 21, end: 23},
              ],
              OFF_PEAK: [
                {rate: 0.28, start: 0, end: 8},
                {rate: 0.28, start: 23, end: 24},
              ],
            },
            Winter: {
              MID_PEAK: [{rate: 0.43, start: 8, end: 21}],
              SUPER_OFF_PEAK: [
                {rate: 0.28, start: 0, end: 8},
                {rate: 0.28, start: 21, end: 24},
              ],
            },
          },
          seasons: {
            Summer: {fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30},
            Winter: {fromMonth: 10, fromDay: 1, toMonth: 5, toDay: 31},
          },
        },
      },
    },
  },
  {
    id: 'sdge-tou-dr1',
    name: 'SDG&E TOU-DR1',
    utility: 'San Diego Gas & Electric',
    settings: {
      tou_settings: {
        optimization_strategy: 'economics',
        tariff_content_v2: {
          name: 'SDG&E TOU-DR1',
          utility: 'San Diego Gas & Electric',
          daily_charges: [{amount: 0.546, name: 'Charge'}],
          demand_charges: {ALL: {ALL: 0}},
          energy_charges: {
            Summer: {
              ON_PEAK: [{rate: 0.71, start: 16, end: 21}],
              OFF_PEAK: [
                {rate: 0.45, start: 0, end: 16},
                {rate: 0.45, start: 21, end: 24},
              ],
            },
            Winter: {
              ON_PEAK: [{rate: 0.57, start: 16, end: 21}],
              OFF_PEAK: [
                {rate: 0.45, start: 0, end: 16},
                {rate: 0.45, start: 21, end: 24},
              ],
            },
          },
          seasons: {
            Summer: {fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30},
            Winter: {fromMonth: 10, fromDay: 1, toMonth: 5, toDay: 31},
          },
        },
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/*  TOU Settings Modal (web ../components/TOUSettingsModal)            */
/* ------------------------------------------------------------------ */

interface TOUSettingsModalProps {
  open: boolean;
  onClose: () => void;
  siteId: number;
}

function TOUSettingsModal({open, onClose, siteId}: TOUSettingsModalProps) {
  const {t} = useNativeTranslationObj();
  const updateMutation = useUpdateTOUSettings();
  const refreshSiteInfo = useRefreshTeslaEnergySiteInfo();

  const [activeTab, setActiveTab] = useState<string>('preset');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [customJSON, setCustomJSON] = useState('');
  const [error, setError] = useState('');

  const presetOptions = useMemo(
    () => PRESETS.map(p => ({value: p.id, label: `${p.name} — ${p.utility}`})),
    [],
  );

  const tabs = useMemo(
    () => [
      {key: 'preset', label: t('energy.tou.tabPreset', 'Preset Tariff')},
      {key: 'custom', label: t('energy.tou.tabCustom', 'Custom JSON')},
    ],
    [t],
  );

  function getPayload(): TOUSettingsPayload | null {
    setError('');

    if (activeTab === 'preset') {
      const preset = PRESETS.find(p => p.id === selectedPreset);
      if (!preset) {
        setError(t('energy.tou.errorNoPreset', 'Please select a rate plan'));
        return null;
      }
      return preset.settings;
    }

    // Custom JSON mode
    const trimmed = customJSON.trim();
    if (!trimmed) {
      setError(t('energy.tou.errorEmptyJSON', 'Please enter the TOU settings JSON'));
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError(t('energy.tou.errorNotObject', 'JSON must be an object'));
        return null;
      }
      const obj = parsed as Record<string, unknown>;
      // Allow either the full envelope or just the inner tou_settings object
      if ('tou_settings' in obj) {
        return obj as unknown as TOUSettingsPayload;
      }
      return {tou_settings: obj};
    } catch {
      setError(t('energy.tou.errorInvalidJSON', 'Invalid JSON — please check syntax'));
      return null;
    }
  }

  function handleSubmit() {
    const payload = getPayload();
    if (!payload) {
      return;
    }

    updateMutation.mutate(
      {siteId, settings: payload},
      {
        onSuccess: () => {
          // Refresh site info from Tesla so the UI shows updated tariff data
          refreshSiteInfo.mutate(siteId);
          onClose();
        },
        onError: err => {
          setError(String(err instanceof Error ? err.message : err));
        },
      },
    );
  }

  function handleClose() {
    if (!updateMutation.isPending) {
      setError('');
      onClose();
    }
  }

  const selectedPresetData = PRESETS.find(p => p.id === selectedPreset);

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleClose}
      transparent
      visible={open}>
      <Pressable onPress={handleClose} style={styles.modalBackdrop}>
        <Pressable
          onPress={() => undefined}
          style={styles.modalCard}
          testID="tou-settings-modal">
          <AppText style={styles.modalTitle} variant="title" weight="bold">
            {t('energy.tou.title', 'Update Rate Plan')}
          </AppText>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <AppText style={styles.modalDesc} tone="secondary" variant="caption">
              {t(
                'energy.tou.description',
                'Configure your utility rate plan so the Powerwall can optimize charging and discharging based on electricity pricing.',
              )}
            </AppText>

            <View style={styles.tabsRow}>
              {tabs.map(tab => {
                const tabActive = activeTab === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => setActiveTab(tab.key)}
                    style={[styles.tab, tabActive && styles.tabActive]}>
                    <AppText
                      style={[
                        styles.tabText,
                        tabActive ? styles.tabTextActive : undefined,
                      ]}
                      variant="caption"
                      weight="semibold">
                      {tab.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            {activeTab === 'preset' ? (
              <View style={styles.modalSection}>
                <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
                  {t('energy.tou.selectPlan', 'Rate Plan')}
                </AppText>
                <View style={styles.selectList}>
                  {presetOptions.map(opt => {
                    const optActive = selectedPreset === opt.value;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => setSelectedPreset(opt.value)}
                        style={[
                          styles.selectOption,
                          optActive && styles.selectOptionActive,
                        ]}>
                        <AppText
                          style={optActive ? styles.selectOptionTextActive : undefined}
                          variant="caption">
                          {opt.label}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
                {selectedPreset ? (
                  <View style={styles.previewBox}>
                    <AppText
                      style={styles.previewLabel}
                      tone="secondary"
                      variant="caption">
                      {t('energy.tou.previewLabel', 'Preview')}
                    </AppText>
                    <ScrollView style={styles.previewScroll}>
                      <AppText style={styles.previewText} variant="caption">
                        {JSON.stringify(selectedPresetData?.settings, null, 2)}
                      </AppText>
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.modalSection}>
                <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
                  {t('energy.tou.customLabel', 'TOU Settings JSON')}
                </AppText>
                <TextInput
                  multiline
                  onChangeText={setCustomJSON}
                  placeholder={
                    '{\n  "tou_settings": {\n    "optimization_strategy": "economics",\n    "tariff_content_v2": { ... }\n  }\n}'
                  }
                  placeholderTextColor={colors.textMuted}
                  style={styles.textarea}
                  value={customJSON}
                />
                <View style={styles.hintRow}>
                  <AppText style={styles.hintGlyph} tone="muted" variant="caption">
                    {ICON_FILE_JSON}
                  </AppText>
                  <AppText style={styles.hintText} tone="muted" variant="caption">
                    {t(
                      'energy.tou.customHint',
                      'Paste the full tou_settings payload or just the inner object. See Tesla Fleet API docs for the schema.',
                    )}
                  </AppText>
                </View>
              </View>
            )}

            {error ? (
              <View style={styles.errorRow}>
                <AppText style={styles.errorGlyph} variant="caption">
                  {ICON_ZAP}
                </AppText>
                <AppText style={styles.errorMsg} variant="caption">
                  {error}
                </AppText>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.modalFooter}>
            <Button
              disabled={updateMutation.isPending}
              onPress={handleClose}
              variant="ghost">
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={updateMutation.isPending}
              icon={ICON_CLOCK}
              loading={updateMutation.isPending}
              onPress={handleSubmit}>
              {t('energy.tou.submit', 'Update Rate Plan')}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Small object wrapper so the modal can destructure `{ t }` like the web. */
function useNativeTranslationObj(): {t: NativeTFunction} {
  const t = useNativeTranslation();
  return useMemo(() => ({t}), [t]);
}

/* ------------------------------------------------------------------ */
/*  Site Info Section (web L79-254)                                    */
/* ------------------------------------------------------------------ */

function SiteInfoSection({
  siteId,
  touCapable,
}: {
  siteId: number;
  touCapable: boolean;
}) {
  const t = useNativeTranslation();
  const {data: response, isLoading} = useTeslaEnergySiteInfo(siteId);
  const refreshMutation = useRefreshTeslaEnergySiteInfo();
  const [touModalOpen, setTouModalOpen] = useState(false);

  const info: TeslaEnergySiteInfo | null = response?.data ?? null;

  // Extract current tariff name from site_info if available. The web expression
  // mixes `??` and `?:`, so it parses as `(A ?? (B != null)) ? C : undefined` —
  // preserved verbatim (explicit parens added for the same precedence).
  const tariffName =
    (((info?.tariff_content_v2 as Record<string, unknown> | undefined)?.name as
      | string
      | undefined) ??
    ((info?.tou_settings as Record<string, unknown> | undefined)
      ?.tariff_content_v2 != null))
      ? (((info?.tou_settings as Record<string, unknown>)
          ?.tariff_content_v2 as Record<string, unknown> | undefined)?.name as
          | string
          | undefined)
      : undefined;

  if (isLoading) {
    return (
      <View style={styles.siteInfoSkeleton}>
        <Skeleton height={128} />
      </View>
    );
  }

  return (
    <View style={styles.siteInfoSection}>
      <View style={styles.siteInfoHeader}>
        <View style={styles.siteInfoHeading}>
          <AppText style={styles.siteInfoHeadingGlyph} tone="secondary">
            {ICON_SETTINGS}
          </AppText>
          <AppText style={styles.siteInfoHeadingText} tone="secondary" weight="semibold">
            {t('energy.siteInfo.title', 'Site Configuration')}
          </AppText>
        </View>
        <Button
          accessibilityLabel={t('energy.siteInfo.refresh', 'Refresh site info')}
          disabled={refreshMutation.isPending}
          icon={ICON_REFRESH}
          loading={refreshMutation.isPending}
          onPress={() => refreshMutation.mutate(siteId)}
          size="sm"
          testID="energy-site-info-refresh"
          variant="ghost"
        />
      </View>

      {info ? (
        <View style={styles.siteInfoBody}>
          {/* Operation mode + backup reserve */}
          <View style={styles.infoGrid2}>
            <View style={styles.infoTile}>
              <AppText style={styles.infoTileLabel} tone="muted" variant="caption">
                {t('energy.siteInfo.operationMode', 'Operation Mode')}
              </AppText>
              <AppText style={styles.infoTileValue} weight="semibold">
                {operationModeLabel(info.default_real_mode)}
              </AppText>
            </View>
            <View style={styles.infoTile}>
              <AppText style={styles.infoTileLabel} tone="muted" variant="caption">
                {t('energy.siteInfo.backupReserve', 'Backup Reserve')}
              </AppText>
              {info.backup_reserve_percent != null ? (
                <View style={styles.backupRow}>
                  <RadialGauge
                    label=""
                    max={100}
                    size={32}
                    value={info.backup_reserve_percent}
                  />
                  <AppText style={styles.infoTileValue} weight="semibold">
                    {fmtNumber(info.backup_reserve_percent, 0)}%
                  </AppText>
                </View>
              ) : (
                <AppText style={styles.infoTileValue} tone="muted">
                  {'\u2014'}
                </AppText>
              )}
            </View>
          </View>

          {/* Battery count + capacity */}
          <Grid cols={{default: 2, md: 3}} gap={3}>
            {info.battery_count != null ? (
              <StatCard
                color="green"
                icon={ICON_BATTERY}
                label={t('energy.siteInfo.batteryCount', 'Powerwalls')}
                value={info.battery_count}
              />
            ) : null}
            {info.nameplate_power != null ? (
              <StatCard
                color="cyan"
                icon={ICON_ZAP}
                label={t('energy.siteInfo.ratedPower', 'Rated Power')}
                value={fmtPower(info.nameplate_power)}
              />
            ) : null}
            {info.nameplate_energy != null ? (
              <StatCard
                color="purple"
                icon={ICON_GAUGE}
                label={t('energy.siteInfo.ratedEnergy', 'Rated Energy')}
                value={fmtEnergy(info.nameplate_energy)}
              />
            ) : null}
          </Grid>

          {/* Firmware + timezone */}
          <View style={styles.firmwareRow}>
            {info.version ? (
              <View style={styles.firmwareItem}>
                <AppText style={styles.firmwareGlyph} tone="muted" variant="caption">
                  {ICON_CPU}
                </AppText>
                <AppText tone="muted" variant="caption">
                  {t('energy.siteInfo.firmware', 'Firmware')}: {info.version}
                </AppText>
              </View>
            ) : null}
            {info.installation_time_zone ? (
              <AppText tone="muted" variant="caption">
                · {info.installation_time_zone}
              </AppText>
            ) : null}
          </View>

          {/* Component badges from site_info (may differ from /products) */}
          {info.components ? (
            <View style={styles.componentBadges}>
              {Object.entries(info.components).map(([key, val]) =>
                typeof val === 'boolean' ? (
                  <Badge key={key} variant={val ? 'success' : 'neutral'}>
                    {key.replace(/_/g, ' ')}
                  </Badge>
                ) : null,
              )}
            </View>
          ) : null}

          {/* Time-of-Use Rate Plan */}
          {touCapable || info.components?.tou_capable ? (
            <View style={styles.touTile}>
              <View style={styles.touTileRow}>
                <View style={styles.touTileMain}>
                  <View style={styles.touTileLabelRow}>
                    <AppText style={styles.touTileGlyph} tone="muted" variant="caption">
                      {ICON_CLOCK}
                    </AppText>
                    <AppText style={styles.touTileLabel} tone="muted" variant="caption">
                      {t('energy.tou.sectionTitle', 'Rate Plan')}
                    </AppText>
                  </View>
                  <AppText style={styles.touTileValue} weight="semibold">
                    {tariffName ?? t('energy.tou.noPlan', 'No rate plan configured')}
                  </AppText>
                </View>
                <Button
                  accessibilityLabel={t('energy.tou.editPlan', 'Update rate plan')}
                  onPress={() => setTouModalOpen(true)}
                  size="sm"
                  testID="tou-update-button"
                  variant="ghost">
                  {t('energy.tou.updateButton', 'Update')}
                </Button>
              </View>
            </View>
          ) : null}

          {/* Fetched timestamp */}
          {response?.fetched_at ? (
            <AppText style={styles.fetchedText} tone="muted" variant="caption">
              {t('energy.siteInfo.lastFetched', 'Site info fetched')}:{' '}
              {formatDateTime(response.fetched_at)}
            </AppText>
          ) : null}
        </View>
      ) : (
        <View style={styles.siteInfoEmptyBox}>
          {/* no-action: transient empty state — surfaces when source data is
              missing; no specific recovery action available */}
          <EmptyState
            icon={ICON_INFO}
            message={t(
              'energy.siteInfo.empty',
              'No site configuration loaded yet. Click refresh to fetch from Tesla.',
            )}
            testID="energy-site-info-empty"
          />
        </View>
      )}

      <TOUSettingsModal
        onClose={() => setTouModalOpen(false)}
        open={touModalOpen}
        siteId={siteId}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Site Card (web L256-327)                                           */
/* ------------------------------------------------------------------ */

function EnergySiteCard({site}: {site: TeslaEnergySite}) {
  const t = useNativeTranslation();
  const glyph = resourceGlyph(site.resource_type);

  return (
    <GlassPanel style={styles.glassCard} testID={`energy-site-card-${site.id}`}>
      {/* Header */}
      <View style={styles.siteHeader}>
        <View style={styles.siteHeaderLeft}>
          <View style={styles.siteIconBox}>
            <AppText style={styles.siteIconGlyph}>{glyph}</AppText>
          </View>
          <View style={styles.siteHeaderText}>
            <AppText style={styles.siteName} weight="semibold">
              {site.site_name || t('energy.products.unnamed', 'Unnamed Site')}
            </AppText>
            <AppText style={styles.siteMeta} tone="muted" variant="caption">
              {resourceLabel(site.resource_type)} · ID {site.energy_site_id}
            </AppText>
          </View>
        </View>
        {site.battery_type ? <Badge variant="info">{site.battery_type}</Badge> : null}
      </View>

      {/* Stats row */}
      <Grid cols={{default: 2, md: 3}} gap={3}>
        <StatCard
          color="cyan"
          icon={ICON_GAUGE}
          label={t('energy.products.charge', 'Charge')}
          value={
            site.percentage_charged != null
              ? `${fmtNumber(site.percentage_charged, 1)}%`
              : '\u2014'
          }
        />
        <StatCard
          color="green"
          icon={ICON_BATTERY}
          label={t('energy.products.capacity', 'Capacity')}
          value={fmtEnergy(site.total_pack_energy)}
        />
        <StatCard
          color="purple"
          icon={ICON_ACTIVITY}
          label={t('energy.products.type', 'Type')}
          value={resourceLabel(site.resource_type)}
        />
      </Grid>

      {/* Capability badges */}
      <View style={styles.capRow}>
        <CapBadge
          active={site.has_solar}
          icon={ICON_SUN}
          label={t('energy.products.solar', 'Solar')}
        />
        <CapBadge
          active={site.has_battery}
          icon={ICON_BATTERY}
          label={t('energy.products.battery', 'Battery')}
        />
        <CapBadge
          active={site.has_grid}
          icon={ICON_GRID}
          label={t('energy.products.grid', 'Grid')}
        />
        <CapBadge
          active={site.backup_capable}
          icon={ICON_SHIELD}
          label={t('energy.products.backup', 'Backup')}
        />
        <CapBadge
          active={site.storm_mode_capable}
          icon={ICON_STORM}
          label={t('energy.products.stormWatch', 'Storm Watch')}
        />
        {site.storm_mode_enabled ? (
          <Badge icon={ICON_STORM} variant="warning">
            {t('energy.products.stormActive', 'Storm Mode Active')}
          </Badge>
        ) : null}
      </View>

      {/* Site Info section */}
      <SiteInfoSection siteId={site.energy_site_id} touCapable={site.tou_capable} />

      {/* Footer */}
      <AppText style={styles.footerText} tone="muted" variant="caption">
        {t('energy.products.lastFetched', 'Last fetched')}:{' '}
        {formatDateTime(site.fetched_at)}
      </AppText>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Page (web L329-418)                                                */
/* ------------------------------------------------------------------ */

export default function EnergyProductsPage() {
  const t = useNativeTranslation();
  usePageTitle(t('energy.products.title', 'Energy Products'));

  const {data, isLoading, error} = useTeslaEnergySites();
  const refreshMutation = useRefreshTeslaEnergySites();

  const sites = data ?? [];

  return (
    <PageContainer
      actions={
        <Button
          accessibilityLabel={t('energy.products.refresh', 'Refresh from Tesla')}
          disabled={refreshMutation.isPending}
          icon={ICON_REFRESH}
          loading={refreshMutation.isPending}
          onPress={() => refreshMutation.mutate()}
          testID="energy-products-refresh">
          {t('energy.products.refresh', 'Refresh from Tesla')}
        </Button>
      }
      error={
        error instanceof Error
          ? error
          : error
          ? new Error(String(error))
          : null
      }
      loading={isLoading}
      subtitle={t(
        'energy.products.subtitle',
        'Powerwalls, Solar Panels & Wall Connectors discovered from Tesla',
      )}
      title={t('energy.products.title', 'Energy Products')}>
      {/* Summary stats */}
      <FadeIn>
        <Grid cols={{default: 2, md: 4}} gap={4}>
          <StatCard
            color="cyan"
            icon={ICON_ZAP}
            label={t('energy.products.totalSites', 'Energy Sites')}
            value={sites.length}
          />
          <StatCard
            color="amber"
            icon={ICON_SUN}
            label={t('energy.products.withSolar', 'With Solar')}
            value={sites.filter(s => s.has_solar).length}
          />
          <StatCard
            color="green"
            icon={ICON_BATTERY}
            label={t('energy.products.withBattery', 'With Battery')}
            value={sites.filter(s => s.has_battery).length}
          />
          <StatCard
            color="blue"
            icon={ICON_SHIELD}
            label={t('energy.products.backupCapable', 'Backup Capable')}
            value={sites.filter(s => s.backup_capable).length}
          />
        </Grid>
      </FadeIn>

      {/* Site cards */}
      <FadeIn delay={0.05}>
        {isLoading ? (
          <Grid cols={{default: 1, lg: 2}} gap={4}>
            {[1, 2].map(i => (
              <GlassPanel key={i} style={styles.glassCard}>
                <Skeleton height={192} />
              </GlassPanel>
            ))}
          </Grid>
        ) : sites.length > 0 ? (
          <StaggerContainer>
            <Grid cols={{default: 1, lg: 2}} gap={4}>
              {sites.map(site => (
                <StaggerItem key={site.id}>
                  <EnergySiteCard site={site} />
                </StaggerItem>
              ))}
            </Grid>
          </StaggerContainer>
        ) : (
          <GlassPanel style={styles.glassCard}>
            {/* no-action: transient empty state — surfaces when source data is
                missing; no specific recovery action available */}
            <EmptyState
              icon={ICON_ZAP}
              message={t(
                'energy.products.empty',
                'No energy products found. Click "Refresh from Tesla" to discover your Powerwalls and Solar installations.',
              )}
              testID="energy-products-empty"
            />
          </GlassPanel>
        )}
      </FadeIn>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  backupRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    columnGap: spacing.xs,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeGlyph: {
    fontSize: 11,
  },
  badgeText: {
    fontSize: typography.caption,
    fontWeight: '600',
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    columnGap: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonGlyph: {
    fontSize: 14,
  },
  buttonMd: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonSm: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buttonText: {
    fontSize: typography.caption,
  },
  capRow: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  componentBadges: {
    columnGap: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyStateIcon: {
    fontSize: 24,
  },
  emptyStateMessage: {
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorGlyph: {
    color: colors.danger,
  },
  errorMsg: {
    color: colors.danger,
    flex: 1,
  },
  errorRow: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  errorText: {
    color: colors.danger,
  },
  fetchedText: {
    marginTop: spacing.xs,
  },
  fieldLabel: {
    marginBottom: spacing.xs,
  },
  firmwareGlyph: {
    fontSize: 11,
  },
  firmwareItem: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  firmwareRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  footerText: {
    marginTop: spacing.xs,
  },
  glassCard: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridCell: {
    flexGrow: 1,
    minWidth: 0,
  },
  hintGlyph: {
    fontSize: 11,
  },
  hintRow: {
    alignItems: 'flex-start',
    columnGap: spacing.xs,
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  hintText: {
    flex: 1,
  },
  infoGrid2: {
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  infoTile: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md,
  },
  infoTileLabel: {
    marginBottom: spacing.xs,
  },
  infoTileValue: {
    color: colors.textPrimary,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalBody: {
    gap: spacing.md,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: spacing.md,
    maxHeight: '86%',
    maxWidth: 560,
    padding: spacing.lg,
    width: '100%',
  },
  modalDesc: {
    lineHeight: 18,
  },
  modalFooter: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalSection: {
    gap: spacing.sm,
  },
  modalTitle: {
    color: colors.textPrimary,
  },
  previewBox: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  previewLabel: {
    marginBottom: spacing.xs,
  },
  previewScroll: {
    maxHeight: 180,
  },
  previewText: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
  },
  scaffold: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  scaffoldActions: {
    flexShrink: 0,
  },
  scaffoldBody: {
    gap: spacing.lg,
  },
  scaffoldHeader: {
    alignItems: 'flex-start',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  scaffoldHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  scaffoldSubtitle: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  scaffoldTitle: {
    letterSpacing: -0.5,
  },
  selectList: {
    gap: spacing.xs,
  },
  selectOption: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectOptionActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  selectOptionTextActive: {
    color: colors.accent,
  },
  siteHeader: {
    alignItems: 'flex-start',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  siteHeaderLeft: {
    alignItems: 'center',
    columnGap: spacing.md,
    flex: 1,
    flexDirection: 'row',
    minWidth: 0,
  },
  siteHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  siteIconBox: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  siteIconGlyph: {
    color: colors.accent,
    fontSize: 18,
  },
  siteInfoBody: {
    gap: spacing.md,
  },
  siteInfoEmptyBox: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  siteInfoHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  siteInfoHeading: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  siteInfoHeadingGlyph: {
    fontSize: 13,
  },
  siteInfoHeadingText: {
    fontSize: typography.caption,
  },
  siteInfoSection: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  siteInfoSkeleton: {
    marginTop: spacing.md,
  },
  siteMeta: {
    marginTop: 2,
  },
  siteName: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    width: '100%',
  },
  tab: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 2,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  tabActive: {
    borderBottomColor: colors.accent,
  },
  tabText: {
    color: colors.textMuted,
  },
  tabTextActive: {
    color: colors.textPrimary,
  },
  tabsRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  textarea: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: typography.caption,
    minHeight: 180,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  touTile: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  touTileGlyph: {
    fontSize: 11,
  },
  touTileLabel: {
    marginBottom: 0,
  },
  touTileLabelRow: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
    marginBottom: 2,
  },
  touTileMain: {
    flex: 1,
    minWidth: 0,
  },
  touTileRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  touTileValue: {
    color: colors.textPrimary,
  },
});

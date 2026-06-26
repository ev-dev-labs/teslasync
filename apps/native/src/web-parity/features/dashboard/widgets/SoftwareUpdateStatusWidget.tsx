// Native parity port of web/src/features/dashboard/widgets/SoftwareUpdateStatusWidget.tsx.
//
// `SoftwareUpdateStatusWidget` is a dashboard widget that surfaces the active
// vehicle's Tesla software-update state. It has two layouts driven by
// `size`:
//   - compact (cols <= 1 && rows <= 1): a centred MonitorSmartphone glyph + the
//     current firmware version + a small status Badge.
//   - full: a titled shell whose body is a current-version row (label + version +
//     status Badge) and — when an update exists — a target-version row, the
//     download/install MetricBar progress, a "ready to install" line, plus
//     (in tall layouts) the expected-duration and scheduled-start lines; an
//     "up to date" line is shown when there is no pending update. When there is
//     no vehicle state the shell body is a `No software data` empty state.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3):
//   - `id = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution (L15).
//   - the three query hooks: `useVehicleState(id)` destructured as
//     data:stateData/isLoading:stateLoading/isFetching/isStale/isError/
//     dataUpdatedAt/refetch (L16) and `useVehicleConfigLatest(id, 60_000)`
//     destructured as data:configData/isLoading:configLoading (L17).
//   - `isLoading = stateLoading || configLoading` (L19);
//     `state = stateData?.state` (L20);
//     `currentVersion = state?.software_version ?? '—'` (L21).
//   - the five config reads, each `?? null` (L23-27):
//     updateVersion/downloadPct/installPct/expectedDuration/scheduledStart.
//   - the memoized `updateStatus` state machine (L29-36, verbatim thresholds:
//     no updateVersion -> 'up-to-date'; installPct in (0,100) -> 'installing';
//     downloadPct in (0,100) -> 'downloading'; installPct===100 -> 'installed';
//     downloadPct===100 -> 'ready'; else 'available') with the exact
//     [updateVersion, downloadPct, installPct] deps.
//   - `isCompact = size.cols <= 1 && size.rows <= 1` (L38) and `isTall =
//     size.rows >= 2` (L68).
//   - every `{value || '—'}` fallback (L98/L133) and every conditional branch in
//     FullView (L139/L153/L163/L173/L181/L192/L204) is reproduced verbatim.
//   - the StatusBadgeSmall config map + `?? { variant: 'neutral', label: status }`
//     fallback (L222-231) and every i18n key + English default
//     (widget.softwareUpdate, widget.currentVersion, widget.updateAvailable,
//     widget.downloading, widget.installing, widget.readyToInstall,
//     widget.estimatedTime, widget.minutes, widget.scheduledStart,
//     widget.upToDate, widget.noSoftwareData, and the six status* labels) are
//     kept verbatim. The `software_version` / `software_update_*` field names are
//     read identically through the already-ported web-parity hooks.
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local fallback
//     resolver returning the inline English string (same shim shape as the
//     Motor/AnomalyDetector widget ports); the namespace arg is accepted +
//     ignored. This widget needs no `{{var}}` interpolation.
//   - lucide-react `Download` / `CheckCircle2` / `Clock` / `MonitorSmartphone`
//     (L3) -> there is no `react-native-svg` dependency, so each renders a
//     decorative glyph stand-in via `<GlyphIcon>` (the Motor-widget glyph
//     precedent): MonitorSmartphone '📱', Download '⬇', CheckCircle2 '✓',
//     Clock '🕘'. Each keeps the web colour intent — the header/compact device
//     and the Download glyph keep `text-neon-cyan` (colors.accent); the
//     empty-state device + Clock glyphs inherit the muted token; the ready
//     check keeps `text-emerald-300`; the up-to-date check keeps
//     `text-emerald-400` (colors.success).
//   - `@/components/data-display` `MetricBar` (L5) -> not yet ported, reproduced
//     locally as `<LocalMetricBar>` (the same View-track + View-fill shape used
//     by the ChargingDetailPage port): the `pct = Math.min((value/max)*100,100)`
//     calc + the `sublabel ?? fmtNumber(value)` policy are preserved; the web
//     framer width animation + gradient/glow are simplified to a static
//     solid-colour fill at the computed percentage.
//   - `@/components/feedback` `EmptyState` (L6) -> not yet ported, reproduced as
//     `<LocalEmptyState>` (centred glyph + muted message). The web `py-4`
//     padding is preserved; the "no-action transient empty state" intent is kept.
//   - `./WidgetShell` `WidgetShell` (L9, sibling not yet ported) -> reproduced
//     locally as a native `<WidgetShell>` (same self-contained approach as the
//     Motor-widget port): loading -> skeleton (web `Skeleton h-full rounded-xl`),
//     error -> centred danger text (web `QueryError`, surfaced never hidden),
//     the title+icon header (text-[11px] uppercase muted) + the freshness chip
//     via the converted web-parity `DataFreshness` port (dot-only/compact when
//     title-less, mirroring the web overlay), and the `px-4 pb-3` body. The web
//     pulse-on-data-change box-shadow glow (justUpdated/prevUpdatedAt useEffect)
//     is a CSS shadow transition with no native analog and is omitted; the
//     help-tooltip / pin-button / actions / noPadding / query header slots are
//     unused by this widget and not modeled.
//   - `./types` `WidgetProps` (L10) -> the `WidgetProps` / `WidgetSize` /
//     `WidgetConfig` subset is reproduced + exported locally.
//   - `@/lib/numberFormat` `fmtNumber` (the MetricBar dep) -> inlined native-safe
//     equivalent (+ `safeNumber`): nullish/non-finite -> 0, en-US, default 2 dp.
//
// Real native parity deps reused (rule 5): `@/api/hooks/useVehicles`
// `useVehicles` / `useVehicleState` / `useVehicleConfigLatest` (L8) -> the
// already-ported web-parity hooks (real TanStack Query; the
// `/vehicles/{id}/state` + `/vehicle-config/latest?vehicle_id=` paths kept
// verbatim; the native VehicleConfigSnapshot already carries the
// software_update_* fields). `@/components/ui` `Badge` (L4) -> the converted
// web-parity Badge port (success/info/warning/neutral subset, size="sm", dot).
// `@/components/motion` `FadeIn` (L7) -> the converted web-parity FadeIn from the
// motion barrel (opacity+translateY entrance honouring reduced motion).
//
// The native `useVehicleState` result's `state` is typed `VehicleState | string |
// null` (offline responses can be a bare status string). The web call site is
// `any`, so reading `.software_version` off a bare string yields `undefined` at
// runtime; here we narrow once (object -> read field, otherwise '—'), preserving
// the identical observable result while staying type-safe.
//
// Tailwind spacing -> px (1 unit = 4px); var(--text-*) -> theme tokens so the
// light/dark cascade is preserved at the token boundary. No DOM elements,
// Recharts, Leaflet, framer-motion, lucide, or old web UI components are imported.

import React, { useMemo, type ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors } from '../../../../theme/tokens';
import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import { FadeIn } from '../../../components/motion';
import {
  useVehicleConfigLatest,
  useVehicleState,
  useVehicles,
} from '../../../api/hooks/useVehicles';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation('dashboard')` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(_namespace?: string): { t: TFunc } {
  return { t: (_key, fallback) => fallback };
}

// ── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber) ─────────────────────
// MetricBar's `sublabel ?? fmtNumber(value)` fallback. Matches the web helper:
// nullish/non-finite input coerces to 0, en-US locale, default 2 dp.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

// ── Type reproductions (web ./types) ─────────────────────────────────────────
export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

// ── lucide glyph stand-ins + colour intent ───────────────────────────────────
const NEON_CYAN = colors.accent; // text-neon-cyan
const CYAN_300 = '#67e8f9'; // text-cyan-300
const EMERALD_300 = '#6ee7b7'; // text-emerald-300
const EMERALD_400 = colors.success; // text-emerald-400 (#34d399)
const DOWNLOAD_BAR = '#22d3ee'; // downloading MetricBar colour
const INSTALL_BAR = '#a78bfa'; // installing MetricBar colour

const GLYPH_DEVICE = '📱'; // lucide MonitorSmartphone
const GLYPH_DOWNLOAD = '⬇'; // lucide Download
const GLYPH_CHECK = '✓'; // lucide CheckCircle2
const GLYPH_CLOCK = '🕘'; // lucide Clock

function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}) {
  const glyphStyle: StyleProp<TextStyle> = {
    color,
    fontSize: size,
    lineHeight: size,
  };
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={glyphStyle}
    >
      {glyph}
    </AppText>
  );
}

// ── Local `EmptyState` (web @/components/feedback, icon+message) ──────────────
function LocalEmptyState({
  icon,
  message,
}: {
  icon?: ReactNode;
  message: string;
}) {
  // no-action: transient empty state — surfaces when source data is missing;
  // no specific recovery action available.
  return (
    <View style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// ── Local `MetricBar` (web @/components/data-display MetricBar) ───────────────
// The `sublabel ?? fmtNumber(value)` policy is preserved (an explicit empty
// string suppresses the readout). The web framer width animation + gradient/glow
// are simplified to a static solid-colour fill at the computed percentage.
function LocalMetricBar({
  value,
  max,
  color,
  label,
  sublabel,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  sublabel?: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <View>
      <View style={styles.metricBarHeader}>
        <AppText style={styles.metricBarLabel} tone="secondary">
          {label}
        </AppText>
        <AppText style={[styles.metricBarValue, { color }]}>
          {sublabel ?? fmtNumber(value)}
        </AppText>
      </View>
      <View style={styles.metricBarTrack}>
        <View
          style={[styles.metricBarFill, { width: `${pct}%`, backgroundColor: color }]}
        />
      </View>
    </View>
  );
}

// ── Local `WidgetShell` (web ./WidgetShell) ──────────────────────────────────
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never). */
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  if (loading) {
    return <View accessibilityRole="progressbar" style={styles.skeleton} />;
  }
  if (error) {
    return (
      <View style={styles.errorBox}>
        <AppText tone="danger">{error}</AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl: ReactNode = showFreshness ? (
    <DataFreshness
      updatedAt={updatedAt > 0 ? updatedAt : null}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      isError={isError ?? false}
      onRefresh={onRefresh}
      compact={freshnessCompact}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export default function SoftwareUpdateStatusWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: stateData,
    isLoading: stateLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id);
  const { data: configData, isLoading: configLoading } = useVehicleConfigLatest(
    id,
    60_000,
  );

  const isLoading = stateLoading || configLoading;
  const state = stateData?.state;
  const currentVersion =
    state != null && typeof state === 'object'
      ? state.software_version ?? '—'
      : '—';

  const updateVersion = configData?.software_update_version ?? null;
  const downloadPct = configData?.software_update_download_pct ?? null;
  const installPct = configData?.software_update_install_pct ?? null;
  const expectedDuration = configData?.software_update_expected_duration ?? null;
  const scheduledStart = configData?.software_update_scheduled_start ?? null;

  const updateStatus = useMemo(() => {
    if (!updateVersion) return 'up-to-date';
    if (installPct != null && installPct > 0 && installPct < 100)
      return 'installing';
    if (downloadPct != null && downloadPct > 0 && downloadPct < 100)
      return 'downloading';
    if (installPct === 100) return 'installed';
    if (downloadPct === 100) return 'ready';
    return 'available';
  }, [updateVersion, downloadPct, installPct]);

  const isCompact = size.cols <= 1 && size.rows <= 1;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.softwareUpdate', 'Software Update')}
      icon={
        isCompact ? undefined : (
          <GlyphIcon glyph={GLYPH_DEVICE} color={NEON_CYAN} size={14} />
        )
      }
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {state ? (
        <FadeIn>
          {isCompact ? (
            <CompactView version={currentVersion} updateStatus={updateStatus} t={t} />
          ) : (
            <FullView
              version={currentVersion}
              updateVersion={updateVersion}
              downloadPct={downloadPct}
              installPct={installPct}
              expectedDuration={expectedDuration}
              scheduledStart={scheduledStart}
              updateStatus={updateStatus}
              isTall={size.rows >= 2}
              t={t}
            />
          )}
        </FadeIn>
      ) : (
        <LocalEmptyState
          icon={<GlyphIcon glyph={GLYPH_DEVICE} color={colors.textMuted} size={20} />}
          message={t('widget.noSoftwareData', 'No software data')}
        />
      )}
    </WidgetShell>
  );
}

/* ── Compact: 1×1 ── */
function CompactView({
  version,
  updateStatus,
  t,
}: {
  version: string;
  updateStatus: string;
  t: TFunc;
}) {
  return (
    <View style={styles.compactRoot}>
      <GlyphIcon glyph={GLYPH_DEVICE} color={NEON_CYAN} size={20} />
      <AppText numberOfLines={1} style={styles.compactVersion}>
        {version || '—'}
      </AppText>
      <StatusBadgeSmall status={updateStatus} t={t} />
    </View>
  );
}

/* ── Full: 2×1+ ── */
function FullView({
  version,
  updateVersion,
  downloadPct,
  installPct,
  expectedDuration,
  scheduledStart,
  updateStatus,
  isTall,
  t,
}: {
  version: string;
  updateVersion: string | null;
  downloadPct: number | null;
  installPct: number | null;
  expectedDuration: number | null;
  scheduledStart: string | null;
  updateStatus: string;
  isTall: boolean;
  t: TFunc;
}) {
  return (
    <View style={styles.fullRoot}>
      {/* Current version row */}
      <View style={styles.currentVersionRow}>
        <View style={styles.currentVersionCol}>
          <AppText style={styles.currentVersionLabel}>
            {t('widget.currentVersion', 'Current Version')}
          </AppText>
          <AppText numberOfLines={1} style={styles.currentVersionValue}>
            {version || '—'}
          </AppText>
        </View>
        <StatusBadgeSmall status={updateStatus} t={t} />
      </View>

      {/* Update section — only when an update exists */}
      {!!updateVersion && updateStatus !== 'up-to-date' && (
        <View style={styles.updateSection}>
          {/* Target version */}
          <View style={styles.inlineRow}>
            <GlyphIcon glyph={GLYPH_DOWNLOAD} color={NEON_CYAN} size={12} />
            <AppText style={styles.updateLabel}>
              {t('widget.updateAvailable', 'Update')}:
            </AppText>
            <AppText numberOfLines={1} style={styles.updateVersionText}>
              {updateVersion}
            </AppText>
          </View>

          {/* Progress bars */}
          {updateStatus === 'downloading' && downloadPct != null && (
            <LocalMetricBar
              value={downloadPct}
              max={100}
              color={DOWNLOAD_BAR}
              label={t('widget.downloading', 'Downloading')}
              sublabel={`${downloadPct}%`}
            />
          )}

          {updateStatus === 'installing' && installPct != null && (
            <LocalMetricBar
              value={installPct}
              max={100}
              color={INSTALL_BAR}
              label={t('widget.installing', 'Installing')}
              sublabel={`${installPct}%`}
            />
          )}

          {updateStatus === 'ready' && (
            <View style={styles.inlineRow}>
              <GlyphIcon glyph={GLYPH_CHECK} color={EMERALD_300} size={12} />
              <AppText style={styles.readyText}>
                {t('widget.readyToInstall', 'Ready to install')}
              </AppText>
            </View>
          )}

          {/* Expected duration — shown in tall layout when relevant */}
          {isTall && expectedDuration != null && expectedDuration > 0 && (
            <View style={styles.dividerRow}>
              <GlyphIcon glyph={GLYPH_CLOCK} color={colors.textMuted} size={12} />
              <AppText style={styles.dividerText}>
                {t('widget.estimatedTime', 'Est. time')}: ~{expectedDuration}{' '}
                {t('widget.minutes', 'min')}
              </AppText>
            </View>
          )}

          {/* Scheduled start — shown when available */}
          {isTall && !!scheduledStart && (
            <View style={styles.dividerRow}>
              <GlyphIcon glyph={GLYPH_CLOCK} color={colors.textMuted} size={12} />
              <AppText style={styles.dividerText}>
                {t('widget.scheduledStart', 'Scheduled')}: {scheduledStart}
              </AppText>
            </View>
          )}
        </View>
      )}

      {/* Up to date message */}
      {updateStatus === 'up-to-date' && (
        <View style={styles.inlineRow}>
          <GlyphIcon glyph={GLYPH_CHECK} color={EMERALD_400} size={12} />
          <AppText style={styles.upToDateText}>
            {t('widget.upToDate', 'Up to date')}
          </AppText>
        </View>
      )}
    </View>
  );
}

/* ── Status badge helper ── */
function StatusBadgeSmall({ status, t }: { status: string; t: TFunc }) {
  const config: Record<string, { variant: BadgeVariant; label: string }> = {
    'up-to-date': {
      variant: 'success',
      label: t('widget.statusUpToDate', 'Up to date'),
    },
    available: { variant: 'info', label: t('widget.statusAvailable', 'Available') },
    downloading: {
      variant: 'warning',
      label: t('widget.statusDownloading', 'Downloading'),
    },
    ready: { variant: 'info', label: t('widget.statusReady', 'Ready') },
    installing: {
      variant: 'warning',
      label: t('widget.statusInstalling', 'Installing'),
    },
    installed: {
      variant: 'success',
      label: t('widget.statusInstalled', 'Installed'),
    },
  };
  const { variant, label } = config[status] ?? {
    variant: 'neutral' as const,
    label: status,
  };
  return (
    <Badge variant={variant} size="sm" dot>
      {label}
    </Badge>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  compactRoot: {
    alignItems: 'center',
    flex: 1,
    gap: 6, // gap-1.5
    justifyContent: 'center',
  },
  compactVersion: {
    color: colors.textPrimary,
    fontSize: 12, // text-xs
    fontWeight: '700', // font-bold
    lineHeight: 16,
    maxWidth: '100%', // max-w-full
    paddingHorizontal: 4, // px-1
  },
  currentVersionCol: {
    flexShrink: 1, // min-w-0
  },
  currentVersionLabel: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    lineHeight: 14,
  },
  currentVersionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
    justifyContent: 'space-between',
  },
  currentVersionValue: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm
    fontWeight: '700', // font-bold
    lineHeight: 20,
  },
  dividerRow: {
    alignItems: 'center',
    borderTopColor: 'rgba(255, 255, 255, 0.06)', // border-white/[0.06]
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 6, // gap-1.5
    paddingTop: 2, // pt-0.5
  },
  dividerText: {
    color: colors.textMuted,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16, // py-4
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16, // p-4
  },
  freshnessOverlay: {
    position: 'absolute',
    right: 6, // right-1.5
    top: 6, // top-1.5
    zIndex: 5,
  },
  fullRoot: {
    flex: 1,
    justifyContent: 'center',
    rowGap: 10, // gap-2.5
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11, // text-[11px]
    fontWeight: '500', // font-medium
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6, // gap-1.5
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6, // gap-1.5
  },
  metricBarFill: {
    borderRadius: 999, // rounded-full
    height: '100%',
  },
  metricBarHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6, // mb-1.5
  },
  metricBarLabel: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
  },
  metricBarTrack: {
    backgroundColor: colors.surfaceRaised, // bg-[var(--surface-2)]
    borderRadius: 999, // rounded-full
    height: 8, // h-2
    overflow: 'hidden',
  },
  metricBarValue: {
    fontSize: 12, // text-xs
    fontVariant: ['tabular-nums'], // font-mono
  },
  readyText: {
    color: EMERALD_300,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
  updateLabel: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    lineHeight: 14,
  },
  updateSection: {
    rowGap: 8, // space-y-2
  },
  updateVersionText: {
    color: CYAN_300,
    flexShrink: 1,
    fontSize: 12, // text-xs
    fontWeight: '600', // font-semibold
    lineHeight: 16,
  },
  upToDateText: {
    color: EMERALD_400,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
});

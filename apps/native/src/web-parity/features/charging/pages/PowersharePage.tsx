// Native parity port of web/src/features/charging/pages/PowersharePage.tsx.
//
// The web page renders the vehicle's bidirectional Powershare telemetry sourced
// from 5 cold signals in signal_observations (PowershareStatus, PowershareType,
// PowershareStopReason, PowershareHoursLeft, PowershareInstantaneousPowerKW). It
// shows a status panel (status Badge + Type / Output Power / Hours Remaining
// StatCards in a responsive 1/2/3 grid, or an EmptyState when nothing has been
// reported) and a stop-reason panel (a Badge + helper line, or an EmptyState).
//
// This port reproduces the identical data wiring, branching, copy, unit handling,
// and visual intent with React Native View/ScrollView + AppText primitives, the
// repo SemanticIcon glyphs, the GlassPanel surface, and the design tokens -- no
// DOM, no lucide-react, no recharts/leaflet, and no web UI components.
//
// Native-safe adaptations (each mirrors the sibling charging/battery/admin parity
// ports):
//   * react-i18next `useTranslation` -> useNativeTranslationFallback (returns the
//     English fallback; no PowersharePage key uses `{{var}}` interpolation).
//   * `usePageTitle` -> useNativePageTitle no-op (no document.title on native).
//   * `@/lib/signalObservation` latestText/latestNumeric -> inlined verbatim.
//   * `@/lib/numberFormat` fmtNumber -> inlined (safeNumber + Intl, en-US, the
//     explicit per-call precision the page passes: 2 for kW, 1 for hours).
//   * `@/components/layout` PageContainer/Grid, `@/components/ui` GlassPanel/Badge,
//     `@/components/data-display` StatCard, `@/components/feedback` EmptyState,
//     `@/components/motion` FadeIn, `@/components/forms` VehicleSelect ->
//     re-implemented inline on RN primitives + tokens (GlassPanel is the one
//     shared native surface that exists).
//   * `@/hooks/useSelectedVehicle` (global store + URL scope, browser-only) ->
//     useNativeSelectedVehicle (defaults to the first vehicle, local override)
//     feeding the inline cycling-chip VehicleSelect, exactly like EnergyPage.
//   * `useSignalObservations` and `@/api/types` BadgeVariant are reused from the
//     existing native ports (identical shapes the web imported).

import React, {useCallback, useState, type ReactNode} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useSignalObservations,
  type SignalObservation,
} from '../../../api/hooks/useTelemetry';
import {useVehicles} from '../../../api/hooks/useVehicles';
import type {BadgeVariant} from '../../../api/types';

/* ── Native-safe inlines for unported web dependencies ──────────────────── */

const SM_BREAKPOINT = 640;
const MD_BREAKPOINT = 768;
const TW_UNIT = 4;

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * The web page read `t` from react-i18next. Native parity has no i18n runtime
 * wired yet, so this returns the English fallback string, preserving the i18n
 * key/fallback intent (matches the sibling ConflictWarnings port).
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/** `usePageTitle` swap: document.title has no native equivalent — intentional no-op. */
function useNativePageTitle(_title: string): void {
  // No-op on native (parity for the web `usePageTitle` document.title side effect).
}

/** Safe number extraction (parity for @/lib/numberFormat safeNumber). */
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Locale-aware number format (parity for @/lib/numberFormat fmtNumber). The web
 * helper reads a global locale/precision set by useSettings; the page always
 * passes an explicit precision (2 / 1), so this uses the en-US default locale and
 * honours the requested decimals.
 */
function fmtNumber(value: unknown, decimals: number): string {
  try {
    return safeNumber(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toFixed(decimals);
  }
}

/** Extract the latest numeric value from a signal-observations query result. */
function latestNumeric(data: SignalObservation[] | undefined): number | null {
  return data?.[0]?.value_numeric ?? null;
}

/** Extract the latest text value from a signal-observations query result. */
function latestText(data: SignalObservation[] | undefined): string | null {
  return data?.[0]?.value_text ?? null;
}

/** Map status string → Badge variant. */
function statusVariant(status: string | null): BadgeVariant {
  if (!status) {
    return 'neutral';
  }
  const s = status.toLowerCase();
  if (s.includes('active') || s.includes('on')) {
    return 'success';
  }
  if (s.includes('error') || s.includes('fail')) {
    return 'danger';
  }
  if (s.includes('inactive') || s.includes('off')) {
    return 'neutral';
  }
  return 'warning';
}

/** Map stop reason → Badge variant. */
function stopReasonVariant(reason: string | null): BadgeVariant {
  if (!reason) {
    return 'neutral';
  }
  const r = reason.toLowerCase();
  if (r === 'none' || r === '') {
    return 'neutral';
  }
  if (r.includes('user')) {
    return 'warning';
  }
  if (r.includes('error') || r.includes('fault') || r.includes('low')) {
    return 'danger';
  }
  return 'warning';
}

interface VehicleOption {
  id: number;
  label: string;
}

// Parity for useSelectedVehicle: defaults to the first vehicle once the fleet
// loads and allows a local override (the store/URL precedence is browser-only).
function useNativeSelectedVehicle(): {
  vehicleId: number | null;
  options: VehicleOption[];
  setVehicleId: (id: number | null) => void;
} {
  const {data: vehicles} = useVehicles();
  const [override, setOverride] = useState<number | null>(null);
  const list = vehicles ?? [];
  const firstId = list.length > 0 ? list[0].id : null;
  const vehicleId = override ?? firstId;
  const options = list.map(v => ({
    id: v.id,
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));
  return {vehicleId, options, setVehicleId: setOverride};
}

/* ── Native shared-component re-implementations ─────────────────────────── */

// `<Badge variant>` — a rounded pill (parity for @/components/ui Badge variants).
function Badge({
  variant = 'neutral',
  children,
}: {
  variant?: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeSurface[variant]]}>
      <AppText variant="caption" weight="semibold" style={badgeLabel[variant]}>
        {children}
      </AppText>
    </View>
  );
}

// `<StatCard label value unit icon sublabel>` — compact metric tile.
function StatCard({
  label,
  value,
  unit,
  icon,
  sublabel,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon?: SemanticIconName;
  sublabel?: string;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHeader}>
        <AppText
          variant="caption"
          tone="muted"
          weight="semibold"
          style={styles.statLabel}>
          {label}
        </AppText>
        {icon ? <SemanticIcon decorative name={icon} size="sm" /> : null}
      </View>
      <View style={styles.statValueRow}>
        <AppText weight="bold" style={styles.statValue}>
          {value}
        </AppText>
        {unit ? (
          <AppText variant="caption" tone="muted" style={styles.statUnit}>
            {unit}
          </AppText>
        ) : null}
      </View>
      {sublabel ? (
        <AppText variant="caption" tone="muted">
          {sublabel}
        </AppText>
      ) : null}
    </View>
  );
}

// `<EmptyState icon message>` — centred icon + muted message.
function EmptyState({
  icon,
  message,
}: {
  icon?: SemanticIconName;
  message: string;
}) {
  return (
    <View style={styles.empty}>
      {icon ? <SemanticIcon decorative name={icon} size="lg" /> : null}
      <AppText tone="muted" style={styles.emptyText}>
        {message}
      </AppText>
    </View>
  );
}

// framer-motion `<FadeIn>` -> static final-state wrapper (the web reduced-motion
// branch). The `delay` prop is accepted for source parity and intentionally
// ignored (entrance timing has no behavioural contract).
function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View style={styles.section}>{children}</View>;
}

// `<Grid cols={{ default, sm, md }} gap>` — chunks children into aligned rows.
function Grid({
  cols,
  gap = 3,
  children,
}: {
  cols?: {default?: number; sm?: number; md?: number};
  gap?: number;
  children: ReactNode;
}) {
  const {width} = useWindowDimensions();
  const columns =
    width >= MD_BREAKPOINT
      ? cols?.md ?? cols?.sm ?? cols?.default ?? 1
      : width >= SM_BREAKPOINT
      ? cols?.sm ?? cols?.default ?? 1
      : cols?.default ?? 1;
  const gapPx = gap * TW_UNIT;
  const items = React.Children.toArray(children);
  const rows: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return (
    <View style={{gap: gapPx}}>
      {rows.map((row, ri) => (
        <View key={ri} style={[styles.gridRow, {gap: gapPx}]}>
          {row.map((child, ci) => (
            <View key={ci} style={styles.gridCell}>
              {child}
            </View>
          ))}
          {row.length < columns
            ? Array.from({length: columns - row.length}).map((_pad, k) => (
                <View key={`pad-${k}`} style={styles.gridCell} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

// `<VehicleSelect>` — native pressable chip cycling the fleet (URL scope is
// browser-only; this mirrors the picker behaviour with a local override).
function VehicleSelect({
  value,
  options,
  onChange,
}: {
  value: number | null;
  options: VehicleOption[];
  onChange: (id: number | null) => void;
}) {
  const current = options.find(o => o.id === value);
  const label = current?.label ?? 'Vehicle';
  const onPress = () => {
    if (options.length === 0) {
      return;
    }
    const idx = options.findIndex(o => o.id === value);
    const next = options[(idx + 1) % options.length];
    onChange(next.id);
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Selected vehicle ${label}`}
      disabled={options.length <= 1}
      onPress={onPress}
      style={styles.actionChip}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
    </Pressable>
  );
}

// `<PageContainer title subtitle actions>` -> native scroll layout.
function PageContainer({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText tone="muted" style={styles.pageSubtitle}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      <View style={styles.pageBody}>{children}</View>
    </ScrollView>
  );
}

/**
 * Powershare telemetry comes from 5 cold signals in signal_observations per
 * ADR-005 (typed-only hot schema; everything else → signal_observations):
 *   PowershareStatus, PowershareType, PowershareStopReason,
 *   PowershareHoursLeft, PowershareInstantaneousPowerKW.
 */
export default function PowersharePage() {
  const t = useNativeTranslationFallback();
  useNativePageTitle(t('powershare.title', 'Powershare'));

  const {
    vehicleId: selectedId,
    options,
    setVehicleId,
  } = useNativeSelectedVehicle();
  const vehicleId = selectedId ?? undefined;

  const {data: statusObs} = useSignalObservations(vehicleId, {
    signal_name: 'PowershareStatus',
    limit: 1,
  });
  const {data: typeObs} = useSignalObservations(vehicleId, {
    signal_name: 'PowershareType',
    limit: 1,
  });
  const {data: stopObs} = useSignalObservations(vehicleId, {
    signal_name: 'PowershareStopReason',
    limit: 1,
  });
  const {data: hoursObs} = useSignalObservations(vehicleId, {
    signal_name: 'PowershareHoursLeft',
    limit: 1,
  });
  const {data: powerObs} = useSignalObservations(vehicleId, {
    signal_name: 'PowershareInstantaneousPowerKW',
    limit: 1,
  });

  const status = latestText(statusObs);
  const shareType = latestText(typeObs);
  const stopReason = latestText(stopObs);
  const hoursLeft = latestNumeric(hoursObs);
  const powerKw = latestNumeric(powerObs);

  const hasData =
    status != null ||
    shareType != null ||
    stopReason != null ||
    hoursLeft != null ||
    powerKw != null;

  return (
    <PageContainer
      title={t('powershare.title', 'Powershare')}
      subtitle={t(
        'powershare.subtitle',
        'Monitor your vehicle’s bidirectional power sharing — status, output, remaining runtime, and stop conditions.',
      )}
      actions={
        <VehicleSelect
          value={selectedId}
          options={options}
          onChange={setVehicleId}
        />
      }>
      {/* Status row */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.statusHeader}>
            <View style={styles.headerTitleRow}>
              <SemanticIcon decorative name="bolt" size="sm" />
              <AppText weight="semibold" style={styles.sectionTitle}>
                {t('powershare.statusSection', 'Powershare Status')}
              </AppText>
            </View>
            {status ? (
              <Badge variant={statusVariant(status)}>{status}</Badge>
            ) : (
              <Badge variant="neutral">{t('common.noData', '—')}</Badge>
            )}
          </View>

          {hasData ? (
            <Grid cols={{default: 1, sm: 2, md: 3}} gap={4}>
              <StatCard
                label={t('powershare.type', 'Type')}
                value={shareType ?? '—'}
                icon="home"
                sublabel={t('powershare.typeSub', 'Powershare destination')}
              />
              <StatCard
                label={t('powershare.outputPower', 'Output Power')}
                value={powerKw != null ? fmtNumber(powerKw, 2) : '—'}
                unit={powerKw != null ? 'kW' : undefined}
                icon="power"
                sublabel={t(
                  'powershare.outputPowerSub',
                  'Instantaneous power draw',
                )}
              />
              <StatCard
                label={t('powershare.hoursLeft', 'Hours Remaining')}
                value={hoursLeft != null ? fmtNumber(hoursLeft, 1) : '—'}
                unit={hoursLeft != null ? 'h' : undefined}
                icon="clock"
                sublabel={t(
                  'powershare.hoursLeftSub',
                  'Estimated runtime at current output',
                )}
              />
            </Grid>
          ) : (
            <EmptyState
              icon="info"
              message={t(
                'powershare.noData',
                'No Powershare data received yet. Values appear once your vehicle reports Powershare telemetry.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Stop reason */}
      <FadeIn delay={0.05}>
        <GlassPanel style={styles.panel}>
          <View style={styles.headerTitleRow}>
            <SemanticIcon decorative name="alertCircle" size="sm" />
            <AppText weight="semibold" style={styles.sectionTitle}>
              {t('powershare.stopReasonSection', 'Stop Reason')}
            </AppText>
          </View>

          {stopReason ? (
            <View style={styles.stopReasonRow}>
              <Badge variant={stopReasonVariant(stopReason)}>{stopReason}</Badge>
              <AppText tone="secondary" style={styles.stopReasonHelp}>
                {t(
                  'powershare.stopReasonHelp',
                  'Last recorded reason Powershare was halted.',
                )}
              </AppText>
            </View>
          ) : (
            <EmptyState
              icon="info"
              message={t(
                'powershare.noStopReason',
                'No stop reason recorded. Powershare has not been halted, or the signal has not yet been reported.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

PowersharePage.displayName = 'PowersharePage';

/* ── Styles ─────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  pageHeader: {
    gap: spacing.md,
  },
  pageHeaderText: {
    gap: spacing.xs,
  },
  pageSubtitle: {
    maxWidth: 640,
  },
  pageActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pageBody: {
    gap: spacing.lg,
  },
  actionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  section: {
    gap: spacing.md,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  sectionTitle: {
    fontSize: 18,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  gridCell: {
    flex: 1,
    minWidth: 0,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statLabel: {
    flexShrink: 1,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  statValue: {
    fontSize: 24,
    color: colors.textPrimary,
  },
  statUnit: {
    marginBottom: 2,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 420,
  },
  stopReasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  stopReasonHelp: {
    flexShrink: 1,
    fontSize: 13,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
});

const badgeSurface = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeLabel = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {
    color: colors.accent,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
});

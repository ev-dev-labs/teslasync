// Native parity port of
// web/src/features/analytics/components/weekly-digest/BatteryHealthSection.tsx.
//
// The "Battery Health" card of the weekly digest: a purple Battery heading, a
// two-up grid of <BatteryPill>s (avg battery at charge start / end, each a
// colour-coded level + percentage + proportional fill bar), and a three-up grid
// of <MiniStat>s (Avg Charge Gain = batteryEnd-batteryStart %, Charge Sessions =
// chargingSessionCount, Est. Range Added = chargeEnergyAdded * 5.5 km).
//
// React Native has no DOM, framer-motion, lucide-react, or Tailwind, so the web
// tree is reproduced with native View/AppText layers that preserve the same
// data, copy, colours, and proportional intent.
//
// Self-contained native adaptations (documented in the sidecar):
//   - @/components/ui GlassPanel -> the shared native GlassPanel against the
//     theme tokens.
//   - @/components/motion <FadeIn delay={0.2}> is a presentation-only entrance
//     animation with no native equivalent yet, so (following the established
//     OverviewTab / SavingsSlide idiom) the panel renders statically in its rest
//     state — visually identical at rest. @/components/motion is not imported.
//   - ./BatteryPill and ./MiniStat are inlined here because their native modules
//     are not yet converted targets (the same idiom OverviewTab used for
//     ./OverviewVehicleComparison / SectionTitle). BatteryPill keeps the exact
//     web @/lib/colors STATUS_COLORS thresholds (>=60 good, >=30 warning, else
//     critical) and the ml-auto h-2 w-16 fill bar; MiniStat keeps the icon +
//     label + value layout.
//   - lucide-react Battery / TrendingUp / Zap / MapPin 16-20px icons -> short
//     SemanticIcon-style glyph slots (BT / UP / ZP / PN) so the deliberate
//     colours survive: the heading Battery keeps the source text-neon-purple
//     (#a855f7), each BatteryPill Battery keeps its level colour, and the
//     MiniStat icons keep the source's var(--text-muted) tone.
//   - ./types DigestMetrics is inlined as the subset of fields this section
//     reads (batteryStart, batteryEnd, chargingSessionCount, chargeEnergyAdded)
//     because the native ./types module is not yet a converted target.
//   - @/lib/numberFormat fmtNumber / fmtInt -> inlined formatters with the same
//     nullish/NaN -> 0 (safe) and en-US grouping semantics as the converted
//     OverviewTab; en-US stands in for the not-yet-ported global locale.
//   - react-i18next useTranslation -> a native English-default `t` that keeps
//     every analytics.weeklyDigest.* key verbatim.
//
// No DOM, framer-motion, lucide-react, Recharts, Leaflet, or old web UI
// components are imported.

import React from 'react';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';

/* ─── Inlined type (subset of web ./types.DigestMetrics this section reads) ── */

interface DigestMetrics {
  chargeEnergyAdded: number;
  chargingSessionCount: number;
  batteryStart: number;
  batteryEnd: number;
}

interface BatteryHealthSectionProps {
  metrics: DigestMetrics;
}

/* ─── Native i18n fallback (mirrors i18next default-value return) ─────────── */

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so this fallback returns the English default
// while keeping every analytics.weeklyDigest.* key verbatim.
const t = (_key: string, fallback: string): string => fallback;

/* ─── Numeric helpers (mirror web @/lib/numberFormat + null safety) ───────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safe(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Mirrors web lib/numberFormat.fmtNumber; every call site passes an explicit
// precision. en-US grouping stands in for the not-yet-ported global locale.
function fmtNumber(v: unknown, decimals = 2): string {
  const n = safe(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

// Mirrors web lib/numberFormat.fmtInt -> fmtNumber(v, 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── Source colours (verbatim hues; theme tokens for muted text) ─────────── */

// web/src/index.css --neon-purple.
const NEON_PURPLE = '#a855f7';
// web @/lib/colors STATUS_COLORS (battery level thresholds).
const STATUS_COLORS = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
} as const;
// web var(--text-muted) -> shared theme token.
const TEXT_MUTED = colors.textMuted;

/* ─── Glyph slot stand-in for lucide icons (preserves deliberate colour) ──── */

function Glyph({
  label,
  color,
  size = 16,
}: {
  label: string;
  color: string;
  size?: number;
}): React.ReactElement {
  return (
    <AppText
      weight="bold"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 4}]}>
      {label}
    </AppText>
  );
}

/* ─── Inlined native BatteryPill (web ./BatteryPill) ──────────────────────── */

interface BatteryPillProps {
  level: number;
  label: string;
  style?: StyleProp<ViewStyle>;
}

function BatteryPill({
  level,
  label,
  style,
}: BatteryPillProps): React.ReactElement {
  const color =
    level >= 60
      ? STATUS_COLORS.good
      : level >= 30
        ? STATUS_COLORS.warning
        : STATUS_COLORS.critical;

  const fillWidth = `${Math.min(level, 100)}%` as DimensionValue;

  return (
    <GlassPanel style={[styles.pill, style]}>
      <Glyph label="BT" color={color} size={20} />
      <View style={styles.pillText}>
        <AppText variant="caption" tone="secondary">
          {label}
        </AppText>
        <AppText weight="bold" style={[styles.pillValue, {color}]}>
          {fmtInt(level)}%
        </AppText>
      </View>
      <View style={styles.pillBarTrack}>
        <View
          style={[styles.pillBarFill, {backgroundColor: color, width: fillWidth}]}
        />
      </View>
    </GlassPanel>
  );
}

/* ─── Inlined native MiniStat (web ./MiniStat) ────────────────────────────── */

interface MiniStatProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

function MiniStat({
  label,
  value,
  icon,
  style,
}: MiniStatProps): React.ReactElement {
  return (
    <GlassPanel style={[styles.miniStat, style]}>
      {icon ? <View style={styles.miniIcon}>{icon}</View> : null}
      <View style={styles.miniText}>
        <AppText variant="caption" tone="secondary">
          {label}
        </AppText>
        <AppText weight="semibold" style={styles.miniValue}>
          {String(value)}
        </AppText>
      </View>
    </GlassPanel>
  );
}

export function BatteryHealthSection({
  metrics,
}: BatteryHealthSectionProps): React.ReactElement {
  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.header}>
        <Glyph label="BT" color={NEON_PURPLE} size={20} />
        <AppText weight="bold" style={styles.headerText}>
          {t('analytics.weeklyDigest.batteryHealth', 'Battery Health')}
        </AppText>
      </View>

      <View style={styles.pillGrid}>
        <BatteryPill
          style={styles.pillCell}
          level={Math.round(safe(metrics.batteryStart))}
          label={t(
            'analytics.weeklyDigest.avgBatteryStart',
            'Avg Battery at Charge Start',
          )}
        />
        <BatteryPill
          style={styles.pillCell}
          level={Math.round(safe(metrics.batteryEnd))}
          label={t(
            'analytics.weeklyDigest.avgBatteryEnd',
            'Avg Battery at Charge End',
          )}
        />
      </View>

      {/* Range stats */}
      <View style={styles.statGrid}>
        <MiniStat
          style={styles.statCell}
          label={t('analytics.weeklyDigest.avgChargeGain', 'Avg Charge Gain')}
          value={`${fmtNumber(safe(metrics.batteryEnd) - safe(metrics.batteryStart), 1)}%`}
          icon={<Glyph label="UP" color={TEXT_MUTED} />}
        />
        <MiniStat
          style={styles.statCell}
          label={t('analytics.weeklyDigest.chargeSessions', 'Charge Sessions')}
          value={fmtInt(metrics.chargingSessionCount)}
          icon={<Glyph label="ZP" color={TEXT_MUTED} />}
        />
        <MiniStat
          style={styles.statCell}
          label={t('analytics.weeklyDigest.estRangeAdded', 'Est. Range Added')}
          value={`${fmtNumber(safe(metrics.chargeEnergyAdded) * 5.5, 0)} km`}
          icon={<Glyph label="PN" color={TEXT_MUTED} />}
        />
      </View>
    </GlassPanel>
  );
}

BatteryHealthSection.displayName = 'BatteryHealthSection';

const styles = StyleSheet.create({
  glyph: {
    letterSpacing: 0.4,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  headerText: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  miniIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStat: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  miniText: {
    flexDirection: 'column',
    flexShrink: 1,
  },
  miniValue: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  panel: {
    gap: 24,
    padding: 24,
  },
  pill: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pillBarFill: {
    borderRadius: 999,
    height: '100%',
  },
  pillBarTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    marginLeft: 'auto',
    overflow: 'hidden',
    width: 64,
  },
  pillCell: {
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 180,
  },
  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  pillText: {
    flexDirection: 'column',
    flexShrink: 1,
  },
  pillValue: {
    fontSize: 14,
  },
  statCell: {
    flexGrow: 1,
    minWidth: 140,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
});

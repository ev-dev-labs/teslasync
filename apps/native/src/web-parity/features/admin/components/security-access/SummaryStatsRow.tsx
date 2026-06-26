// Native parity port of
// web/src/features/admin/components/security-access/SummaryStatsRow.tsx.
//
// The web module renders the admin Security & Access "summary stats" row: a
// responsive grid (1 / 2 / 4 columns) of four MetricCards — Current Status
// (Secure/Unsecure, green/red), Last Lock Change (timeSince, cyan), Sentry
// Uptime (`fmtInt(%)`, blue), and Total Events (count, purple) — wrapped in a
// FadeIn. While loading it instead renders four height-88 Skeleton bars in the
// same grid. Built from react-i18next, the lucide ShieldCheck/Clock/Activity/
// BarChart3 icons, @/lib/numberFormat fmtInt, the shared @/components MetricCard/
// Skeleton/FadeIn, and the local ./helpers timeSince.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() hook whose
//     t(key, fallback?) returns the English fallback (or the key), so every
//     translation key is preserved verbatim at the call site.
//   • lucide-react icons (ShieldCheck/Clock/Activity/BarChart3) -> SemanticIcon
//     glyphs (securityCheck / clock / activity / analytics) rendered inside the
//     MetricCard's colour-tinted icon box. The lucide ReactNode is replaced by a
//     SemanticIconName, mirroring the FleetApiSection parity port.
//   • @/lib/numberFormat fmtInt -> an inlined fmtInt (+ safeNumber) reproducing
//     the web behaviour: non-finite -> 0, locale en-US integer formatting.
//   • The shared web <MetricCard> (DOM div + Tailwind neon-colour classes, with
//     change/delta/subtitle/help slots this caller never uses) -> an inlined
//     native MetricCard covering exactly the props this caller passes
//     (label / value / icon / color): a rounded card with a label, a bold value,
//     and a NeonColor-tinted icon box (the same cyan/green/red/blue/purple
//     mapping the web neonColorMap uses).
//   • The shared web <Skeleton> / <FadeIn> -> the already-ported native Skeleton
//     and FadeIn (web-parity/components).
//   • The local ./helpers timeSince -> inlined verbatim (the same "—" / "just
//     now" / "Nm/h/d ago" relative formatter).
//   • The CSS grid (grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6) -> a
//     flex row with flexWrap, a gap, and flexGrow cards that wrap to ~2-up on a
//     phone — the responsive 1/2/4-column intent in a native layout.
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {Skeleton} from '../../../../components/feedback/Skeleton';
import {FadeIn} from '../../../../components/motion/FadeIn';
import {AppText} from '../../../../../components/ui/AppText';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. A stable useCallback identity keeps the hook honest.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtInt ────────────────────────────────── */

/** Safe number extraction from unknown values, returns 0 for nullish/NaN. */
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtInt = fmtNumber(v, 0): locale integer formatting at the default en-US
// locale, with non-finite inputs coerced to 0 via safeNumber.
function fmtInt(v: unknown): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/* ─── inlined ./helpers timeSince ──────────────────────────────────────── */

// Relative "time since" formatter, ported verbatim from the web ./helpers: a "—"
// placeholder for null/unparseable/future timestamps, then just now / Nm / Nh / Nd.
function timeSince(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    return '—';
  }
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ─── inlined @/components/data-display MetricCard (subset used here) ───── */

// web @/lib/tokens NeonColor — the full palette so the `color` prop stays
// type-faithful even though this caller only uses green/red/cyan/blue/purple.
type NeonColor = 'cyan' | 'green' | 'red' | 'purple' | 'amber' | 'blue';

interface NeonTint {
  fg: string;
  bg: string;
  border: string;
}

// web neonColorMap (Tailwind neon text/bg/ring classes) -> native tinted tokens.
// cyan/green/red/purple/amber resolve to the theme tokens; blue has no native
// token, so it maps to an explicit indigo-300 tint mirroring text-indigo-300.
const NEON_TINT: Record<NeonColor, NeonTint> = {
  cyan: {fg: colors.accent, bg: colors.accentSoft, border: colors.borderAccent},
  green: {
    fg: colors.success,
    bg: colors.successSurface,
    border: colors.successBorder,
  },
  red: {fg: colors.danger, bg: colors.dangerSurface, border: colors.dangerBorder},
  purple: {
    fg: colors.violet,
    bg: colors.violetSurface,
    border: colors.violetBorder,
  },
  amber: {
    fg: colors.warning,
    bg: colors.warningSurface,
    border: colors.warningBorder,
  },
  blue: {
    fg: '#a5b4fc',
    bg: 'rgba(99, 102, 241, 0.12)',
    border: 'rgba(99, 102, 241, 0.32)',
  },
};

interface MetricCardProps {
  label: string;
  // web `value: string | number`.
  value: string | number;
  // web `icon?: ReactNode` (a lucide glyph) -> a SemanticIconName glyph.
  icon?: SemanticIconName;
  // web `color?: NeonColor` (default 'cyan').
  color?: NeonColor;
}

/** Compact metric display card with a label, value, and colour-tinted icon. */
function MetricCard({label, value, icon, color = 'cyan'}: MetricCardProps) {
  const tint = NEON_TINT[color];
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.cardBody}>
          <AppText numberOfLines={1} style={styles.cardLabel} tone="muted">
            {label}
          </AppText>
          <AppText style={styles.cardValue} weight="bold">
            {value}
          </AppText>
        </View>
        {icon ? (
          <View
            style={[
              styles.iconBox,
              {backgroundColor: tint.bg, borderColor: tint.border},
            ]}>
            <AppText style={[styles.iconGlyph, {color: tint.fg}]} weight="bold">
              {getSemanticIconDefinition(icon).glyph}
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ─── SummaryStatsRow ──────────────────────────────────────────────────── */

interface SummaryStatsRowProps {
  isSecure: boolean;
  lastLockChange: string | undefined;
  sentryUptime: number;
  totalEvents: number;
  isLoading: boolean;
}

export function SummaryStatsRow({
  isSecure,
  lastLockChange,
  sentryUptime,
  totalEvents,
  isLoading,
}: SummaryStatsRowProps) {
  const {t} = useTranslation();

  if (isLoading) {
    return (
      <View style={styles.grid}>
        {Array.from({length: 4}).map((_, i) => (
          <View key={i} style={styles.cell}>
            <Skeleton height={88} />
          </View>
        ))}
      </View>
    );
  }

  return (
    <FadeIn>
      <View style={styles.grid}>
        <Cell>
          <MetricCard
            color={isSecure ? 'green' : 'red'}
            icon="securityCheck"
            label={t('admin.security.stat.status', 'Current Status')}
            value={
              isSecure
                ? t('admin.security.secure', 'Secure')
                : t('admin.security.unsecure', 'Unsecure')
            }
          />
        </Cell>
        <Cell>
          <MetricCard
            color="cyan"
            icon="clock"
            label={t('admin.security.stat.lastLock', 'Last Lock Change')}
            value={timeSince(lastLockChange)}
          />
        </Cell>
        <Cell>
          <MetricCard
            color="blue"
            icon="activity"
            label={t('admin.security.stat.sentryUptime', 'Sentry Uptime')}
            value={`${fmtInt(sentryUptime)}%`}
          />
        </Cell>
        <Cell>
          <MetricCard
            color="purple"
            icon="analytics"
            label={t('admin.security.stat.totalEvents', 'Total Events')}
            value={totalEvents}
          />
        </Cell>
      </View>
    </FadeIn>
  );
}

// Grid cell wrapper — the flexGrow/flexBasis card slot that mirrors the web
// responsive grid columns (1 / 2 / 4) by wrapping to ~2-up on a phone.
function Cell({children}: {children: ReactNode}) {
  return <View style={styles.cell}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  cell: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 150,
  },
  card: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  cardValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
  },
  iconGlyph: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
});

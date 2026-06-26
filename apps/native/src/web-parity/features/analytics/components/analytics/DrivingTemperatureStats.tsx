// Native parity port of
// web/src/features/analytics/components/analytics/DrivingTemperatureStats.tsx.
//
// The web module renders the Driving tab "Temperature Stats" panel: a GlassPanel
// (p-4) titled "Temperature Stats" that, when inside or outside temperature data
// is present, shows a responsive grid (2 / 3 / 6 columns) of six MetricCards —
// Inside Min/Avg/Max (cyan/green/amber) and Outside Min/Avg/Max (cyan/green/
// amber). Each card converts the backend's SI °C value to the user's display
// unit, formats it to 1 decimal, carries the unit as a subtitle, and shows a
// Thermometer icon. When neither temperature stat is present it instead renders
// an EmptyState ("No temperature stats").
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback) returns the English fallback (or the key), preserving
//     every translation key verbatim at the call site.
//   • @/hooks/useUnits (unitPrefs.temperature) -> derived from the native
//     useSettings() query exactly like web useUnits' deriveTemperature:
//     unit_of_temp === 'F' ? '°F' : '°C'.
//   • @/lib/unitConversion convertTempFromSI -> inlined verbatim (°C identity,
//     °F = c*9/5+32).
//   • @/lib/numberFormat fmtNumber -> inlined locale-aware formatter (non-finite
//     -> 0); the locale is read from settings (web reads its global locale).
//   • @/components/charts `safe` -> inlined (finite number else 0).
//   • lucide-react Thermometer -> the native SemanticIcon "climate" glyph,
//     rendered inside the MetricCard's colour-tinted icon box.
//   • The shared web <GlassPanel>/<EmptyState> -> the native GlassPanel (ui) and
//     the EmptyState parity component (feedback).
//   • The shared web <MetricCard> (DOM div + Tailwind neon-colour classes) -> an
//     inlined native MetricCard covering exactly the props this caller passes
//     (label / value / subtitle / icon / color), with the same cyan/green/amber
//     neonColorMap tints.
//   • The local ./helpers SectionTitle -> inlined (text-sm/semibold/primary).
//   • The CSS grid (grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3) -> a
//     flex-wrap row of ~2-up cells, preserving the responsive multi-column
//     intent on a phone.
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {FleetAnalytics} from '../../../../api/types';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
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

/* ─── inlined @/hooks/useUnits temperature preference ──────────────────── */

type TemperatureLabel = '°C' | '°F';

// web useUnits' deriveTemperature: the settings `unit_of_temp` 'F' selects
// Fahrenheit, everything else falls back to Celsius.
function deriveTemperature(unitOfTemp: string | undefined): TemperatureLabel {
  return unitOfTemp === 'F' ? '°F' : '°C';
}

/* ─── inlined @/lib/unitConversion convertTempFromSI ───────────────────── */

// Pure SI celsius -> display temperature (web lib convertTempFromSI): °C is the
// identity, °F applies the classic c*9/5+32 offset.
function convertTempFromSI(celsius: number, to: TemperatureLabel): number {
  return to === '°F' ? (celsius * 9) / 5 + 32 : celsius;
}

/* ─── inlined @/components/charts safe + @/lib/numberFormat fmtNumber ───── */

const DEFAULT_LOCALE = 'en-US';
const EM_DASH = '\u2014';

// web charts `safe`: a finite number passes through, anything else becomes 0.
function safe(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// web fmtNumber(value, decimals): locale-aware fixed-decimal formatting with
// non-finite inputs coerced to 0; a bad locale tag falls back to en-US so a
// string is always produced.
function fmtNumber(value: unknown, decimals: number, locale: string): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  try {
    return safe(value).toLocaleString(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    return safe(value).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }
}

/* ─── inlined ./helpers SectionTitle ───────────────────────────────────── */

// web SectionTitle: <span class="text-sm font-semibold text-[var(--text-primary)]">.
function SectionTitle({children}: {children: ReactNode}) {
  return (
    <AppText style={styles.sectionTitle} weight="semibold">
      {children}
    </AppText>
  );
}

/* ─── inlined @/components/data-display MetricCard (subset used here) ───── */

// web @/lib/tokens NeonColor — the full palette so the `color` prop stays
// type-faithful even though this caller only uses cyan/green/amber.
type NeonColor = 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue';

interface NeonTint {
  fg: string;
  bg: string;
  border: string;
}

// web neonColorMap (Tailwind neon text/bg/ring classes) -> native tinted tokens.
// cyan/green/amber/red/purple resolve to the theme tokens; blue has no native
// token, so it maps to an explicit indigo-300 tint mirroring text-indigo-300.
const NEON_TINT: Record<NeonColor, NeonTint> = {
  cyan: {fg: colors.accent, bg: colors.accentSoft, border: colors.borderAccent},
  green: {
    fg: colors.success,
    bg: colors.successSurface,
    border: colors.successBorder,
  },
  amber: {
    fg: colors.warning,
    bg: colors.warningSurface,
    border: colors.warningBorder,
  },
  red: {fg: colors.danger, bg: colors.dangerSurface, border: colors.dangerBorder},
  purple: {
    fg: colors.violet,
    bg: colors.violetSurface,
    border: colors.violetBorder,
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
  // web `subtitle?: string` (rendered under the value, muted 10px).
  subtitle?: string;
  // web `icon?: ReactNode` (a lucide glyph) -> a SemanticIconName glyph.
  icon?: SemanticIconName;
  // web `color?: NeonColor` (default 'cyan').
  color?: NeonColor;
}

/** Compact metric card with a label, bold value, subtitle, and tinted icon. */
function MetricCard({label, value, subtitle, icon, color = 'cyan'}: MetricCardProps) {
  const tint = NEON_TINT[color];
  return (
    <View style={styles.card}>
      <View style={styles.cardRow}>
        <View style={styles.cardBody}>
          <AppText numberOfLines={1} style={styles.cardLabel} tone="muted">
            {label}
          </AppText>
          <AppText numberOfLines={1} style={styles.cardValue} weight="bold">
            {value}
          </AppText>
          {subtitle ? (
            <AppText numberOfLines={1} style={styles.cardSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
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

// Grid cell wrapper — the flexGrow/flexBasis card slot that mirrors the web
// responsive grid columns (2 / 3 / 6) by wrapping to ~2-up on a phone.
function Cell({children}: {children: ReactNode}) {
  return <View style={styles.cell}>{children}</View>;
}

/* ─── DrivingTemperatureStats ──────────────────────────────────────────── */

export function DrivingTemperatureStats({data}: {data: FleetAnalytics | undefined}) {
  const {t} = useTranslation();
  const {data: settings} = useSettings();
  const tempUnit = deriveTemperature(settings?.unit_of_temp);
  const locale = deriveLocale(settings?.locale);
  // backend `temperature.{inside,outside}` is °C; convertTempFromSI expects °C.
  const fromC = (c: number) => convertTempFromSI(c, tempUnit);

  const da = data?.drive_analytics;
  const insideTemp = da?.temperature?.inside;
  const outsideTemp = da?.temperature?.outside;

  return (
    <GlassPanel style={styles.panel}>
      <SectionTitle>{t('analytics.driving.tempStats', 'Temperature Stats')}</SectionTitle>
      {insideTemp || outsideTemp ? (
        <View style={styles.grid}>
          <Cell>
            <MetricCard
              color="cyan"
              icon="climate"
              label={t('analytics.driving.insideMin', 'Inside Min')}
              subtitle={tempUnit}
              value={insideTemp ? fmtNumber(fromC(safe(insideTemp.min)), 1, locale) : EM_DASH}
            />
          </Cell>
          <Cell>
            <MetricCard
              color="green"
              icon="climate"
              label={t('analytics.driving.insideAvg', 'Inside Avg')}
              subtitle={tempUnit}
              value={insideTemp ? fmtNumber(fromC(safe(insideTemp.avg)), 1, locale) : EM_DASH}
            />
          </Cell>
          <Cell>
            <MetricCard
              color="amber"
              icon="climate"
              label={t('analytics.driving.insideMax', 'Inside Max')}
              subtitle={tempUnit}
              value={insideTemp ? fmtNumber(fromC(safe(insideTemp.max)), 1, locale) : EM_DASH}
            />
          </Cell>
          <Cell>
            <MetricCard
              color="cyan"
              icon="climate"
              label={t('analytics.driving.outsideMin', 'Outside Min')}
              subtitle={tempUnit}
              value={outsideTemp ? fmtNumber(fromC(safe(outsideTemp.min)), 1, locale) : EM_DASH}
            />
          </Cell>
          <Cell>
            <MetricCard
              color="green"
              icon="climate"
              label={t('analytics.driving.outsideAvg', 'Outside Avg')}
              subtitle={tempUnit}
              value={outsideTemp ? fmtNumber(fromC(safe(outsideTemp.avg)), 1, locale) : EM_DASH}
            />
          </Cell>
          <Cell>
            <MetricCard
              color="amber"
              icon="climate"
              label={t('analytics.driving.outsideMax', 'Outside Max')}
              subtitle={tempUnit}
              value={outsideTemp ? fmtNumber(fromC(safe(outsideTemp.max)), 1, locale) : EM_DASH}
            />
          </Cell>
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState message={t('analytics.driving.noTempStats', 'No temperature stats')} />
      )}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: {
    // web GlassPanel className="p-4" (16px).
    padding: 16,
  },
  sectionTitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md, // web gap-3
    marginTop: spacing.md, // web mt-3
  },
  cell: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
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
  cardSubtitle: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
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

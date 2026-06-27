// Native parity port of
// web/src/features/driving/components/drive-detail/JourneyDetailsPanel.tsx.
//
// The web component renders the drive-detail "Journey Details" GlassPanel: a
// heading (Navigation glyph + title) over a responsive 1/2-column grid
// (grid-cols-1 sm:grid-cols-2, gap-4). The left cell is the Start (MapPin, green)
// and the right cell is the Destination (Flag, red); each shows a bold address
// line (the resolved address, else signed lat/lon in a mono span, else a
// placeholder), a muted vehicle-local timestamp, and a secondary battery-% line.
//
// Native substitutions (no DOM, lucide-react, framer-motion, Recharts, Leaflet,
// or web UI components are imported):
//   * `GlassPanel` (web @/components/ui) -> the native `components/ui/GlassPanel`
//     (style instead of className; p-5 -> padding 20).
//   * `FadeIn` (web @/components/motion, framer-motion) -> an inlined static
//     final-state wrapper (the web reduced-motion branch; the entrance animation
//     carries no behavioural contract). Mirrors the sibling native ports.
//   * lucide `Navigation` / `MapPin` / `Flag` -> repo SemanticIcon names
//     navigation / location / flag, whose glyphs are read via
//     getSemanticIconDefinition and tinted with the Tailwind hex the web classes
//     resolve to (text-cyan-400 #22d3ee / text-green-400 #4ade80 /
//     text-red-400 #f87171). The green/red tint also colours the Start /
//     Destination labels, matching the web `text-green-400` / `text-red-400` on
//     the wrapping flex row. No lucide-react import.
//   * `DateTime value=... in="vehicle"` (web @/components/data-display) -> inlined
//     `formatVehicleDateTime`: same `formatDateTime` shape (year numeric / month
//     short / day numeric / hour 2-digit / minute 2-digit, em-dash for null /
//     invalid). The web `in="vehicle"` timezone resolution needs the browser-only
//     useTimezone + useSelectedVehicle providers (not wired into native parity),
//     so this renders in the device's local timezone — the same back-compat path
//     the web `<DateTime>` uses without provider context. The BCP-47 locale is
//     resolved from `useSettings().locale` via the same `resolveLocale` rule.
//   * `fmtNumber` (web @/lib/numberFormat) -> value-identical inline (safeNumber
//     non-finite -> 0, locale-grouped toLocaleString with a bad-locale en-US
//     fallback) called at the web global precision (clamped
//     settings.decimal_precision 0..20, else 2) for the coordinate read-out.
//   * react-i18next `useTranslation().t` -> a self-contained fallback returning the
//     English fallback string, preserving every i18n key + default
//     (journeyDetails / start / destination / noAddress / inProgress / battery).
//   * `DriveDetail` (web @/types/driving) has no native port yet, so the consumed
//     subset (start/end address, lat, lon, ts, batteryPct) is inlined; the parent
//     passes a structurally-compatible richer object.

import React, {useCallback} from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type DimensionValue,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {useSettings} from '../../../../api/hooks/useSettings';

type NativeTFunction = (key: string, fallback: string) => string;

// The web component read `t` from react-i18next. Native parity has no i18n runtime
// wired yet, so this returns the English fallback string, preserving every i18n
// key + default used by this panel.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Local mirror of the consumed subset of web `@/types/driving` `DriveDetail`
// (extends `Drive`). The native types/driving port does not exist yet; only these
// fields are read here. The parent supplies a structurally-compatible richer
// object.
interface DriveDetail {
  startTs: string;
  endTs: string | null;
  startAddress: string | null;
  endAddress: string | null;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  startBatteryPct: number | null;
  endBatteryPct: number | null;
}

// Tailwind palette hex the web `text-cyan-400` / `text-green-400` / `text-red-400`
// classes resolve to (icons + Start/Destination labels).
const CYAN_400 = '#22d3ee';
const GREEN_400 = '#4ade80';
const RED_400 = '#f87171';

// Tailwind grid-cols-1 sm:grid-cols-2: 1 column below the sm breakpoint, 2 at/above.
const SM_BREAKPOINT = 640;
const GRID_GAP = 16; // gap-4 == 1rem == 16.
const HALF_GAP = GRID_GAP / 2;

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// --- Inlined `@/lib/numberFormat` parity ----------------------------------
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals: number, locale: string): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

// Web global precision (numberFormat.setGlobalPrecision): clamp 0..20, else 2.
function deriveGlobalPrecision(decimalPrecision: unknown): number {
  if (typeof decimalPrecision === 'number' && Number.isFinite(decimalPrecision)) {
    return Math.max(0, Math.min(20, decimalPrecision));
  }
  return DEFAULT_PRECISION;
}

// --- Inlined `@/lib/locale` resolveLocale parity --------------------------
// Empty / whitespace-only -> 'en-US' (Intl would otherwise throw RangeError).
function resolveLocale(locale: string | null | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

// Web `<span className="font-mono">{lat}°N/S, {|lon|}°E/W</span>`. Latitude is
// rendered signed (web does not abs it); longitude uses Math.abs. Ported verbatim.
function formatCoords(
  lat: number,
  lon: number,
  decimals: number,
  locale: string,
): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${fmtNumber(lat, decimals, locale)}\u00b0${ns}, ${fmtNumber(
    Math.abs(lon),
    decimals,
    locale,
  )}\u00b0${ew}`;
}

// Native analogue of `<DateTime value=... in="vehicle" />`: the web `formatDateTime`
// shape, rendered in the device's local timezone (vehicle-tz resolution is
// browser-provider-only and not wired into native parity) with the settings locale.
function formatVehicleDateTime(
  value: string | null | undefined,
  locale: string,
): string {
  if (!value) {
    return '\u2014';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  const opts: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return d.toLocaleString(locale, opts);
  } catch {
    return d.toLocaleString(DEFAULT_LOCALE, opts);
  }
}

// framer-motion `<FadeIn>` -> static final-state wrapper (the web reduced-motion
// branch). `delay` is accepted for source parity and intentionally ignored.
function FadeIn({children}: {children: React.ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

export interface JourneyDetailsPanelProps {
  drive: DriveDetail;
}

export function JourneyDetailsPanel({drive}: JourneyDetailsPanelProps) {
  const t = useNativeTranslationFallback();
  const {data: settings} = useSettings();
  const {width} = useWindowDimensions();

  const locale = resolveLocale(settings?.locale);
  const globalPrecision = deriveGlobalPrecision(settings?.decimal_precision);
  const columns = width >= SM_BREAKPOINT ? 2 : 1;
  const cellWidth: DimensionValue = `${100 / columns}%`;

  const navigationGlyph = getSemanticIconDefinition('navigation').glyph;
  const mapPinGlyph = getSemanticIconDefinition('location').glyph;
  const flagGlyph = getSemanticIconDefinition('flag').glyph;

  return (
    <FadeIn>
      <GlassPanel style={styles.panel}>
        <View style={styles.heading}>
          <AppText weight="bold" style={[styles.headingIcon, {color: CYAN_400}]}>
            {navigationGlyph}
          </AppText>
          <AppText weight="semibold" style={styles.headingText}>
            {t('driveDetail.journeyDetails', 'Journey Details')}
          </AppText>
        </View>

        <View style={styles.grid}>
          <View style={[styles.cell, {width: cellWidth}]}>
            <View style={styles.labelRow}>
              <AppText
                weight="bold"
                style={[styles.labelIcon, {color: GREEN_400}]}>
                {mapPinGlyph}
              </AppText>
              <AppText
                weight="semibold"
                style={[styles.labelText, {color: GREEN_400}]}>
                {t('driveDetail.start', 'Start')}
              </AppText>
            </View>
            <AppText weight="bold" style={styles.addressText}>
              {drive.startAddress
                ? drive.startAddress
                : drive.startLat && drive.startLon
                  ? (
                    <Text style={styles.mono}>
                      {formatCoords(
                        drive.startLat,
                        drive.startLon,
                        globalPrecision,
                        locale,
                      )}
                    </Text>
                  )
                  : t('driveDetail.noAddress', 'No address data')}
            </AppText>
            <AppText tone="muted" style={styles.metaText}>
              {formatVehicleDateTime(drive.startTs, locale)}
            </AppText>
            <AppText tone="secondary" style={styles.metaText}>
              {t('driveDetail.battery', 'Battery')}: {drive.startBatteryPct ?? '?'}%
            </AppText>
          </View>

          <View style={[styles.cell, {width: cellWidth}]}>
            <View style={styles.labelRow}>
              <AppText
                weight="bold"
                style={[styles.labelIcon, {color: RED_400}]}>
                {flagGlyph}
              </AppText>
              <AppText
                weight="semibold"
                style={[styles.labelText, {color: RED_400}]}>
                {t('driveDetail.destination', 'Destination')}
              </AppText>
            </View>
            <AppText weight="bold" style={styles.addressText}>
              {drive.endAddress
                ? drive.endAddress
                : drive.endLat && drive.endLon
                  ? (
                    <Text style={styles.mono}>
                      {formatCoords(
                        drive.endLat,
                        drive.endLon,
                        globalPrecision,
                        locale,
                      )}
                    </Text>
                  )
                  : drive.endTs
                    ? t('driveDetail.noAddress', 'No address data')
                    : t('driveDetail.inProgress', 'In progress')}
            </AppText>
            <AppText tone="muted" style={styles.metaText}>
              {drive.endTs
                ? formatVehicleDateTime(drive.endTs, locale)
                : t('driveDetail.inProgress', 'In progress')}
            </AppText>
            <AppText tone="secondary" style={styles.metaText}>
              {t('driveDetail.battery', 'Battery')}: {drive.endBatteryPct ?? '?'}%
            </AppText>
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

JourneyDetailsPanel.displayName = 'JourneyDetailsPanel';

const styles = StyleSheet.create({
  // GlassPanel p-5.
  panel: {
    padding: 20,
  },
  // h3 ... flex items-center gap-2 mb-4 + the Navigation icon.
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  // Navigation glyph (h-4 w-4 text-cyan-400).
  headingIcon: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  // text-sm font-semibold text-[var(--text-primary)].
  headingText: {
    fontSize: 14,
    lineHeight: 20,
  },
  // grid grid-cols-1 sm:grid-cols-2 gap-4 (negative-margin gutter trick).
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -HALF_GAP,
  },
  cell: {
    padding: HALF_GAP,
  },
  // flex items-center gap-2 text-green-400/red-400 mb-1.
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  // MapPin / Flag glyph (h-4 w-4).
  labelIcon: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  // The Start / Destination label (coloured to match the row).
  labelText: {
    fontSize: 14,
    lineHeight: 20,
  },
  // p font-bold text-[var(--text-primary)] text-sm.
  addressText: {
    fontSize: 14,
    lineHeight: 20,
  },
  // span font-mono (size/weight/colour inherited from the address AppText).
  mono: {
    fontFamily: MONO_FONT,
  },
  // p text-xs text-[var(--text-muted)] / text-[var(--text-secondary)].
  metaText: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});

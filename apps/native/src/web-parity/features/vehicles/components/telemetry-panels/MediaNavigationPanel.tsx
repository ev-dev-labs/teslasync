// Native parity port of
// web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx.
//
// The web source renders a "Media & Navigation" GlassPanel (p-6 h-full): a lucide
// Headphones heading icon (text-purple-300) + title, then two stacked sections —
// "Now Playing" (the media title/artist plus a playback_source chip and a
// playback_status Badge) and "Navigation" (a Navigation2-labelled block carrying
// the active destination_name + a MapPin row, the SI distance-to-arrival converted
// to the user's km/mi unit, minutes-to-arrival, and home/work/favourite presence
// chips). Each branch keeps its placeholder copy ("No media data" / "No active
// destination" / "No location data").
//
// Platform dependency swaps (no DOM, lucide, Recharts, Leaflet, or web UI per the
// conversion contract; each documented in the parity sidecar):
//   * react-i18next `useTranslation()` -> `useNativeTranslationFallback()` which
//     returns the English fallback while preserving every i18n key intent.
//   * `@/hooks/useUnits` `useUnits().unitPrefs.distance` + `@/lib/unitConversion`
//     `convertDistanceFromSI` -> `useNativeUnits()` over the ported `useSettings()`:
//     it derives `distanceUnit` ('mi' when `unit_of_length === 'mi'`, else 'km')
//     and an inline `convertDistanceFromSI` (meters/1000 for km, meters/1609.344
//     for mi) — `miles_to_arrival` is treated as SI meters exactly as the web does.
//   * `@/lib/numberFormat` `fmtNumber`/`fmtInt` -> inline formatters over the same
//     settings-derived locale + decimal_precision (numberFormat's global precision
//     default 2, clamped 0..20; `fmtInt` == precision 0), with the `safeNumber`
//     (0 for non-finite) and en-US `toLocaleString` fallback the web lib uses.
//   * `@/lib/cleanNil` `cleanNil` -> an inline value-identical Go-nil string filter.
//   * lucide `Headphones`/`Navigation2`/`MapPin` -> the repo SemanticIcon glyphs
//     ('headphones'/'navigationAlt'/'mapPinned', the established native mapping)
//     rendered as tinted AppText (purple-300 / muted / neon-cyan); the native app
//     ships no lucide/SVG renderer.
//   * `@/components/ui` `GlassPanel` -> native GlassPanel (style, not className).
//   * `@/components/ui` `Badge color={'green'|'amber'|'neutral'}` -> an inline Badge
//     pill. The shared web Badge keys off `variant`, not `color`, so the source's
//     explicit Playing->green / Paused->amber / else->neutral intent is preserved
//     verbatim and coloured via the theme success/warning/neutral palette (the
//     established native Badge convention).
//   * DOM div/span + Tailwind/CSS-vars -> RN View/AppText/tokens; the `--surface-2`
//     source chip background, the `white/[0.02]` cards, and the green/blue/purple
//     `-500` presence chips use their literal web dark-theme values.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {LocationSnapshot, MediaSnapshot} from '../../../../api/types';

// text-purple-300 (Tailwind purple-300) — the Headphones heading-icon tint.
const PURPLE_300 = '#d8b4fe';
// --neon-cyan (web dark theme) — the MapPin destination-icon tint.
const NEON_CYAN = '#00f0ff';
// --surface-2 (web dark theme) — the playback_source chip background.
const SURFACE_2 = '#151621';

// Presence chips: bg-green-500/10 · text-green-400 · border-green-500/20, etc.
const HOME_BG = 'rgba(34, 197, 94, 0.1)';
const HOME_BORDER = 'rgba(34, 197, 94, 0.2)';
const HOME_TEXT = '#4ade80';
const WORK_BG = 'rgba(59, 130, 246, 0.1)';
const WORK_BORDER = 'rgba(59, 130, 246, 0.2)';
const WORK_TEXT = '#60a5fa';
const FAVORITE_BG = 'rgba(168, 85, 247, 0.1)';
const FAVORITE_BORDER = 'rgba(168, 85, 247, 0.2)';
const FAVORITE_TEXT = '#c084fc';

// NIST factors mirrored from web @/lib/unitConversion (SI meters -> display unit).
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

// numberFormat module defaults: global precision starts at 2 (clamped 0..20) and
// the global locale falls back to en-US.
const DEFAULT_GLOBAL_PRECISION = 2;
const DEFAULT_LOCALE = 'en-US';

// lucide -> repo SemanticIcon glyphs (resolved once; no SVG renderer on native).
const HEADPHONES_GLYPH = getSemanticIconDefinition('headphones').glyph;
const NAVIGATION_GLYPH = getSemanticIconDefinition('navigationAlt').glyph;
const MAP_PIN_GLYPH = getSemanticIconDefinition('mapPinned').glyph;

type BadgeVariant = 'success' | 'warning' | 'neutral';

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next swap: no i18n runtime is wired on native, so this returns the
// English fallback while preserving the i18n key intent.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Value-identical inline of web @/lib/cleanNil: strips Go's literal nil strings.
function cleanNil(v?: string | null): string | undefined {
  if (!v || v === '<nil>' || v === 'nil' || v === 'null') {
    return undefined;
  }
  return v;
}

// Mirror of web @/lib/numberFormat `safeNumber`.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function formatWithDigits(
  value: number,
  locale: string,
  digits: number,
): string {
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  };
  try {
    return value.toLocaleString(locale, opts);
  } catch {
    return value.toLocaleString(DEFAULT_LOCALE, opts);
  }
}

// Mirror of numberFormat's global locale (settings.locale or en-US).
function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// Mirror of numberFormat.setGlobalPrecision: Math.max(0, Math.min(20, decimals)),
// with the module default of 2 when settings carry no usable decimal_precision.
function derivePrecision(decimalPrecision: number | undefined): number {
  if (
    typeof decimalPrecision !== 'number' ||
    !Number.isFinite(decimalPrecision)
  ) {
    return DEFAULT_GLOBAL_PRECISION;
  }
  return Math.max(0, Math.min(20, decimalPrecision));
}

// Native mirror of the web's `useUnits().unitPrefs.distance` + lib
// `convertDistanceFromSI` + numberFormat `fmtNumber`/`fmtInt`, all derived from the
// ported `useSettings()`.
function useNativeUnits(): {
  distanceUnit: 'km' | 'mi';
  toDistanceDisplay: (value: number) => number;
  fmtNumber: (value: unknown) => string;
  fmtInt: (value: unknown) => string;
} {
  const {data: settings} = useSettings();
  return useMemo(() => {
    const distanceUnit: 'km' | 'mi' =
      settings?.unit_of_length === 'mi' ? 'mi' : 'km';
    const locale = deriveLocale(settings?.locale);
    const precision = derivePrecision(settings?.decimal_precision);

    const toDistanceDisplay = (value: number): number =>
      distanceUnit === 'mi' ? value / METERS_PER_MILE : value / METERS_PER_KM;

    const fmtNumber = (value: unknown): string =>
      formatWithDigits(safeNumber(value), locale, precision);

    const fmtInt = (value: unknown): string =>
      formatWithDigits(safeNumber(value), locale, 0);

    return {distanceUnit, toDistanceDisplay, fmtNumber, fmtInt};
  }, [settings]);
}

// Inlined @/components/ui <Badge>: a rounded pill coloured by variant. Default web
// Badge sizing (px-2 py-0.5 text-xs font-medium rounded-full inline-flex gap-1).
function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeSurface[variant]]}>
      <AppText style={[styles.badgeText, badgeLabel[variant]]}>
        {children}
      </AppText>
    </View>
  );
}

interface MediaNavigationPanelProps {
  mediaData: MediaSnapshot | null | undefined;
  locationData: LocationSnapshot | null | undefined;
}

export function MediaNavigationPanel({
  mediaData,
  locationData,
}: MediaNavigationPanelProps) {
  const t = useNativeTranslationFallback();
  const {distanceUnit, toDistanceDisplay, fmtNumber, fmtInt} = useNativeUnits();

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={styles.titleIcon} weight="bold">
          {HEADPHONES_GLYPH}
        </AppText>
        <AppText style={styles.title} weight="semibold">
          {t('telemetry.mediaNav', 'Media & Navigation')}
        </AppText>
      </View>

      <View style={styles.sections}>
        {/* Now Playing */}
        <View>
          <AppText style={[styles.sectionLabel, styles.labelSpacing]} tone="muted">
            {t('telemetry.nowPlaying', 'Now Playing')}
          </AppText>
          {mediaData ? (
            <View style={styles.card}>
              <AppText style={styles.cardTitle} weight="bold" numberOfLines={1}>
                {cleanNil(mediaData.now_playing_title) ||
                  t('telemetry.nothingPlaying', 'Nothing playing')}
              </AppText>
              <AppText
                style={styles.cardSubtitle}
                tone="secondary"
                numberOfLines={1}>
                {cleanNil(mediaData.now_playing_artist) ||
                  t('telemetry.unknownArtist', 'Unknown artist')}
              </AppText>
              <View style={styles.metaRow}>
                {cleanNil(mediaData.playback_source) ? (
                  <View style={styles.sourceChip}>
                    <AppText style={styles.sourceChipText} tone="muted">
                      {cleanNil(mediaData.playback_source)}
                    </AppText>
                  </View>
                ) : null}
                {cleanNil(mediaData.playback_status) ? (
                  <Badge
                    variant={
                      mediaData.playback_status === 'Playing'
                        ? 'success'
                        : mediaData.playback_status === 'Paused'
                        ? 'warning'
                        : 'neutral'
                    }>
                    {cleanNil(mediaData.playback_status)}
                  </Badge>
                ) : null}
              </View>
            </View>
          ) : (
            <AppText style={styles.placeholder} tone="muted">
              {t('telemetry.noMediaData', 'No media data')}
            </AppText>
          )}
        </View>

        {/* Navigation destination */}
        <View>
          <View style={[styles.navLabelRow, styles.labelSpacing]}>
            <AppText style={styles.navLabelIcon} tone="muted">
              {NAVIGATION_GLYPH}
            </AppText>
            <AppText style={styles.sectionLabel} tone="muted">
              {t('telemetry.navigation', 'Navigation')}
            </AppText>
          </View>
          {locationData ? (
            <View style={styles.navStack}>
              {locationData.destination_name ? (
                <View style={styles.card}>
                  <View style={styles.destinationRow}>
                    <AppText style={styles.destinationIcon}>
                      {MAP_PIN_GLYPH}
                    </AppText>
                    <AppText
                      style={[styles.cardTitle, styles.destinationTitle]}
                      weight="bold"
                      numberOfLines={1}>
                      {locationData.destination_name}
                    </AppText>
                  </View>
                  <View style={styles.arrivalRow}>
                    {locationData.miles_to_arrival != null ? (
                      <AppText style={styles.arrivalText} tone="secondary">
                        {`${fmtNumber(
                          toDistanceDisplay(locationData.miles_to_arrival),
                        )} ${distanceUnit}`}
                      </AppText>
                    ) : null}
                    {locationData.minutes_to_arrival != null ? (
                      <AppText style={styles.arrivalText} tone="secondary">
                        {`${fmtInt(locationData.minutes_to_arrival)} ${t(
                          'common.minShort',
                          'min',
                        )}`}
                      </AppText>
                    ) : null}
                  </View>
                </View>
              ) : (
                <AppText style={styles.placeholder} tone="muted">
                  {t('telemetry.noActiveDestination', 'No active destination')}
                </AppText>
              )}
              <View style={styles.presenceRow}>
                {locationData.located_at_home ? (
                  <View style={[styles.presenceChip, styles.homeChip]}>
                    <AppText style={[styles.presenceText, styles.homeText]}>
                      {`🏠 ${t('telemetry.placeHome', 'Home')}`}
                    </AppText>
                  </View>
                ) : null}
                {locationData.located_at_work ? (
                  <View style={[styles.presenceChip, styles.workChip]}>
                    <AppText style={[styles.presenceText, styles.workText]}>
                      {`🏢 ${t('telemetry.placeWork', 'Work')}`}
                    </AppText>
                  </View>
                ) : null}
                {locationData.located_at_favorite ? (
                  <View style={[styles.presenceChip, styles.favoriteChip]}>
                    <AppText style={[styles.presenceText, styles.favoriteText]}>
                      {`⭐ ${t('telemetry.placeFavorite', 'Favorite')}`}
                    </AppText>
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <AppText style={styles.placeholder} tone="muted">
              {t('telemetry.noLocationData', 'No location data')}
            </AppText>
          )}
        </View>
      </View>
    </GlassPanel>
  );
}

MediaNavigationPanel.displayName = 'MediaNavigationPanel';

const styles = StyleSheet.create({
  // GlassPanel p-6 h-full (flex:1 fills the grid cell as h-full does on web).
  panel: {
    flex: 1,
    padding: 24,
  },
  // h3 .section-title flex items-center gap-2 mb-5.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  // Headphones h-4 w-4 text-purple-300.
  titleIcon: {
    color: PURPLE_300,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  // .section-title == text-lg font-semibold tracking-tight, color text-primary.
  title: {
    fontSize: 18,
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  // space-y-5 between the Now Playing and Navigation sections.
  sections: {
    gap: 20,
  },
  // text-[10px] uppercase tracking-wider text-[var(--text-muted)].
  sectionLabel: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  // mb-2 below each section label.
  labelSpacing: {
    marginBottom: 8,
  },
  // Navigation label row: flex items-center gap-1.
  navLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  // Navigation2 h-3 w-3 (inherits the muted label colour).
  navLabelIcon: {
    color: colors.textMuted,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.4,
  },
  // rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 (space-y-2 via gap).
  card: {
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 16,
    gap: 8,
  },
  // text-sm font-bold text-[var(--text-primary)] truncate.
  cardTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  // text-xs text-[var(--text-secondary)] truncate.
  cardSubtitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  // flex items-center gap-2 (source chip + status badge).
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // text-[10px] px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)].
  sourceChip: {
    borderRadius: 999,
    backgroundColor: SURFACE_2,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sourceChipText: {
    fontSize: 10,
    lineHeight: 14,
  },
  // Default web Badge: px-2 py-0.5 rounded-full inline-flex items-center.
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  // text-xs font-medium.
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  // space-y-3 inside the navigation block.
  navStack: {
    gap: 12,
  },
  // flex items-center gap-1.5 (MapPin + destination name).
  destinationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // MapPin h-3.5 w-3.5 text-neon-cyan flex-shrink-0.
  destinationIcon: {
    color: NEON_CYAN,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  // Lets the destination name truncate within the row beside the fixed icon.
  destinationTitle: {
    flex: 1,
  },
  // flex items-center gap-3 mt-2 text-xs text-[var(--text-secondary)].
  arrivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  arrivalText: {
    fontSize: 12,
    lineHeight: 16,
  },
  // flex items-center gap-2 flex-wrap.
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  // inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border.
  presenceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  presenceText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
  },
  homeChip: {
    backgroundColor: HOME_BG,
    borderColor: HOME_BORDER,
  },
  homeText: {
    color: HOME_TEXT,
  },
  workChip: {
    backgroundColor: WORK_BG,
    borderColor: WORK_BORDER,
  },
  workText: {
    color: WORK_TEXT,
  },
  favoriteChip: {
    backgroundColor: FAVORITE_BG,
    borderColor: FAVORITE_BORDER,
  },
  favoriteText: {
    color: FAVORITE_TEXT,
  },
  // text-xs text-[var(--text-muted)] empty-state copy.
  placeholder: {
    fontSize: 12,
    lineHeight: 16,
  },
});

const badgeSurface = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeLabel = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  neutral: {
    color: colors.textSecondary,
  },
});

// Native parity port of
// web/src/features/driving/components/drive-detail/DriveDetailHeader.tsx.
//
// The web header is a single flex row: a back <Link to="/drives"> (ArrowLeft),
// a flex-1 title block (an <h1> with a cyan Route icon + either
// "startAddress -> endAddress" or the i18n "Drive Details" fallback, and a
// muted <p> with the vehicle name + start date + start time w/ tz + optional
// end time), a replay <Link to="/drives/{id}/replay"> wrapping a ghost Button
// (Play), and a ghost Share Button (Share2) calling onShare.
//
// Conversion (rules 4/5/6/7):
//   • react-router-dom <Link> (L1, L22/L44) -> Pressable + an onNavigate(to)
//     callback prop carrying the destination path verbatim ('/drives',
//     `/drives/${driveId}/replay`); the established native-parity nav idiom
//     (VehicleHeroCard/TeslaAuthCard/EmptyState). No-op if unwired.
//   • react-i18next useTranslation (L2) -> inline English-fallback
//     useTranslation()/TFunc; all three keys preserved verbatim
//     (driveDetail.title / driveDetail.replay / driveDetail.share).
//   • lucide-react ArrowLeft/Route/Play/Share2 (L3) -> the canonical native
//     SemanticIcon glyphs 'back'/'trip'/'play'/'share' rendered as decorative
//     AppText; the Route glyph keeps the web text-cyan-400 via colors.accent.
//   • @/components/ui Button variant="ghost" size="sm" icon=... (L4, L45/L49)
//     -> inline ghost Pressables (h-8 px-3 text-xs rounded-md gap-2) with a
//     leading glyph + label, matching the web ghost button styling.
//   • @/components/motion FadeIn (L5) -> the native parity FadeIn.
//   • @/components/data-display DateTime in="vehicle" showTz (L6, L33/L35/L39)
//     -> inlined @/lib/dateFormat formatDate/formatTime + tzAbbreviation off the
//     native useSettings query locale. RN ships no ported useTimezone, so the
//     device zone is used (KioskOverlay/RouteMapSection/MotorHistoryWidget
//     precedent); showTz appends the device-zone abbreviation in a smaller span.
//   • @/types/driving DriveDetail (L7) -> imported from the canonical native
//     home '../../../../api/hooks/useDriving' (no type duplication).
//
// No DOM elements, react-router-dom, react-i18next, lucide-react, Recharts,
// Leaflet, react-dom, or web UI-kit modules are imported into the native output.

import React, {useCallback} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {useSettings} from '../../../../api/hooks/useSettings';
import type {DriveDetail} from '../../../../api/hooks/useDriving';
import {FadeIn} from '../../../../components/motion/FadeIn';
import {AppText} from '../../../../../components/ui/AppText';
import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../../theme/tokens';

const EM_DASH = '\u2014';
const MIDDOT = '\u00B7';
const ARROW = '\u2192';
const DEFAULT_LOCALE = 'en-US';

// lucide-react icons -> parity SemanticIcon glyphs (resolved once at module load).
const BACK_GLYPH = getSemanticIconDefinition('back').glyph; // ArrowLeft
const ROUTE_GLYPH = getSemanticIconDefinition('trip').glyph; // Route
const PLAY_GLYPH = getSemanticIconDefinition('play').glyph; // Play
const SHARE_GLYPH = getSemanticIconDefinition('share').glyph; // Share2

export interface DriveDetailHeaderProps {
  drive: DriveDetail;
  driveId: string;
  vehicleName: string;
  onShare: () => void;
  /**
   * Native navigation hook replacing react-router-dom's <Link>. Receives the
   * destination path string verbatim when the back/replay control is pressed.
   * No-op if unwired.
   */
  onNavigate?: (to: string) => void;
}

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while keeping
// every key at the call site. Every call here uses the t(key, fallback) shape.
type TFunc = (key: string, fallback?: string) => string;

function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/dateFormat formatDate / formatTime / tzAbbreviation ─── */

// web numberFormat/locale global: settings.locale when non-empty, else en-US.
function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// react-router-dom <DateTime in="vehicle"> resolves the vehicle's IANA zone via
// useTimezone; RN ships no ported useTimezone, so the device zone stands in.
function resolveDeviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

// web formatDate (variant="date"): "Apr 4, 2026"; em-dash for null/invalid.
function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// web formatTime (variant="time"): "02:30 PM"; em-dash for null/invalid.
function formatTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit'});
}

// web tzAbbreviation: short zone label (e.g. "PST"); '' on null/invalid/error.
function tzAbbreviation(
  iso: string | null | undefined,
  tz: string | undefined,
): string {
  if (!iso || !tz) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(d);
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/**
 * DriveDetailHeader — the drive-detail page header row: back control, route
 * title (start→end address or "Drive Details"), vehicle name + start/end
 * timestamps, and Replay / Share actions.
 */
export function DriveDetailHeader({
  drive,
  driveId,
  vehicleName,
  onShare,
  onNavigate,
}: DriveDetailHeaderProps) {
  const {t} = useTranslation();
  const {data: settings} = useSettings();

  const locale = deriveLocale(settings?.locale);
  const tz = resolveDeviceTimeZone();

  const title =
    drive.startAddress && drive.endAddress
      ? `${drive.startAddress} ${ARROW} ${drive.endAddress}`
      : t('driveDetail.title', 'Drive Details');

  const startDate = formatDate(drive.startTs, locale);
  const startTime = formatTime(drive.startTs, locale);
  const startTzAbbrev = tzAbbreviation(drive.startTs, tz);
  const endTime = drive.endTs ? formatTime(drive.endTs, locale) : null;

  return (
    <FadeIn>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('driveDetail.back', 'Back to drives')}
          onPress={() => onNavigate?.('/drives')}
          style={({pressed}) => [styles.backBtn, pressed && styles.backPressed]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.backGlyph}
            weight="bold">
            {BACK_GLYPH}
          </AppText>
        </Pressable>

        <View style={styles.titleCol}>
          <View style={styles.titleRow}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={styles.routeGlyph}
              weight="bold">
              {ROUTE_GLYPH}
            </AppText>
            <AppText style={styles.title} weight="bold">
              {title}
            </AppText>
          </View>
          <AppText style={styles.subtitle}>
            {`${vehicleName} ${MIDDOT} ${startDate} ${MIDDOT} ${startTime}`}
            {startTzAbbrev ? (
              <AppText style={styles.tzAbbrev}>{` ${startTzAbbrev}`}</AppText>
            ) : null}
            {endTime ? `  ${ARROW} ${endTime}` : null}
          </AppText>
        </View>

        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t('driveDetail.replay', 'Replay')}
          onPress={() => onNavigate?.(`/drives/${driveId}/replay`)}
          style={({pressed}) => [styles.ghostBtn, pressed && styles.ghostPressed]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.ghostGlyph}
            weight="bold">
            {PLAY_GLYPH}
          </AppText>
          <AppText style={styles.ghostLabel} weight="semibold">
            {t('driveDetail.replay', 'Replay')}
          </AppText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('driveDetail.share', 'Share')}
          onPress={onShare}
          style={({pressed}) => [styles.ghostBtn, pressed && styles.ghostPressed]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={styles.ghostGlyph}
            weight="bold">
            {SHARE_GLYPH}
          </AppText>
          <AppText style={styles.ghostLabel} weight="semibold">
            {t('driveDetail.share', 'Share')}
          </AppText>
        </Pressable>
      </View>
    </FadeIn>
  );
}

DriveDetailHeader.displayName = 'DriveDetailHeader';

const styles = StyleSheet.create({
  // flex items-center gap-4
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  // rounded-xl p-2.5 text-[var(--text-muted)] (hover:bg-surface-2)
  backBtn: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    padding: 10,
  },
  backPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  // ArrowLeft h-5 w-5, text-[var(--text-muted)]
  backGlyph: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 20,
  },
  // flex-1
  titleCol: {
    flexShrink: 1,
    flexGrow: 1,
    flexBasis: 0,
  },
  // text-2xl font-bold ... flex items-center gap-3
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  // Route h-6 w-6 text-cyan-400
  routeGlyph: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 18,
  },
  // text-2xl font-bold text-[var(--text-primary)]
  title: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 22,
    lineHeight: 28,
  },
  // text-sm text-[var(--text-muted)] mt-0.5
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  // ml-1 text-xs text-[var(--text-muted)]
  tzAbbrev: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  // ghost size="sm": h-8 px-3 text-xs rounded-md inline-flex items-center gap-2
  ghostBtn: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  // ghost hover:bg-gray-100 dark:hover:bg-gray-800
  ghostPressed: {
    backgroundColor: colors.surfaceHover,
  },
  // Play / Share2 h-4 w-4, inheriting the ghost button text color
  ghostGlyph: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  // ghost button label: text-xs font-medium, inheriting text color
  ghostLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
});

// VehicleHeader — native parity port of
// web/src/features/vehicles/components/vehicle-detail/VehicleHeader.tsx.
//
// The web component is the vehicle-detail page header: a GlassPanel (p-6) with a
// single centred row holding a back link (ArrowLeft -> /vehicles), a flex-1
// column carrying a status Badge (dot, lg) + a model/trim Badge (neutral, sm) on
// a wrapping row above the monospace VIN, and a primary "Wake Up" Button with a
// Power icon + loading spinner on the right.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - react-router-dom `Link to="/vehicles"` (web L1/L22-27): react-router is
//     DOM-only and forbidden in native output (rule 4). The back affordance is a
//     native <Pressable> that routes the web `to` target through an optional
//     `onNavigate(href)` navigation-shell bridge prop (the UsageCard /
//     RecentActivityFeed / AlertRulesPage / OnboardingPage / ErrorDisplay
//     precedent). When no shell callback is wired the press is a safe no-op while
//     the control stays visible — the documented native-safe unavailable state
//     for browser routing (rule 7).
//   - react-i18next `useTranslation` (web L2) -> the native-safe
//     `useNativeTranslationFallback` t(key, fallback) hook (no i18n runtime in
//     the parity tree; the sibling MotorSection / InputCommandTile precedent).
//     Every t() key + English fallback is preserved verbatim.
//   - lucide-react `ArrowLeft` / `Power` (web L3): lucide is browser-only SVG and
//     forbidden in native output (rule 4). Each is rendered via the native
//     SemanticIcon glyph vocabulary — ArrowLeft -> 'back' ('<'), Power ->
//     'power' ('PW') — precomputed once as consts.
//   - `@/components/ui` GlassPanel (web L5) -> the native GlassPanel.
//   - `@/components/ui` Badge (web L5): no native Badge parity port exists yet, so
//     a local Badge is built from RN primitives reproducing the web Badge
//     (rounded-full tinted chip, optional bg-current dot, variant + size). The
//     dark-theme tints follow the StatusPill / SemanticIcon idiom (translucent
//     surface + matching border + coloured text). Only the slots this file uses
//     are ported (variant/size/dot/children).
//   - `@/components/ui` Button (web L5): the native AppButton has no loading/icon
//     slots, so a local WakeButton (Pressable) reproduces the web primary Button
//     — leading Power glyph swapped for an ActivityIndicator while loading,
//     disabled-while-loading, opacity-50 disabled state — matching the slots this
//     file uses (onClick/loading/icon/children).
//   - `@/api/types` Vehicle / VehicleStatus + `./helpers` statusVariant (web
//     L6-7): the web helpers module only re-exports statusVariant from
//     @/api/types, so both the types and statusVariant are read directly from the
//     native web-parity api/types (same snake_case shape + BadgeVariant mapping).
// No DOM / react-router-dom / lucide-react / Recharts / Leaflet / old web-UI
// imports — RN primitives only. See the .parity.json sidecar for the line map.

import React from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {
  statusVariant,
  type BadgeVariant,
  type Vehicle,
  type VehicleStatus,
} from '../../../../api/types';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback;
}

// web L3 lucide glyphs -> native SemanticIcon glyph vocabulary.
const ARROW_LEFT_GLYPH = getSemanticIconDefinition('back').glyph;
const POWER_GLYPH = getSemanticIconDefinition('power').glyph;

// font-mono (web VIN, L37) -> the platform monospace face (WidgetDetailCard).
const monoFontFamily = Platform.select({ios: 'Courier', default: 'monospace'});

// ---- Local Badge (web @/components/ui Badge) --------------------------------
// Reproduces the web Badge: a rounded-full tinted chip with an optional
// bg-current dot ahead of the label. Dark-theme tints mirror StatusPill /
// SemanticIcon (translucent surface + matching border + coloured text). Only the
// slots this file uses are ported (variant/size/dot/children).

type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeTint {
  bg: string;
  border: string;
  text: string;
}

const BADGE_TINT: Record<BadgeVariant, BadgeTint> = {
  info: {bg: colors.accentSoft, border: colors.borderAccent, text: colors.accent},
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  warning: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    text: colors.warning,
  },
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    text: colors.danger,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
};

function Badge({
  variant = 'neutral',
  size = 'md',
  dot = false,
  children,
}: {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children: string;
}): React.ReactElement {
  const tint = BADGE_TINT[variant];

  return (
    <View
      style={[
        styles.badge,
        badgeSizeStyles[size],
        {backgroundColor: tint.bg, borderColor: tint.border},
      ]}>
      {dot ? <View style={[styles.badgeDot, {backgroundColor: tint.text}]} /> : null}
      <AppText
        numberOfLines={1}
        style={[styles.badgeText, badgeTextSizeStyles[size], {color: tint.text}]}>
        {children}
      </AppText>
    </View>
  );
}

Badge.displayName = 'Badge';

// ---- Local WakeButton (web @/components/ui Button, primary) ------------------
// Reproduces the web primary Button used here: a centred row with a leading Power
// glyph (swapped for an ActivityIndicator while loading), the label, the
// disabled-while-loading guard, and the opacity-50 disabled state.

function WakeButton({
  loading,
  onPress,
  children,
}: {
  loading: boolean;
  onPress: () => void;
  children: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={children}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: loading}}
      disabled={loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.wakeButton,
        loading && styles.wakeButtonDisabled,
        pressed && !loading && styles.wakeButtonPressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : (
        <AppText style={styles.wakeIcon}>{POWER_GLYPH}</AppText>
      )}
      <AppText style={styles.wakeLabel}>{children}</AppText>
    </Pressable>
  );
}

WakeButton.displayName = 'WakeButton';

// ---- Component --------------------------------------------------------------

interface VehicleHeaderProps {
  vehicle: Vehicle | undefined;
  status: VehicleStatus;
  onWake: () => void;
  waking: boolean;
  // Native bridge for the web `Link to="/vehicles"` (react-router is DOM-only).
  onNavigate?: (href: string) => void;
}

export function VehicleHeader({
  vehicle,
  status,
  onWake,
  waking,
  onNavigate,
}: VehicleHeaderProps): React.ReactElement {
  const t = useNativeTranslationFallback();

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.row}>
        <Pressable
          accessibilityLabel={t('common.back', 'Back')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onNavigate?.('/vehicles')}
          style={({pressed}) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}>
          <AppText style={styles.backGlyph} tone="muted">
            {ARROW_LEFT_GLYPH}
          </AppText>
        </Pressable>
        <View style={styles.middle}>
          <View style={styles.badgeRow}>
            <Badge dot size="lg" variant={statusVariant(status)}>
              {status}
            </Badge>
            <Badge size="sm" variant="neutral">
              {`${vehicle?.model ?? ''} ${vehicle?.trim_badging ?? ''}`}
            </Badge>
          </View>
          <AppText numberOfLines={1} style={styles.vin} tone="muted">
            {vehicle?.vin ?? ''}
          </AppText>
        </View>
        <WakeButton loading={waking} onPress={onWake}>
          {t('common.wakeUp', 'Wake Up')}
        </WakeButton>
      </View>
    </GlassPanel>
  );
}

VehicleHeader.displayName = 'VehicleHeader';

const styles = StyleSheet.create({
  // web GlassPanel `p-6` (L20).
  panel: {
    padding: 24,
  },
  // web `flex items-center gap-4` (L21).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  // web Link `rounded-xl p-2.5` (L22-25) back affordance.
  backButton: {
    borderRadius: 12,
    padding: 10,
  },
  // web Link `hover:bg-[var(--surface-2)]` (L24) -> pressed bg (no RN hover).
  backButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  // web ArrowLeft `h-5 w-5 text-[var(--text-muted)]` (L24/26) -> muted glyph.
  backGlyph: {
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // web `flex-1 min-w-0` (L28).
  middle: {
    flex: 1,
    minWidth: 0,
  },
  // web `flex items-center gap-3 flex-wrap` (L29).
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
  },
  // web VIN `text-sm text-[var(--text-muted)] mt-1 truncate font-mono` (L37-39).
  vin: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
    fontFamily: monoFontFamily,
  },
  // web Badge root `inline-flex items-center gap-1 rounded-full font-medium` (L32).
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  // web Badge dot `h-1.5 w-1.5 rounded-full bg-current` (L43); colour set dynamically.
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // web Badge `font-medium` (L32) -> fontWeight 500; colour set dynamically.
  badgeText: {
    fontWeight: '500',
  },
  // web Button root `... rounded-md font-medium` + size md `h-10 px-4` (L41).
  wakeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: colors.accent,
  },
  // web Button `disabled:opacity-50` while loading.
  wakeButtonDisabled: {
    opacity: 0.5,
  },
  wakeButtonPressed: {
    opacity: 0.82,
  },
  // web Button Power icon `h-4 w-4` inheriting the button text colour (L44).
  wakeIcon: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: colors.background,
  },
  // web Button label `text-sm font-medium text-white` (L46) on the accent fill.
  wakeLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.background,
  },
});

const badgeSizeStyles = StyleSheet.create({
  // web badgeSizes.sm `px-1.5 py-0.5` (Badge L13).
  sm: {paddingHorizontal: 6, paddingVertical: 2},
  // web badgeSizes.md `px-2 py-0.5` (Badge L14).
  md: {paddingHorizontal: 8, paddingVertical: 2},
  // web badgeSizes.lg `px-2.5 py-1` (Badge L15).
  lg: {paddingHorizontal: 10, paddingVertical: 4},
});

const badgeTextSizeStyles = StyleSheet.create({
  // web badgeSizes.sm/md `text-xs`.
  sm: {fontSize: 12, lineHeight: 16},
  md: {fontSize: 12, lineHeight: 16},
  // web badgeSizes.lg `text-sm`.
  lg: {fontSize: 14, lineHeight: 20},
});

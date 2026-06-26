// Native parity port of web/src/features/vehicles/components/VehicleHeader.tsx.
//
// Renders the vehicle-detail header row: a back link, the vehicle title +
// live status badge, a model/trim/VIN subtitle, and a "Wake Up" action button.
// The web file leans on browser-only dependencies that are absent from the
// native parity manifest (contract rules 4, 5 & 7); each is replaced with a
// React Native-safe equivalent and documented here + in the sidecar:
//
//   - react-router-dom `Link` (web L1, L35-40) -> a React Native Pressable with
//     accessibilityRole="link" that calls the optional `onNavigate(path)` prop.
//     The native web-parity tree has no in-app router, so the route target
//     ('/vehicles') is preserved on the prop and navigation is delegated to the
//     host screen (matching the sibling RecentActivity port). The web hover
//     bg/text-brighten maps to a Pressable pressed-state background tint.
//   - react-i18next `useTranslation` (web L2, L17) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('common.x', 'English') call keeps its key intent + English default.
//   - lucide-react icons (web L3): ArrowLeft renders as a bare '\u2190' AppText
//     glyph inside the back link (a bare muted arrow, matching the web bare-icon
//     touch target); Power renders as the shared native SemanticIcon
//     ('power', decorative) as the Wake Up button's leading icon.
//   - @/components/ui/Button (web L4, L56-62) -> a local WakeButton Pressable
//     reproducing the web primary Button: leading icon (or a loading
//     ActivityIndicator), label, disabled-while-loading + aria-busy semantics
//     (matching the SignalLogViewerPage PrimaryButton port).
//   - @/components/motion/FadeIn (web L5, L33) -> a local Animated.View mount
//     fade reproducing the framer-motion entry (opacity 0->1, translateY 12->0,
//     400ms easeOut), matching the sibling RecentActivity FadeIn port.
//   - @/components/data-display/StatusBadge (web L6, L46-49) -> the ported native
//     StatusBadge (same status + size contract).
//   - @/api/hooks/useVehicles useWakeVehicle / getVehicleStatus (web L7) -> the
//     ported native web-parity hooks (identical contracts).
//   - @/api/types Vehicle / VehicleState / VehicleStatus (web L8) -> imported from
//     the ported native web-parity api/types (identical shapes).
//
// No DOM-only modules, HTML elements, react-router-dom, react-i18next,
// lucide-react, Recharts, Leaflet, or web UI components are imported -- only
// react, react-native primitives, the shared native SemanticIcon / AppText /
// theme tokens, and the ported parity StatusBadge / useVehicles / api types.

import React, {useEffect, useRef, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {getVehicleStatus, useWakeVehicle} from '../../../api/hooks/useVehicles';
import type {Vehicle, VehicleState, VehicleStatus} from '../../../api/types';
import {StatusBadge} from '../../../components/data-display/StatusBadge';

/** FadeIn entry timing — mirrors the web framer-motion FadeIn duration. */
const FADE_DURATION_MS = 400;

/** lucide-react ArrowLeft -> bare left-arrow glyph (U+2190). */
const ARROW_LEFT = '\u2190';

/** HTML `&middot;` (web L52) -> middle dot (U+00B7). */
const MIDDOT = '\u00B7';

/** `font-mono` (web L53) -> a platform-selected monospace family. */
const MONO_FONT = Platform.select({ios: 'Courier', default: 'monospace'});

// ── react-i18next useTranslation replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

/** Returns the English fallback so the translation-key intent is preserved. */
function useNativeTranslation(): NativeTFunction {
  return React.useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * `@/components/motion` FadeIn -> Animated.View mount fade reproducing the web
 * framer-motion entry: opacity 0->1, translateY 12->0, 400ms easeOut, after the
 * caller-supplied `delay` (seconds, like the web prop).
 */
function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: FADE_DURATION_MS,
      delay: delay * 1000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

/**
 * `@/components/ui` Button (primary) -> a Pressable reproducing the web button:
 * a leading `icon` (or a loading ActivityIndicator) + label, disabled while
 * loading with aria-busy semantics. Mirrors the SignalLogViewerPage port.
 */
function WakeButton({
  icon,
  label,
  loading = false,
  onPress,
}: {
  icon?: ReactNode;
  label: string;
  loading?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: loading}}
      disabled={loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.wakeButton,
        loading && styles.wakeButtonDisabled,
        pressed && !loading && styles.pressedDim,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : icon ? (
        <View style={styles.wakeButtonIcon}>{icon}</View>
      ) : null}
      <AppText style={styles.wakeButtonLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

interface VehicleHeaderProps {
  vehicle: Vehicle | undefined;
  state: VehicleState | undefined;
  onRefetchState: () => void;
  /**
   * Native-only: routes the back link target ('/vehicles'). The web-parity tree
   * has no in-app router, so navigation is delegated to the host screen
   * (matching the sibling RecentActivity port).
   */
  onNavigate?: (path: string) => void;
}

export function VehicleHeader({
  vehicle,
  state,
  onRefetchState,
  onNavigate,
}: VehicleHeaderProps) {
  const t = useNativeTranslation();
  const vehicleId = vehicle?.id ?? 0;

  const status: VehicleStatus = vehicle ? getVehicleStatus(state) : 'offline';

  const wakeMut = useWakeVehicle();

  const handleWake = () => {
    wakeMut.mutate(vehicleId, {
      onSuccess: () => {
        setTimeout(() => onRefetchState(), 5000);
      },
    });
  };

  return (
    <FadeIn>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel={t('common.back', 'Back')}
          accessibilityRole="link"
          onPress={() => onNavigate?.('/vehicles')}
          style={({pressed}) => [
            styles.backLink,
            pressed && styles.backLinkPressed,
          ]}>
          <AppText style={styles.backGlyph}>{ARROW_LEFT}</AppText>
        </Pressable>
        <View style={styles.titleColumn}>
          <View style={styles.titleRow}>
            <AppText style={styles.title}>
              {vehicle?.display_name ||
                vehicle?.vin ||
                t('common.vehicle', 'Vehicle')}
            </AppText>
            <StatusBadge size="md" status={status} />
          </View>
          <AppText style={styles.subtitle}>
            {vehicle?.model} {vehicle?.trim_badging} {MIDDOT}{' '}
            <AppText style={styles.subtitleMono}>{vehicle?.vin}</AppText>
          </AppText>
        </View>
        <WakeButton
          icon={<SemanticIcon decorative name="power" size="sm" />}
          label={t('common.wakeUp', 'Wake Up')}
          loading={wakeMut.isPending}
          onPress={handleWake}
        />
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  backGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 20,
  },
  backLink: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    padding: 10,
  },
  backLinkPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
  },
  pressedDim: {
    opacity: 0.82,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  subtitleMono: {
    color: colors.textMuted,
    fontFamily: MONO_FONT,
    fontSize: 14,
  },
  title: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.7,
    lineHeight: 36,
  },
  titleColumn: {
    flex: 1,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  wakeButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 16,
  },
  wakeButtonDisabled: {
    opacity: 0.48,
  },
  wakeButtonIcon: {
    flexShrink: 0,
  },
  wakeButtonLabel: {
    color: colors.background,
    fontSize: 14,
  },
});

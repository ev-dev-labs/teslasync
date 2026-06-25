// Native parity port of web/src/components/layout/PageHeader.tsx.
//
// The web component is a standard page header: a `FadeIn`-wrapped flex row with
// a gradient `Heading level="page"` title, a decorative gradient underline bar,
// an optional subtitle, an optional leading icon, and a right-aligned action
// cluster that can include a `CopyLinkButton`. It is reproduced here with React
// Native primitives:
//
//   - The web `FadeIn` (framer-motion opacity 0->1 + slide-up y 12->0, honouring
//     prefers-reduced-motion) becomes an inline native `FadeIn` Animated.View
//     entrance, reduce-motion-aware via AccessibilityInfo (the same pattern the
//     StatCard / Spinner parity ports use). framer-motion is browser-only.
//   - The web `Heading level="page"` with its `bg-gradient-to-r from-white via-
//     white to-gray-400 bg-clip-text text-transparent` gradient text has no
//     native gradient-fill primitive (no react-native-linear-gradient dependency
//     here), so the title renders solid near-white (`colors.textPrimary`, the
//     dominant "from-white" stop) as an `accessibilityRole="header"` AppText with
//     responsive page-title sizing (text-xl / sm:text-2xl / lg:text-3xl).
//   - The decorative `bg-gradient-to-r from-neon-cyan to-neon-purple opacity-60`
//     underline becomes a solid `colors.accent` (neon-cyan) rounded bar at 0.6
//     opacity; the cyan->violet gradient is flattened to the accent stop.
//   - The web `CopyLinkButton` copies `window.location.href` via the Clipboard
//     API + toast; both are browser-only and there is no Clipboard/URL bar in
//     this native app, so an inline native CopyLinkButton exposes an additive
//     `onCopyLink` escape hatch (a screen can wire native Share/Clipboard). When
//     no handler is supplied the control renders in an explicit disabled
//     "unavailable" state. The i18n keys (`common.copyLink.*`) are preserved via
//     a local t() fallback shim; the web toast has no native parity and is
//     dropped in favour of the inline "Copied" state.
//   - Tailwind utility classes + DOM `<div>`/`<p>` become RN View/AppText with
//     StyleSheet + theme tokens; the `sm:` (640px) and `lg:` (1024px) responsive
//     breakpoints are reproduced via `useWindowDimensions`.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

/** Tailwind `sm` breakpoint — drives the column->row + size step-ups. */
const SM_BREAKPOINT = 640;
/** Tailwind `lg` breakpoint — drives the largest page-title size (text-3xl). */
const LG_BREAKPOINT = 1024;
/** Web `FadeIn` default duration (useMotionPreference(400)). */
const FADE_DURATION_MS = 400;
/** Web CopyLinkButton resets the copied state after window.setTimeout(_, 2000). */
const COPIED_RESET_MS = 2000;

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * react-i18next `useTranslation` is unavailable in native parity; this shim
 * returns the English fallback copy verbatim while preserving the i18n keys.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/** Mirrors the StatCard/Spinner reduce-motion source-of-truth. */
function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/**
 * Native parity for the web `FadeIn`: fades + slides children up on mount. When
 * reduce-motion is requested the children render in their final state with no
 * entry animation, matching the web reduce branch.
 */
function FadeIn({children}: {children: ReactNode}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      duration: FADE_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();

    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
        }),
      },
    ],
  };

  return <Animated.View style={animatedStyle}>{children}</Animated.View>;
}

/**
 * Native-safe replacement for the web `CopyLinkButton`. The browser flow (read
 * `window.location.href`, write to the Clipboard, toast on success) has no native
 * equivalent here, so callers wire native Share/Clipboard via `onCopyLink`. With
 * no handler the control is rendered disabled (explicit unavailable state).
 */
function CopyLinkButton({onCopyLink}: {onCopyLink?: () => void | Promise<void>}) {
  const t = useNativeTranslationFallback();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const available = typeof onCopyLink === 'function';

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  const handlePress = useCallback(async () => {
    if (!onCopyLink) {
      return;
    }
    try {
      await onCopyLink();
      setCopied(true);
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
      resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch {
      // Web mirrors a toast.error here; native has no toast, so the copied
      // state simply stays false and the action is treated as a no-op.
    }
  }, [onCopyLink]);

  return (
    <Pressable
      accessibilityLabel={t('common.copyLink.label', 'Copy link to this view')}
      accessibilityRole="button"
      accessibilityState={{disabled: !available}}
      disabled={!available}
      hitSlop={6}
      onPress={handlePress}
      style={({pressed}) => [
        styles.copyButton,
        !available && styles.copyButtonDisabled,
        pressed && available && styles.copyButtonPressed,
      ]}
      testID="page-header-copy-link">
      <AppText style={styles.copyGlyph} tone="accent">
        {copied ? '\u2713' : '\u29C9'}
      </AppText>
      <AppText style={styles.copyLabel} tone={available ? 'secondary' : 'muted'}>
        {copied
          ? t('common.copyLink.copied', 'Copied')
          : t('common.copyLink.action', 'Copy link')}
      </AppText>
    </Pressable>
  );
}

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  /**
   * Show a "Copy link" button. On the web this copies the current URL (with all
   * query params baked in); on native there is no URL bar, so the button defers
   * to `onCopyLink` (native Share/Clipboard) and is disabled when none is wired.
   * Use on pages where users would reasonably share a filtered view.
   */
  copyLink?: boolean;
  /**
   * Native-safe replacement for the browser Clipboard copy. Invoked when the
   * copy-link button is pressed; absent => the button renders in a disabled
   * "unavailable" state.
   */
  onCopyLink?: () => void | Promise<void>;
  /** Native style override on the outer header container. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Standard page header with title, decorative underline, optional subtitle and actions. */
export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
  copyLink,
  onCopyLink,
  style,
  testID,
}: PageHeaderProps) {
  const {width} = useWindowDimensions();
  const isWide = width >= SM_BREAKPOINT;
  const isXWide = width >= LG_BREAKPOINT;

  const titleSize = isXWide ? 30 : isWide ? 24 : 20;
  const titleLine = Math.round(titleSize * 1.2);

  return (
    <FadeIn>
      <View
        style={[
          styles.container,
          {
            flexDirection: isWide ? 'row' : 'column',
            gap: isWide ? spacing.md + spacing.xs : spacing.md,
            marginBottom: isWide ? spacing.xl + spacing.xs : spacing.lg + spacing.xs,
          },
          isWide && styles.containerWide,
          style,
        ]}
        testID={testID ?? 'page-header'}>
        <View style={styles.titleRow}>
          {icon ? <View style={styles.iconWrap}>{icon}</View> : null}
          <View style={styles.titleBlock}>
            <AppText
              accessibilityRole="header"
              style={[styles.title, {fontSize: titleSize, lineHeight: titleLine}]}>
              {title}
            </AppText>
            <View
              style={[
                styles.underline,
                {marginTop: isWide ? spacing.sm : 6, width: isWide ? 64 : 48},
              ]}
            />
            {subtitle ? (
              <AppText
                style={[
                  styles.subtitle,
                  {fontSize: isWide ? 14 : 12, marginTop: isWide ? spacing.sm : 6},
                ]}
                tone="secondary">
                {subtitle}
              </AppText>
            ) : null}
          </View>
        </View>
        {actions || copyLink ? (
          <View style={[styles.actionsRow, {gap: isWide ? spacing.md : spacing.sm}]}>
            {copyLink ? <CopyLinkButton onCopyLink={onCopyLink} /> : null}
            {actions}
          </View>
        ) : null}
      </View>
    </FadeIn>
  );
}

PageHeader.displayName = 'PageHeader';

const styles = StyleSheet.create({
  actionsRow: {
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    maxWidth: '100%',
    minWidth: 0,
  },
  container: {
    width: '100%',
  },
  containerWide: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  copyButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  copyButtonDisabled: {
    opacity: 0.48,
  },
  copyButtonPressed: {
    opacity: 0.82,
  },
  copyGlyph: {
    fontSize: 13,
    lineHeight: 18,
  },
  copyLabel: {
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  iconWrap: {
    marginTop: spacing.xs,
  },
  subtitle: {
    lineHeight: 20,
  },
  title: {
    color: colors.textPrimary,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  titleBlock: {
    flexShrink: 1,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  underline: {
    backgroundColor: colors.accent,
    borderRadius: 9999,
    height: 2,
    opacity: 0.6,
  },
});

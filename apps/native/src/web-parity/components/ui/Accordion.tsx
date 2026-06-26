// Native parity port of web/src/components/ui/Accordion.tsx.
//
// Replaces the framer-motion <AnimatePresence>/<motion.div> reveal, the lucide
// <ChevronDown/> icon, the cn() Tailwind class composer, the DOM <div>/<button>,
// and the CSS-var color tokens (--text-primary, --text-muted) with React Native
// primitives (View/Pressable/Animated), the shared AppText, theme tokens, and a
// text-glyph chevron.
//
// Behavior is preserved 1:1: the controlled/uncontrolled open contract (the
// component is controlled only when BOTH `open` and `onOpenChange` are supplied,
// otherwise it owns `internalOpen` seeded from `defaultOpen`), the header layout
// (optional icon, flex title, badge, headerExtra, trailing chevron), and the
// animated body reveal. RN cannot animate to height:'auto', so a single
// `progress` value (0 collapsed -> 1 expanded) drives a measured-height clip plus
// opacity for the body and the chevron's 0deg -> 180deg rotation, mirroring the
// web `height 0 -> auto` + `opacity 0 -> 1` + `rotate-180` over a 0.2s curve.
// AnimatePresence's exit-then-unmount lifecycle is reproduced by keeping the body
// mounted while open OR while the close animation plays out, then unmounting.
//
// The DOM-only className override props (className/headerClassName/bodyClassName)
// have no native analog; they are replaced by style/headerStyle/bodyStyle
// (StyleProp<ViewStyle>) that preserve the same "override the default px-4 py-3
// padding, else fall back to it" semantics, documented in the parity sidecar.

import React, {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// framer `transition={{ duration: 0.2 }}` — the body reveal / chevron spin curve.
const REVEAL_DURATION_MS = 200;

export interface AccordionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /**
   * Optional controlled open state. When both `open` and `onOpenChange`
   * are provided the component switches to controlled mode and ignores
   * `defaultOpen` (parent owns the source of truth — useful for URL
   * state, persisting across remount, or programmatic toggling).
   */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  icon?: ReactNode;
  badge?: ReactNode;
  /** Optional content rendered to the right of the badge inside the header. */
  headerExtra?: ReactNode;
  /** Native override for the web `headerClassName` (default `px-4 py-3`). */
  headerStyle?: StyleProp<ViewStyle>;
  /** Native override for the web `bodyClassName` (default `px-4 py-3`). */
  bodyStyle?: StyleProp<ViewStyle>;
  /** Native composition hook replacing the web `className`. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Collapsible content section with animated reveal. Controlled when `open`+`onOpenChange` provided. */
export function Accordion({
  title,
  children,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  icon,
  badge,
  headerExtra,
  headerStyle,
  bodyStyle,
  style,
  testID,
}: AccordionProps) {
  const isControlled = openProp !== undefined && onOpenChange !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isControlled ? (openProp as boolean) : internalOpen;
  const setOpen = (next: boolean) => {
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  };

  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [measuredHeight, setMeasuredHeight] = useState(0);
  // Keep the body mounted while open OR while the close animation runs, then
  // unmount — the native analog of framer's AnimatePresence exit lifecycle.
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
    }
    const animation = Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: REVEAL_DURATION_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    });
    animation.start(({finished}) => {
      if (finished && !open) {
        setRendered(false);
      }
    });
    return () => animation.stop();
  }, [open, progress]);

  const animatedHeight =
    measuredHeight > 0
      ? progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, measuredHeight],
        })
      : undefined;

  const chevronRotation = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const handleBodyLayout = (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    if (height > 0 && height !== measuredHeight) {
      setMeasuredHeight(height);
    }
  };

  return (
    <View style={[styles.container, style]} testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(!open)}
        style={({pressed}) => [
          styles.header,
          headerStyle ? null : styles.headerPadding,
          headerStyle,
          pressed ? styles.headerPressed : null,
        ]}>
        {icon ? <View>{icon}</View> : null}
        <AppText style={styles.title}>{title}</AppText>
        {badge}
        {headerExtra}
        <Animated.Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.chevron, {transform: [{rotate: chevronRotation}]}]}>
          {'\u25BE'}
        </Animated.Text>
      </Pressable>
      {rendered ? (
        <Animated.View
          style={[
            styles.bodyClip,
            animatedHeight !== undefined ? {height: animatedHeight} : null,
            {opacity: progress},
          ]}>
          <View
            onLayout={handleBodyLayout}
            style={[
              styles.body,
              bodyStyle ? null : styles.bodyPadding,
              bodyStyle,
            ]}>
            {children}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

Accordion.displayName = 'Accordion';

const styles = StyleSheet.create({
  body: {
    borderTopColor: 'rgba(255, 255, 255, 0.04)',
    borderTopWidth: 1,
  },
  bodyClip: {
    overflow: 'hidden',
  },
  bodyPadding: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 16,
  },
  container: {
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerPadding: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});

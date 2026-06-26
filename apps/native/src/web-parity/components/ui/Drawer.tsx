// Native parity port of web/src/components/ui/Drawer.tsx.
//
// Shared `<Drawer>` primitive — a slide-in side panel with an optional title
// header (+ close button), a scrollable body, and an optional footer. The
// vendor-agnostic contract is preserved verbatim: the `open`/`onClose`
// gating, the `side` ('left' | 'right') slide origin, the title/footer
// conditional rendering, the backdrop-tap-to-close, and the Escape-to-close
// behaviour. Only the DOM/animation layer is re-expressed with React Native
// primitives:
//
//   - `react-dom` `createPortal(..., document.body)` (web L3, L50, L89) -> a
//     transparent React Native `Modal`, which is itself the portal/overlay
//     analogue and additionally captures the Android hardware-back / desktop
//     Escape gesture via `onRequestClose` (the web Escape-to-close handler at
//     web L33). The `role="dialog"` / `aria-modal="true"` / `aria-label`
//     (web L51) map to the panel's `accessibilityViewIsModal` +
//     `accessibilityLabel` (falling back to 'Panel' exactly as the web did).
//   - `framer-motion` `motion` (web L2): there is no DOM motion engine on
//     React Native, so the backdrop fade (opacity 0->1, web L53-55) and the
//     panel slide (x '100%'/'-100%' -> 0 with a spring, damping 30 /
//     stiffness 300, web L61-64) are reimplemented with the `Animated` API.
//     A single `progress` value (0 = hidden, 1 = shown) drives both the
//     backdrop opacity and the panel translateX; the spring config mirrors the
//     web `{ type: 'spring', damping: 30, stiffness: 300 }`. The web `exit`
//     variants (web L55, L63) only play under an ancestor `AnimatePresence`;
//     since the native `Modal` owns its own visibility, the exit slide is
//     reproduced with a deferred-unmount (`mounted` state): when `open` flips
//     false the panel animates out first, then unmounts — the same pattern the
//     sibling Toast port uses for AnimatePresence parity. Percentage
//     translateX is not supported by the native driver, so the off-screen
//     offset is the panel's own measured width (via `onLayout`), defaulting to
//     the screen width so the panel starts fully off-screen before its first
//     layout pass.
//   - `@/lib/cn` className composition (web L4) -> RN `StyleSheet` style arrays
//     + per-side style maps. The web `className` escape hatch (web L16, L68)
//     becomes an optional `style?: StyleProp<ViewStyle>` merged onto the panel
//     at the same position cn() appended it.
//   - `lucide-react` `X` (web L5, L75): no native icon module in this tree, so
//     the close affordance renders the inline glyph `✕` (the dismiss-glyph
//     approach the Toast / QueryError ports use). Its `aria-label="Close"`
//     (web L74) maps to the Pressable `accessibilityLabel`.
//   - The DOM focus-trap (web L7 `FOCUSABLE_SELECTOR`, L23-47: auto-focus the
//     first focusable, cycle Tab within the drawer, restore the previously
//     focused element on close) relies on `document.activeElement`,
//     `querySelectorAll`, `HTMLElement.focus()` and DOM key events that React
//     Native core does not expose portably across iOS/Android/Windows/macOS.
//     The native `Modal` already contains screen-reader focus within the
//     overlay, so the Tab cycling, explicit first-element auto-focus, and
//     focus restoration are dropped; only the Escape branch (web L33) survives,
//     mapped to `onRequestClose`. The `glass-panel`, `backdrop-blur-sm` /
//     `backdrop-blur-xl`, `rounded-none`, `transition-colors`, and `hover:`
//     states have no RN analogue and are dropped (the blur becomes a flat
//     translucent overlay).

import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { AppText } from '../../../components/ui/AppText';
import { colors, shadows } from '../../../theme/tokens';

export interface DrawerProps {
  /** Whether the drawer is shown. When false the panel animates out and the
   *  native Modal unmounts. */
  open: boolean;
  /** Invoked when the user taps the backdrop, the close button, or triggers the
   *  Android back / desktop Escape gesture. */
  onClose: () => void;
  /** Optional header title. When omitted the header (and close button) is not
   *  rendered, matching the web. */
  title?: string;
  /** Scrollable body content. */
  children: ReactNode;
  /** Optional pinned footer content. */
  footer?: ReactNode;
  /** Edge the panel slides in from. Defaults to 'right'. */
  side?: 'left' | 'right';
  /** Native analogue of the web `className` escape hatch — extra style merged
   *  onto the panel container at the same position cn() appended it. */
  style?: StyleProp<ViewStyle>;
}

const SLIDE_OUT_DURATION_MS = 200;

/** Slide-in side panel. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  side = 'right',
  style,
}: DrawerProps): React.ReactElement | null {
  // Keep the overlay mounted through the exit animation (AnimatePresence parity).
  const [mounted, setMounted] = useState(open);
  // Off-screen slide distance: the panel's own width once measured, defaulting
  // to the screen width so it starts fully off-screen before the first layout.
  const [panelWidth, setPanelWidth] = useState(
    () => Dimensions.get('window').width,
  );
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
    }
  }, [open]);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    if (open) {
      // Entrance: spring mirrors the web { type:'spring', damping:30, stiffness:300 }.
      const animation = Animated.spring(progress, {
        damping: 30,
        mass: 1,
        stiffness: 300,
        toValue: 1,
        useNativeDriver: true,
      });
      animation.start();
      return () => animation.stop();
    }
    // Exit: animate out, then unmount (the web AnimatePresence exit analogue).
    const animation = Animated.timing(progress, {
      duration: SLIDE_OUT_DURATION_MS,
      easing: Easing.in(Easing.cubic),
      toValue: 0,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
    return () => animation.stop();
  }, [open, mounted, progress]);

  if (!mounted) {
    return null;
  }

  const hiddenOffset = side === 'right' ? panelWidth : -panelWidth;
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [hiddenOffset, 0],
  });

  const handleLayout = (e: LayoutChangeEvent) => {
    const measured = e.nativeEvent.layout.width;
    setPanelWidth(prev => (Math.abs(prev - measured) < 1 ? prev : measured));
  };

  return (
    <Modal
      animationType="none"
      onRequestClose={onClose}
      transparent
      visible>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: progress }]}>
          <Pressable
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View
          accessibilityLabel={title || 'Panel'}
          accessibilityViewIsModal
          onLayout={handleLayout}
          style={[
            styles.panel,
            side === 'right' ? styles.panelRight : styles.panelLeft,
            { transform: [{ translateX }] },
            style,
          ]}
          testID="drawer">
          {title ? (
            <View style={styles.header}>
              <AppText numberOfLines={1} style={styles.title} weight="semibold">
                {title}
              </AppText>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.closeButtonPressed,
                ]}
                testID="drawer-close">
                <AppText style={styles.closeIcon}>✕</AppText>
              </Pressable>
            </View>
          ) : null}

          <ScrollView
            contentContainerStyle={styles.bodyContent}
            style={styles.body}>
            {children}
          </ScrollView>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}
Drawer.displayName = 'Drawer';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 24,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  closeButtonPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  closeIcon: {
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 18,
  },
  footer: {
    backgroundColor: colors.surfaceGlass,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  panel: {
    backgroundColor: colors.surface,
    bottom: 0,
    maxWidth: 448,
    position: 'absolute',
    top: 0,
    width: '100%',
    ...shadows.panel,
  },
  panelLeft: {
    borderRightColor: colors.border,
    borderRightWidth: 1,
    left: 0,
  },
  panelRight: {
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
    right: 0,
  },
  root: {
    flex: 1,
  },
  title: {
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
    marginRight: 12,
  },
});

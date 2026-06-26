// Native parity port of web/src/components/ui/Popover.tsx.
//
// The web component is a portaled, bbox-anchored popover primitive: it
// createPortal()s its children to <body>, positions them relative to an
// `anchorRef` HTMLElement via getBoundingClientRect (side bottom/top with
// auto-flip, align start/center/end, a sideOffset gap, and viewport clamping),
// and closes on Escape / outside-pointerdown, restoring focus to the trigger on
// close. It is intentionally NOT a focus trap. None of those DOM pieces exist
// in React Native, so the port reproduces the full contract 1:1 with RN
// primitives (see the parity sidecar for the line-by-line mapping):
//
//   • createPortal(children, document.body)  -> a transparent <Modal>; it renders
//                                               above everything, the native
//                                               "portal to the top layer".
//   • anchorRef: RefObject<HTMLElement>       -> RefObject<PopoverAnchorHandle>
//                                               (a RN View ref satisfies it:
//                                               measureInWindow + optional focus).
//   • el.getBoundingClientRect()              -> View.measureInWindow(...) for the
//                                               anchor + onLayout for the content,
//                                               feeding the SAME flip/align/clamp
//                                               arithmetic verbatim.
//   • window.innerWidth / innerHeight         -> Dimensions.get('window').
//   • visibility:hidden until positioned      -> opacity 0 + offscreen top/left
//                                               (-9999) until `pos` is computed,
//                                               matching the web's hidden-measure-
//                                               then-show trick.
//   • resize / scroll re-position listeners   -> Dimensions 'change' (resize); a
//                                               Modal overlay can't scroll under
//                                               the popover, so the scroll listener
//                                               has no analog and is dropped.
//   • document pointerdown outside -> close   -> a full-screen backdrop Pressable
//                                               (inside taps land on the content,
//                                               which sits above the backdrop).
//   • document keydown Escape -> close        -> Modal onRequestClose (Android
//                                               back button / hardware Esc).
//   • anchor.focus() on close                 -> best-effort anchorRef.focus?.()
//                                               (only refs that implement focus,
//                                               e.g. a TextInput trigger, respond).
//   • role="dialog" / aria-label              -> accessibilityViewIsModal +
//                                               accessibilityLabel. NB: the web is
//                                               aria-modal="false" (deliberately NOT
//                                               a focus trap) whereas RN <Modal> DOES
//                                               trap focus — an intentional, native-
//                                               platform delta documented in the
//                                               sidecar.
//   • cn() + CSS-var surface classes          -> StyleSheet + theme tokens
//                                               (rounded-lg -> borderRadius 8,
//                                               border/--glass-border -> borderWidth
//                                               1 + colors.border, --surface-1 ->
//                                               colors.surface, shadow-xl ->
//                                               shadows.panel). The forced-colors
//                                               high-contrast overrides have no RN
//                                               analog. The DOM `className` override
//                                               becomes `style` (StyleProp<ViewStyle>).
//
// State names (`pos` = {top,left,resolvedSide}) and the public prop contract
// (open/onClose/anchorRef/side/align/sideOffset/ariaLabel/children) are
// preserved. The SSR guards (typeof window / typeof document === 'undefined')
// have no RN analog and are dropped. No DOM modules, browser HTML elements,
// Recharts, Leaflet, or old web UI components are imported.

import React, {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {colors, shadows} from '../../../theme/tokens';

export type PopoverAlign = 'start' | 'end' | 'center';
export type PopoverSide = 'bottom' | 'top';

/**
 * Minimal native contract the anchor must satisfy — the RN replacement for the
 * web `RefObject<HTMLElement>`. A React Native `View` ref implements both
 * `measureInWindow` (used for positioning, replacing getBoundingClientRect) and
 * the optional `focus` (used for focus restoration on close), so callers pass a
 * plain `useRef<View>(null)` and it satisfies this shape structurally.
 */
export interface PopoverAnchorHandle {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
  focus?: () => void;
}

export interface PopoverProps {
  /** Whether the popover content is shown. */
  open: boolean;
  /** Called when the popover requests to close (Esc/back, tap outside). */
  onClose: () => void;
  /**
   * Ref to the trigger view. Position is computed relative to its measured
   * window rect; focus is restored to it on close when the ref supports focus.
   */
  anchorRef: RefObject<PopoverAnchorHandle | null>;
  /** Side relative to the anchor. Auto-flips when there isn't enough viewport space. */
  side?: PopoverSide;
  /** Alignment along the cross axis. */
  align?: PopoverAlign;
  /** Pixel gap between anchor and popover. */
  sideOffset?: number;
  /** Optional style for the content surface (native analog of the web `className`). */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label for the popover region (when no internal heading exists). */
  ariaLabel?: string;
  children: ReactNode;
  testID?: string;
}

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface ContentSize {
  width: number;
  height: number;
}

interface ResolvedPos {
  top: number;
  left: number;
  resolvedSide: PopoverSide;
}

// Offscreen sentinel mirroring the web `top/left ?? -9999` pre-measure position.
const OFFSCREEN = -9999;

/**
 * Lightweight popover primitive. Renders content in a transparent Modal (the
 * native "portal"), positions it relative to `anchorRef`, and closes on
 * back/Esc (onRequestClose) and outside tap (backdrop). Mirrors the web
 * auto-flip + viewport-clamp positioning. Unlike the web version (which is
 * deliberately not a focus trap) the underlying RN Modal traps focus — see the
 * parity sidecar. When you need a true focus trap on web, use Modal.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  side = 'bottom',
  align = 'start',
  sideOffset = 6,
  style,
  ariaLabel,
  children,
  testID,
}: PopoverProps) {
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const [contentSize, setContentSize] = useState<ContentSize | null>(null);
  const [pos, setPos] = useState<ResolvedPos | null>(null);

  // Measure the anchor when opening + on viewport resize (the RN analog of the
  // web resize/scroll re-position listeners). measureInWindow yields window
  // coordinates — the direct replacement for getBoundingClientRect.
  useEffect(() => {
    if (!open) {
      setAnchorRect(null);
      setContentSize(null);
      setPos(null);
      return;
    }

    const measureAnchor = () => {
      const node = anchorRef.current;
      if (!node || typeof node.measureInWindow !== 'function') {
        return;
      }
      node.measureInWindow((x, y, width, height) => {
        setAnchorRect({
          left: x,
          top: y,
          width,
          height,
          right: x + width,
          bottom: y + height,
        });
      });
    };

    measureAnchor();
    const subscription = Dimensions.addEventListener('change', measureAnchor);
    return () => subscription.remove();
  }, [open, anchorRef]);

  // Compute the resolved position once both the anchor rect and the content
  // size are known — the verbatim port of the web `compute()` flip/align/clamp.
  useEffect(() => {
    if (!open || !anchorRect || !contentSize) {
      return;
    }

    const {width: vw, height: vh} = Dimensions.get('window');
    const margin = 8;
    const a = anchorRect;
    const c = contentSize;

    // Resolve side: flip if the requested side overflows.
    let resolvedSide: PopoverSide = side;
    const spaceBelow = vh - a.bottom - sideOffset - margin;
    const spaceAbove = a.top - sideOffset - margin;
    if (side === 'bottom' && c.height > spaceBelow && spaceAbove > spaceBelow) {
      resolvedSide = 'top';
    } else if (
      side === 'top' &&
      c.height > spaceAbove &&
      spaceBelow > spaceAbove
    ) {
      resolvedSide = 'bottom';
    }

    let top: number;
    if (resolvedSide === 'bottom') {
      top = a.bottom + sideOffset;
    } else {
      top = a.top - sideOffset - c.height;
    }

    let left: number;
    if (align === 'start') {
      left = a.left;
    } else if (align === 'end') {
      left = a.right - c.width;
    } else {
      left = a.left + a.width / 2 - c.width / 2;
    }

    // Clamp horizontally to the viewport.
    if (left + c.width + margin > vw) {
      left = vw - c.width - margin;
    }
    if (left < margin) {
      left = margin;
    }

    // Clamp vertically (rare — only if both sides overflow).
    if (top + c.height + margin > vh) {
      top = vh - c.height - margin;
    }
    if (top < margin) {
      top = margin;
    }

    setPos({top, left, resolvedSide});
  }, [open, anchorRect, contentSize, side, align, sideOffset]);

  // Restore focus to the trigger when the popover closes (best-effort: only
  // refs that implement focus, e.g. a focused TextInput trigger, respond).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      anchorRef.current?.focus?.();
    }
  }, [open, anchorRef]);

  const handleContentLayout = (event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    if (
      width > 0 &&
      height > 0 &&
      (width !== contentSize?.width || height !== contentSize?.height)
    ) {
      setContentSize({width, height});
    }
  };

  // Web: `if (!open) return null`. Keeping the children mounted only while open
  // means each open re-measures fresh, exactly like the web portal.
  if (!open) {
    return null;
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
          testID={testID ? `${testID}-backdrop` : 'popover-backdrop'}
        />
        <View
          accessibilityLabel={ariaLabel}
          accessibilityViewIsModal
          onLayout={handleContentLayout}
          style={[
            styles.content,
            {
              top: pos?.top ?? OFFSCREEN,
              left: pos?.left ?? OFFSCREEN,
              opacity: pos ? 1 : 0,
            },
            style,
          ]}
          testID={testID ?? 'popover-content'}>
          {children}
        </View>
      </View>
    </Modal>
  );
}

Popover.displayName = 'Popover';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    position: 'absolute',
    ...shadows.panel,
  },
  overlay: {
    flex: 1,
  },
});

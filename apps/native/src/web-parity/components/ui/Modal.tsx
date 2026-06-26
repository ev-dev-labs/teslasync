// Native parity port of web/src/components/ui/Modal.tsx.
//
// The web source is the shared surface <Modal> with a backdrop. It is a
// forwardRef DOM component that: portals to <body> via react-dom createPortal
// (L2/L186) so it escapes ancestors that create a containing block for
// position:fixed; renders an opaque scrim + a glass dialog card; optionally
// renders a title header with a lucide-react <X> close button (L3/L163-175);
// and implements a full DOM focus-trap (L55-100) -- it queries FOCUSABLE_SELECTOR
// (L6-7), focuses the first focusable (or the dialog) on open, traps Tab /
// Shift+Tab, closes on Escape, and restores focus to the triggering element on
// close. Width presets sm/md/lg/full apply only at >= sm viewports; below sm
// (640px) it is a full-bleed bottom sheet (L104-109, L137, L152-154). Styling is
// token-driven (--surface-1 / --glass-border / --text-primary / --surface-overlay)
// with forced-colors fallbacks (L133, L146-151).
//
// This port reproduces the same open/onClose contract, the same size presets and
// >= sm vs < sm layout split, the same backdrop-tap-to-close, the same optional
// title header + 44x44 close affordance, the same Escape-to-close, and the same
// scrollable body, using React Native View/Modal/Pressable/ScrollView primitives,
// the AppText text component, and the native design tokens. No react-dom portal,
// no DOM focus-trap APIs, no lucide-react, no Recharts/Leaflet, and no web UI
// components are imported.
//
// Native-safe adaptations (documented in the sidecar):
//   * react-dom createPortal(overlay, document.body) -> the RN <Modal> host.
//     RN's <Modal> already renders into a top-level native overlay window that
//     sits above all app chrome, which is exactly what the web portal + z-[60]
//     achieved (escaping backdrop-blur/transform containing blocks). The
//     `typeof document === 'undefined'` SSR guard (L120) has no RN analog and is
//     dropped.
//   * The entire DOM focus-trap effect (L55-100): FOCUSABLE_SELECTOR querying,
//     document.activeElement, focus()/blur, the keydown Tab/Shift+Tab cycle, and
//     focus restoration are all provided natively by <Modal>, which contains
//     focus within itself and restores it to the previously focused view on
//     dismiss. There is no DOM in RN, so the manual trap is replaced by the
//     native behaviour + `accessibilityViewIsModal` on the dialog card (the RN
//     analog of `aria-modal="true"`, marking sibling views inert for AT).
//   * Escape-to-close (L70-75) -> the RN Modal `onRequestClose` callback, which
//     fires on the Android hardware back button and on the Esc key on RN
//     Windows/macOS. Touch is the primary dismissal on phones/tablets via the
//     backdrop tap and the header close button.
//   * lucide-react <X> (L3/L174) -> an AppText '×' glyph (same approach as the
//     CommandPalette parity port's close affordances). No icon library is pulled
//     into native.
//   * Tailwind responsive classes (`sm:` width presets, `items-end` vs
//     `sm:items-center`, `rounded-none` vs `sm:rounded-lg`, `max-h-[100dvh]` vs
//     `sm:max-h-[90vh]`) -> a `useWindowDimensions()` width >= 640 (the Tailwind
//     `sm` breakpoint) branch that swaps between bottom-sheet and centered-card
//     StyleSheet entries, so the same SSR/no-JS-equivalent deterministic layout
//     is reproduced.
//   * `backdrop-blur-sm` and the forced-colors Canvas/CanvasText fallbacks have
//     no RN primitive (no blur view / no Windows High Contrast bridge here) and
//     are dropped in favour of an opaque token scrim; the visual intent (a dark
//     dimmed modal context) is preserved.
//   * The web `className` + `...props` (HTMLAttributes<HTMLDivElement>) spread
//     onto the dialog div have no RN equivalent; `className` is accepted as an
//     inert web-parity no-op (same pattern as the Icon parity port) and a native
//     `style` override of the dialog card is provided in its place. The ref,
//     typed as the dialog View, is still composed via useImperativeHandle exactly
//     like the web `useImperativeHandle(ref, () => dialogRef.current)`.

import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import {
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

/**
 * Mirrors the web `ModalProps`. The web interface extended
 * `HTMLAttributes<HTMLDivElement>`; the DOM attribute surface has no React Native
 * equivalent, so the meaningful members are kept and a native `style` override of
 * the dialog card replaces the spread `...props`. `className` is preserved as an
 * inert web-parity no-op so ported call sites keep compiling.
 */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /**
   * Width preset for `>= sm` viewports. Below `sm` (640px) the modal is always
   * full-screen regardless of this prop -- see MOBILE_GUIDELINES.md.
   */
  size?: 'sm' | 'md' | 'lg' | 'full';
  children: ReactNode;
  /**
   * Accessible label for the dialog when no `title` is rendered. Required by
   * ARIA when the dialog has no visible heading.
   */
  ariaLabel?: string;
  /**
   * Web-parity only: Tailwind classes do not apply in React Native. Accepted so
   * ported call sites keep compiling; use `style` for native overrides.
   */
  className?: string;
  /** Native stand-in for the web `...props` spread onto the dialog card. */
  style?: StyleProp<ViewStyle>;
  /** Test hook for the rendered dialog card. */
  testID?: string;
}

// Tailwind `sm` breakpoint (640px). At/above this the modal is a centered card
// constrained by the `size` preset; below it the modal is a full-bleed bottom
// sheet -- exactly the web `sm:` responsive split.
const SM_BREAKPOINT = 640;

// web `sizes` map (L104-109): Tailwind max-width tokens -> pixel caps.
//   sm   -> sm:max-w-sm   = 24rem = 384
//   md   -> sm:max-w-lg   = 32rem = 512
//   lg   -> sm:max-w-2xl  = 42rem = 672
//   full -> sm:max-w-[min(96vw,1100px)] = 1100 (the 96vw clamp is handled
//           naturally by the card's width:100% inside the padded overlay).
const SIZE_MAX_WIDTH: Record<NonNullable<ModalProps['size']>, number> = {
  sm: 384,
  md: 512,
  lg: 672,
  full: 1100,
};

/**
 * Surface modal with a backdrop. Mobile + accessibility behaviour mirrors the web
 * source:
 * - Below `sm` (< 640px), the modal is full-screen edge-to-edge regardless of
 *   `size` (bottom sheet, square corners, up to full viewport height).
 * - Close button is at least 44 x 44 px to satisfy WCAG 2.5.5 (touch target).
 * - Surfaces use the shared design tokens, not hard-coded colours, so the dark
 *   theme renders correctly.
 *
 * Accessibility:
 * - `accessibilityViewIsModal` on the dialog card is the RN analog of
 *   `aria-modal="true"`, marking sibling views inert for assistive tech.
 * - When `title` is present the dialog is labelled by the heading; otherwise the
 *   caller may pass `ariaLabel`.
 * - Focus containment and restoration are handled natively by <Modal>.
 * - Esc / the Android back button close the dialog (via `onRequestClose`), in
 *   addition to the backdrop tap.
 */
export const Modal = forwardRef<View, ModalProps>(
  (
    {open, onClose, title, size = 'md', className: _className, children, ariaLabel, style, testID},
    ref,
  ) => {
    const dialogRef = useRef<View | null>(null);
    const titleId = useId();
    const {width} = useWindowDimensions();
    // Compose the forwarded ref with our internal ref so callers and (on web) the
    // focus-trap effect can both reach the dialog node. Mirrors the web
    // useImperativeHandle(ref, () => dialogRef.current).
    useImperativeHandle(ref, () => dialogRef.current as View, []);

    // Mirrors the web `if (!open) return null` (L102): the modal is not mounted
    // while closed, so children never render off-screen.
    if (!open) {
      return null;
    }

    const isWide = width >= SM_BREAKPOINT;

    // aria-labelledby={title ? titleId : undefined} / aria-label={!title ? ariaLabel}
    // (L142-143) collapse, in RN, to a single accessibilityLabel on the dialog
    // card: the visible heading text when present, else the caller's ariaLabel.
    const dialogLabel = title ?? ariaLabel;

    return (
      // createPortal(overlay, document.body) (L186) -> the RN <Modal> host, which
      // renders above all app chrome (the web portal + z-[60] intent).
      <RNModal
        visible
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={onClose}
        testID={testID}>
        <View style={[styles.overlayRoot, isWide ? styles.overlayWide : styles.overlayNarrow]}>
          {/* Backdrop: bg-[var(--surface-overlay)] + onClick={onClose}, aria-hidden
              (L126-136). Decorative for AT (matching aria-hidden); dismissal for
              screen-reader users is via the header close button / Esc. */}
          <Pressable
            style={styles.backdrop}
            onPress={onClose}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          />
          {/* role="dialog" + aria-modal dialog card (L138-181). */}
          <View
            ref={dialogRef}
            accessibilityViewIsModal
            accessibilityLabel={dialogLabel}
            style={[
              styles.card,
              isWide ? styles.cardWide : styles.cardNarrow,
              isWide ? sizeStyles[size] : null,
              style,
            ]}
            testID={testID ? `${testID}-dialog` : undefined}>
            {title ? (
              <View style={[styles.header, isWide && styles.headerWide]}>
                <AppText
                  nativeID={titleId}
                  weight="semibold"
                  numberOfLines={1}
                  style={styles.title}>
                  {title}
                </AppText>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={styles.closeButton}>
                  {/* lucide <X /> (L174) -> a glyph; aria-hidden on the glyph as
                      the button already carries the "Close" label. */}
                  <AppText
                    tone="secondary"
                    style={styles.closeGlyph}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants">
                    {'×'}
                  </AppText>
                </Pressable>
              </View>
            ) : null}
            {/* Body: flex-1 overflow-y-auto + safe-bottom (L178-180). */}
            <ScrollView
              style={styles.bodyScroll}
              contentContainerStyle={[styles.body, isWide && styles.bodyWide]}>
              {children}
            </ScrollView>
          </View>
        </View>
      </RNModal>
    );
  },
);
Modal.displayName = 'Modal';

const styles = StyleSheet.create({
  // The padded overlay region. Below sm the dialog is pinned to the bottom edge
  // (web `items-end`); at/above sm it is centered (web `sm:items-center` +
  // `sm:p-4`). Below sm there is no horizontal padding so the sheet is edge to
  // edge (web has no padding below sm).
  overlayRoot: {
    flex: 1,
  } as ViewStyle,
  overlayNarrow: {
    justifyContent: 'flex-end',
    alignItems: 'stretch',
  } as ViewStyle,
  overlayWide: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  } as ViewStyle,
  // bg-[var(--surface-overlay)] backdrop-blur-sm (blur dropped: no RN primitive).
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 5, 10, 0.72)',
  } as ViewStyle,
  // Dialog card: bg-[var(--surface-1)] border border-[var(--glass-border)]
  // shadow-xl text-[var(--text-primary)].
  card: {
    width: '100%',
    flexShrink: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadows.panel,
  } as ViewStyle,
  // Below sm: rounded-none, fills width, up to full viewport height (max-h-100dvh).
  cardNarrow: {
    borderRadius: 0,
    maxHeight: '100%',
  } as ViewStyle,
  // From sm: rounded-lg (8px), auto height up to 90vh, centered.
  cardWide: {
    borderRadius: 8,
    maxHeight: '90%',
  } as ViewStyle,
  // Title header: flex row, space-between, bottom border, px-4 pt-4 pb-3.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  } as ViewStyle,
  // sm:px-6 sm:pt-6 sm:pb-4.
  headerWide: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  } as ViewStyle,
  // h2 min-w-0 truncate text-lg font-semibold text-[var(--text-primary)].
  title: {
    flexShrink: 1,
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  // Close button: inline-flex h-11 w-11 (44x44 touch target, WCAG 2.5.5),
  // rounded-lg, centered.
  closeButton: {
    flexShrink: 0,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  } as ViewStyle,
  // The lucide <X /> glyph (h-5 w-5) -> a 22px '×'.
  closeGlyph: {
    fontSize: 22,
    lineHeight: 22,
  },
  bodyScroll: {
    flexShrink: 1,
  } as ViewStyle,
  // flex-1 overflow-y-auto px-4 pb-4 pt-3 safe-bottom (extra bottom padding for
  // the home-indicator inset that `safe-bottom` reserved on web).
  body: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
  } as ViewStyle,
  // sm:px-6 sm:pb-6.
  bodyWide: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  } as ViewStyle,
});

// web `sizes` Record<NonNullable<size>, string> (L104-109): pre-built StyleSheet
// entries (one per preset) so the dynamic max-width carries no inline style.
const sizeStyles = StyleSheet.create<Record<NonNullable<ModalProps['size']>, ViewStyle>>({
  sm: {maxWidth: SIZE_MAX_WIDTH.sm},
  md: {maxWidth: SIZE_MAX_WIDTH.md},
  lg: {maxWidth: SIZE_MAX_WIDTH.lg},
  full: {maxWidth: SIZE_MAX_WIDTH.full},
});

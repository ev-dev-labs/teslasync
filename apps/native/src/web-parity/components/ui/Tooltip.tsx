// Native parity port of web/src/components/ui/Tooltip.tsx.
//
// The web source is a hover/focus tooltip. It wraps `children` in a relative
// `inline-flex` span carrying the `group/tip` marker (L168) and renders a second,
// absolutely-positioned span (L170-191) that is revealed via the Tailwind
// `group-hover/tip:` + `group-focus-within/tip:` variants -- so mouse hover AND
// keyboard focus (Tab into a wrapped <button>) both surface it, and a tap on a
// focusable trigger reveals it on touch. The body uses an INVERTED surface for
// contrast (`bg-gray-900 text-gray-100` light-mode / `dark:bg-gray-100
// dark:text-gray-900` dark-mode), `pointer-events-none` so it never intercepts,
// `role="tooltip"` + a stable `useId` id, and that id is merged into the single
// trigger child's `aria-describedby` (L154-165) so screen readers announce the
// tooltip text after the trigger's own name. `side` picks one of four position
// classes (L93-98); `multiline` swaps `whitespace-nowrap` for a wrapping
// `max-w-[260px]` body. A dev-only sentry (L46-91) walks `content` and warns once
// per callsite when a child hardcodes a body-text colour class that would collide
// with the inverted surface; the audit script enforces the same statically in CI.
//
// This port reproduces the same content/side/multiline/children contract, the same
// hover + focus + tap reveal, the same inverted high-contrast surface, the same
// describedby wiring, the same `side` positioning + `multiline` wrap, and the same
// dev-time colour-collision sentry, using React Native View/Pressable primitives,
// the AppText text component, and pixel geometry. No DOM elements, no `cn`/Tailwind,
// no Recharts/Leaflet, no framer-motion, and no web UI components are imported.
//
// Native-safe adaptations (documented in the sidecar):
//   * The dark/light `dark:` inverted pair collapses to the dark-theme arm only --
//     this native app ships a single dark theme (theme/tokens has no light surface),
//     so the tooltip is the dark-mode rendering: a LIGHT card (`bg-gray-100`
//     #f3f4f6) with DARK text (`text-gray-900` #111827). Defined as local constants
//     (the dark token set has no light surface), mirroring how the Modal port
//     defined its scrim rgba inline.
//   * The CSS `:hover` / `:focus-within` group variants have no RN analog. The
//     wrapper is a Pressable whose onHoverIn/onHoverOut (desktop mouse), onFocus/
//     onBlur (hardware keyboard on RN Windows/macOS), and onPress (touch tap, the
//     primary phone/tablet path) drive a `visible` state -- the exact hover OR focus
//     OR tap reveal the web group selectors produced.
//   * The opacity/scale reveal transition + `motion-reduce:transition-none` (L184)
//     becomes an instant show/hide (the reduced-motion arm); no Animated timer is
//     started, keeping the test runner free of open handles.
//   * `aria-describedby` merged into the single child (L154-165) -> the same single
//     child is cloned to carry `accessibilityHint` = the (string) content, the RN
//     analog that AT announces after the trigger's own name; an existing hint is
//     preserved by concatenation. For multi/non-element children the hint falls back
//     onto the wrapper, mirroring the web fall-back to the wrapper span. For
//     non-string (JSX) content the body stays accessible so its text is still read.
//   * `pointer-events-none` (L174) -> pointerEvents="none" on the positioner so the
//     tooltip never intercepts touches. `z-50` (L174) -> zIndex/elevation; RN has no
//     portal so escaping an ancestor's overflow clip is best-effort (documented).
//   * The four Tailwind `sideClasses` (L93-98: `left-1/2 -translate-x-1/2` etc.)
//     become four absolute StyleSheet positioners that centre the card over the
//     trigger axis WITHOUT measuring width -- left:0/right:0 + alignItems:center for
//     top/bottom, top:0/bottom:0 + justifyContent:center for left/right -- so the
//     `-translate-{x,y}-1/2` centring is reproduced with no layout pass.
//   * The dev sentry's `FORBIDDEN_TEXT_CLASS` className scan (L56-74) -> a
//     `FORBIDDEN_TONES` AppText-`tone` scan: on the LIGHT card the light tones
//     (primary/secondary/muted) are exactly the collision the web warned about
//     (`text-white` / `text-gray-{100..400}`); decorative tones (accent/danger) are
//     fine, mirroring the web `text-amber-300`/`text-emerald-300` exception.
//     `import.meta.env.PROD` (L77, Vite-only) -> `!__DEV__` (the RN dev flag).
//   * `forced-colors` High-Contrast border/bg fallbacks (L177-183) have no RN
//     primitive and are dropped (same as the Modal port); the inverted light card
//     already reads as a separate floating layer.
//   * `className`/`style`/`testID` are added as optional native conveniences (same
//     pattern as the Icon/Modal/Slider ports); `className` is an inert web-parity
//     no-op, `style` overrides the wrapper, `testID` targets the rendered body.

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

export interface TooltipProps {
  /**
   * Tooltip content. Strings (and numbers) render in a single line by default;
   * pass JSX (or set `multiline`) when the content needs to wrap.
   *
   * IMPORTANT -- text colour contract:
   * The tooltip uses an INVERTED surface for high contrast (a LIGHT card with
   * DARK text, the dark-theme rendering of the web tooltip). String content is
   * rendered in the tooltip's own dark colour, but RN `Text` colour does NOT
   * cascade across `View` boundaries, so JSX passed as `content` keeps its own
   * colours. Do NOT pass light-coloured AppText (`tone="primary"`,
   * `tone="secondary"`, `tone="muted"`) inside `content` -- it would render
   * near-invisibly on the light card. Decorative tones that convey meaning
   * (`tone="accent"`, `tone="danger"`) are fine. A dev-only `console.warn` fires
   * in development when an offending tone is detected (the RN analog of the web
   * audit script `web/scripts/audit-tooltip-text-color.mjs`).
   */
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * When true (or when `content` is non-string JSX with its own width
   * constraints), the tooltip body wraps onto multiple lines instead of forcing
   * a single line. Used by `HelpTooltip` for long help bodies.
   */
  multiline?: boolean;
  children: ReactNode;
  /**
   * Web-parity only: Tailwind classes do not apply in React Native. Accepted so
   * ported call sites keep compiling; use `style` for native overrides.
   */
  className?: string;
  /** Native stand-in for the web wrapper styling; overrides the wrapper View. */
  style?: StyleProp<ViewStyle>;
  /** Test hook for the rendered tooltip body. */
  testID?: string;
}

/**
 * Dev-only sentry -- warns once per offending callsite when a child of `content`
 * uses a light AppText `tone` that collides with the tooltip's INVERTED (light)
 * surface. Production builds short-circuit on the first line so this has zero
 * runtime cost when shipped.
 *
 * The web source matched Tailwind body-text colour CLASSES
 * (`text-white` / `text-gray-{100..400}`); React Native has no className colours,
 * so the native analog matches the equivalent light AppText TONES. Decorative
 * tones (accent/danger) are allowed, mirroring the web `text-amber-300` /
 * `text-emerald-300` exception.
 */
const FORBIDDEN_TONES = new Set<string>(['primary', 'secondary', 'muted']);
const warnedFingerprints = new Set<string>();

function collectForbiddenTones(node: ReactNode, hits: string[], depth = 0): void {
  if (depth > 6) return;
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (Array.isArray(node)) {
    for (const child of node) collectForbiddenTones(child, hits, depth + 1);
    return;
  }
  if (!isValidElement(node)) return;
  const tone = (node.props as {tone?: unknown}).tone;
  if (typeof tone === 'string' && FORBIDDEN_TONES.has(tone)) {
    hits.push(tone);
  }
  const children = (node.props as {children?: ReactNode}).children;
  if (children !== undefined) collectForbiddenTones(children, hits, depth + 1);
}

function warnIfHardcodedTextTone(content: ReactNode, callerHint: string): void {
  if (!__DEV__) return;
  if (typeof content === 'string' || typeof content === 'number') return;
  const hits: string[] = [];
  collectForbiddenTones(content, hits);
  if (hits.length === 0) return;
  const fingerprint = `${callerHint}::${hits.join(',')}`;
  if (warnedFingerprints.has(fingerprint)) return;
  warnedFingerprints.add(fingerprint);
  console.warn(
    `[Tooltip] content uses the light tone(s) ${hits.join(', ')} which collide ` +
      `with the tooltip's inverted (light) surface and would render near-` +
      `invisibly. Drop the tone (the tooltip cascades its own dark text) or use ` +
      `a decorative tone (accent/danger). Caller: ${callerHint}`,
  );
}

// web `sideClasses` (L93-98): the Tailwind position/translate classes become four
// absolute positioners. top/bottom span the trigger width (left:0/right:0) and
// centre the card horizontally (alignItems:center) -> the web `left-1/2
// -translate-x-1/2`. left/right span the trigger height (top:0/bottom:0) and centre
// vertically (justifyContent:center) -> the web `top-1/2 -translate-y-1/2`. The
// mb/mt/mr/ml-2 (8px) gaps become the matching margins. No width measurement.
const GAP = 8;

/**
 * Hover/focus tooltip.
 *
 * Visual contract -- inverted surface (dark-theme rendering): a LIGHT card
 * (`bg-gray-100`) with DARK text (`text-gray-900`) for high contrast against the
 * dark app background.
 *
 * Reveal: mouse hover (onHoverIn/Out), keyboard focus (onFocus/Blur on RN
 * Windows/macOS), or a tap on the trigger (onPress) -- the native analogs of the
 * web `:hover` / `:focus-within` group variants.
 *
 * Accessibility:
 * - When `children` is a single element and `content` is a string, that string is
 *   merged into the child's `accessibilityHint` (preserving any existing hint) so
 *   assistive tech announces the tooltip text after the trigger's own name -- the
 *   RN analog of the web `aria-describedby` wiring. For multiple/non-element
 *   children the hint falls back onto the wrapper. For JSX content the body stays
 *   accessible so its text is still read.
 *
 * Reduced motion:
 * - The reveal is instant (the reduced-motion arm of the web transition).
 */
export function Tooltip({
  content,
  side = 'top',
  multiline,
  children,
  className: _className,
  style,
  testID,
}: TooltipProps) {
  const tooltipId = useId();
  const [visible, setVisible] = useState(false);

  // Stable per-mount fingerprint for the dev-time warn so we don't de-duplicate
  // across distinct callsites that happen to share the same forbidden tone.
  const callerRef = useRef<string>('');
  if (!callerRef.current) callerRef.current = `tooltip:${tooltipId}`;

  useEffect(() => {
    warnIfHardcodedTextTone(content, callerRef.current);
  }, [content]);

  const stringContent = typeof content === 'string' || typeof content === 'number';

  // We try to attach the describedby hint directly to the trigger element so
  // assistive tech reads the tooltip after the trigger name. This works when
  // `children` is a single React element (the common case) and `content` is a
  // string. For text-only/multiple children, or JSX content, we fall back to the
  // wrapper, which still groups the trigger + announces the hint.
  const child = Children.count(children) === 1 ? Children.only(children) : null;
  const singleElement = child && isValidElement(child) ? child : null;
  const hintOnChild = Boolean(singleElement && stringContent);

  const enrichedChild = hintOnChild
    ? (cloneElement(singleElement as ReactElement<{accessibilityHint?: string}>, {
        accessibilityHint: [
          (singleElement!.props as {accessibilityHint?: string}).accessibilityHint,
          String(content),
        ]
          .filter(Boolean)
          .join(' '),
      }) as ReactNode)
    : children;

  const show = () => setVisible(true);
  const hide = () => setVisible(false);
  const toggle = () => setVisible((v) => !v);

  return (
    <Pressable
      style={[styles.wrapper, style]}
      // hintOnChild -> the cloned child is the single accessible trigger node, so
      // the wrapper stays out of the a11y tree (matching the web "describedby on
      // the child, no extra wrapper node" approach). Otherwise the wrapper is the
      // accessible trigger and carries the hint itself.
      accessible={hintOnChild ? false : undefined}
      accessibilityHint={!hintOnChild && stringContent ? String(content) : undefined}
      onHoverIn={show}
      onHoverOut={hide}
      onFocus={show}
      onBlur={hide}
      onPress={toggle}>
      {enrichedChild}
      {visible ? (
        <View pointerEvents="none" style={positioners[side]}>
          <View
            nativeID={tooltipId}
            testID={testID}
            // String content is announced via the trigger hint, so the visible
            // body is decorative for AT (avoids a double read). JSX content has no
            // hint, so the body stays accessible and its text is read.
            accessibilityElementsHidden={stringContent}
            importantForAccessibility={stringContent ? 'no-hide-descendants' : 'auto'}
            style={[styles.card, multiline ? styles.cardMultiline : null]}>
            {stringContent ? (
              <AppText style={styles.text}>{content}</AppText>
            ) : (
              content
            )}
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

// web: inverted surface, dark-theme arm. `bg-gray-100` / `text-gray-900`. Defined
// as locals because the dark token set has no light surface (same approach as the
// Modal port's inline scrim).
const TOOLTIP_BG = '#f3f4f6';
const TOOLTIP_TEXT = '#111827';

const styles = StyleSheet.create({
  // web wrapper span: `relative inline-flex` -> a relative row that shrinks to its
  // content (alignSelf flex-start) so the tooltip anchors to the trigger box.
  wrapper: {
    position: 'relative',
    flexDirection: 'row',
    alignSelf: 'flex-start',
  } as ViewStyle,
  // web body span: rounded-lg px-2.5 py-1.5 + shadow-lg, on the inverted light card.
  card: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: TOOLTIP_BG,
    zIndex: 50,
    // shadow-lg (no RN portal: best-effort over ancestors).
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 6},
    elevation: 6,
  } as ViewStyle,
  // web `multiline`: whitespace-normal max-w-[260px] (wrap is the RN default).
  cardMultiline: {
    maxWidth: 260,
  } as ViewStyle,
  // web body text: text-xs font-medium, cascaded `text-gray-900`. RN text colour
  // does not inherit across Views, so the dark colour is set explicitly here.
  text: {
    color: TOOLTIP_TEXT,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
});

// web `sideClasses` map (L93-98) -> absolute positioners (see the GAP note above).
const positioners = StyleSheet.create<Record<NonNullable<TooltipProps['side']>, ViewStyle>>({
  // bottom-full left-1/2 -translate-x-1/2 mb-2
  top: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    alignItems: 'center',
    marginBottom: GAP,
    zIndex: 50,
    elevation: 6,
  },
  // top-full left-1/2 -translate-x-1/2 mt-2
  bottom: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    alignItems: 'center',
    marginTop: GAP,
    zIndex: 50,
    elevation: 6,
  },
  // right-full top-1/2 -translate-y-1/2 mr-2
  left: {
    position: 'absolute',
    right: '100%',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'flex-end',
    marginRight: GAP,
    zIndex: 50,
    elevation: 6,
  },
  // left-full top-1/2 -translate-y-1/2 ml-2
  right: {
    position: 'absolute',
    left: '100%',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'flex-start',
    marginLeft: GAP,
    zIndex: 50,
    elevation: 6,
  },
});

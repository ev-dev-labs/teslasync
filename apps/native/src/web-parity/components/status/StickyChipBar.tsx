// Native parity port of web/src/components/status/StickyChipBar.tsx.
//
// StickyChipBar is a horizontal "jump to section" navigation: a row of
// pill-shaped chips that scroll the page to in-page anchors. On the web it
//   - rendered a sticky <nav> that pinned to the top of the scroll viewport
//     (`position: sticky; top: topOffset`) with a `backdrop-blur` translucent
//     fill,
//   - tracked which referenced anchor was visible via an `IntersectionObserver`
//     (rootMargin `-${topOffset + 80}px 0px -60% 0px`), highlighting the topmost
//     intersecting section's chip, and
//   - on chip click walked the DOM (`document.getElementById`), found the app's
//     real scroll container (`<main id="main-content">`, since window.scrollY is
//     always 0), and smooth-scrolled it to the anchor minus
//     `topOffset + navHeight + 12`, falling back to `window.scrollTo`.
//
// React Native has none of those browser primitives -- no `IntersectionObserver`,
// no `document.getElementById`, no CSS `position: sticky`, no `backdrop-blur`,
// and no global `window.scrollTo`. This port keeps the SAME behaviour using
// native-safe replacements, mirroring the established ScrollRestoration parity
// port in this directory:
//   * The visual chip bar IS reproducible natively: a horizontal `ScrollView`
//     of `Pressable` chips with the same fill / active-cyan highlight / sizing,
//     rendered as a fixed header ABOVE the scroll content (the native analogue
//     of `position: sticky`, which keeps it permanently visible just like the
//     web sticky bar).
//   * The `IntersectionObserver` active-tracking is replaced by `useSectionAnchors`,
//     a working hook the host wires to its own `ScrollView`. Sections register
//     their vertical offset through `registerSection(id)` (onLayout) and the
//     hook derives the active chip from the live scroll offset using the SAME
//     activation line the web rootMargin used (`scrollY + topOffset + 80`).
//   * `document.getElementById` + smooth `scrollTo` are replaced by
//     `scrollToSection(id)`, which scrolls the host `ScrollView` (via its ref)
//     to the registered section offset minus `topOffset + 12` (the web `navHeight`
//     term is dropped because the native bar sits above the scroll content
//     instead of overlapping it).
// Browser capabilities that have no native analogue are recorded in
// `stickyChipBarCapabilities` so the unavailable state is explicit and
// inspectable (parity-contract rule 7). No DOM, no IntersectionObserver, no
// recharts/leaflet, and no web UI components are imported -- only React Native
// primitives and the existing native AppText component.

import {useCallback, useMemo, useRef, useState} from 'react';
import type {RefObject} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';

export interface ChipItem {
  id: string;
  label: string;
}

export interface StickyChipBarProps {
  chips: ChipItem[];
  /** Pixel offset from the top of the viewport when stuck. */
  topOffset?: number;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the bar (parity for `className`). */
  style?: StyleProp<ViewStyle>;
  /**
   * Controlled active chip id. When provided -- e.g. driven from a host
   * `ScrollView`'s scroll offset via {@link useSectionAnchors} -- it overrides
   * the internal state. This is the native stand-in for the web
   * `IntersectionObserver` that tracked which anchor was visible.
   */
  activeId?: string;
  /** Notified whenever the active chip changes (internal selection or press). */
  onActiveChange?: (id: string) => void;
  /**
   * Called when a chip is pressed. The web component scrolled the
   * `<main id="main-content">` DOM container to the matching anchor; native has
   * no DOM, so the host performs the scroll -- typically by passing
   * {@link useSectionAnchors}'s `scrollToSection`.
   */
  onChipPress?: (id: string) => void;
  /** Test hook. */
  testID?: string;
}

/**
 * The activation line the web `IntersectionObserver` used: its rootMargin top
 * inset was `topOffset + 80`, so a section became "active" once its top crossed
 * 80px below the sticky bar. The native scrollspy reuses the exact same offset.
 */
const ACTIVE_LINE_OFFSET = 80;

/** Breathing room kept below the bar when scrolling to a section (web `- 12`). */
const DEFAULT_SCROLL_PADDING = 12;

/** ~16ms == one 60fps frame; a sensible `scrollEventThrottle` for the host list. */
const SCROLL_EVENT_THROTTLE_MS = 16;

// Web colours mirrored verbatim (the shared native token set has no equivalent
// cyan stops, so they are recreated here -- the same approach the other parity
// ports take for web-exact colours):
//   bg-[var(--bg-1)]/85   -> the ThemeProvider base bg (--bg #0a0a0f) @ 85%
//   border-white/[0.06]   -> rgba(255,255,255,0.06)  (== --border-subtle)
//   bg-[var(--surface-2)] -> #151621                 (inactive chip fill)
//   text-[var(--text-secondary)] -> #9ca3af          (inactive chip label)
//   hover:text-[var(--text-primary)] -> native pressed opacity (no hover on touch)
//   bg-cyan-400/15        -> rgba(34,211,238,0.15)   (active chip fill)
//   ring-cyan-400/30      -> rgba(34,211,238,0.30)   (active chip ring)
//   text-cyan-200         -> #a5f3fc                 (active chip label)
const BAR_BG = 'rgba(10, 10, 15, 0.85)';
const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.06)';
const CHIP_INACTIVE_BG = '#151621';
const TEXT_SECONDARY = '#9ca3af';
const CHIP_ACTIVE_BG = 'rgba(34, 211, 238, 0.15)';
const CHIP_ACTIVE_RING = 'rgba(34, 211, 238, 0.30)';
const CHIP_ACTIVE_TEXT = '#a5f3fc';

/**
 * Records which browser capabilities the web file relied on are unavailable on
 * native, so the unavailable state is explicit and programmatically inspectable
 * (parity-contract rule 7).
 */
export const stickyChipBarCapabilities = {
  /** No `IntersectionObserver`; active tracking derives from scroll offset. */
  intersectionObserverAvailable: false,
  /** No `document.getElementById`; sections register via `onLayout` instead. */
  domGetElementByIdAvailable: false,
  /** No global `window.scrollTo`; the host `ScrollView` ref scrolls instead. */
  windowScrollToAvailable: false,
  /** No CSS `position: sticky`; the bar is a fixed header above the ScrollView. */
  cssStickyPositionAvailable: false,
  /** No CSS `backdrop-blur`; a translucent fill stands in. */
  backdropBlurAvailable: false,
} as const;

/**
 * Sticky "jump to section" chip bar. Renders the chips visually exactly like the
 * web component; active highlighting + scroll-to-section are driven by props so a
 * host can wire them to a real `ScrollView` (see {@link useSectionAnchors}). When
 * uncontrolled, pressing a chip still updates the internal active state -- the
 * native parity of the web `setActiveId(id)` that ran alongside the DOM scroll.
 */
export function StickyChipBar({
  chips,
  topOffset = 0,
  className: _className,
  style,
  activeId: controlledActiveId,
  onActiveChange,
  onChipPress,
  testID = 'sticky-chip-bar',
}: StickyChipBarProps) {
  const [internalActiveId, setInternalActiveId] = useState<string>(
    chips[0]?.id ?? '',
  );
  const isControlled = controlledActiveId !== undefined;
  const activeId = isControlled ? controlledActiveId : internalActiveId;

  const handlePress = useCallback(
    (id: string) => {
      onChipPress?.(id);
      if (!isControlled) {
        setInternalActiveId(id);
      }
      onActiveChange?.(id);
    },
    [isControlled, onChipPress, onActiveChange],
  );

  return (
    <View
      accessibilityLabel="Jump to section"
      style={[styles.bar, {marginTop: topOffset}, style]}
      testID={testID}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        {chips.map(chip => {
          const active = chip.id === activeId;
          return (
            <Pressable
              key={chip.id}
              accessibilityLabel={chip.label}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => handlePress(chip.id)}
              style={({pressed}) => [
                styles.chip,
                active ? styles.chipActive : styles.chipInactive,
                pressed && !active && styles.chipPressed,
              ]}>
              <AppText
                variant="caption"
                style={active ? styles.chipTextActive : styles.chipTextInactive}>
                {chip.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

StickyChipBar.displayName = 'StickyChipBar';

export interface UseSectionAnchorsOptions {
  /** Same chip list passed to the bar; defines order + which sections to track. */
  chips: ChipItem[];
  /** Mirrors the web `topOffset`; feeds the activation line and scroll math. */
  topOffset?: number;
  /** Ref to the host scroll container -- the native `<main id="main-content">`. */
  scrollRef?: RefObject<ScrollView | null>;
  /**
   * Extra pixels kept above a section when scrolling to it. Defaults to the web
   * `- 12` breathing room. The web also subtracted the sticky bar's own
   * `navHeight`; that term is dropped on native because the bar sits above the
   * scroll content rather than overlapping it.
   */
  scrollPadding?: number;
}

export interface SectionAnchorsApi {
  /** Topmost section currently past the activation line (web observer result). */
  activeId: string;
  /** `onLayout` factory: capture each section's vertical offset by id. */
  registerSection: (id: string) => (event: LayoutChangeEvent) => void;
  /** Smooth-scroll the host `ScrollView` to a section (web `handleClick`). */
  scrollToSection: (id: string) => void;
  /** Attach to the host `ScrollView`'s `onScroll` to drive `activeId`. */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Recommended `scrollEventThrottle` for the host `ScrollView`. */
  scrollEventThrottle: number;
}

/**
 * Working native implementation of the web `IntersectionObserver` + smooth
 * scroll-to-anchor behaviour. The host wires `registerSection` to each section's
 * `onLayout`, attaches `onScroll`/`scrollEventThrottle` to its `ScrollView`,
 * passes `scrollRef` so `scrollToSection` can move the viewport, and feeds the
 * bar `activeId={api.activeId}` + `onChipPress={api.scrollToSection}`.
 */
export function useSectionAnchors({
  chips,
  topOffset = 0,
  scrollRef,
  scrollPadding = DEFAULT_SCROLL_PADDING,
}: UseSectionAnchorsOptions): SectionAnchorsApi {
  const offsets = useRef<Map<string, number>>(new Map());
  const [activeId, setActiveId] = useState<string>(chips[0]?.id ?? '');

  const registerSection = useCallback(
    (id: string) => (event: LayoutChangeEvent) => {
      offsets.current.set(id, event.nativeEvent.layout.y);
    },
    [],
  );

  // Native parity of the web `handleClick`: find the section offset, mark it
  // active immediately (web `setActiveId(id)`), and smooth-scroll the host
  // container to it minus the offset/padding -- the analogue of
  // `scrollEl.scrollTo({ top: target, behavior: 'smooth' })`.
  const scrollToSection = useCallback(
    (id: string) => {
      setActiveId(id);
      const y = offsets.current.get(id);
      if (y == null) {
        return;
      }
      const target = Math.max(0, y - topOffset - scrollPadding);
      scrollRef?.current?.scrollTo({y: target, animated: true});
    },
    [topOffset, scrollPadding, scrollRef],
  );

  // Native parity of the `IntersectionObserver` callback: the active section is
  // the topmost one whose start has passed the activation line at
  // `scrollY + topOffset + 80` (the exact line the web rootMargin encoded). With
  // nothing past the line yet we keep the first chip active, matching the web
  // initial `chips[0]` state.
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const scrollY = event.nativeEvent.contentOffset.y;
      const line = scrollY + topOffset + ACTIVE_LINE_OFFSET;
      let bestId = '';
      let bestY = -Infinity;
      for (const chip of chips) {
        const y = offsets.current.get(chip.id);
        if (y == null) {
          continue;
        }
        if (y <= line && y > bestY) {
          bestY = y;
          bestId = chip.id;
        }
      }
      if (bestId === '') {
        bestId = chips[0]?.id ?? '';
      }
      if (bestId !== '') {
        setActiveId(prev => (prev === bestId ? prev : bestId));
      }
    },
    [chips, topOffset],
  );

  return useMemo(
    () => ({
      activeId,
      registerSection,
      scrollToSection,
      onScroll,
      scrollEventThrottle: SCROLL_EVENT_THROTTLE_MS,
    }),
    [activeId, registerSection, scrollToSection, onScroll],
  );
}

const styles = StyleSheet.create({
  // sticky z-30 -mx-4 border-b border-white/[0.06] bg-[var(--bg-1)]/85 backdrop-blur.
  // `sticky`/`top` -> a fixed header above the ScrollView (marginTop = topOffset);
  // `backdrop-blur` -> the translucent BAR_BG fill.
  bar: {
    backgroundColor: BAR_BG,
    borderBottomColor: BORDER_SUBTLE,
    borderBottomWidth: 1,
    marginHorizontal: -16,
  },
  // flex gap-1.5 overflow-x-auto px-4 py-1.5.
  scrollContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  // shrink-0 rounded-full px-3 py-1 text-xs font-medium min-h-[32px].
  chip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  // bg-cyan-400/15 ring-1 ring-cyan-400/30.
  chipActive: {
    backgroundColor: CHIP_ACTIVE_BG,
    borderColor: CHIP_ACTIVE_RING,
  },
  // bg-[var(--surface-2)] with a transparent ring slot (no layout shift vs active).
  chipInactive: {
    backgroundColor: CHIP_INACTIVE_BG,
    borderColor: 'transparent',
  },
  // hover:text-[var(--text-primary)] -> native pressed feedback.
  chipPressed: {
    opacity: 0.82,
  },
  // text-cyan-200, font-medium.
  chipTextActive: {
    color: CHIP_ACTIVE_TEXT,
    fontWeight: '500',
  } as TextStyle,
  // text-[var(--text-secondary)], font-medium.
  chipTextInactive: {
    color: TEXT_SECONDARY,
    fontWeight: '500',
  } as TextStyle,
});

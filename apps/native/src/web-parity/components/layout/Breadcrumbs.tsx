// Native parity port of web/src/components/layout/Breadcrumbs.tsx.
//
// The web component is a horizontally-scrolling `<nav aria-label="Breadcrumb">`
// trail: a leading Home icon link followed by `ChevronRight`-separated crumbs,
// where the last crumb is the (non-link) current page and middle crumbs collapse
// to an ellipsis on small screens. It is reproduced here with React Native
// primitives:
//
//   - The web `PrefetchLink` (react-router navigation + hover prefetch) is
//     browser-only; in-app navigation becomes an `onNavigate(path)` callback
//     (the same pattern the native shell App.tsx uses for route items), wired to
//     a `Pressable` with `accessibilityRole="link"`. Prefetch-on-hover has no
//     native equivalent and is intentionally dropped.
//   - The lucide `Home` / `ChevronRight` icons (browser-only) become semantic
//     glyphs (`\u2302` house / `\u203A` chevron) rendered in `AppText`, matching
//     the native TransitionArrow / SortControl glyph approach.
//   - react-i18next `useTranslation` is unavailable in native parity; a local
//     t() shim returns the fallback copy verbatim so the `a11y.breadcrumb` /
//     `a11y.breadcrumbHome` keys + English fallbacks are preserved.
//   - The Tailwind `overflow-x-auto scrollbar-none` row becomes a horizontal
//     `ScrollView` with the scroll indicator hidden; the `hidden sm:inline` /
//     `sm:hidden` responsive split is reproduced via `useWindowDimensions`
//     against the Tailwind `sm` (640px) breakpoint. The `cn`/`className` merge is
//     web-only: `className` is retained on props for source compatibility but
//     ignored on native, with a `style` override added instead. The web hover
//     colour change (muted -> secondary) maps to the link pressed state.

import {Fragment, useCallback} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

/** Tailwind `sm` breakpoint — below this, middle crumbs collapse to `…`. */
const SM_BREAKPOINT = 640;

export interface BreadcrumbItem {
  label: string;
  href?: string; // undefined = current page (no link)
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /**
   * Destination of the leading Home icon link. Defaults to '/'. Override for
   * brandable / role-based homes (e.g. embedded surfaces that should anchor at
   * a sub-route).
   */
  homeHref?: string;
  /**
   * Aria label for the leading Home link. Defaults to the localized
   * `a11y.breadcrumbHome` key ("Dashboard" in English).
   */
  homeAriaLabel?: string;
  /**
   * Native-safe replacement for `PrefetchLink` navigation. Invoked with the
   * crumb `href` when a link is pressed. Optional so a screen can mount the
   * trail before wiring its navigator; absent => links render but are inert.
   */
  onNavigate?: (path: string) => void;
  /** Native style override on the outer scroll row. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export function Breadcrumbs({
  items,
  className: _className,
  homeHref = '/',
  homeAriaLabel,
  onNavigate,
  style,
  testID,
}: BreadcrumbsProps) {
  const t = useNativeTranslationFallback();
  const {width} = useWindowDimensions();
  const isWide = width >= SM_BREAKPOINT;

  if (items.length <= 1) {
    return null;
  }

  return (
    <ScrollView
      accessibilityLabel={t('a11y.breadcrumb', 'Breadcrumb')}
      contentContainerStyle={styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={style}
      testID={testID ?? 'breadcrumbs'}>
      <Pressable
        accessibilityLabel={homeAriaLabel ?? t('a11y.breadcrumbHome', 'Dashboard')}
        accessibilityRole="link"
        accessible
        hitSlop={6}
        onPress={() => onNavigate?.(homeHref)}
        testID="breadcrumb-home">
        {({pressed}) => (
          <AppText style={[styles.homeIcon, pressed && styles.linkPressed]}>
            {'\u2302'}
          </AppText>
        )}
      </Pressable>

      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        const isMiddle = i > 0 && !isLast;
        const href = item.href;
        const showLabel = !isMiddle || isWide;
        const showEllipsis = isMiddle && !isWide;

        return (
          <Fragment key={i}>
            <AppText importantForAccessibility="no" style={styles.separator}>
              {'\u203A'}
            </AppText>
            {showLabel ? (
              isLast || !href ? (
                <AppText
                  numberOfLines={1}
                  style={[styles.label, isLast && styles.current]}
                  tone={isLast ? 'secondary' : 'muted'}>
                  {item.label}
                </AppText>
              ) : (
                <Pressable
                  accessibilityLabel={item.label}
                  accessibilityRole="link"
                  accessible
                  hitSlop={6}
                  onPress={() => onNavigate?.(href)}
                  testID={`breadcrumb-link-${i}`}>
                  {({pressed}) => (
                    <AppText
                      numberOfLines={1}
                      style={[styles.label, pressed && styles.linkPressed]}
                      tone="muted">
                      {item.label}
                    </AppText>
                  )}
                </Pressable>
              )
            ) : null}
            {showEllipsis ? (
              <AppText importantForAccessibility="no" style={styles.ellipsis}>
                {'\u2026'}
              </AppText>
            ) : null}
          </Fragment>
        );
      })}
    </ScrollView>
  );
}

Breadcrumbs.displayName = 'Breadcrumbs';

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  current: {
    color: colors.textSecondary,
    fontWeight: '500',
  },
  ellipsis: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  homeIcon: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 18,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 200,
  },
  linkPressed: {
    color: colors.textSecondary,
  },
  separator: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
});

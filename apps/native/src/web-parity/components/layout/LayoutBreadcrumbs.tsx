// Native parity port of web/src/components/layout/LayoutBreadcrumbs.tsx.
//
// Web role: the single canonical breadcrumb row mounted in the global Layout
// chrome. The web component reads per-page label overrides from
// BreadcrumbOverridesContext (which <PageContainer> populates via the
// breadcrumbLabels prop), resolves the full parent chain via useBreadcrumbs(),
// and renders <Breadcrumbs items={items} className={className} />. <Breadcrumbs>
// self-suppresses when the chain has <= 1 items so top-level pages render an
// empty slot while the surrounding row keeps the "Ctrl+K to jump" hint visible.
//
// Web -> native mapping notes:
//   - useBreadcrumbs() resolves the chain from react-router's useLocation /
//     useParams / matchPath against the web ROUTE_META map. None of that browser
//     routing state exists in this isolated parity file, so the resolved
//     BreadcrumbItem[] is accepted as a native-safe `items` prop supplied by the
//     native navigation shell (which owns the equivalent route + params + parent
//     chain). nativeLayoutBreadcrumbsCapabilities documents the unavailable
//     browser pieces.
//   - useBreadcrumbOverrides() (a React context fed by <PageContainer>) is a
//     web-app-state concern; the shell folds the per-page label overrides into
//     `items` before passing them down, preserving the override-wins behavior.
//   - The dependency <Breadcrumbs> component is not yet ported, so its render is
//     inlined here with React Native primitives: the leading Home link, the
//     ChevronRight separators, link-vs-current-text crumb items, the <= 1-item
//     self-suppression, and the per-item truncation are all preserved. lucide
//     Home / ChevronRight become text glyphs; the PrefetchLink <a> navigation
//     becomes an onNavigate(href) callback; react-i18next useTranslation becomes
//     an inline English-fallback t() (matching the DatePresetChips port).
//   - The web `overflow-x-auto scrollbar-none` row becomes a horizontal
//     ScrollView with the scroll indicator hidden. The responsive
//     `hidden sm:inline` middle-item collapse + "…" indicator has no React
//     Native media-query analogue, so every crumb renders (the web `sm:` and
//     wider behavior); see the sidecar.
//   - The web `className` (a flex utility hook) maps to a `style` pass-through
//     plus an optional `testID`, mirroring the other layout/forms parity ports.

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

/** Ported verbatim from web/src/components/layout/Breadcrumbs.tsx. */
export interface BreadcrumbItem {
  label: string;
  href?: string; // undefined = current page (no link)
}

/**
 * Native-safe capability flags for the global breadcrumb row. The web resolver
 * leans on react-router route matching plus a web React context; neither is
 * reachable from this isolated parity port, so the navigation shell resolves and
 * supplies the breadcrumb chain instead.
 */
export const nativeLayoutBreadcrumbsCapabilities = {
  reactRouterRouteResolutionAvailable: false,
  breadcrumbOverridesContextAvailable: false,
  shellSuppliedItemsSupported: true,
} as const;

export interface LayoutBreadcrumbsProps {
  /**
   * Resolved breadcrumb chain. Native-safe replacement for the web
   * useBreadcrumbs(useBreadcrumbOverrides()) pipeline — the navigation shell
   * resolves the current route, params, and per-page label overrides and passes
   * the merged BreadcrumbItem[] here. Defaults to [] so the row renders nothing,
   * matching the web <= 1-item self-suppression for chrome-less / top-level
   * routes.
   */
  items?: BreadcrumbItem[];
  /**
   * Called when a linked crumb (or the leading Home icon) is pressed. Native-safe
   * replacement for the web PrefetchLink router navigation.
   */
  onNavigate?: (href: string) => void;
  /** Destination passed to onNavigate for the leading Home icon. Defaults to '/'. */
  homeHref?: string;
  /**
   * Accessible label for the leading Home link. Defaults to the localized
   * a11y.breadcrumbHome key ("Dashboard" in English).
   */
  homeAriaLabel?: string;
  /** Pass-through style for the row (replaces the web className hook). */
  style?: StyleProp<ViewStyle>;
  /** Pass-through test id for the row. */
  testID?: string;
}

/** Inline English-fallback translator (no interpolation needed here). */
function t(_key: string, fallback: string): string {
  return fallback;
}

export function LayoutBreadcrumbs({
  items = [],
  onNavigate,
  homeHref = '/',
  homeAriaLabel,
  style,
  testID,
}: LayoutBreadcrumbsProps) {
  // Mirror web <Breadcrumbs> self-suppression: a single (current-page) crumb or
  // an empty chain renders nothing so top-level pages keep an empty slot.
  if (items.length <= 1) {
    return null;
  }

  const lastIndex = items.length - 1;

  return (
    <ScrollView
      accessibilityLabel={t('a11y.breadcrumb', 'Breadcrumb')}
      contentContainerStyle={styles.row}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.nav, style]}
      testID={testID}>
      <Pressable
        accessibilityLabel={homeAriaLabel ?? t('a11y.breadcrumbHome', 'Dashboard')}
        accessibilityRole="link"
        hitSlop={6}
        onPress={() => onNavigate?.(homeHref)}
        style={({pressed}) => [styles.home, pressed && styles.pressed]}>
        <AppText style={styles.glyph} tone="muted" variant="caption">
          ⌂
        </AppText>
      </Pressable>

      {items.map((item, i) => {
        const isLast = i === lastIndex;
        const isLink = !isLast && !!item.href;
        return (
          <View key={i} style={styles.segment}>
            <AppText style={styles.chevron} tone="muted" variant="caption">
              ›
            </AppText>
            {isLink ? (
              <Pressable
                accessibilityRole="link"
                hitSlop={4}
                onPress={() => onNavigate?.(item.href as string)}
                style={({pressed}) => pressed && styles.pressed}>
                <AppText
                  numberOfLines={1}
                  style={styles.crumb}
                  tone="muted"
                  variant="caption">
                  {item.label}
                </AppText>
              </Pressable>
            ) : (
              <AppText
                numberOfLines={1}
                style={styles.crumb}
                tone={isLast ? 'secondary' : 'muted'}
                variant="caption"
                weight={isLast ? 'semibold' : 'regular'}>
                {item.label}
              </AppText>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

export default LayoutBreadcrumbs;

const styles = StyleSheet.create({
  chevron: {
    color: colors.textMuted,
    flexShrink: 0,
  },
  crumb: {
    maxWidth: 200,
  },
  glyph: {
    color: colors.textMuted,
  },
  home: {
    flexShrink: 0,
  },
  nav: {
    flexGrow: 0,
  },
  pressed: {
    opacity: 0.7,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
});

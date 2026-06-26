// Native parity port of web/src/components/layout/sidebar/LinearSidebar.tsx.
//
// Web role: a Linear / Notion-inspired replacement for the default TeslaSync
// sidebar <nav> block. A single persistent, quiet, monochrome column that
// renders the canonical navSections tree with tiny uppercase section headers
// (click-to-collapse), a permanent "Favorites" group for pinned items, a 2px
// left accent bar + medium weight for the active row, muted 14px page-marker
// glyphs (no decorative tiles), and a dormant Notion-style tree filter whose
// only live affordance in this source snapshot is the "Clear filter" button.
//
// Behaviour preserved verbatim:
//   - All sections start collapsed EXCEPT the one containing the active page
//     (activeSectionTitle); navigating into a collapsed section auto-expands it.
//   - Favorites is an un-collapsable group shown whenever >= 1 item is pinned;
//     items already pinned keep appearing in their source section but drop the
//     duplicate "pin" affordance (pinnedSet lookup).
//   - The tree filter (filter/filterTokens/matchesFilter/filteredSections/
//     isExpanded) and the empty-filter "No matches." + clear branch are ported
//     exactly. As in the web source, NO text input renders here, so `filter`
//     can only ever be cleared, never set — the filter plumbing stays dormant.
//   - Trailing badges: a single dot for unread alerts (/notifications/alerts),
//     count chips for vehicles (/vehicles) and stale rows (/data-repair).
//
// Web -> native mapping notes (see nativeLinearSidebarCapabilities + sidecar):
//   - DOM <div>/<span>/<nav>/<p>/<button> become View / AppText / ScrollView /
//     Pressable. Tailwind utility classes become StyleSheet styles using the
//     theme tokens (--theme-primary -> colors.accent, --text-primary/-secondary/
//     -muted -> colors.textPrimary/textSecondary/textMuted, the white/[0.0x]
//     surface tints -> matching rgba values).
//   - react-router-dom useLocation() (the live-router fallback for `pathname`)
//     is not reachable from this isolated parity file, so the shell-supplied
//     `pathname` prop is authoritative; the fallback is flagged unavailable.
//   - GuardedNavLink (react-router navigation + useNavigationGuard confirm) is
//     reproduced with the ported native useNavigationGuardContext().confirmIfDirty
//     gate plus an onNavigate(to) callback owned by the native navigation shell.
//     onItemSelect still fires first (drawer close) exactly like the web onClick.
//   - lucide icons from @/lib/icons become native glyphs: per-item page markers
//     resolve through the shared SemanticIcon registry (icon: SemanticIconName ->
//     getSemanticIconDefinition().glyph), rendered monochrome (muted, or primary
//     when active) to honour the quiet/no-neon intent; the component's own chrome
//     (chevron, favorites/pin star, unpin close) uses clean unicode glyphs.
//   - The shared web <Button> tiny icon buttons become small Pressable affordances
//     (AppButton is a 44px full button, too large for the 6px hover actions).
//   - There is no hover on touch, so the pin/unpin actions render always-visible
//     instead of opacity-0 -> group-hover:opacity-100.
//   - react-i18next useTranslation() becomes an inline English-fallback t() with
//     {{count}} / {{page}} interpolation, preserving every nav.* key intent.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useNavigationGuardContext} from '../../feedback/NavigationGuardProvider';

// ─── i18n fallback ───────────────────────────────────────────────────────

type TranslationOptions = {
  count?: number;
  page?: string;
  defaultValue?: string;
};

type NativeTFunction = (
  key: string,
  fallbackOrOptions?: string | TranslationOptions,
) => string;

function interpolate(template: string, values: TranslationOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key as keyof TranslationOptions];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key, fallbackOrOptions) => {
    const fallback =
      typeof fallbackOrOptions === 'string'
        ? fallbackOrOptions
        : fallbackOrOptions?.defaultValue ?? key;

    if (!fallbackOrOptions || typeof fallbackOrOptions === 'string') {
      return fallback;
    }

    return interpolate(fallback, fallbackOrOptions);
  }, []);
}

// ─── Public types ────────────────────────────────────────────────────────

// Mirrors Layout's exported navSections item shape so this component stays in
// lockstep with the canonical nav tree. The web `icon: typeof Icons.home`
// (lucide component) becomes a native-safe `icon: SemanticIconName` supplied by
// the navigation shell and rendered as a monochrome page-marker glyph.
export type LinearSidebarSectionInput = {
  title: string;
  items: Array<{
    to: string;
    icon: SemanticIconName;
    label: string;
    color?: string;
    dataTour?: string;
    minVehicles?: number;
  }>;
};

export interface LinearSidebarProps {
  /** Already filtered by visibility (vehicle count, forward-auth, etc.). */
  sections: LinearSidebarSectionInput[];
  /** Pinned items, in pin-order, already visibility-filtered. */
  pinnedItems: LinearSidebarSectionInput['items'];
  /** Active path (the navigation shell's current route). */
  pathname: string;
  /** Translate a nav label key/value. Caller already knows the i18n map. */
  navLabel: (label: string) => string;
  /** Pin / unpin callbacks — already exposed by the navigation shell. */
  onPin: (to: string) => void;
  onUnpin: (to: string) => void;
  /**
   * Native-safe replacement for GuardedNavLink router navigation. Called with
   * the item's `to` after the navigation guard confirms. The shell owns the
   * actual route change.
   */
  onNavigate?: (to: string) => void;
  /** Called when a link is followed — mobile uses this to close the drawer. */
  onItemSelect?: () => void;
  /** Title of the section that currently contains the active page. */
  activeSectionTitle?: string;
  /** Badge counts — kept as dots/chips, not raw numbers, per the quiet principle. */
  alertCount?: number;
  vehicleCount?: number;
  staleCount?: number;
  /** Pass-through style for the root column (replaces the web flex className). */
  style?: StyleProp<ViewStyle>;
  /** Pass-through test id for the root column (web data-role="linear-sidebar"). */
  testID?: string;
}

/**
 * Native-safe capability flags. The web component leans on react-router
 * (useLocation fallback + GuardedNavLink navigation) and lucide icon
 * components; none of those are reachable from this isolated parity port, so
 * the navigation shell supplies the active path + navigation callback and the
 * shared SemanticIcon registry supplies the glyphs.
 */
export const nativeLinearSidebarCapabilities = {
  reactRouterLocationFallbackAvailable: false,
  shellSuppliedPathnameAuthoritative: true,
  navigationGuardConfirmAvailable: true,
  hoverRevealAvailable: false,
  treeFilterInputRendered: false,
} as const;

// ─── Active-path helpers ─────────────────────────────────────────────────

function isActiveLinearPath(pathname: string, to: string) {
  return to === '/'
    ? pathname === '/'
    : pathname === to || pathname.startsWith(to + '/');
}

// ─── Tiny components ─────────────────────────────────────────────────────

interface LinearNavLinkProps {
  to: string;
  label: string;
  icon: SemanticIconName;
  active: boolean;
  onNavigate?: (to: string) => void;
  onSelect?: () => void;
  /** Right-side hint (e.g., dot for unread, count for vehicles). */
  trailing?: ReactNode;
  /** Optional action rendered to the right of the row (pin / unpin). */
  hoverAction?: ReactNode;
  /** Web data-tour hook — forwarded as a testID so tours/automation can find it. */
  dataTour?: string;
}

function LinearNavLink({
  to,
  label,
  icon,
  active,
  onNavigate,
  onSelect,
  trailing,
  hoverAction,
  dataTour,
}: LinearNavLinkProps) {
  const {confirmIfDirty} = useNavigationGuardContext();

  // Preserve the web GuardedNavLink order exactly: onSelect (drawer close)
  // fires first, then the dirty-guard, then navigation only if confirmed.
  const handlePress = useCallback(async () => {
    onSelect?.();
    const ok = await confirmIfDirty();
    if (ok) {
      onNavigate?.(to);
    }
  }, [confirmIfDirty, onNavigate, onSelect, to]);

  const glyph = getSemanticIconDefinition(icon).glyph;

  return (
    <View style={styles.row}>
      {/* Active accent bar — 2px, neutral accent. No glow. */}
      {active ? <View style={styles.accentBar} /> : null}
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="link"
        accessibilityState={{selected: active}}
        onPress={handlePress}
        style={({pressed}) => [
          styles.link,
          active && styles.linkActive,
          pressed && styles.linkPressed,
        ]}
        testID={dataTour}>
        <AppText
          style={[styles.linkIcon, active && styles.linkIconActive]}
          variant="caption"
          weight="semibold">
          {glyph}
        </AppText>
        <AppText
          numberOfLines={1}
          style={styles.linkLabel}
          tone={active ? 'primary' : 'secondary'}
          variant="caption"
          weight={active ? 'semibold' : 'regular'}>
          {label}
        </AppText>
        {trailing}
      </Pressable>
      {hoverAction ? <View style={styles.hoverAction}>{hoverAction}</View> : null}
    </View>
  );
}

interface SectionHeaderProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  count?: number;
}

function LinearSectionHeader({
  title,
  expanded,
  onToggle,
  count,
}: SectionHeaderProps) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{expanded}}
      onPress={onToggle}
      style={styles.sectionHeader}>
      <AppText
        style={[styles.chevron, expanded && styles.chevronExpanded]}
        tone="muted"
        variant="caption">
        ›
      </AppText>
      <AppText
        numberOfLines={1}
        style={styles.sectionHeaderTitle}
        tone="muted"
        variant="caption"
        weight="semibold">
        {title.toUpperCase()}
      </AppText>
      {typeof count === 'number' && count > 0 ? (
        <AppText style={styles.sectionCount} tone="muted" variant="caption">
          {count}
        </AppText>
      ) : null}
    </Pressable>
  );
}

// ─── Trailing badges ─────────────────────────────────────────────────────

/** Single 6px dot — used for "has unread", never a number. */
function NotificationDot() {
  return <View style={styles.notificationDot} />;
}

/** Tiny monochrome count chip — used for vehicles, stale-data, etc. */
function CountChip({value, label}: {value: number; label: string}) {
  return (
    <View accessibilityLabel={label} style={styles.countChip}>
      <AppText style={styles.countChipText} tone="secondary" variant="caption">
        {value > 99 ? '99+' : value}
      </AppText>
    </View>
  );
}

// ─── Main component ──────────────────────────────────────────────────────

export function LinearSidebar({
  sections,
  pinnedItems,
  pathname,
  navLabel,
  onPin,
  onUnpin,
  onNavigate,
  onItemSelect,
  activeSectionTitle,
  alertCount = 0,
  vehicleCount = 0,
  staleCount = 0,
  style,
  testID,
}: LinearSidebarProps) {
  const t = useNativeTranslationFallback();
  // The web honours a caller-supplied pathname but falls back to the live
  // react-router location; that fallback is unavailable in this isolated parity
  // file, so the shell-supplied `pathname` is authoritative.
  const effectivePath = pathname;

  // Fast lookup so we can hide the "pin" affordance for items that are already
  // in Favorites (they still appear in their source section, matching the
  // legacy sidebar, but the duplicate pin button would be confusing).
  const pinnedSet = useMemo(
    () => new Set(pinnedItems.map(item => item.to)),
    [pinnedItems],
  );

  // ── Tree state ─────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // Default: collapse everything EXCEPT the section that contains the current
    // page. Matches Linear's "show me where I am" behaviour and prevents the
    // sidebar from being a wall of rows on first paint.
    const initial = new Set<string>();
    for (const section of sections) {
      if (section.title !== activeSectionTitle) initial.add(section.title);
    }
    return initial;
  });

  // When the active section changes (user navigates into a currently-collapsed
  // section), expand that section automatically.
  useEffect(() => {
    if (!activeSectionTitle) return;
    setCollapsed(prev => {
      if (!prev.has(activeSectionTitle)) return prev;
      const next = new Set(prev);
      next.delete(activeSectionTitle);
      return next;
    });
  }, [activeSectionTitle]);

  const toggleSection = (title: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  // ── Tree filter ────────────────────────────────────────────────────────
  // As in the web source, no text input renders here, so `filter` is only ever
  // cleared (never set) — the plumbing below stays dormant but is ported 1:1.
  const [filter, setFilter] = useState('');
  const filterTokens = useMemo(
    () => filter.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [filter],
  );

  const matchesFilter = useCallback(
    (label: string) => {
      if (filterTokens.length === 0) return true;
      const haystack = label.toLowerCase();
      return filterTokens.every(token => haystack.includes(token));
    },
    [filterTokens],
  );

  // Compute the visible items per section AFTER applying the filter, so we can
  // both hide non-matching rows AND auto-expand sections that have a match.
  const filteredSections = useMemo(
    () =>
      sections.map(section => ({
        ...section,
        items: section.items.filter(item =>
          matchesFilter(navLabel(item.label)),
        ),
      })),
    [sections, matchesFilter, navLabel],
  );

  // When the filter is active, treat every section with matches as expanded.
  const isExpanded = (title: string) => {
    if (filterTokens.length > 0) {
      const sec = filteredSections.find(s => s.title === title);
      return Boolean(sec && sec.items.length > 0);
    }
    return !collapsed.has(title);
  };

  // ── Trailing-badge logic per item ──────────────────────────────────────
  const trailingFor = (to: string): ReactNode => {
    if (to === '/notifications/alerts' && alertCount > 0) {
      return <NotificationDot />;
    }
    if (to === '/vehicles' && vehicleCount > 0) {
      return (
        <CountChip
          value={vehicleCount}
          label={t('nav.vehicleCount', {
            count: vehicleCount,
            defaultValue: '{{count}} vehicles',
          })}
        />
      );
    }
    if (to === '/data-repair' && staleCount > 0) {
      return (
        <CountChip
          value={staleCount}
          label={t('nav.staleCount', {
            count: staleCount,
            defaultValue: '{{count}} stale rows',
          })}
        />
      );
    }
    return null;
  };

  // Pin-to-favorites button, rendered to the right of each row in the regular
  // sections (skipped for items already pinned — those expose an unpin button
  // up in the Favorites group).
  const pinActionFor = (
    item: LinearSidebarSectionInput['items'][number],
  ): ReactNode => {
    if (pinnedSet.has(item.to)) return null;
    const pinLabel = t('nav.pinPage', {
      page: navLabel(item.label),
      defaultValue: 'Pin {{page}} to favorites',
    });
    return (
      <Pressable
        accessibilityLabel={pinLabel}
        accessibilityRole="button"
        onPress={() => onPin(item.to)}
        style={({pressed}) => [styles.iconButton, pressed && styles.iconButtonPressed]}
        testID={`linear-sidebar-pin-${item.to}`}>
        <AppText style={styles.iconButtonText} tone="muted" variant="caption">
          ★
        </AppText>
      </Pressable>
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────
  const expandedSections = filteredSections.filter(s => s.items.length > 0);

  return (
    <View style={[styles.root, style]} testID={testID}>
      {/* Tree */}
      <ScrollView
        accessibilityLabel={t('nav.sidebar', 'Sidebar navigation')}
        contentContainerStyle={styles.navContent}
        style={styles.navScroll}>
        {/* Favorites — only when there is at least one pinned item.
            Never collapses (Linear style: favorites are always visible). */}
        {pinnedItems.length > 0 ? (
          <View style={styles.favoritesGroup}>
            <View style={styles.favoritesLabel}>
              <AppText style={styles.star} tone="muted" variant="caption">
                ★
              </AppText>
              <AppText
                style={styles.favoritesLabelText}
                tone="muted"
                variant="caption"
                weight="semibold">
                {t('nav.favorites', 'Favorites').toUpperCase()}
              </AppText>
            </View>
            <View style={styles.favoritesList}>
              {pinnedItems
                .filter(item => matchesFilter(navLabel(item.label)))
                .map(item => {
                  const unpinLabel = t('nav.unpinPage', {
                    page: navLabel(item.label),
                    defaultValue: 'Unpin {{page}}',
                  });
                  return (
                    <LinearNavLink
                      key={`pinned-${item.to}`}
                      to={item.to}
                      label={navLabel(item.label)}
                      icon={item.icon}
                      active={isActiveLinearPath(effectivePath, item.to)}
                      onNavigate={onNavigate}
                      onSelect={onItemSelect}
                      trailing={trailingFor(item.to)}
                      hoverAction={
                        <Pressable
                          accessibilityLabel={unpinLabel}
                          accessibilityRole="button"
                          onPress={() => onUnpin(item.to)}
                          style={({pressed}) => [
                            styles.iconButton,
                            pressed && styles.iconButtonPressed,
                          ]}
                          testID={`linear-sidebar-unpin-${item.to}`}>
                          <AppText
                            style={styles.iconButtonText}
                            tone="muted"
                            variant="caption">
                            ✕
                          </AppText>
                        </Pressable>
                      }
                    />
                  );
                })}
            </View>
          </View>
        ) : null}

        {/* Sections */}
        <View style={styles.sectionsContainer}>
          {expandedSections.map(section => {
            const expanded = isExpanded(section.title);
            return (
              <View key={section.title} style={styles.sectionGroup}>
                <LinearSectionHeader
                  title={section.title}
                  expanded={expanded}
                  onToggle={() => toggleSection(section.title)}
                  count={section.items.length}
                />
                {expanded ? (
                  <View
                    accessibilityLabel={section.title}
                    accessibilityRole="menu"
                    style={styles.sectionItems}>
                    {section.items.map(item => (
                      <LinearNavLink
                        key={item.to}
                        to={item.to}
                        label={navLabel(item.label)}
                        icon={item.icon}
                        active={isActiveLinearPath(effectivePath, item.to)}
                        onNavigate={onNavigate}
                        onSelect={onItemSelect}
                        trailing={trailingFor(item.to)}
                        hoverAction={pinActionFor(item)}
                        dataTour={item.dataTour}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}

          {filterTokens.length > 0 && expandedSections.length === 0 ? (
            <View
              accessibilityRole="alert"
              style={styles.emptyFilter}
              testID="linear-sidebar-empty-filter">
              <AppText style={styles.emptyFilterText} tone="muted" variant="caption">
                {t('nav.filterNoMatch', 'No matches.')}
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => setFilter('')}
                style={({pressed}) => [
                  styles.clearButton,
                  pressed && styles.clearButtonPressed,
                ]}>
                <AppText
                  style={styles.clearButtonText}
                  tone="accent"
                  variant="caption">
                  {t('nav.filterClear', 'Clear filter')}
                </AppText>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

export default LinearSidebar;

const styles = StyleSheet.create({
  accentBar: {
    backgroundColor: colors.accent,
    borderBottomRightRadius: 2,
    borderTopRightRadius: 2,
    height: 20,
    left: 0,
    marginTop: -10,
    position: 'absolute',
    top: '50%',
    width: 2,
  },
  chevron: {
    color: colors.textMuted,
    width: 12,
  },
  chevronExpanded: {
    transform: [{rotate: '90deg'}],
  },
  clearButton: {
    borderRadius: 6,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  clearButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  clearButtonText: {
    color: colors.accent,
  },
  countChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 6,
    height: 16,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: spacing.xs,
  },
  countChipText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 14,
  },
  emptyFilter: {
    alignItems: 'center',
    borderRadius: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
  },
  emptyFilterText: {
    color: colors.textMuted,
  },
  favoritesGroup: {
    marginBottom: spacing.md,
  },
  favoritesLabel: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  favoritesLabelText: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  favoritesList: {
    gap: 1,
    marginTop: 2,
  },
  hoverAction: {
    marginLeft: spacing.xs,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 6,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  iconButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  iconButtonText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
  },
  link: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: spacing.xs,
  },
  linkActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  linkIcon: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
    width: 18,
  },
  linkIconActive: {
    color: colors.textPrimary,
  },
  linkLabel: {
    flex: 1,
  },
  linkPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  navContent: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  navScroll: {
    flex: 1,
    minHeight: 0,
  },
  notificationDot: {
    backgroundColor: colors.accent,
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  root: {
    flex: 1,
    flexDirection: 'column',
    minHeight: 0,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    position: 'relative',
  },
  sectionCount: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  sectionGroup: {
    gap: 2,
  },
  sectionHeader: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sectionHeaderTitle: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  sectionItems: {
    gap: 1,
    paddingLeft: spacing.sm,
  },
  sectionsContainer: {
    gap: spacing.sm,
  },
  star: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
  },
});

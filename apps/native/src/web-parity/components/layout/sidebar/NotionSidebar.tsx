// Native parity port of web/src/components/layout/sidebar/NotionSidebar.tsx.
//
// NotionSidebar is the Notion-inspired alternative to the default TeslaSync
// sidebar: a workspace-style tree with a "Favorites" (pinned) group, a "Pages"
// group of collapsible sections, per-row pin/unpin actions, and a quiet active
// state. The full behaviour contract is preserved 1:1 — collapse/expand state,
// the active-page auto-expand effect, the tree filter + filter-tokens matcher,
// the per-section glyph borrowed from the first item, the trailing alert dot /
// vehicle-count / stale-count badges, and the pin/unpin callbacks.
//
// The web source pulls several browser/web-only modules with no native parity
// surface (rules 4/7), so a native-safe implementation is built with NO DOM
// elements, Recharts, Leaflet, framer-motion, or web UI components imported:
//   - react-router-dom `useLocation` + `<GuardedNavLink>` have no native router.
//     Rows become `<Pressable accessibilityRole="link">`s that fire the existing
//     `onItemSelect` callback (the web onClick={onSelect} — used by mobile to
//     close the drawer); the destination `to` is preserved on the prop contract
//     and surfaced via accessibilityValue so the host shell can wire navigation
//     through the same data. `effectivePath` falls back to '' instead of
//     `useLocation().pathname` (no DOM location on native) — the host passes
//     `pathname` exactly as the web Layout does.
//   - react-i18next `useTranslation` is absent from the native deps; a local
//     fallback `t` returns the inline English copy and interpolates `{{token}}`
//     params (count/page), supporting BOTH the `t(key, 'fallback')` and the
//     `t(key, { count|page, defaultValue })` call shapes the source uses. Every
//     i18n key (nav.favorites, nav.pages, nav.sidebar, nav.vehicleCount,
//     nav.staleCount, nav.pinPage, nav.unpinPage, nav.filterNoMatch,
//     nav.filterClear) is referenced verbatim so intent survives.
//   - `@/lib/icons` Icons are lucide SVG components. Item/section glyphs are
//     rendered from the passed-in icon component (now typed as a native
//     `SidebarIcon` accepting {color,size}); the internal Icons.next caret,
//     Icons.star (pin) and Icons.close (unpin) become native text/View glyphs
//     ('\u203a' rotated, '\u2606', '\u00d7'), matching the text-glyph approach of
//     the sibling SearchInput port. Icons.home fallback -> a small drawn glyph.
//   - `@/components/ui` `<Button variant="ghost">` -> a native ghost
//     `<Pressable>` icon button with the same accessible label + press behaviour.
//   - `@/lib/cn` Tailwind merging -> React Native StyleSheet arrays; the
//     hover-only reveal of the pin/unpin actions collapses to always-visible on
//     touch (there is no hover on a touch device, matching the web behaviour on
//     touch). CSS vars map to theme tokens (--text-primary -> colors.textPrimary,
//     --theme-primary -> colors.accent, bg-white/[0.05] -> rgba literals, etc.).
//   - `./LinearSidebar` shared types are re-derived locally because the native
//     LinearSidebar has not been ported yet; they are re-exported under the
//     Notion names so the data contract stays identical to the web.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';

// ─── Shared data contract (re-derived from the web LinearSidebar) ────────────

/** Props a native sidebar glyph component accepts. */
export interface SidebarIconProps {
  color?: string;
  size?: number;
}

/**
 * Native-safe analog of the web `typeof Icons.home` (a lucide component). The
 * host supplies a React Native glyph component for each nav item instead of an
 * SVG icon so nothing DOM-only renders.
 */
export type SidebarIcon = React.ComponentType<SidebarIconProps>;

export type NotionSidebarSectionInput = {
  title: string;
  items: Array<{
    to: string;
    icon: SidebarIcon;
    label: string;
    color?: string;
    dataTour?: string;
    minVehicles?: number;
  }>;
};

export interface NotionSidebarProps {
  /** Already filtered by visibility (vehicle count, forward-auth, etc.). */
  sections: NotionSidebarSectionInput[];
  /** Pinned items, in pin-order, already visibility-filtered. */
  pinnedItems: NotionSidebarSectionInput['items'];
  /** Active path (the host passes the current route; web used useLocation). */
  pathname: string;
  /** Translate a nav label key/value. Caller already knows the i18n map. */
  navLabel: (label: string) => string;
  /** Pin / unpin callbacks — already exposed by Layout. */
  onPin: (to: string) => void;
  onUnpin: (to: string) => void;
  /** Called when a link is followed — mobile uses this to close the drawer. */
  onItemSelect?: () => void;
  /** Title of the section that currently contains the active page. */
  activeSectionTitle?: string;
  /** Badge counts — kept as dots, not numbers, per the quiet principle. */
  alertCount?: number;
  vehicleCount?: number;
  staleCount?: number;
}

// ─── i18n fallback ───────────────────────────────────────────────────────────
// react-i18next has no native parity module; resolve to the inline English
// copy and interpolate {{token}} params so the i18n keys + intent survive.

type TParams = Record<string, string | number>;
type TOptions = {defaultValue: string} & TParams;

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const value = params[key];
    return value == null ? match : String(value);
  });
}

function useTranslation(): {
  t: (key: string, fallback: string | TOptions) => string;
} {
  const t = useCallback((_key: string, fallback: string | TOptions) => {
    if (typeof fallback === 'string') {
      return fallback;
    }
    const {defaultValue, ...params} = fallback;
    return interpolate(defaultValue, params as TParams);
  }, []);
  return {t};
}

// ─── Active-path helpers ─────────────────────────────────────────────────────

function isActiveNotionPath(pathname: string, to: string) {
  return to === '/'
    ? pathname === '/'
    : pathname === to || pathname.startsWith(to + '/');
}

// ─── Native glyphs (stand-ins for the internal lucide Icons) ─────────────────

/** Caret — native stand-in for `Icons.next` (ChevronRight), rotated when open. */
function Caret({expanded}: {expanded: boolean}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.caret,
        {transform: [{rotate: expanded ? '90deg' : '0deg'}]},
      ]}>
      {'\u203a'}
    </AppText>
  );
}

/** Fallback page glyph — native stand-in for the `Icons.home` default. */
function DefaultGlyph({color, size = 14}: SidebarIconProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.defaultGlyph,
        {borderColor: color ?? colors.textMuted, height: size, width: size},
      ]}
    />
  );
}

// ─── Tiny components ─────────────────────────────────────────────────────────

interface NotionRowProps {
  to: string;
  label: string;
  icon: SidebarIcon;
  iconColor?: string;
  active: boolean;
  onSelect?: () => void;
  trailing?: ReactNode;
  hoverAction?: ReactNode;
  dataTour?: string;
  /** Indent depth (default ps-2 / shallow). */
  indent?: 'ps-2' | 'ps-7';
}

/**
 * The base "row" for any clickable nav line. Used by both quick-links and leaf
 * items. Section rows use a separate component because they need a caret +
 * toggle handler instead of a link.
 */
function NotionRow({
  to,
  label,
  icon: Icon,
  iconColor,
  active,
  onSelect,
  trailing,
  hoverAction,
  dataTour,
  indent = 'ps-2',
}: NotionRowProps) {
  return (
    <View style={styles.rowWrap}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="link"
        accessibilityState={{selected: active}}
        accessibilityValue={{text: to}}
        onPress={onSelect}
        style={({pressed}) => [
          styles.row,
          indent === 'ps-7' ? styles.indentDeep : styles.indentShallow,
          active ? styles.rowActive : pressed ? styles.rowPressed : null,
        ]}
        testID={dataTour}>
        <View style={styles.rowIcon}>
          <Icon
            color={active ? colors.textPrimary : iconColor ?? colors.textMuted}
            size={14}
          />
        </View>
        <AppText
          numberOfLines={1}
          style={[styles.rowLabel, active ? styles.rowLabelActive : null]}>
          {label}
        </AppText>
        {trailing}
      </Pressable>
      {hoverAction ? <View style={styles.rowAction}>{hoverAction}</View> : null}
    </View>
  );
}

interface NotionSectionRowProps {
  title: string;
  icon: SidebarIcon;
  iconColor?: string;
  expanded: boolean;
  onToggle: () => void;
  count: number;
}

/**
 * Section row — caret + icon + label + count, all in one pressable line. The
 * whole row toggles; the caret rotates and children slide open below.
 */
function NotionSectionRow({
  title,
  icon: Icon,
  iconColor,
  expanded,
  onToggle,
  count,
}: NotionSectionRowProps) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{expanded}}
      onPress={onToggle}
      style={({pressed}) => [styles.sectionRow, pressed ? styles.rowPressed : null]}>
      <Caret expanded={expanded} />
      <View style={styles.rowIcon}>
        <Icon color={iconColor ?? colors.textMuted} size={14} />
      </View>
      <AppText numberOfLines={1} style={styles.sectionTitle}>
        {title}
      </AppText>
      <AppText style={styles.sectionCount}>{count}</AppText>
    </Pressable>
  );
}

function GroupLabel({
  children,
  action,
  id,
}: {
  children: ReactNode;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <View nativeID={id} style={styles.groupLabel}>
      <AppText numberOfLines={1} style={styles.groupLabelText}>
        {children}
      </AppText>
      {action ? <View>{action}</View> : null}
    </View>
  );
}

function NotificationDot() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={styles.notificationDot}
    />
  );
}

function CountChip({value, label}: {value: number; label: string}) {
  return (
    <View accessibilityLabel={label} style={styles.countChip}>
      <AppText style={styles.countChipText}>
        {value > 99 ? '99+' : value}
      </AppText>
    </View>
  );
}

/** Native ghost icon button — stand-in for the web `<Button variant="ghost">`. */
function IconGhostButton({
  glyph,
  label,
  onPress,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.ghostButton,
        pressed ? styles.ghostButtonPressed : null,
      ]}>
      <AppText style={styles.ghostGlyph}>{glyph}</AppText>
    </Pressable>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function NotionSidebar({
  sections,
  pinnedItems,
  pathname,
  navLabel,
  onPin,
  onUnpin,
  onItemSelect,
  activeSectionTitle,
  alertCount = 0,
  vehicleCount = 0,
  staleCount = 0,
}: NotionSidebarProps) {
  const {t} = useTranslation();
  // Web read `useLocation().pathname` as the fallback; there is no DOM location
  // on native, so the host-supplied `pathname` is authoritative (empty == none).
  const effectivePath = pathname ?? '';

  // ── Tree state ─────────────────────────────────────────────────────────────
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    // Default: collapse everything except the active section. Notion's
    // "show me the page I'm on" behaviour.
    const initial = new Set<string>();
    for (const section of sections) {
      if (section.title !== activeSectionTitle) {
        initial.add(section.title);
      }
    }
    return initial;
  });

  useEffect(() => {
    if (!activeSectionTitle) {
      return;
    }
    setCollapsed(prev => {
      if (!prev.has(activeSectionTitle)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(activeSectionTitle);
      return next;
    });
  }, [activeSectionTitle]);

  const toggleSection = (title: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  // ── Tree filter ────────────────────────────────────────────────────────────
  const [filter, setFilter] = useState('');
  const filterTokens = useMemo(
    () => filter.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [filter],
  );
  const matchesFilter = (label: string) => {
    if (filterTokens.length === 0) {
      return true;
    }
    const haystack = label.toLowerCase();
    return filterTokens.every(token => haystack.includes(token));
  };

  const filteredSections = useMemo(
    () =>
      sections.map(section => ({
        ...section,
        items: section.items.filter(item => matchesFilter(navLabel(item.label))),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, filterTokens, navLabel],
  );

  const isExpanded = (title: string) => {
    if (filterTokens.length > 0) {
      const sec = filteredSections.find(s => s.title === title);
      return Boolean(sec && sec.items.length > 0);
    }
    return !collapsed.has(title);
  };

  // ── Per-section icon (first item's icon as the section glyph) ───────────────
  // Sections don't have their own icon definition, but Notion shows one on every
  // collapsible row. We borrow the first item's icon+color so the glyph stays in
  // the same visual family as the section contents.
  const sectionGlyph = (section: NotionSidebarSectionInput) => {
    const first = section.items[0];
    return {
      icon: first?.icon ?? DefaultGlyph,
      color: first?.color,
    };
  };

  // ── Trailing badges ──────────────────────────────────────────────────────────
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

  // Hover action — "pin" if not pinned, "unpin" if pinned. On touch there is no
  // hover, so the action renders always-visible (matching web-on-touch).
  const pinnedSet = useMemo(
    () => new Set(pinnedItems.map(p => p.to)),
    [pinnedItems],
  );
  const pinAction = (item: NotionSidebarSectionInput['items'][number]) => {
    const pinned = pinnedSet.has(item.to);
    return (
      <IconGhostButton
        glyph={pinned ? '\u00d7' : '\u2606'}
        label={
          pinned
            ? t('nav.unpinPage', {
                page: navLabel(item.label),
                defaultValue: 'Unpin {{page}}',
              })
            : t('nav.pinPage', {
                page: navLabel(item.label),
                defaultValue: 'Pin {{page}}',
              })
        }
        onPress={() => {
          if (pinned) {
            onUnpin(item.to);
          } else {
            onPin(item.to);
          }
        }}
      />
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  const expandedSections = filteredSections.filter(s => s.items.length > 0);

  return (
    <View style={styles.root} testID="notion-sidebar">
      <ScrollView
        accessibilityLabel={t('nav.sidebar', 'Sidebar navigation')}
        contentContainerStyle={styles.navContent}
        style={styles.nav}>
        {/* Favorites group — only when there's at least one pin. */}
        {pinnedItems.length > 0 ? (
          <View style={styles.favoritesGroup}>
            <GroupLabel id="notion-favorites-label">
              {t('nav.favorites', 'Favorites')}
            </GroupLabel>
            <View style={styles.rowGroup}>
              {pinnedItems
                .filter(item => matchesFilter(navLabel(item.label)))
                .map(item => (
                  <NotionRow
                    key={`fav-${item.to}`}
                    active={isActiveNotionPath(effectivePath, item.to)}
                    hoverAction={
                      <IconGhostButton
                        glyph={'\u00d7'}
                        label={t('nav.unpinPage', {
                          page: navLabel(item.label),
                          defaultValue: 'Unpin {{page}}',
                        })}
                        onPress={() => onUnpin(item.to)}
                      />
                    }
                    icon={item.icon}
                    iconColor={item.color}
                    label={navLabel(item.label)}
                    onSelect={onItemSelect}
                    to={item.to}
                    trailing={trailingFor(item.to)}
                  />
                ))}
            </View>
          </View>
        ) : null}

        {/* Pages group — Notion calls everything below "Workspace"/"Private". */}
        <GroupLabel id="notion-pages-label">{t('nav.pages', 'Pages')}</GroupLabel>
        <View style={styles.rowGroup}>
          {expandedSections.map(section => {
            const expanded = isExpanded(section.title);
            const glyph = sectionGlyph(section);
            return (
              <View key={section.title}>
                <NotionSectionRow
                  count={section.items.length}
                  expanded={expanded}
                  icon={glyph.icon}
                  iconColor={glyph.color}
                  onToggle={() => toggleSection(section.title)}
                  title={section.title}
                />
                {expanded ? (
                  <View
                    accessibilityLabel={section.title}
                    style={styles.rowGroup}>
                    {section.items.map(item => (
                      <NotionRow
                        key={item.to}
                        active={isActiveNotionPath(effectivePath, item.to)}
                        dataTour={item.dataTour}
                        hoverAction={pinAction(item)}
                        icon={item.icon}
                        iconColor={item.color}
                        indent="ps-7"
                        label={navLabel(item.label)}
                        onSelect={onItemSelect}
                        to={item.to}
                        trailing={trailingFor(item.to)}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}

          {filterTokens.length > 0 && expandedSections.length === 0 ? (
            <View
              accessibilityLiveRegion="polite"
              style={styles.emptyFilter}
              testID="notion-sidebar-empty-filter">
              <AppText style={styles.emptyFilterText}>
                {t('nav.filterNoMatch', 'No matches.')}
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => setFilter('')}
                style={({pressed}) => [
                  styles.clearFilter,
                  pressed ? styles.rowPressed : null,
                ]}>
                <AppText style={styles.clearFilterText}>
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

NotionSidebar.displayName = 'NotionSidebar';

const styles = StyleSheet.create({
  caret: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
    textAlign: 'center',
    width: 12,
  },
  clearFilter: {
    borderRadius: 6,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  clearFilterText: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 16,
  },
  countChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // bg-white/[0.05]
    borderRadius: 4,
    height: 16,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 4,
  },
  countChipText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 14,
  },
  defaultGlyph: {
    borderRadius: 3,
    borderWidth: 1.5,
  },
  emptyFilter: {
    alignItems: 'center',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  emptyFilterText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  favoritesGroup: {
    marginBottom: 4,
  },
  ghostButton: {
    alignItems: 'center',
    borderRadius: 4,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  ghostButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  ghostGlyph: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 16,
    textAlign: 'center',
  },
  groupLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    paddingBottom: 2,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  groupLabelText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  indentDeep: {
    paddingStart: 28, // ps-7
  },
  indentShallow: {
    paddingStart: 8, // ps-2
  },
  nav: {
    flex: 1,
  },
  navContent: {
    paddingBottom: 12,
    paddingHorizontal: 6,
  },
  notificationDot: {
    backgroundColor: colors.accent, // bg-[var(--theme-primary)]
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  root: {
    flex: 1,
  },
  row: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 28, // h-7
    paddingEnd: 6,
    paddingVertical: 2,
  },
  rowAction: {
    marginStart: 2,
  },
  rowActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)', // bg-white/[0.05]
  },
  rowGroup: {
    gap: 1, // space-y-px
  },
  rowIcon: {
    alignItems: 'center',
    height: 14,
    justifyContent: 'center',
    width: 14,
  },
  rowLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  rowLabelActive: {
    color: colors.textPrimary,
  },
  rowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)', // hover:bg-white/[0.03]
  },
  rowWrap: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  sectionCount: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  sectionRow: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 4,
    minHeight: 28,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sectionTitle: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});

export default NotionSidebar;

/**
 * Native parity port of
 * web/src/features/admin/components/EndpointSidebar.tsx.
 *
 * The web file is the API-Playground endpoint navigator: a full-height,
 * right-bordered column with a search field, a live "N endpoints" count, and a
 * scrollable list of collapsible tag groups whose rows are selectable
 * endpoint buttons (each prefixed by a coloured HTTP-method badge). This native
 * port preserves that contract 1:1 — the exported ParsedParam / ParsedBody /
 * ParsedEndpoint / MethodBadge surface, the `search` + case-insensitive
 * path|summary|operationId filter, the tag → endpoints grouping, the per-group
 * `open` accordion (default-open when the selection lives in it or there are
 * <= 5 groups), single-selection highlight, and the "no matching endpoints"
 * empty state — using React Native primitives + the existing native AppText and
 * design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2): replaced by a native-safe
 *     `t(key, def?)` fallback returning the English default (or the key when the
 *     web call omitted one), preserving every translation key + i18n intent
 *     (playground.search / playground.endpoints / playground.noResults).
 *   - lucide-react `ChevronDown` / `Search` (web L3): rendered as decorative
 *     AppText glyphs (CHEVRON_DOWN \u2304, SEARCH_GLYPH \u2315) — the established
 *     native inline-icon stand-in. The chevron still rotates 180deg when its
 *     group is open, matching the web `open && 'rotate-180'`.
 *   - `@/lib/cn` (web L4): dropped — Tailwind class merging is meaningless on RN;
 *     native styling uses StyleSheet + tokens.
 *   - `@/components/ui` Button / Input (web L5): no native parity port yet, so
 *     minimal native-safe equivalents are reproduced locally — Pressable rows in
 *     place of the ghost `Button` group header + endpoint rows, and a RN
 *     `TextInput` in place of `Input`.
 *   - The web `METHOD_COLORS` Tailwind classes (bg-{c}-500/20 text-{c}-400) and
 *     `text-cyan-400` selection rule cannot apply on native, so the five method
 *     colours + the gray fallback are reproduced locally as native chip styles
 *     ({backgroundColor, color}) using the exact Tailwind palette hex values,
 *     preserving the tinted-bg + tinted-text intent.
 *   - The web `<button title={ep.summary}>` hover tooltip becomes the row's
 *     accessibilityHint (the native tooltip analog).
 *   - The web `truncate` path becomes AppText numberOfLines={1}.
 */
import React, {useMemo, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ── types ──────────────────────────────────────────────────────────────── */

export interface ParsedParam {
  name: string;
  in: 'path' | 'query';
  required: boolean;
  type: string;
  description: string;
  default?: string;
}

export interface ParsedBody {
  contentType: string;
  example?: unknown;
  schema?: Record<string, unknown>;
}

export interface ParsedEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  tag: string;
  summary: string;
  description: string;
  operationId: string;
  parameters: ParsedParam[];
  requestBody?: ParsedBody;
  responses: Record<string, {description: string}>;
}

interface EndpointSidebarProps {
  endpoints: ParsedEndpoint[];
  selected: ParsedEndpoint | null;
  onSelect: (ep: ParsedEndpoint) => void;
}

/* ── native translation fallback (native-safe port of react-i18next) ─────── */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: returns the English default, else the key. */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key: string, fallback?: string) => fallback ?? key,
    [],
  );
}

/* ── decorative glyph stand-ins for the lucide-react icons ───────────────── */

const CHEVRON_DOWN = '\u2304';
const SEARCH_GLYPH = '\u2315';

/* ── subtle surface fills (web bg-white/[0.0x] + border-white/[0.0x]) ────── */

const BORDER_SUBTLE = 'rgba(255, 255, 255, 0.06)';
const BORDER_FAINT = 'rgba(255, 255, 255, 0.04)';
const SURFACE_SEARCH = 'rgba(255, 255, 255, 0.03)';
const SURFACE_HOVER_TAG = 'rgba(255, 255, 255, 0.03)';
const SURFACE_HOVER_ROW = 'rgba(255, 255, 255, 0.05)';
const SURFACE_SELECTED = 'rgba(255, 255, 255, 0.07)';

/* ── method badge ────────────────────────────────────────────────────────── */

interface MethodChipStyle {
  backgroundColor: string;
  color: string;
}

/**
 * The web `METHOD_COLORS` (bg-{c}-500/20 text-{c}-400) reproduced as native
 * chip styles using the exact Tailwind palette hex values.
 */
const METHOD_COLORS: Record<string, MethodChipStyle> = {
  GET: {backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80'},
  POST: {backgroundColor: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa'},
  PUT: {backgroundColor: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24'},
  DELETE: {backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171'},
  PATCH: {backgroundColor: 'rgba(168, 85, 247, 0.2)', color: '#c084fc'},
};

/** web fallback `bg-gray-500/20 text-[var(--text-muted)]`. */
const METHOD_FALLBACK: MethodChipStyle = {
  backgroundColor: 'rgba(107, 114, 128, 0.2)',
  color: colors.textMuted,
};

/**
 * Native parity of the web `MethodBadge`. The web `className` override (a
 * web-only concept) is adapted to an optional `style` applied to the chip
 * container, preserving the badge's extensibility intent.
 */
export function MethodBadge({
  method,
  style,
}: {
  method: string;
  style?: StyleProp<ViewStyle>;
}) {
  const chip = METHOD_COLORS[method] ?? METHOD_FALLBACK;
  return (
    <View
      style={[styles.methodBadge, {backgroundColor: chip.backgroundColor}, style]}
      testID={`endpoint-method-badge-${method}`}>
      <AppText style={[styles.methodBadgeText, {color: chip.color}]}>
        {method}
      </AppText>
    </View>
  );
}

/* ── collapsible tag group ───────────────────────────────────────────────── */

interface TagGroupProps {
  tag: string;
  endpoints: ParsedEndpoint[];
  selected: ParsedEndpoint | null;
  onSelect: (ep: ParsedEndpoint) => void;
  defaultOpen: boolean;
}

function TagGroup({tag, endpoints, selected, onSelect, defaultOpen}: TagGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(o => !o)}
        style={({pressed}) => [styles.tagHeader, pressed && styles.tagHeaderPressed]}
        testID={`endpoint-sidebar-tag-toggle-${tag}`}>
        <AppText
          style={[styles.tagChevron, open && styles.tagChevronOpen]}
          tone="muted">
          {CHEVRON_DOWN}
        </AppText>
        <AppText style={styles.tagLabel} tone="secondary" weight="semibold">
          {tag}
        </AppText>
        <AppText style={styles.tagCount} tone="muted">
          {endpoints.length}
        </AppText>
      </Pressable>
      {open ? (
        <View>
          {endpoints.map(ep => {
            const isSelected =
              selected?.path === ep.path && selected?.method === ep.method;
            return (
              <Pressable
                key={`${ep.method}-${ep.path}`}
                accessibilityHint={ep.summary}
                accessibilityRole="button"
                accessibilityState={{selected: isSelected}}
                onPress={() => onSelect(ep)}
                style={({pressed}) => [
                  styles.endpointRow,
                  pressed && styles.endpointRowPressed,
                  isSelected && styles.endpointRowSelected,
                ]}
                testID={`endpoint-sidebar-endpoint-${ep.method}-${ep.path}`}>
                <MethodBadge method={ep.method} />
                <AppText
                  numberOfLines={1}
                  style={styles.endpointPath}
                  tone="secondary">
                  {ep.path}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/* ── sidebar ─────────────────────────────────────────────────────────────── */

export default function EndpointSidebar({
  endpoints,
  selected,
  onSelect,
}: EndpointSidebarProps) {
  const t = useNativeTranslationFallback();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) {
      return endpoints;
    }
    const q = search.toLowerCase();
    return endpoints.filter(
      e =>
        (e.path ?? '').toLowerCase().includes(q) ||
        (e.summary ?? '').toLowerCase().includes(q) ||
        (e.operationId ?? '').toLowerCase().includes(q),
    );
  }, [endpoints, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, ParsedEndpoint[]>();
    for (const ep of filtered) {
      const tag = ep.tag || 'Other';
      const list = map.get(tag) ?? [];
      list.push(ep);
      map.set(tag, list);
    }
    return map;
  }, [filtered]);

  return (
    <View style={styles.container} testID="endpoint-sidebar">
      {/* Search */}
      <View style={styles.searchSection}>
        <View style={styles.searchField}>
          <AppText style={styles.searchIcon} tone="muted">
            {SEARCH_GLYPH}
          </AppText>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
            placeholder={t('playground.search', 'Search endpoints...')}
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            testID="endpoint-sidebar-search"
            value={search}
          />
        </View>
      </View>

      {/* Endpoint count */}
      <View style={styles.countSection}>
        <AppText
          style={styles.countText}
          testID="endpoint-sidebar-count"
          tone="muted">
          {filtered.length} {t('playground.endpoints', 'endpoints')}
        </AppText>
      </View>

      {/* Tag groups */}
      <ScrollView style={styles.groupList}>
        {Array.from(grouped.entries()).map(([tag, eps]) => (
          <TagGroup
            key={tag}
            defaultOpen={selected?.tag === tag || grouped.size <= 5}
            endpoints={eps}
            onSelect={onSelect}
            selected={selected}
            tag={tag}
          />
        ))}

        {filtered.length === 0 ? (
          <AppText
            style={styles.empty}
            testID="endpoint-sidebar-empty"
            tone="muted">
            {t('playground.noResults', 'No matching endpoints')}
          </AppText>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: BORDER_SUBTLE,
  },
  searchSection: {
    padding: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_SUBTLE,
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: SURFACE_SEARCH,
    paddingHorizontal: spacing.sm,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.caption,
    paddingVertical: 6,
  },
  countSection: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_FAINT,
  },
  countText: {
    fontSize: 10,
  },
  groupList: {
    flex: 1,
  },
  tagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tagHeaderPressed: {
    backgroundColor: SURFACE_HOVER_TAG,
  },
  tagChevron: {
    fontSize: 12,
    lineHeight: 14,
  },
  tagChevronOpen: {
    transform: [{rotate: '180deg'}],
  },
  tagLabel: {
    flex: 1,
    fontSize: typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  tagCount: {
    fontSize: 10,
    fontFamily: 'monospace',
  },
  endpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  endpointRowPressed: {
    backgroundColor: SURFACE_HOVER_ROW,
  },
  endpointRowSelected: {
    backgroundColor: SURFACE_SELECTED,
    borderLeftColor: colors.accent,
  },
  endpointPath: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  methodBadge: {
    width: 48,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodBadgeText: {
    fontSize: 9,
    lineHeight: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
    textAlign: 'center',
  },
  empty: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    fontSize: typography.caption,
    textAlign: 'center',
  },
});

/**
 * Native parity port of
 * web/src/features/admin/components/devtools/tools/HttpStatusTool.tsx.
 *
 * The web file is the DevTools "HTTP Status" reference tool: a ToolCard wrapping
 * a search box + a sortable/paginated DataTable that lists the 19 common HTTP
 * status codes (code badge, status text, description), filtered case-insensitively
 * by code|text|desc. This native port preserves that contract 1:1 — the same
 * `search` state, the same `filtered`/`columns` useMemo logic, the same
 * code-range → badge-variant mapping, and the same `compact` + `pagination`
 * DataTable intent — using React Native primitives + the existing native
 * AppText / GlassPanel / design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2/L9): replaced by a native-safe
 *     `t(key, fallback?)` fallback (the established sibling ClientUtilitiesSection
 *     precedent) that returns the English default, else the key itself. Every
 *     web key is preserved verbatim ('Status Code' / 'Status Text' /
 *     'Status Desc' / 'Http Status' / 'Http Status Desc' / 'Search Codes').
 *   - lucide-react `Network` (web L3): rendered as a decorative `\u29BF` AppText
 *     glyph (the same glyph the sibling ClientUtilitiesSection port uses for the
 *     Network icon) — used both for the ToolCard header chip and the search
 *     input's leading icon.
 *   - `@/components/ui` `Input` / `Badge` / `DataTable` + `Column` type (web L4):
 *     none have a native parity port yet, so minimal native-safe equivalents are
 *     reproduced locally (the established "reproduce locally when no native parity
 *     port exists" precedent): a `TextInput`-based `SearchInput`, a chip-style
 *     `StatusBadge`, and a `NativeDataTable` that supports exactly the props
 *     HttpStatusTool passes (columns/render, keyExtractor, compact, pagination).
 *     The `Column<T>` shape (key/header/render/sortable) is ported verbatim.
 *     IMPORTANT parity detail: HttpStatusTool passes NO `sortKey`/`sortDir`/
 *     `onSort` to the (controlled-sort) web DataTable, so the `sortable: true`
 *     code column renders a sort indicator but clicking it is a no-op and the
 *     rows stay in `filtered` order — the native port mirrors this exactly
 *     (a static sort glyph, data rendered in `filtered` order). Pagination uses
 *     the web default page size 25, so all 19 rows sit on a single page and no
 *     pager controls show; the pager + clamp logic is implemented faithfully so
 *     a longer data set would paginate. The web DataTable default
 *     `emptyMessage='No data'` is reproduced for the no-match state.
 *   - `../ToolCard` + `./constants` `ICON_COLOR_MAP` (web ToolCard L4/L6): the
 *     ToolCard is reproduced locally as `ToolCard` (GlassPanel header chip +
 *     title/description + children). The web Tailwind `bg-neon-{c}/10
 *     text-neon-{c} ring-1 ring-neon-{c}/20` chip classes (which cannot apply on
 *     native) are reproduced as native chip styles mapped to the equivalent
 *     design tokens (cyan→accent, green→success, purple→violet, amber→warning,
 *     red→danger), matching the sibling ClientUtilitiesSection mapping.
 *   - `../constants` `HTTP_CODES` (web L6): ported verbatim (19 entries) as a
 *     local `HTTP_CODES` constant — plain data, no browser dependency.
 *   - The web responsive Tailwind layout (`space-y-3`, table cell classes) maps
 *     to native StyleSheet spacing/typography tokens.
 */
import React, {useMemo, useState, type ReactNode} from 'react';
import {Pressable, StyleSheet, TextInput, View, type ViewStyle} from 'react-native';

import {AppText} from '../../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../../../theme/tokens';

/* ── native translation fallback (native-safe port of react-i18next) ── */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: returns the English default, else the key. */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key: string, fallback?: string) => fallback ?? key,
    [],
  );
}

/* ── decorative glyph stand-in for the lucide-react Network icon ── */

const NETWORK_GLYPH = '\u29BF';

/* ── HTTP codes data (native-safe port of `../constants` HTTP_CODES) ── */

export interface HttpCode {
  code: number;
  text: string;
  desc: string;
}

export const HTTP_CODES: HttpCode[] = [
  {code: 200, text: 'OK', desc: 'Request succeeded'},
  {code: 201, text: 'Created', desc: 'Resource created'},
  {code: 204, text: 'No Content', desc: 'Success with no body'},
  {code: 301, text: 'Moved Permanently', desc: 'Resource moved'},
  {code: 302, text: 'Found', desc: 'Temporary redirect'},
  {code: 304, text: 'Not Modified', desc: 'Use cached version'},
  {code: 400, text: 'Bad Request', desc: 'Invalid request'},
  {code: 401, text: 'Unauthorized', desc: 'Auth required'},
  {code: 403, text: 'Forbidden', desc: 'Access denied'},
  {code: 404, text: 'Not Found', desc: 'Resource not found'},
  {code: 405, text: 'Method Not Allowed', desc: 'HTTP method not supported'},
  {code: 408, text: 'Request Timeout', desc: 'Client took too long'},
  {code: 409, text: 'Conflict', desc: 'Resource conflict'},
  {code: 422, text: 'Unprocessable Entity', desc: 'Validation failed'},
  {code: 429, text: 'Too Many Requests', desc: 'Rate limited'},
  {code: 500, text: 'Internal Server Error', desc: 'Server error'},
  {code: 502, text: 'Bad Gateway', desc: 'Upstream error'},
  {code: 503, text: 'Service Unavailable', desc: 'Server overloaded'},
  {code: 504, text: 'Gateway Timeout', desc: 'Upstream timeout'},
];

/* ── native Badge stand-in (`@/components/ui` Badge, size="sm") ── */

type BadgeVariant = 'success' | 'info' | 'warning' | 'danger';

function StatusBadge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeSurface[variant]]}>
      <AppText style={[styles.badgeText, badgeText[variant]]}>{children}</AppText>
    </View>
  );
}

/* ── icon chip colour map (native-safe port of `./constants` ICON_COLOR_MAP) ── */

interface ChipStyle {
  backgroundColor: string;
  color: string;
  borderColor: string;
}

const CHIP_COLORS: Record<string, ChipStyle> = {
  cyan: {
    backgroundColor: colors.accentSoft,
    color: colors.accent,
    borderColor: colors.borderAccent,
  },
  green: {
    backgroundColor: colors.successSurface,
    color: colors.success,
    borderColor: colors.successBorder,
  },
  purple: {
    backgroundColor: colors.violetSurface,
    color: colors.violet,
    borderColor: colors.violetBorder,
  },
  amber: {
    backgroundColor: colors.warningSurface,
    color: colors.warning,
    borderColor: colors.warningBorder,
  },
  red: {
    backgroundColor: colors.dangerSurface,
    color: colors.danger,
    borderColor: colors.dangerBorder,
  },
};

/* ── native ToolCard stand-in (`../ToolCard`) ── */

function ToolCard({
  glyph,
  color,
  title,
  description,
  children,
}: {
  glyph: string;
  color: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const chip = CHIP_COLORS[color] ?? CHIP_COLORS.cyan;
  return (
    <GlassPanel style={styles.toolCard}>
      <View style={styles.toolHeader}>
        <View
          style={[
            styles.toolIcon,
            {backgroundColor: chip.backgroundColor, borderColor: chip.borderColor},
          ]}>
          <AppText style={[styles.toolGlyph, {color: chip.color}]}>{glyph}</AppText>
        </View>
        <View style={styles.toolHeaderText}>
          <AppText style={styles.toolTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.toolDesc} tone="secondary">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

/* ── native Input stand-in with a leading icon (`@/components/ui` Input) ── */

function SearchInput({
  glyph,
  placeholder,
  value,
  onChangeText,
}: {
  glyph: string;
  placeholder: string;
  value: string;
  onChangeText: (next: string) => void;
}) {
  return (
    <View style={styles.inputRow}>
      <AppText style={styles.inputIcon} tone="muted">
        {glyph}
      </AppText>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        testID="http-status-search"
        value={value}
      />
    </View>
  );
}

/* ── minimal native DataTable stand-in (`@/components/ui` DataTable) ── */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
}

const DEFAULT_PAGE_SIZE = 25;

interface NativeDataTableProps<T> {
  tableId: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  compact?: boolean;
  pagination?: boolean;
  emptyMessage?: string;
}

function NativeDataTable<T>({
  tableId,
  columns,
  data,
  keyExtractor,
  compact = false,
  pagination = false,
  emptyMessage = 'No data',
}: NativeDataTableProps<T>) {
  const [page, setPage] = useState(1);

  const pageCount =
    pagination && data.length > 0
      ? Math.ceil(data.length / DEFAULT_PAGE_SIZE)
      : 1;
  const safePage = Math.min(page, pageCount);
  const visible = pagination
    ? data.slice((safePage - 1) * DEFAULT_PAGE_SIZE, safePage * DEFAULT_PAGE_SIZE)
    : data;
  const showPager = pagination && data.length > DEFAULT_PAGE_SIZE;

  const cellPad = compact ? styles.cellCompact : styles.cellRegular;

  return (
    <View style={styles.table} testID={tableId}>
      <View style={[styles.row, styles.headerRow]}>
        {columns.map(col => (
          <View key={col.key} style={[styles.cell, cellPad, columnFlex[col.key]]}>
            <AppText style={styles.headerText} tone="secondary" weight="semibold">
              {col.header}
            </AppText>
            {col.sortable ? (
              <AppText style={styles.sortGlyph} tone="muted">
                {' \u2195'}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
      {visible.length === 0 ? (
        <View style={styles.emptyRow} testID={`${tableId}-empty`}>
          <AppText style={styles.emptyText} tone="muted">
            {emptyMessage}
          </AppText>
        </View>
      ) : (
        visible.map(row => {
          const rowKey = keyExtractor(row);
          return (
            <View
              key={rowKey}
              style={styles.row}
              testID={`${tableId}-row-${rowKey}`}>
              {columns.map(col => (
                <View
                  key={col.key}
                  style={[styles.cell, cellPad, columnFlex[col.key]]}>
                  {col.render(row)}
                </View>
              ))}
            </View>
          );
        })
      )}
      {showPager ? (
        <View style={styles.pager} testID={`${tableId}-pager`}>
          <Pressable
            accessibilityRole="button"
            disabled={safePage <= 1}
            onPress={() => setPage(p => Math.max(1, p - 1))}
            style={({pressed}) => [
              styles.pagerButton,
              (safePage <= 1 || pressed) && styles.pagerButtonMuted,
            ]}
            testID={`${tableId}-pager-prev`}>
            <AppText style={styles.pagerLabel} tone="secondary">
              {'\u2039'}
            </AppText>
          </Pressable>
          <AppText style={styles.pagerInfo} tone="muted">
            {`${safePage} / ${pageCount}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            disabled={safePage >= pageCount}
            onPress={() => setPage(p => Math.min(pageCount, p + 1))}
            style={({pressed}) => [
              styles.pagerButton,
              (safePage >= pageCount || pressed) && styles.pagerButtonMuted,
            ]}
            testID={`${tableId}-pager-next`}>
            <AppText style={styles.pagerLabel} tone="secondary">
              {'\u203A'}
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   HttpStatusTool — searchable HTTP status code reference
   ═══════════════════════════════════════════════════════════════════════ */

export function HttpStatusTool() {
  const t = useNativeTranslationFallback();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) {
      return HTTP_CODES;
    }
    const q = search.toLowerCase();
    return HTTP_CODES.filter(
      c =>
        String(c.code).includes(q) ||
        c.text.toLowerCase().includes(q) ||
        c.desc.toLowerCase().includes(q),
    );
  }, [search]);

  const columns: Column<HttpCode>[] = useMemo(
    () => [
      {
        key: 'code',
        header: t('Status Code'),
        sortable: true,
        render: r => (
          <StatusBadge
            variant={
              r.code < 300
                ? 'success'
                : r.code < 400
                ? 'info'
                : r.code < 500
                ? 'warning'
                : 'danger'
            }>
            {r.code}
          </StatusBadge>
        ),
      },
      {
        key: 'text',
        header: t('Status Text'),
        render: r => <AppText style={styles.statusText}>{r.text}</AppText>,
      },
      {
        key: 'desc',
        header: t('Status Desc'),
        render: r => (
          <AppText style={styles.statusDesc} tone="secondary">
            {r.desc}
          </AppText>
        ),
      },
    ],
    [t],
  );

  return (
    <ToolCard
      color="amber"
      description={t('Http Status Desc')}
      glyph={NETWORK_GLYPH}
      title={t('Http Status')}>
      <View style={styles.body}>
        <SearchInput
          glyph={NETWORK_GLYPH}
          onChangeText={setSearch}
          placeholder={t('Search Codes')}
          value={search}
        />
        <NativeDataTable
          columns={columns}
          compact
          data={filtered}
          keyExtractor={r => r.code}
          pagination
          tableId="http-status-table"
        />
      </View>
    </ToolCard>
  );
}

/* ── column widths (shared between header + body rows) ── */

const columnFlex = StyleSheet.create<Record<string, ViewStyle>>({
  code: {width: 78},
  text: {flex: 1},
  desc: {flex: 1.6},
});

const styles = StyleSheet.create({
  toolCard: {
    padding: spacing.lg,
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  toolIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  toolHeaderText: {
    flex: 1,
    gap: 2,
  },
  toolTitle: {
    fontSize: typography.body,
  },
  toolDesc: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  body: {
    gap: spacing.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
  },
  inputIcon: {
    fontSize: 14,
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  headerRow: {
    borderTopWidth: 0,
    backgroundColor: colors.surfaceRaised,
  },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  cellRegular: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cellCompact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  headerText: {
    fontSize: typography.caption,
  },
  sortGlyph: {
    fontSize: typography.caption,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: typography.caption,
    fontWeight: '500',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  statusDesc: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  emptyRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.caption,
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pagerButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pagerButtonMuted: {
    opacity: 0.4,
  },
  pagerLabel: {
    fontSize: 14,
  },
  pagerInfo: {
    fontSize: typography.caption,
  },
});

const badgeSurface = StyleSheet.create<Record<BadgeVariant, {backgroundColor: string; borderColor: string; borderWidth: number}>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderWidth: 1,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderWidth: 1,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderWidth: 1,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
  },
});

const badgeText = StyleSheet.create<Record<BadgeVariant, {color: string}>>({
  success: {color: colors.success},
  info: {color: colors.accent},
  warning: {color: colors.warning},
  danger: {color: colors.danger},
});

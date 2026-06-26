// Native parity port of
// web/src/features/admin/components/feature-flags/FlagsTable.tsx.
//
// `FlagsTable` is the Feature Flags main table: it renders the current registry
// of flag rows with a compact JSON-pretty value preview, a sortable `key`
// column, and per-row Edit + Delete actions. Editing calls the parent-owned
// `onEdit(entry)`; delete calls the parent-owned `onAskDelete(entry)` (which on
// web opens a ConfirmDialog with a required reason input — that surface lives in
// the parent, not here). State names (`sortKey` / `sortDir` / `onSort` via
// `useSortToggle('key','asc')`), the `[...rows].sort(localeCompare * dir)` sort,
// the `previewValue` helper, the `FlagsTableProps` shape (`rows` / `loading` /
// `onEdit` / `onAskDelete`), every `t('admin.flags.*','English')` i18n key +
// fallback, the `tableId` (`admin:feature-flags`), the `name`
// (`feature-flags`), the `keyExtractor` (`row.key`), the pagination config
// ({25, [25,50,100]}) and the `mobileColumns` list are all carried over
// unchanged.
//
// The web source pulls three modules with no native-parity surface; mapped per
// the conversion contract (rules 4/5/7), matching the sibling AuditPanel /
// FleetTelemetryHealth ports:
//   - react-i18next `useTranslation` (L10) -> the standard web-parity i18n shim
//     returning the inline English fallback (apps/native deps lack
//     react-i18next), so the body's `t('key','English')` calls are unchanged.
//   - lucide-react `Pencil` / `Trash2` (L11, SVG icons) have no native analog ->
//     decorative `AppText` glyphs ('\u270E' pencil for Edit, '\u2716' for
//     Delete), flagged `accessibilityElementsHidden`; the visible button label
//     ("Edit" / "Delete") carries the real meaning. Same glyph-substitution
//     approach the sibling ports use for lucide icons.
//   - `Button` + `DataTable` + `useSortToggle` + `type Column` from
//     `@/components/ui` (L13-18): `DataTable` / `useSortToggle` / `Column` are
//     reused as-is from the web-parity `components/ui/DataTable` port (their
//     props — `tableId` / `name` / `columns` / `data` / `keyExtractor` /
//     `sortKey` / `sortDir` / `onSort` / `emptyMessage` / `pagination` /
//     `mobileColumns` — match the web API 1:1, and `useSortToggle(default,dir)`
//     has the same signature). The web `Button` host is NOT ported to native
//     parity, so its two uses (variant="secondary"/"danger", size="sm", with a
//     lucide `icon`) are rebuilt with a local `FlagActionButton`
//     (`Pressable` + `AppText`) — one shared component for both rows (DRY),
//     preserving each `onClick` -> `onPress` handler and the icon+label layout.
//   - the `FeatureFlagEntry` type (L19, web `@/types/admin-diagnostics`) has no
//     native parity types module; it is imported from the web-parity
//     `api/hooks/useFeatureFlags` module, where the native parity surface
//     re-declares it with identical shape ({ key: string; value: unknown }) —
//     the same "types come from the hook" approach the AuditPanel port uses for
//     the DLQ record types.
//
// Each column `render` returned a DOM `<span className=…>` on web; React Native
// has no `<span>` / className, so the cells become `AppText` carrying the
// equivalent styling via `StyleSheet`: `font-mono text-sm text-[var(--text-
// primary)]` -> mono + 14/20 + colors.textPrimary (key cell); `font-mono
// text-xs text-[var(--text-muted)]` -> mono + 12/16 + colors.textMuted (value
// cell). font-mono -> a Platform.select monospace family (Menlo on iOS),
// matching the sibling ports. The actions `<div className="flex items-center
// gap-2">` -> a row `View` (flexDirection row + alignItems center + gap 8).
//
// Button visual intent: web `size="sm"` -> h-8/px-3/text-xs -> height 32 /
// paddingHorizontal 12 / fontSize 12; rounded-md -> radius 6; font-medium ->
// weight 500; gap-2 -> 6. `variant="secondary"` (dark:bg-gray-700/text-gray-100)
// -> the neutral filled surfaceRaised + border + textPrimary treatment (same
// mapping the FleetTelemetryHealth RefreshButton uses for web `secondary`).
// `variant="danger"` (bg-red-600/text-white) -> the native danger idiom
// (dangerSurface fill + dangerBorder + danger-colored bold label), the
// surface/border/foreground trio used everywhere else for destructive intent
// (SemanticIcon danger tone, ToolCard red tone) since the token system exposes
// no solid-red fill. The web `hover:` affordances have no touch analog and
// collapse into a Pressable pressed opacity.

import React from 'react';
import {Platform, Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';
import {
  DataTable,
  useSortToggle,
  type Column,
} from '../../../../components/ui/DataTable';
import type {FeatureFlagEntry} from '../../../../api/hooks/useFeatureFlags';

// ── i18n shim ──────────────────────────────────────────────────────────────
// react-i18next has no native parity module; like the other web-parity ports,
// translations resolve to their inline English fallback. The hook shape mirrors
// the web `const { t } = useTranslation()` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;
function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// font-mono has no className analog on native; resolve to a monospace family.
const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

interface FlagsTableProps {
  rows: FeatureFlagEntry[];
  loading: boolean;
  onEdit: (entry: FeatureFlagEntry) => void;
  onAskDelete: (entry: FeatureFlagEntry) => void;
}

/**
 * Compact JSON preview suitable for a single table cell. Falls back
 * to `String(value)` for primitives so booleans / numbers don't get
 * extra quoting noise.
 */
function previewValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  const tx = typeof value;
  if (tx === 'string') return JSON.stringify(value);
  if (tx === 'boolean' || tx === 'number') return String(value);
  try {
    const json = JSON.stringify(value);
    if (json && json.length > 120) return `${json.slice(0, 117)}…`;
    return json ?? '—';
  } catch {
    return '—';
  }
}

// ── FlagActionButton (web <Button variant size="sm" icon>; host not ported) ──
// One shared button for both row actions (Edit/Delete). `variant` selects the
// neutral (secondary) or destructive (danger) palette; `glyph` stands in for the
// lucide icon and `label` is the button text — both preserved from the source.
interface FlagActionButtonProps {
  variant: 'secondary' | 'danger';
  glyph: string;
  label: string;
  onPress: () => void;
}

function FlagActionButton({variant, glyph, label, onPress}: FlagActionButtonProps) {
  const danger = variant === 'danger';
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.btn,
        danger ? styles.btnDanger : styles.btnSecondary,
        pressed ? styles.btnPressed : null,
      ]}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.btnGlyph, danger ? styles.btnTextDanger : styles.btnTextSecondary]}>
        {glyph}
      </AppText>
      <AppText
        style={[styles.btnLabel, danger ? styles.btnTextDanger : styles.btnTextSecondary]}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function FlagsTable({
  rows,
  loading,
  onEdit,
  onAskDelete,
}: FlagsTableProps) {
  const {t} = useTranslation();
  const {sortKey, sortDir, onSort} = useSortToggle('key', 'asc');

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortKey === 'key') return a.key.localeCompare(b.key) * dir;
    return 0;
  });

  const columns: Column<FeatureFlagEntry>[] = [
    {
      key: 'key',
      header: t('admin.flags.cols.key', 'Flag key'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => <AppText style={styles.keyCell}>{row.key}</AppText>,
    },
    {
      key: 'value',
      header: t('admin.flags.cols.value', 'Value'),
      visibleOnMobile: true,
      render: (row) => (
        <AppText style={styles.valueCell}>{previewValue(row.value)}</AppText>
      ),
    },
    {
      key: 'actions',
      header: t('admin.flags.cols.actions', 'Actions'),
      visibleOnMobile: true,
      render: (row) => (
        <View style={styles.actions}>
          <FlagActionButton
            variant="secondary"
            glyph={'\u270E'}
            label={t('admin.flags.actions.edit', 'Edit')}
            onPress={() => onEdit(row)}
          />
          <FlagActionButton
            variant="danger"
            glyph={'\u2716'}
            label={t('admin.flags.actions.delete', 'Delete')}
            onPress={() => onAskDelete(row)}
          />
        </View>
      ),
    },
  ];

  return (
    <DataTable<FeatureFlagEntry>
      tableId="admin:feature-flags"
      name="feature-flags"
      columns={columns}
      data={sorted}
      keyExtractor={(row) => row.key}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      emptyMessage={
        loading
          ? t('admin.flags.table.loading', 'Loading flags…')
          : t('admin.flags.table.empty', 'No feature flags are set on this server.')
      }
      pagination={{defaultPageSize: 25, pageSizeOptions: [25, 50, 100]}}
      mobileColumns={['key', 'value', 'actions']}
    />
  );
}

export default FlagsTable;

const styles = StyleSheet.create({
  keyCell: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  valueCell: {
    color: colors.textMuted,
    fontFamily: MONO_FONT,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
  },
  btn: {
    alignItems: 'center',
    borderRadius: 6, // rounded-md
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6, // gap-2 (tightened for the sm icon+label pair)
    height: 32, // h-8
    justifyContent: 'center',
    paddingHorizontal: 12, // px-3
  },
  btnSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  btnDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnGlyph: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  btnLabel: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  btnTextSecondary: {
    color: colors.textPrimary,
  },
  btnTextDanger: {
    color: colors.danger,
  },
});

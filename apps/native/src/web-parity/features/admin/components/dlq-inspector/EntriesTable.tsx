/**
 * DLQ Inspector — entries table (native parity port of
 * web/src/features/admin/components/dlq-inspector/EntriesTable.tsx).
 *
 * Renders the list of DLQ rows with sortable columns + an Inspect action per
 * row. Selection state is owned by the parent page so it can decide whether to
 * open the drawer.
 *
 * Native adaptations vs. the web source (behavior/state/keys/API intent kept):
 *   - web `ui` `DataTable` (responsive `<table>` with column headers,
 *     pagination, and `mobileColumns`) -> a vertical list of bordered "row
 *     cards". Each card keeps every column the web row had (no mobileColumns
 *     subset — native shows the full set): an Arrived header + Inspect action on
 *     top, then a `KVList` of Reason / VIN / Source topic / Redel. / Payload /
 *     Replayable. The web pagination (25/50/100) is dropped — the parent page is
 *     already a ScrollView so the full sorted list scrolls.
 *   - web `ui` `useSortToggle('arrived_at','desc')` is ported inline verbatim
 *     (same toggle semantics: same key flips dir, new key resets to 'desc') and
 *     the exact `sorted` comparator switch is preserved. The web sortable column
 *     HEADERS become a tappable sort-chip row (Arrived / Reason / VIN / Payload)
 *     with an active ↑/↓ direction arrow.
 *   - web `ui` `Button size="sm" variant="secondary"` -> a Pressable Inspect
 *     button (>=44px target, same onInspect(row) call).
 *   - web `ui` `Badge` (success/neutral) -> an inline RN Badge chip.
 *   - web `data-display` `TimeStamp format="absolute"` -> the same inline
 *     formatAbsolute as EntryDrawer (locale absolute, '—' for null/unparseable).
 *   - `@/lib/numberFormat` `fmtInt` + the local `formatBytes` are ported inline.
 *   - react-i18next `useTranslation` -> a native-safe t(key, fallback) fallback
 *     preserving every key + English default.
 *   - `DLQEntrySummary` type imported from the native useDLQ hook (which
 *     re-exports it) rather than `@/types/admin-diagnostics`.
 */

import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import {KVList, type KVItem} from '../../../../components/data-display/KVList';
import type {DLQEntrySummary} from '../../../../api/hooks/useDLQ';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ---- Ported integer formatting (web/src/lib/numberFormat.ts: fmtInt) --------

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Locale-aware integer (web `fmtInt` = `fmtNumber(v, 0)`). */
function fmtInt(value: unknown): string {
  try {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(safeNumber(value)));
  }
}

/** Web `formatBytes` (B / KB / MB), '—' for non-finite/negative. */
function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) {
    return '—';
  }
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- Inline TimeStamp (web data-display TimeStamp, format="absolute") --------

/** Renders an ISO/epoch/Date as an absolute label, "—" for null/unparseable. */
function formatAbsolute(value: string | number | Date | null | undefined): string {
  if (value == null) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ---- Inline Badge (web ui Badge) -------------------------------------------

type BadgeVariant = 'success' | 'neutral';

const BADGE_THEME: Record<
  BadgeVariant,
  {bg: string; border: string; fg: string}
> = {
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    fg: colors.success,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    fg: colors.textSecondary,
  },
};

function Badge({
  variant,
  label,
}: {
  variant: BadgeVariant;
  label: string;
}): React.ReactElement {
  const theme = BADGE_THEME[variant];
  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: theme.bg, borderColor: theme.border},
      ]}>
      <AppText style={[styles.badgeText, {color: theme.fg}]} variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

// ---- Ported sort toggle (web ui useSortToggle) ------------------------------

type SortDir = 'asc' | 'desc';

function useSortToggle(defaultKey: string, defaultDir: SortDir = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const onSort = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey],
  );

  return {sortKey, sortDir, onSort};
}

// ---- Sort chip (web sortable column header) ---------------------------------

function SortChip({
  label,
  active,
  dir,
  onPress,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      onPress={onPress}
      style={({pressed}) => [
        styles.sortChip,
        active && styles.sortChipActive,
        pressed && styles.pressed,
      ]}>
      <AppText
        style={active ? styles.sortChipTextActive : styles.sortChipText}
        variant="caption"
        weight="semibold">
        {active ? `${label} ${dir === 'asc' ? '↑' : '↓'}` : label}
      </AppText>
    </Pressable>
  );
}

// ---- Entry card (web DataTable row) -----------------------------------------

function EntryCard({
  row,
  t,
  onInspect,
}: {
  row: DLQEntrySummary;
  t: NativeTFunction;
  onInspect: (entry: DLQEntrySummary) => void;
}): React.ReactElement {
  const items: KVItem[] = [
    {
      label: t('admin.dlq.cols.reason', 'Reason'),
      value: (
        <AppText style={styles.mono}>{row.parsed_reason || '—'}</AppText>
      ),
    },
    {
      label: t('admin.dlq.cols.vin', 'VIN'),
      value: (
        <AppText style={styles.monoMuted}>{row.parsed_vin ?? '—'}</AppText>
      ),
    },
    {
      label: t('admin.dlq.cols.topic', 'Source topic'),
      value: (
        <AppText style={styles.monoMuted}>
          {row.parsed_source_topic ?? '—'}
        </AppText>
      ),
    },
    {
      label: t('admin.dlq.cols.redeliveries', 'Redel.'),
      value:
        row.parsed_redeliveries != null
          ? fmtInt(row.parsed_redeliveries)
          : '—',
    },
    {
      label: t('admin.dlq.cols.size', 'Payload'),
      value: (
        <AppText style={styles.sizeText}>
          {formatBytes(row.raw_payload_size)}
        </AppText>
      ),
    },
    {
      label: t('admin.dlq.cols.replayable', 'Replayable'),
      value: row.replayable ? (
        <Badge label={t('common.yes', 'Yes')} variant="success" />
      ) : (
        <Badge label={t('common.no', 'No')} variant="neutral" />
      ),
    },
  ];

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <AppText style={styles.arrived} weight="semibold">
          {formatAbsolute(row.arrived_at)}
        </AppText>
        <Pressable
          accessibilityLabel={t('admin.dlq.actions.inspect', 'Inspect')}
          accessibilityRole="button"
          onPress={() => onInspect(row)}
          style={({pressed}) => [
            styles.inspectButton,
            pressed && styles.pressed,
          ]}>
          <AppText style={styles.inspectText} variant="caption" weight="semibold">
            {t('admin.dlq.actions.inspect', 'Inspect')}
          </AppText>
        </Pressable>
      </View>
      <KVList items={items} />
    </View>
  );
}

// ---- Component --------------------------------------------------------------

export interface EntriesTableProps {
  rows: DLQEntrySummary[];
  loading: boolean;
  onInspect: (entry: DLQEntrySummary) => void;
}

const SORT_COLUMNS: ReadonlyArray<{key: string; labelKey: string; label: string}> = [
  {key: 'arrived_at', labelKey: 'admin.dlq.cols.arrived', label: 'Arrived'},
  {key: 'parsed_reason', labelKey: 'admin.dlq.cols.reason', label: 'Reason'},
  {key: 'parsed_vin', labelKey: 'admin.dlq.cols.vin', label: 'VIN'},
  {key: 'raw_payload_size', labelKey: 'admin.dlq.cols.size', label: 'Payload'},
];

export function EntriesTable({
  rows,
  loading,
  onInspect,
}: EntriesTableProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const {sortKey, sortDir, onSort} = useSortToggle('arrived_at', 'desc');

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'arrived_at':
        return (Date.parse(a.arrived_at) - Date.parse(b.arrived_at)) * dir;
      case 'parsed_reason':
        return a.parsed_reason.localeCompare(b.parsed_reason) * dir;
      case 'parsed_vin':
        return (a.parsed_vin ?? '').localeCompare(b.parsed_vin ?? '') * dir;
      case 'raw_payload_size':
        return (a.raw_payload_size - b.raw_payload_size) * dir;
      default:
        return 0;
    }
  });

  if (sorted.length === 0) {
    return (
      <View style={styles.empty}>
        <AppText style={styles.emptyText} tone="muted">
          {loading
            ? t('admin.dlq.table.loading', 'Loading…')
            : t(
                'admin.dlq.table.empty',
                'No DLQ entries — the pipeline is clean.',
              )}
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.sortRow}>
        {SORT_COLUMNS.map(col => (
          <SortChip
            active={sortKey === col.key}
            dir={sortDir}
            key={col.key}
            label={t(col.labelKey, col.label)}
            onPress={() => onSort(col.key)}
          />
        ))}
      </View>

      <View style={styles.list}>
        {sorted.map(row => (
          <EntryCard
            key={row.id}
            onInspect={onInspect}
            row={row}
            t={t}
          />
        ))}
      </View>
    </View>
  );
}

EntriesTable.displayName = 'EntriesTable';

const styles = StyleSheet.create({
  arrived: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    lineHeight: 16,
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  emptyText: {
    textAlign: 'center',
  },
  inspectButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  inspectText: {
    color: colors.textPrimary,
  },
  list: {
    gap: spacing.sm,
  },
  mono: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'right',
  },
  monoMuted: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 12,
    textAlign: 'right',
  },
  pressed: {
    opacity: 0.82,
  },
  root: {
    gap: spacing.md,
  },
  sizeText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  sortChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  sortChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  sortChipText: {
    color: colors.textSecondary,
  },
  sortChipTextActive: {
    color: colors.accent,
  },
  sortRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});

export default EntriesTable;

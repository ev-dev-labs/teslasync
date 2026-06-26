// Native parity port of
// web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx.
//
// `LiveSignalsTable` is the Live Signal Inspector table: it renders the current
// Redis-cached live snapshot for a single vehicle as a sortable + filterable
// table. Refresh cadence is owned by the page (1s polling); this component just
// renders whatever rows are passed. Values arrive as `{ value: unknown;
// timestamp?: string }` envelopes OR bare scalars; the renderer coerces objects
// to JSON so it never crashes on a typed compound value (e.g. a location triple).
//
// State names (`filter`/`setFilter` via useState, `sortKey`/`sortDir`/`onSort`
// via `useSortToggle('name','asc')`), the three derived memos (`rows` from
// `Object.keys(signals).map(rowFromEntry)`, `filtered` by the lowercased trimmed
// query substring, `sorted` by name localeCompare or timestamp Date.parse delta
// * dir), the `LiveSignalsTableProps` shape (`data`/`loading`), the
// `LiveSignalRow` shape (`name`/`value`/`timestamp?`), the `rowFromEntry` +
// `renderValue` helpers, every `t('admin.liveSignals.*','English')` i18n key +
// fallback, the `tableId` (`admin:live-signals`), the `name` (`live-signals`),
// the `keyExtractor` (`row.name`), the pagination config ({50, [25,50,100]}) and
// the `mobileColumns` list (['name','value']) are all carried over unchanged.
//
// The web source pulls five modules; native-safe mapping (contract rules 4/5/7),
// matching the sibling AuditPanel / FlagsTable ports:
//   - react-i18next `useTranslation` (L14) -> the standard web-parity i18n shim
//     returning the inline English fallback (apps/native deps lack
//     react-i18next), so the body's `t('key','English')` calls are unchanged.
//   - lucide-react `Search` (L15, SVG icon) -> a decorative `SearchGlyph`
//     (View-drawn ring + 45deg handle), pointerEvents="none" inside a
//     non-accessible leading slot to mirror the web `aria-hidden` magnifier —
//     the same stand-in the sibling `forms/SearchInput` port uses for lucide
//     `Search`.
//   - `DataTable` + `useSortToggle` + `type Column` from `@/components/ui`
//     (L17-22) -> reused as-is from the web-parity `components/ui/DataTable`
//     port (their props and `useSortToggle(default,dir)` signature match the web
//     API 1:1). The web `Input` host is NOT ported to native parity, so the
//     filter field (`Input` + an absolutely-positioned `Search` icon, `pl-9`,
//     `aria-label`) is rebuilt with a React Native `TextInput` inside a bordered
//     shell + leading `SearchGlyph` — the exact shell the `SearchInput` port
//     uses; `value`/`onChange(e.target.value)` -> `value`/`onChangeText`,
//     `placeholder` + `aria-label` preserved as `placeholder` +
//     `accessibilityLabel`.
//   - `TimeStamp` from `@/components/data-display` (L23) -> reused as-is from the
//     web-parity `components/data-display/TimeStamp` port; `format="relative"`
//     is honored.
//   - `EmptyState` from `@/components/feedback` (L24) -> the existing native
//     shared `components/feedback/EmptyState` primitive (title + message — the
//     props this surface passes; the L154 "no-action" comment is preserved, and
//     the action-less native primitive naturally satisfies it).
//   - the `VehicleLiveSignal` / `VehicleLiveSignalsResponse` types (L25-28, web
//     `@/api/hooks/useTelemetry`) -> imported from the web-parity
//     `api/hooks/useTelemetry` module, where the native parity surface
//     re-declares them with identical shape (`{ value: unknown; timestamp?:
//     string }` / `{ vehicle_id?; signals?: Record<string, ...> }`).
//
// Each column `render` returned a DOM `<span className=…>` on web; React Native
// has no `<span>` / className, so the cells become `AppText` carrying the
// equivalent styling via `StyleSheet`: `font-mono text-sm text-[var(--text-
// primary)]` -> mono + 14/20 + colors.textPrimary (name cell); `font-mono
// text-xs text-[var(--text-muted)]` -> mono + 12/16 + colors.textMuted (value
// cell); `text-xs text-[var(--text-muted)]` -> 12/16 + colors.textMuted (the
// timestamp "—" placeholder). font-mono -> a Platform.select monospace family
// (Menlo on iOS), matching the sibling ports. The outer `<div className="space-
// y-4">` -> a `View` with gap 16; the `<div className="relative max-w-md">`
// search wrapper -> the bordered shell View capped at maxWidth 448 (max-w-md).

import React, {useMemo, useState} from 'react';
import {Platform, StyleSheet, TextInput, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {colors, spacing} from '../../../../../theme/tokens';
import {
  DataTable,
  useSortToggle,
  type Column,
} from '../../../../components/ui/DataTable';
import {TimeStamp} from '../../../../components/data-display/TimeStamp';
import type {
  VehicleLiveSignal,
  VehicleLiveSignalsResponse,
} from '../../../../api/hooks/useTelemetry';

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

interface LiveSignalsTableProps {
  data: VehicleLiveSignalsResponse | undefined;
  loading: boolean;
}

interface LiveSignalRow {
  name: string;
  value: unknown;
  timestamp?: string;
}

/**
 * Normalises a single entry of `data.signals` into a flat row. The
 * backend may return either `{ value, timestamp }` envelopes OR a bare
 * scalar (`true`, `42`, "Drive"), depending on which signal repo
 * shipped the row. Both shapes flow through unchanged into the table.
 */
function rowFromEntry(name: string, raw: unknown): LiveSignalRow {
  if (raw && typeof raw === 'object' && 'value' in (raw as VehicleLiveSignal)) {
    const env = raw as VehicleLiveSignal;
    return {name, value: env.value, timestamp: env.timestamp};
  }
  return {name, value: raw};
}

function renderValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  const tx = typeof v;
  if (tx === 'string') return v as string;
  if (tx === 'number' || tx === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '—';
  }
}

// ── SearchGlyph (lucide-react `Search` stand-in; host not ported) ───────────
// Decorative View-drawn magnifier: a ring (the lens) plus a 45deg handle.
// pointerEvents="none" + lives inside a non-accessible slot, mirroring the web
// `aria-hidden`. Same approach as the sibling `forms/SearchInput` port.
function SearchGlyph({color, size}: {color: string; size: number}) {
  const ring = Math.round(size * 0.62);
  const handle = Math.round(size * 0.4);
  return (
    <View
      pointerEvents="none"
      style={[styles.glyphBox, {height: size, width: size}]}>
      <View
        style={[
          styles.glyphRing,
          {borderColor: color, borderRadius: ring / 2, height: ring, width: ring},
        ]}
      />
      <View style={[styles.glyphHandle, {backgroundColor: color, width: handle}]} />
    </View>
  );
}

export function LiveSignalsTable({data, loading}: LiveSignalsTableProps) {
  const {t} = useTranslation();
  const [filter, setFilter] = useState('');
  const {sortKey, sortDir, onSort} = useSortToggle('name', 'asc');

  const rows = useMemo<LiveSignalRow[]>(() => {
    const signals = data?.signals ?? {};
    return Object.keys(signals).map((name) => rowFromEntry(name, signals[name]));
  }, [data]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, filter]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dir;
      if (sortKey === 'timestamp') {
        return (
          ((a.timestamp ? Date.parse(a.timestamp) : 0) -
            (b.timestamp ? Date.parse(b.timestamp) : 0)) *
          dir
        );
      }
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const columns: Column<LiveSignalRow>[] = [
    {
      key: 'name',
      header: t('admin.liveSignals.cols.name', 'Signal'),
      sortable: true,
      visibleOnMobile: true,
      render: (row) => <AppText style={styles.nameCell}>{row.name}</AppText>,
    },
    {
      key: 'value',
      header: t('admin.liveSignals.cols.value', 'Value'),
      visibleOnMobile: true,
      render: (row) => (
        <AppText style={styles.valueCell}>{renderValue(row.value)}</AppText>
      ),
    },
    {
      key: 'timestamp',
      header: t('admin.liveSignals.cols.timestamp', 'Last update'),
      sortable: true,
      render: (row) =>
        row.timestamp ? (
          <TimeStamp value={row.timestamp} format="relative" />
        ) : (
          <AppText style={styles.placeholder}>—</AppText>
        ),
    },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.searchShell}>
        <View pointerEvents="none" style={styles.leadingIcon}>
          <SearchGlyph color={colors.textMuted} size={16} />
        </View>
        <TextInput
          accessibilityLabel={t('admin.liveSignals.filterAria', 'Filter signals')}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setFilter}
          placeholder={t(
            'admin.liveSignals.filterPlaceholder',
            'Filter signal names…',
          )}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          value={filter}
        />
      </View>

      {!loading && rows.length === 0 ? (
        <EmptyState
          title={t('admin.liveSignals.empty.title', 'No live signals cached')}
          message={t(
            'admin.liveSignals.empty.message',
            'Redis has no live snapshot for this vehicle yet. Confirm the vehicle is online and publishing.',
          )}
          // no-action: the vehicle picker above is the only meaningful CTA.
        />
      ) : (
        <DataTable<LiveSignalRow>
          tableId="admin:live-signals"
          name="live-signals"
          columns={columns}
          data={sorted}
          keyExtractor={(row) => row.name}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          emptyMessage={
            loading
              ? t('admin.liveSignals.table.loading', 'Loading…')
              : t(
                  'admin.liveSignals.table.filtered',
                  'No signals match this filter.',
                )
          }
          pagination={{defaultPageSize: 50, pageSizeOptions: [25, 50, 100]}}
          mobileColumns={['name', 'value']}
        />
      )}
    </View>
  );
}

export default LiveSignalsTable;

const styles = StyleSheet.create({
  root: {
    gap: 16, // space-y-4
  },
  searchShell: {
    alignItems: 'center',
    backgroundColor: '#0e1727', // bg-[var(--surface-1)]
    borderColor: colors.border, // border-[var(--glass-border)]
    borderRadius: 6, // rounded-md
    borderWidth: 1,
    flexDirection: 'row',
    maxWidth: 448, // max-w-md
    paddingHorizontal: spacing.md, // px-3 (matches the web Input's left padding)
  },
  leadingIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm, // pl-9 icon gutter
  },
  input: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    flex: 1,
    fontSize: 14, // text-sm
    paddingHorizontal: 0,
    paddingVertical: 8, // py-2
  },
  nameCell: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontFamily: MONO_FONT,
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  valueCell: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontFamily: MONO_FONT,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  placeholder: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  glyphBox: {
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  glyphRing: {
    borderWidth: 1.5,
    left: 0,
    position: 'absolute',
    top: 0,
  },
  glyphHandle: {
    bottom: 1,
    height: 1.5,
    position: 'absolute',
    right: 0,
    transform: [{rotate: '45deg'}],
  },
});

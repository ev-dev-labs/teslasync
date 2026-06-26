// Native parity port of
// web/src/features/charging/components/cost-analysis/MonthlyCostTable.tsx.
//
// `MonthlyCostTable` is the charging Cost-Analysis "Monthly Cost Breakdown"
// panel: a GlassPanel (p-4) holding a BarChart3-iconed title row and a sortable
// DataTable of seven columns — Month, Sessions, Energy, Cost, Avg $/kWh, Gas
// Equiv and Savings — over the `MonthlyBucket[]` the parent computes. The
// component owns the table's sort state (`tableSortKey` default 'month',
// `tableSortDir` default 'desc'), derives `sortedData` (numeric subtract vs
// String.localeCompare, asc/desc flip), and toggles direction via `handleSort`.
// Every state name, the `tableId="charging:cost-monthly"`, the column keys +
// i18n keys/fallbacks, the per-cell formatters (fmtInt, fmtWithUnit 'kWh' 1dp,
// Currency at 2dp / 3dp), the cyan/red/green cell tints, the `savings >= 0`
// sign-prefix + green/red branch, the `compact pagination columnVisibility
// columnReorder` table flags, and the empty-state fallback are all preserved.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` (L2) -> a local key-preserving fallback
//     shim returning the inline English copy (stable `t` via useCallback so the
//     `columns` useMemo dep `[t]` matches the web's stable react-i18next `t`).
//     Every i18n key is referenced verbatim so intent survives without the
//     react-i18next dep (the CostSummaryCards / DataTable port precedent).
//   - lucide-react `BarChart3` (L3, SVG, no native analog) -> a decorative emoji
//     glyph (📊) rendered in an accessibility-hidden AppText (the adjacent title
//     carries the meaning) — the CostSummaryCards <Glyph/> precedent. The raw
//     `text-cyan-400` icon tint has no SI token, so it is kept as the literal
//     Tailwind-400 hex #22d3ee (the sibling CostSummaryCards mapping).
//   - `GlassPanel`, `DataTable`, `type Column` from @/components/ui (L4) ->
//     GlassPanel = the shared native GlassPanel; DataTable / Column = the
//     web-parity ui port (reused 1:1 — tableId/columns/data/keyExtractor/sortKey/
//     sortDir/onSort/compact/pagination/columnVisibility/columnReorder kept
//     verbatim; the native DataTable auto-wraps string cell renders in AppText
//     and passes element renders through), exactly as the SleepEfficiencyPage /
//     BatteryCellsPage ports consume it.
//   - `Currency` from @/components/data-display (L5) -> reproduced as a local
//     native `Currency` mirroring the web component: value/precision(2)/
//     symbolOverride/fallback('—') with the same null/!isFinite -> fallback
//     guard and `${symbol}${fmtNumber(value, precision)}` body. The web symbol
//     comes from useFormatting().currencySymbol; with no ported native settings
//     provider this uses the web default '$' (the CostSummaryCards precedent).
//     The web `title={`${symbol}${value.toFixed(precision)}`}` tooltip has no
//     native analog and is dropped (documented). A `style` prop replaces the
//     web `className`; the savings cell passes the same green/red tint so the
//     value inherits the cell colour the web got from CSS span inheritance.
//   - `fmtInt`, `fmtWithUnit` from @/lib/numberFormat (L6) -> inlined native-safe
//     equivalents (+ their fmtNumber/safeNumber deps): nullish/non-finite -> 0,
//     en-US locale, fmtInt = precision 0, fmtWithUnit = "<n> <unit>" (identical
//     to the CostSummaryCards inline ports).
//   - `cn` from @/lib/cn (L7, Tailwind class merge) -> no native analog; the one
//     use (`cn('font-medium', savings>=0 ? 'text-green-400' : 'text-red-400')`)
//     becomes a StyleSheet array `[styles.medium, positive ? greenText :
//     redText]`, so the merge is unnecessary and `cn` is dropped.
//   - `type MonthlyBucket` from ./types (L8) -> inlined verbatim (the
//     cost-analysis types.ts is not yet ported as a standalone native module,
//     the CostSummaryCards CoreStats-inline precedent).
//
// DOM -> native element mapping: the `<GlassPanel className="p-4">` -> native
// GlassPanel (styles.panel padding 16); the `<h3 className="mb-4 flex
// items-center gap-2 text-sm font-semibold text-white">` -> a row View
// (styles.titleRow: row, items-center, gap 8, marginBottom 16) holding the 📊
// Glyph + an AppText title (14 / '600'); each `render` returning a `<span>` ->
// an AppText (font-medium -> fontWeight '500'); `<Currency>` -> the local native
// Currency; the string-returning renders (fmtInt / fmtWithUnit) are returned
// verbatim and auto-wrapped by the native DataTable; the empty `<div
// className="flex h-32 items-center justify-center text-sm text-[var(--text-
// muted)]">` -> a centered View (height 128) with a muted AppText. No DOM-only
// modules, browser HTML elements, Recharts, Leaflet, or old web UI components
// are imported.

import React, {useCallback, useMemo, useState} from 'react';
import {StyleSheet, View, type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {DataTable, type Column} from '../../../../components/ui/DataTable';

// ─── i18n fallback shim ───────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
// `t` is stabilised with useCallback so the `columns` useMemo dep `[t]` behaves
// like the web's stable react-i18next `t` (computed once, not every render).
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((_key, fallback) => fallback, []);
  return {t};
}

// ─── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber / fmtInt / fmtWithUnit) ──
// Locale-aware formatting matching the web helpers: nullish/non-finite input
// coerces to 0, default precision is 2, fmtInt is precision 0, fmtWithUnit is
// "<n> <unit>", and a bad locale falls back to en-US.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

// ─── Inlined `@/components/data-display` Currency ─────────────
// Mirrors the web Currency: renders `${symbol}${fmtNumber(value, precision)}`
// with the same null/!Number.isFinite -> fallback guard. The web symbol comes
// from useFormatting().currencySymbol; with no ported native settings provider
// this uses the web default '$'. The web `title` tooltip has no native analog
// and is dropped; a `style` prop replaces the web `className`.
const CURRENCY_SYMBOL = '$';

interface CurrencyProps {
  value?: number | null;
  precision?: number;
  symbolOverride?: string;
  fallback?: string;
  style?: StyleProp<TextStyle>;
}

function Currency({
  value,
  precision = 2,
  symbolOverride,
  fallback = '—',
  style,
}: CurrencyProps): React.ReactElement {
  if (value == null || !Number.isFinite(value)) {
    return <AppText style={style}>{fallback}</AppText>;
  }
  const symbol = symbolOverride ?? CURRENCY_SYMBOL;
  const display = fmtNumber(value, precision);
  return <AppText style={style}>{`${symbol}${display}`}</AppText>;
}

// ─── Inlined `./types` (MonthlyBucket) ────────────────────────
// The cost-analysis types.ts is not yet ported as a standalone native module, so
// the consumed type is inlined verbatim.
export interface MonthlyBucket {
  month: string;
  cost: number;
  energy: number;
  sessions: number;
  avgCostPerKwh: number;
  gasEquiv: number;
  savings: number;
}

// ─── Decorative glyph (lucide BarChart3 → native-safe text glyph) ──
// The adjacent title carries the meaning, so the glyph is hidden from the
// accessibility tree. The h-4 w-4 (16px) lucide icon maps to a 16px emoji.
interface GlyphProps {
  char: string;
  color: string;
}

function Glyph({char, color}: GlyphProps): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color}]}>
      {char}
    </AppText>
  );
}

interface MonthlyCostTableProps {
  data: MonthlyBucket[];
}

export function MonthlyCostTable({data}: MonthlyCostTableProps) {
  const {t} = useTranslation();
  const [tableSortKey, setTableSortKey] = useState('month');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');

  const columns = useMemo<Column<MonthlyBucket>[]>(
    () => [
      {
        key: 'month',
        header: t('costAnalysis.table.month', 'Month'),
        sortable: true,
        render: row => <AppText style={styles.medium}>{row.month}</AppText>,
      },
      {
        key: 'sessions',
        header: t('costAnalysis.table.sessions', 'Sessions'),
        sortable: true,
        render: row => fmtInt(row.sessions),
      },
      {
        key: 'energy',
        header: t('costAnalysis.table.energy', 'Energy'),
        sortable: true,
        render: row => fmtWithUnit(row.energy, 'kWh', 1),
      },
      {
        key: 'cost',
        header: t('costAnalysis.table.cost', 'Cost'),
        sortable: true,
        render: row => <Currency value={row.cost} style={styles.cyanText} />,
      },
      {
        key: 'avgCostPerKwh',
        header: t('costAnalysis.table.avgRate', 'Avg $/kWh'),
        sortable: true,
        render: row => <Currency value={row.avgCostPerKwh} precision={3} />,
      },
      {
        key: 'gasEquiv',
        header: t('costAnalysis.table.gasEquiv', 'Gas Equiv'),
        sortable: true,
        render: row => <Currency value={row.gasEquiv} style={styles.redText} />,
      },
      {
        key: 'savings',
        header: t('costAnalysis.table.savings', 'Savings'),
        sortable: true,
        render: row => {
          const positive = row.savings >= 0;
          const tint = positive ? styles.greenText : styles.redText;
          return (
            <AppText style={[styles.medium, tint]}>
              {positive ? '+' : ''}
              <Currency value={row.savings} style={tint} />
            </AppText>
          );
        },
      },
    ],
    [t],
  );

  const sortedData = useMemo(() => {
    if (data.length === 0) return [];
    return [...data].sort((a, b) => {
      const aVal = a[tableSortKey as keyof MonthlyBucket];
      const bVal = b[tableSortKey as keyof MonthlyBucket];
      const cmp =
        typeof aVal === 'number' && typeof bVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal));
      return tableSortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, tableSortKey, tableSortDir]);

  const handleSort = (key: string) => {
    if (key === tableSortKey) {
      setTableSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTableSortKey(key);
      setTableSortDir('desc');
    }
  };

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <Glyph char="📊" color="#22d3ee" />
        <AppText style={styles.title}>
          {t('costAnalysis.table.title', 'Monthly Cost Breakdown')}
        </AppText>
      </View>
      {sortedData.length > 0 ? (
        <DataTable<MonthlyBucket>
          tableId="charging:cost-monthly"
          columns={columns}
          data={sortedData}
          keyExtractor={row => row.month}
          sortKey={tableSortKey}
          sortDir={tableSortDir}
          onSort={handleSort}
          compact
          pagination
          columnVisibility
          columnReorder
        />
      ) : (
        <View style={styles.empty}>
          <AppText style={styles.emptyText} tone="muted">
            {t('costAnalysis.table.noData', 'No monthly data available')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

MonthlyCostTable.displayName = 'MonthlyCostTable';

export default MonthlyCostTable;

const styles = StyleSheet.create({
  panel: {
    padding: 16, // p-4
  },
  titleRow: {
    alignItems: 'center', // items-center
    flexDirection: 'row', // flex
    gap: 8, // gap-2
    marginBottom: 16, // mb-4
  },
  title: {
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold (text-white -> AppText primary tone)
    lineHeight: 20,
  },
  glyph: {
    fontSize: 16, // h-4 w-4 (16px)
    lineHeight: 20,
  },
  medium: {
    fontWeight: '500', // font-medium
  },
  cyanText: {
    color: '#22d3ee', // text-cyan-400
  },
  redText: {
    color: '#f87171', // text-red-400
  },
  greenText: {
    color: '#4ade80', // text-green-400
  },
  empty: {
    alignItems: 'center', // items-center
    height: 128, // h-32
    justifyContent: 'center', // justify-center
  },
  emptyText: {
    fontSize: 14, // text-sm (text-[var(--text-muted)] -> AppText muted tone)
    lineHeight: 20,
  },
});

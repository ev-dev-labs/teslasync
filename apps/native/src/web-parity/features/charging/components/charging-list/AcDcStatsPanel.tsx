// Native parity port of
// web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx.
//
// Renders the "Charging Stats by Type" GlassPanel: an AC-vs-DC energy split bar,
// an 8-column AC/DC statistics table, and an optional free-charging total footer.
// The web file leans on browser-only dependencies that are absent from the native
// parity manifest (contract rules 4, 5 & 7); each is replaced with a React
// Native-safe equivalent and documented here + in the sidecar:
//
//   - react-i18next `useTranslation` (web L1, L26, L79) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('key', 'English') call keeps its English default and translation-key
//     intent at each call site (charging.stats.chargingByType /
//     charging.stats.energySplitLabel / charging.table.*).
//   - lucide-react `Zap` (web L2, L31) -> the shared native SemanticIcon
//     name="bolt" (a lightning glyph, warning/amber tone), decorative, since
//     lucide SVG icons have no native renderer. Visual intent (amber bolt next to
//     the title) is preserved.
//   - `@/components/ui` GlassPanel + DataTable/Column (web L3, L29, L63-105) ->
//     the shared native GlassPanel plus a hand-built native table (View/AppText
//     rows wrapped in a horizontal ScrollView to honor the web `overflow-x-auto`).
//     The web DataTable's `tableId`/`keyExtractor`/`compact`/`pagination` props are
//     port-mapped: compact -> tight cell padding, keyExtractor -> the row React
//     key, tableId/pagination are inert here (the AC/DC dataset is at most two
//     rows, so pagination never engages and the persisted tableId/column-order/CSV
//     features have no native surface). Each web `Column.render` (returning a React
//     node) is ported verbatim; `className: 'text-right'` -> the cell's flex-end
//     alignment.
//   - `@/components/data-display` Currency (web L4, L89-90) -> the ported native
//     parity Currency (same settings-driven symbol, no FX conversion).
//   - `@/lib/numberFormat` fmtPercent + fmtWithUnit (web L5) -> tiny local closures
//     over the ported `useFormatPrefs().fmt` (the native parity port of
//     numberFormat.fmtNumber with the same settings-derived global locale +
//     precision), so `${fmt(v)}%` / `${fmt(v)} ${unit}` match the web strings.
//   - `@/lib/cn` (web L6, L86) -> not needed; the web's conditional
//     `text-blue-500 | text-amber-500` class is the same hex as the bucket color,
//     so the type label is colored directly from `row.color`.
//   - `../ChargingSessionCard` formatDuration (web L7, L92) is the re-exported
//     `@/lib/dateFormat` formatDurationMinutes; ported inline (with formatRoundedInt
//     + the ported isFiniteNumber/FALLBACK from _formatPrimitives) because the
//     native dateFormat helpers are not yet present.
//   - `./helpers` types AcDcBreakdown + AcDcBucket (web L8) -> ported inline; the
//     native charging-list helpers are not yet ported.
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, or web UI components are
// imported -- only react, react-native primitives, the shared native AppText /
// GlassPanel / SemanticIcon / theme tokens, and ported parity Currency / format
// primitives.

import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {Currency} from '../../../../components/data-display/format/Currency';
import {
  FALLBACK,
  isFiniteNumber,
  useFormatPrefs,
} from '../../../../components/data-display/format/_formatPrimitives';

// Tailwind palette hexes used by the web classes, kept verbatim for parity.
const COLOR_AC = '#3b82f6'; // bg-blue-500 / text-blue-500 (AC)
const COLOR_DC = '#f59e0b'; // bg-amber-500 / text-amber-500 (DC)
const COLOR_AMBER_300 = '#fcd34d'; // text-amber-300 (cost)
const COLOR_EMERALD_300 = '#6ee7b7'; // text-emerald-300 (free)

// ── ./helpers types (ported inline; native helpers not yet present) ──

interface AcDcBucket {
  energy: number;
  energyUsed: number;
  cost: number;
  count: number;
  totalDuration: number;
  freeCount: number;
  freeEnergy: number;
}

interface AcDcBreakdown {
  ac: AcDcBucket;
  dc: AcDcBucket;
  total: {energy: number; cost: number; freeEnergy: number; freeCount: number};
}

interface AcDcStatsPanelProps {
  breakdown: AcDcBreakdown;
}

interface AcDcTableRow {
  label: string;
  color: string;
  energy: number;
  cost: number;
  count: number;
  totalDuration: number;
  freeCount: number;
  freeEnergy: number;
}

interface NativeColumn {
  key: string;
  header: string;
  align: 'left' | 'right';
  width: number;
  render: (row: AcDcTableRow) => React.ReactNode;
}

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next useTranslation replacement: returns the English fallback so the
// translation key intent is preserved at every call site.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/dateFormat formatDurationMinutes (ported inline) ──

function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDurationMinutes(
  minutes: number | null | undefined,
  options: {subMinuteLabel?: string} = {},
): string {
  if (!isFiniteNumber(minutes) || minutes < 0) {
    return FALLBACK;
  }
  if (options.subMinuteLabel && minutes < 1) {
    return options.subMinuteLabel;
  }
  const h = Math.floor(minutes / 60);
  const m = formatRoundedInt(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function AcDcStatsPanel({breakdown}: AcDcStatsPanelProps) {
  const t = useNativeTranslation();
  const {fmt} = useFormatPrefs();
  const fmtWithUnit = (v: number, unit: string) => `${fmt(v)} ${unit}`;
  const fmtPercent = (v: number) => `${fmt(v)}%`;
  const fmtEnergy = (v: number) =>
    v >= 1000 ? fmtWithUnit(v / 1000, 'MWh') : fmtWithUnit(v, 'kWh');

  const acPct = (breakdown.ac.energy / breakdown.total.energy) * 100;
  const dcPct = (breakdown.dc.energy / breakdown.total.energy) * 100;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <SemanticIcon name="bolt" size="sm" decorative />
        <AppText style={styles.sectionTitle}>
          {t('charging.stats.chargingByType', 'Charging Stats by Type')}
        </AppText>
      </View>

      {/* Energy Split Bar */}
      <View style={styles.splitSection}>
        <AppText style={styles.splitLabel}>
          {t('charging.stats.energySplitLabel', 'Energy Split (AC vs DC)')}
        </AppText>
        <View style={styles.splitBar}>
          {breakdown.ac.energy > 0 && (
            <View
              style={[styles.splitSegment, styles.splitSegmentAc, {flex: acPct}]}>
              <AppText style={styles.splitSegmentLabel}>
                {`AC ${fmtPercent(acPct)}`}
              </AppText>
            </View>
          )}
          {breakdown.dc.energy > 0 && (
            <View
              style={[styles.splitSegment, styles.splitSegmentDc, {flex: dcPct}]}>
              <AppText style={styles.splitSegmentLabel}>
                {`DC ${fmtPercent(dcPct)}`}
              </AppText>
            </View>
          )}
        </View>
        <View style={styles.splitFooter}>
          <AppText style={styles.splitFooterText}>
            {`AC: ${fmtEnergy(breakdown.ac.energy)}`}
          </AppText>
          <AppText style={styles.splitFooterText}>
            {`Total: ${fmtEnergy(breakdown.total.energy)}`}
          </AppText>
          <AppText style={styles.splitFooterText}>
            {`DC: ${fmtEnergy(breakdown.dc.energy)}`}
          </AppText>
        </View>
      </View>

      {/* Stats Table (horizontal scroll mirrors web overflow-x-auto) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <AcDcTable ac={breakdown.ac} dc={breakdown.dc} />
      </ScrollView>

      {/* Free charging total */}
      {breakdown.total.freeCount > 0 && (
        <View style={styles.freeFooter}>
          <AppText style={styles.freeFooterText}>
            {`${t('charging.table.freeCharged', 'Free charged')}: `}
            <AppText style={styles.freeStrong}>
              {`${breakdown.total.freeCount} sessions`}
            </AppText>
          </AppText>
          <AppText style={styles.freeFooterText}>
            {`${t('charging.table.freeEnergy', 'Free energy')}: `}
            <AppText style={styles.freeStrong}>
              {fmtWithUnit(breakdown.total.freeEnergy, 'kWh')}
            </AppText>
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

function AcDcTable({ac, dc}: {ac: AcDcBucket; dc: AcDcBucket}) {
  const t = useNativeTranslation();
  const {fmt} = useFormatPrefs();
  const fmtWithUnit = (v: number, unit: string) => `${fmt(v)} ${unit}`;
  const fmtEnergy = (v: number) =>
    v >= 1000 ? fmtWithUnit(v / 1000, 'MWh') : fmtWithUnit(v, 'kWh');

  const data: AcDcTableRow[] = [
    {label: t('charging.table.acCharging', 'AC Charging'), color: COLOR_AC, ...ac},
    {label: t('charging.table.dcCharging', 'DC Charging'), color: COLOR_DC, ...dc},
  ].filter(r => r.count > 0);

  const columns: NativeColumn[] = [
    {
      key: 'type',
      header: t('charging.table.type', 'Type'),
      align: 'left',
      width: 120,
      render: r => (
        <AppText style={[styles.cellText, styles.typeLabel, {color: r.color}]}>
          {r.label}
        </AppText>
      ),
    },
    {
      key: 'sessions',
      header: t('charging.table.sessionCount', 'Sessions'),
      align: 'right',
      width: 80,
      render: r => (
        <AppText style={[styles.cellText, styles.textPrimary]}>
          {String(r.count)}
        </AppText>
      ),
    },
    {
      key: 'energy',
      header: t('charging.table.energy', 'Energy'),
      align: 'right',
      width: 96,
      render: r => (
        <AppText style={[styles.cellText, styles.textPrimary]}>
          {fmtEnergy(r.energy)}
        </AppText>
      ),
    },
    {
      key: 'cost',
      header: t('charging.table.cost', 'Cost'),
      align: 'right',
      width: 90,
      render: r => (
        <Currency value={r.cost} style={[styles.cellText, styles.amber300]} />
      ),
    },
    {
      key: 'perKwh',
      header: t('charging.table.costPerKwh', '$/kWh'),
      align: 'right',
      width: 84,
      render: r =>
        r.energy > 0 ? (
          <Currency
            value={r.cost / r.energy}
            style={[styles.cellText, styles.textSecondary]}
          />
        ) : (
          <AppText style={[styles.cellText, styles.textSecondary]}>
            {FALLBACK}
          </AppText>
        ),
    },
    {
      key: 'avgEnergy',
      header: t('charging.table.avgEnergy', 'Avg Energy'),
      align: 'right',
      width: 104,
      render: r => (
        <AppText style={[styles.cellText, styles.textSecondary]}>
          {fmtWithUnit(r.energy / r.count, 'kWh')}
        </AppText>
      ),
    },
    {
      key: 'avgTime',
      header: t('charging.table.avgTime', 'Avg Time'),
      align: 'right',
      width: 90,
      render: r => (
        <AppText style={[styles.cellText, styles.textSecondary]}>
          {formatDurationMinutes(r.totalDuration / r.count)}
        </AppText>
      ),
    },
    {
      key: 'free',
      header: t('charging.table.free', 'Free'),
      align: 'right',
      width: 140,
      render: r => (
        <AppText style={[styles.cellText, styles.emerald300]}>
          {r.freeCount > 0
            ? `${r.freeCount} (${fmtWithUnit(r.freeEnergy, 'kWh')})`
            : FALLBACK}
        </AppText>
      ),
    },
  ];

  return (
    <View style={styles.table}>
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        {columns.map(col => (
          <View
            key={col.key}
            style={[
              styles.cell,
              {width: col.width},
              col.align === 'right' && styles.cellAlignRight,
            ]}>
            <AppText style={styles.headerText}>{col.header}</AppText>
          </View>
        ))}
      </View>
      {data.map(row => (
        <View key={row.label} style={[styles.tableRow, styles.tableBodyRow]}>
          {columns.map(col => (
            <View
              key={col.key}
              style={[
                styles.cell,
                {width: col.width},
                col.align === 'right' && styles.cellAlignRight,
              ]}>
              {col.render(row)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 20,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  splitSection: {
    marginBottom: 16,
  },
  splitLabel: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 6,
  },
  splitBar: {
    borderRadius: 8,
    flexDirection: 'row',
    height: 16,
    overflow: 'hidden',
  },
  splitSegment: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  splitSegmentAc: {
    backgroundColor: COLOR_AC,
  },
  splitSegmentDc: {
    backgroundColor: COLOR_DC,
  },
  splitSegmentLabel: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 12,
  },
  splitFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  splitFooterText: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  table: {
    minWidth: '100%',
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  tableBodyRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cell: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cellAlignRight: {
    alignItems: 'flex-end',
  },
  headerText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  cellText: {
    fontSize: 12,
    lineHeight: 16,
  },
  typeLabel: {
    fontWeight: '500',
  },
  textPrimary: {
    color: colors.textPrimary,
  },
  textSecondary: {
    color: colors.textSecondary,
  },
  amber300: {
    color: COLOR_AMBER_300,
  },
  emerald300: {
    color: COLOR_EMERALD_300,
  },
  freeFooter: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
    marginTop: 12,
    paddingTop: 12,
  },
  freeFooterText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  freeStrong: {
    color: COLOR_EMERALD_300,
    fontWeight: '700',
  },
});

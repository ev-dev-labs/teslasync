// Native parity port of
// web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx.
//
// `ChargerSpecsPanel` is the charging-list "Charger Specs Breakdown" card: a
// GlassPanel with a Gauge-iconed section heading followed by either a responsive
// 4-up grid of `SpecColumn`s (By Voltage / By Phase / By Cable / By Brand) or a
// single "no data" EmptyState. Each `SpecColumn` renders an icon+label header and
// a stack of `name` / `<count> sessions · <energy|avgPower>` rows, or its own
// per-column EmptyState when it has no entries. The `hasData` predicate (voltage
// OR cable OR brand non-empty), the four columns + their exact i18n keys/English
// fallbacks, the `showAvgPower` brand-only flag, the unit strings ("kWh"/"kW
// avg"), the "<count> sessions · " separator, and the avgPower-vs-energy choice
// (`showAvgPower && v.avgPower != null`) are all preserved verbatim.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` (L1) -> the standard local key-preserving
//     fallback shim returning the inline English copy (no react-i18next in the
//     native deps; same approach as the sibling SessionDetailPanel port).
//   - lucide-react `Zap`/`Activity`/`Cable`/`Plug`/`Gauge` (L2, SVG) have no
//     native analog -> small decorative emoji glyphs rendered in `AppText`
//     (the AutomationCard `<Glyph glyph="⚡" .../>` precedent). Each glyph is
//     decorative (accessibilityElementsHidden) because the adjacent label/heading
//     text carries the meaning. The Gauge heading icon keeps its `text-neon-purple`
//     tint via colors.violet; the column icons inherit the secondary label tone.
//   - `GlassPanel` from `@/components/ui` (L3) -> the native shared
//     `components/ui/GlassPanel` primitive (View-based glass card).
//   - `EmptyState` from `@/components/feedback` (L4) -> a faithful message-only
//     local shim mirroring the web component's single-`message` API; the shared
//     native EmptyState requires a `title` the source never supplies (the
//     SleepEfficiencyPage message-only-shim precedent). The web no-action JSDoc
//     comment intent is carried in the sidecar.
//   - `fmtInt` + `fmtWithUnit` from `@/lib/numberFormat` (L5) -> inlined
//     native-safe equivalents (+ their `safeNumber`/`fmtNumber` deps) matching the
//     web contract: nullish/non-finite -> 0, en-US locale, default precision 2,
//     `fmtInt` = precision 0, `fmtWithUnit` = "<n> <unit>" (same inline as the
//     SessionDetailPanel port).
//   - `ChargerSpecsData` type from `./helpers` (L6) -> inlined verbatim (with its
//     `SpecEntry` member type); the charging-list `helpers.ts` has not been ported
//     as a standalone native module yet, so this component stays self-contained.
//
// DOM -> native element mapping: `<GlassPanel className="p-5">` -> GlassPanel
// styles.panel (padding 20); the `<h3 className="section-title flex items-center
// gap-2 mb-4">` -> a row View (heading) of the violet Gauge Glyph + an AppText
// carrying section-title (text-lg 18 / font-semibold '600' / tracking-tight
// letterSpacing -0.45 / text-primary) + mb-4 marginBottom 16; the grid
// `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6` -> the mobile base single
// column (grid-cols-1) as a vertical View stack with gap 24 (gap-6). Inside each
// SpecColumn the `<p className="text-xs font-semibold text-[var(--text-secondary)]
// mb-2 flex items-center gap-1">` -> a row View (columnLabel) gap 4 / marginBottom
// 8 with a Glyph + secondary AppText (text-xs 12 / font-semibold '600'); the
// `<div className="space-y-2">` -> a View gap 8; each row `<div className="flex
// justify-between items-center text-xs">` -> a row View (space-between, center);
// `<span className="text-[var(--text-primary)] font-medium">` -> AppText primary
// (text-xs 12 / font-medium '500'); `<span className="text-[var(--text-muted)]">`
// -> AppText muted (text-xs 12). No DOM-only modules, browser HTML elements,
// Recharts, Leaflet, or old web UI components are imported.

import React from 'react';
import {StyleSheet, View, type StyleProp, type TextStyle} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';

// ─── i18n fallback shim ───────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ─── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber / fmtWithUnit / fmtInt) ──
// Locale-aware formatting matching the web helpers: nullish/non-finite input
// coerces to 0, default precision is 2, fmtInt is precision 0, and a bad locale
// falls back to en-US.
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

function fmtWithUnit(v: unknown, unit: string, decimals?: number): string {
  return `${fmtNumber(v, decimals)} ${unit}`;
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// ─── Inlined `./helpers` types (SpecEntry / ChargerSpecsData) ──
// The charging-list helpers.ts has not been ported as a standalone native module
// yet, so the consumed types are inlined verbatim to keep this file self-contained.
interface SpecEntry {
  name: string;
  count: number;
  energy: number;
  power?: number;
  avgPower?: number;
}

export interface ChargerSpecsData {
  voltage: SpecEntry[];
  phase: SpecEntry[];
  cable: SpecEntry[];
  brand: SpecEntry[];
}

// ─── Decorative glyph (lucide icon → native-safe text glyph) ──
// The adjacent label/heading text carries the meaning, so each glyph is hidden
// from the accessibility tree.
function Glyph({glyph, style}: {glyph: string; style?: StyleProp<TextStyle>}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, style]}>
      {glyph}
    </AppText>
  );
}

// ─── EmptyState (web @/components/feedback EmptyState, message-only) ──
// Faithful message-only shim: the shared native EmptyState requires a title the
// source never supplies. Web no-action note: transient empty state — surfaces
// when source data is missing; no specific recovery action available.
function EmptyState({message}: {message: string}): React.ReactElement {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

interface ChargerSpecsPanelProps {
  specs: ChargerSpecsData | null;
}

export function ChargerSpecsPanel({specs}: ChargerSpecsPanelProps) {
  const {t} = useTranslation();

  const hasData =
    specs && (specs.voltage.length > 0 || specs.cable.length > 0 || specs.brand.length > 0);

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.heading}>
        <Glyph glyph="🎛️" style={styles.gaugeGlyph} />
        <AppText style={styles.headingText}>
          {t('charging.specs.title', 'Charger Specs Breakdown')}
        </AppText>
      </View>
      {hasData ? (
        <View style={styles.grid}>
          <SpecColumn
            glyph="⚡"
            label={t('charging.specs.byVoltage', 'By Voltage')}
            items={specs!.voltage}
            emptyMsg={t('charging.specs.noVoltage', 'No voltage data')}
          />
          <SpecColumn
            glyph="〰️"
            label={t('charging.specs.byPhase', 'By Phase')}
            items={specs!.phase}
            emptyMsg={t('charging.specs.noPhase', 'No phase data')}
          />
          <SpecColumn
            glyph="🔗"
            label={t('charging.specs.byCable', 'By Cable')}
            items={specs!.cable}
            emptyMsg={t('charging.specs.noCable', 'No cable data')}
          />
          <SpecColumn
            glyph="🔌"
            label={t('charging.specs.byBrand', 'By Brand')}
            items={specs!.brand}
            emptyMsg={t('charging.specs.noBrand', 'No brand data')}
            showAvgPower
          />
        </View>
      ) : (
        <EmptyState
          message={t('charging.specs.noData', 'No charger specification data available yet')}
        />
      )}
    </GlassPanel>
  );
}

interface SpecColumnProps {
  glyph: string;
  label: string;
  items: Array<{name: string; count: number; energy: number; avgPower?: number}>;
  emptyMsg: string;
  showAvgPower?: boolean;
}

function SpecColumn({glyph, label, items, emptyMsg, showAvgPower}: SpecColumnProps) {
  if (items.length === 0) {
    return (
      <View>
        <EmptyState message={emptyMsg} />
      </View>
    );
  }

  return (
    <View>
      <View style={styles.columnLabel}>
        <Glyph glyph={glyph} style={styles.columnGlyph} />
        <AppText style={styles.columnLabelText} tone="secondary">
          {label}
        </AppText>
      </View>
      <View style={styles.columnItems}>
        {items.map((v) => (
          <View key={v.name} style={styles.itemRow}>
            <AppText style={styles.itemName}>{v.name}</AppText>
            <AppText style={styles.itemMeta} tone="muted">
              {v.count} sessions ·{' '}
              {showAvgPower && v.avgPower != null
                ? `${fmtInt(v.avgPower)} kW avg`
                : fmtWithUnit(v.energy, 'kWh')}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

ChargerSpecsPanel.displayName = 'ChargerSpecsPanel';

export default ChargerSpecsPanel;

const styles = StyleSheet.create({
  panel: {
    padding: 20, // p-5
  },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
    marginBottom: 16, // mb-4
  },
  headingText: {
    fontSize: 18, // section-title text-lg
    fontWeight: '600', // font-semibold
    letterSpacing: -0.45, // tracking-tight (-0.025em * 18)
    lineHeight: 28, // text-lg line-height
  },
  glyph: {
    fontSize: 12, // h-3 w-3 column icons
    lineHeight: 16,
  },
  gaugeGlyph: {
    color: colors.violet, // text-neon-purple
    fontSize: 14, // h-4 w-4 heading icon
  },
  grid: {
    gap: 24, // gap-6 (grid-cols-1 mobile base — vertical stack)
  },
  columnLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4, // gap-1
    marginBottom: 8, // mb-2
  },
  columnGlyph: {
    color: colors.textSecondary, // inherits --text-secondary from the web <p>
  },
  columnLabelText: {
    fontSize: 12, // text-xs
    fontWeight: '600', // font-semibold
  },
  columnItems: {
    gap: 8, // space-y-2
  },
  itemRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  itemName: {
    flexShrink: 1, // keep long names on the row instead of overflowing
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
  },
  itemMeta: {
    fontSize: 12, // text-xs
    textAlign: 'right',
  },
  emptyState: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
  },
  emptyMessage: {
    textAlign: 'center',
  },
});

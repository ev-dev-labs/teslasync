// Native parity port of
// web/src/features/charging/components/charging-curve/SessionDetailPanel.tsx.
//
// `SessionDetailPanel` is the charging-curve "Session Details" card: a GlassPanel
// with an uppercase heading followed by a stack of label/value rows describing one
// `ChargingSession` — Date, Charger Type, SOC Range, Energy Added (kWh), Peak Power
// (kW), an optional Avg Power (kW) row, Duration (min) and the optional Cost and
// Location rows. The row set, the conditional rendering of Avg Power / Cost /
// Location, every i18n key + English fallback, the unit strings ("kWh"/"kW"/"min"),
// the SI→display divisions (Wh→kWh and W→kW both `/1000`) and the SOC-range string
// (`start% → end%`, end falling back to "?") are preserved verbatim.
//
// Web modules -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` (L1) -> the standard local key-preserving
//     fallback shim returning the inline English copy (no react-i18next in the
//     native deps; same approach as the sibling WeekOverWeekSummary / EventTimeline
//     ports).
//   - `ChargingSession` from `@/api/types` (L2) -> imported from the ported native
//     `../../../../../api/types`. That native parity type does not yet carry the
//     web type's optional `start_place` label, so the prop widens it with that
//     single optional field (documented in the sidecar) to keep the Location row
//     without depending on a separate types.ts parity change.
//   - `formatDateTime` from `@/lib/dateFormat` (L3) -> inlined native-safe copy of
//     the web helper (nullish/invalid -> "—", else locale `toLocaleString` with
//     year/short-month/day/2-digit-hour/2-digit-minute); there is no ported native
//     dateFormat module.
//   - `fmtWithUnit` from `@/lib/numberFormat` (L4) -> inlined native-safe
//     equivalent (+ its `safeNumber`/`fmtNumber` deps) matching the web contract:
//     nullish/non-finite -> 0, default precision 2, en-US locale, "<n> <unit>".
//   - `GlassPanel` from `@/components/ui` (L5) -> the native shared
//     `components/ui/GlassPanel` primitive (View-based glass card).
//   - `useFormatting` `formatCurrency` from `@/hooks/useFormatting` (L6) -> inlined
//     as a local `useFormatting()` shim returning a native-safe `formatCurrency`.
//     The web hook reads the currency symbol + precision from `useSettings`; there
//     is no ported native settings provider here, so the port uses the web default
//     symbol "$" and the hook's default precision (2). Documented in the sidecar.
//   - `getChargerLabel` + `durationMinutes` from `./helpers` (L7-8) -> inlined
//     verbatim; the sibling charging-curve `helpers.ts` has not been ported as a
//     standalone native module yet, so this component stays self-contained (same
//     precedent as the WeekOverWeekSummary inline of its `./helpers`/`./types`).
//
// DOM -> native element mapping: the `<GlassPanel className="space-y-1 p-5">`
// wrapper keeps gap 4 (space-y-1) + padding 20 (p-5); the `<h3>` heading and the
// row `<span>`s become `AppText`; each row `<div>` becomes a `View`. Tailwind
// classes become StyleSheet/token styles (py-2 -> 8, mb-3 -> 12, text-sm -> 14,
// font-medium -> '500', font-semibold -> '600', tracking-wider -> letterSpacing
// 0.7 = 0.05em·14, uppercase -> textTransform). `--text-secondary` -> the AppText
// `secondary` tone; `text-white` -> the AppText `primary` tone;
// `--border-subtle` -> colors.border (the closest shared subtle-border token). No
// DOM-only modules, HTML elements, Recharts, Leaflet, or old web UI are imported.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import type {ChargingSession} from '../../../../../api/types';
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

// ─── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber / fmtWithUnit) ──
// Locale-aware formatting matching the web helpers: nullish/non-finite input
// coerces to 0, default precision is 2, and a bad locale falls back to en-US.
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

// ─── Inlined `@/lib/dateFormat` (formatDateTime) ──────────────
// Full date + time: "Apr 4, 2026, 2:30 AM". Nullish/invalid -> "—" placeholder.
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Inlined `@/hooks/useFormatting` (formatCurrency) ─────────
// The web hook resolves the currency symbol + default precision from useSettings;
// with no ported native settings provider, this uses the web default symbol "$"
// and the hook's default precision (2).
const CURRENCY_SYMBOL = '$';

function useFormatting(): {formatCurrency: (amount: number, decimals?: number) => string} {
  return {
    formatCurrency: (amount: number, decimals = 2): string =>
      `${CURRENCY_SYMBOL}${fmtNumber(amount, decimals)}`,
  };
}

// ─── Inlined `./helpers` (getChargerLabel / durationMinutes) ──
function getChargerLabel(s: ChargingSession): string {
  if (s.charger_type === 'Tesla' || (s.charger_type ?? '').toLowerCase().includes('tesla')) {
    return 'Supercharger';
  }
  if (s.charger_type) {
    return 'DC Fast';
  }
  if (s.peak_power_w && s.peak_power_w > 20_000) {
    return 'DC Fast';
  }
  return 'Home / AC';
}

function durationMinutes(startedAt: string, endedAt: string | null): number {
  if (!endedAt) {
    return 0;
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return Math.round((end - start) / 60000);
}

function SessionDetailRow({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.row}>
      <AppText style={styles.label} tone="secondary">
        {label}
      </AppText>
      <AppText style={styles.value}>{value}</AppText>
    </View>
  );
}

// The native parity ChargingSession (api/types) does not yet carry the web type's
// optional `start_place` label, so widen it with that single optional field to
// preserve the source's Location row without a separate types.ts parity change.
type SessionDetail = ChargingSession & {start_place?: string | null};

interface SessionDetailPanelProps {
  session: SessionDetail;
}

export default function SessionDetailPanel({session}: SessionDetailPanelProps) {
  const {t} = useTranslation();
  const {formatCurrency} = useFormatting();

  return (
    <GlassPanel style={styles.panel}>
      <AppText style={styles.heading} tone="secondary">
        {t('charging.curve.sessionDetails', 'Session Details')}
      </AppText>
      <SessionDetailRow
        label={t('charging.curve.date', 'Date')}
        value={formatDateTime(session.started_at)}
      />
      <SessionDetailRow
        label={t('charging.curve.chargerType', 'Charger Type')}
        value={getChargerLabel(session)}
      />
      <SessionDetailRow
        label={t('charging.curve.socRange', 'SOC Range')}
        value={`${session.start_soc_pct}% → ${session.end_soc_pct ?? '?'}%`}
      />
      <SessionDetailRow
        label={t('charging.curve.energyAdded', 'Energy Added')}
        value={fmtWithUnit((session.total_energy_added_wh ?? 0) / 1000, 'kWh')}
      />
      <SessionDetailRow
        label={t('charging.curve.peakPower', 'Peak Power')}
        value={fmtWithUnit((session.peak_power_w ?? 0) / 1000, 'kW')}
      />
      {session.avg_power_w != null && (
        <SessionDetailRow
          label={t('charging.curve.avgPower', 'Avg Power')}
          value={fmtWithUnit(session.avg_power_w / 1000, 'kW')}
        />
      )}
      <SessionDetailRow
        label={t('charging.curve.duration', 'Duration')}
        value={fmtWithUnit(durationMinutes(session.started_at, session.ended_at), 'min')}
      />
      {session.cost_decimal != null && (
        <SessionDetailRow
          label={t('charging.curve.cost_decimal', 'Cost')}
          value={formatCurrency(session.cost_decimal)}
        />
      )}
      {session.start_place && (
        <SessionDetailRow
          label={t('charging.curve.location', 'Location')}
          value={session.start_place}
        />
      )}
    </GlassPanel>
  );
}

SessionDetailPanel.displayName = 'SessionDetailPanel';

const styles = StyleSheet.create({
  panel: {
    gap: 4, // space-y-1
    padding: 20, // p-5
  },
  heading: {
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    letterSpacing: 0.7, // tracking-wider (0.05em * 14)
    marginBottom: 12, // mb-3
    textTransform: 'uppercase',
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border, // --border-subtle
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8, // py-2
  },
  label: {
    fontSize: 14, // text-sm
  },
  value: {
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
  },
});

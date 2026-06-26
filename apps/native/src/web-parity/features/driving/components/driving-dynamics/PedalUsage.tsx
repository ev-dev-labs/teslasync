// Native parity port of
// web/src/features/driving/components/driving-dynamics/PedalUsage.tsx.
//
// `PedalUsage` is the "Pedal Usage" panel of the Driving Dynamics page. It reads
// the latest projected drive-dynamics snapshot for a vehicle and renders the
// original throttle / brake / brake-active 3-up gauge layout:
//   - A "Throttle" RadialGauge (value `pedal_position`, max 100, cyan #06b6d4)
//     with a "Throttle Position" caption.
//   - A "Brake" RadialGauge (value `brake_pedal_position`, max 100, red #ef4444)
//     with a "Brake Pedal Position" caption.
//   - A decorative footprints glyph + a Badge whose variant flips danger/success
//     on `brake_pedal_active`, with a "Brake Pedal Status" caption.
// When none of the three signals is present, an EmptyState is shown instead
// (the documented no-action transient empty state).
//
// Every prop/state name (`vehicleId`), API field (pedal_position,
// brake_pedal_position, brake_pedal_active), the `useDriveDynamicsLatest`
// hook + `INTERVALS.REALTIME` refetch cadence, every i18n key + English
// fallback, every gauge colour (#06b6d4 / #ef4444), the `max={100}` bound, the
// `unit` "%"/"—" toggle, the Badge danger/success variant logic, and the
// FadeIn delay (0.1) are preserved verbatim. No unit conversion happens here —
// `pedal_position` / `brake_pedal_position` are already percentages from the
// hook, passed through with a literal "%".
//
// Web module -> native-safe mappings (contract rules 4-7):
//   - react-i18next `useTranslation` (L1) -> a local key-preserving fallback
//     shim returning the inline English copy (or the key when no default,
//     mirroring i18next); no react-i18next in the native deps. Every call site
//     here is `t(key, 'English')` (no interpolation), so the 2-arg shim suffices.
//   - lucide-react `Footprints` (L2) -> a decorative emoji glyph ('\u{1F463}')
//     via `Glyph` (accessibility-hidden); the adjacent Badge + caption always
//     carry the meaning. Same precedent as the DrivingCoachSection lucide
//     substitution. The web `h-8 w-8 text-[var(--text-muted)]` becomes a 32px
//     muted-tone glyph.
//   - `@/components/layout` `Grid` (L4) -> a local `GridRow`. The native shell
//     has no Grid; `cols={{ default: 1, sm: 3 }} gap={6}` resolves mobile-first
//     to a flex-wrap row (gap 24) with min-width grow items, so the gauges sit
//     1-up on a phone and 3-up once wide enough.
//   - `@/components/ui` GlassPanel (L5) -> the shared native `components/ui/
//     GlassPanel` (glass surface + border + radius). The web `p-6` has no
//     className channel on native, so padding moves to GlassPanel's forwarded
//     `style`.
//   - `@/components/ui` Badge (L5) -> the web-parity `components/ui/Badge` port.
//     `variant` (danger/success) and `size` (lg) are preserved field-for-field.
//   - `@/components/charts` RadialGauge (L6) -> the web-parity `components/charts`
//     RadialGauge port (value/max/label/unit/color/size preserved; the gauge arc
//     is approximated with positioned native Views since RN has no SVG stroke).
//   - `@/components/feedback` EmptyState (L7) -> a local EmptyState mirroring the
//     WEB feedback API (message required; title/icon optional). The native
//     `components/feedback/EmptyState` REQUIRES a title which the message-only
//     call site here does not, so a faithful local mirror is used (same
//     precedent as DrivingCoachSection). The web action/actionTo CTAs are unused.
//   - `@/components/motion` FadeIn (L8) -> the ported web-parity components/motion
//     FadeIn; the 0.1s delay is preserved (the native FadeIn delay is also in
//     seconds).
//   - `@/api/hooks/useVehicles` useDriveDynamicsLatest (L9) -> the native
//     web-parity hook (same `/drive-dynamics/latest?vehicle_id=` path +
//     `DriveDynamicsSnapshot` shape).
//   - `@/lib/constants` INTERVALS (L10) -> there is no native `lib/constants`;
//     INTERVALS is defined locally in each native hook file, so the single value
//     used here (REALTIME = 5000ms) is inlined as a local const, matching the
//     hooks' own definition.
//
// DOM -> native element mapping: every web `<div>`/`<h2>`/`<span>` becomes a
// `View`/`AppText`. Tailwind maps to StyleSheet/token styles (1 unit = 4px:
// p-6 -> 24, mb-4 -> 16, gap-6 -> 24, gap-3 -> 12, gap-2 -> 8, text-lg -> 18,
// text-xs -> 12, h-8/w-8 -> 32). `var(--text-primary)`/`var(--text-secondary)`/
// `var(--text-muted)` map to the AppText primary/secondary/muted tones. No
// DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { RadialGauge } from '../../../../components/charts';
import { Badge } from '../../../../components/ui/Badge';
import { FadeIn } from '../../../../components/motion';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { AppText } from '../../../../../components/ui/AppText';
import { useDriveDynamicsLatest } from '../../../../api/hooks/useVehicles';

// ─── i18n fallback ────────────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy (or the key itself when no default is supplied, mirroring i18next). Every
// call site here is `t(key, 'English')`, so no interpolation is needed.
type TFunc = (key: string, defaultValue?: string) => string;

function useTranslation(): { t: TFunc } {
  return { t: (key, defaultValue) => defaultValue ?? key };
}

// ─── INTERVALS (web @/lib/constants) ──────────────────────────
// The native app has no `lib/constants`; INTERVALS is defined locally in each
// hook file. Only REALTIME (5s refetch) is used here, inlined to match.
const INTERVALS = { REALTIME: 5_000 } as const;

// ─── Decorative glyph (lucide Footprints substitute) ──────────
// The lucide icon is decorative; the adjacent Badge + caption carry the
// meaning, so the glyph is hidden from assistive tech.
function Glyph({ children }: { children: string }) {
  return (
    <AppText
      accessibilityElementsHidden
      allowFontScaling={false}
      importantForAccessibility="no"
      style={styles.footprints}
      tone="muted">
      {children}
    </AppText>
  );
}

// ─── EmptyState (web @/components/feedback EmptyState) ─────────
// Mirrors the web public API surface used here (message required). The web
// action/actionTo CTAs are unused (this is the documented no-action transient
// empty state surfaced when source data is missing).
function EmptyState({ message }: { message: string }) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      <AppText style={styles.emptyStateMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ─── GridRow (web @/components/layout Grid) ───────────────────
// cols={{ default: 1, sm: 3 }} gap={6}: a flex-wrap row (gap 24) whose items grow
// with a min width, so the gauges sit 1-up on a phone and 3-up once wide enough.
function GridRow({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

interface PedalUsageProps {
  vehicleId: number | null | undefined;
}

/**
 * Pedal telemetry (PedalPosition, BrakePedalPos, BrakePedal).
 *
 * These signals used to come from the removed `signal_observations` route;
 * stale callers 404'd silently and left this panel in a permanent
 * "No pedal telemetry received yet" empty state.
 *
 * Today all 3 signals flow through per-field MQTT to the L1 live cache
 * (mirrored to L2 / Redis with a `signal_log` fallback). We read the
 * latest projected snapshot via `useDriveDynamicsLatest` and render
 * the original throttle / brake / brake-active 3-up gauge layout.
 */
export default function PedalUsage({ vehicleId }: PedalUsageProps) {
  const { t } = useTranslation();

  const { data } = useDriveDynamicsLatest(vehicleId ?? 0, INTERVALS.REALTIME);

  const throttle =
    typeof data?.pedal_position === 'number' ? data.pedal_position : null;
  const brakePos =
    typeof data?.brake_pedal_position === 'number'
      ? data.brake_pedal_position
      : null;
  const brakeActive =
    typeof data?.brake_pedal_active === 'boolean'
      ? data.brake_pedal_active
      : null;

  const hasAny = throttle != null || brakePos != null || brakeActive != null;

  return (
    <FadeIn delay={0.1}>
      <GlassPanel style={styles.panel}>
        <AppText style={styles.heading} weight="semibold">
          {t('dynamics.pedalUsage', 'Pedal Usage')}
        </AppText>
        {hasAny ? (
          <GridRow>
            <View style={styles.gaugeCell}>
              <RadialGauge
                value={throttle ?? 0}
                max={100}
                label={t('dynamics.throttle', 'Throttle')}
                unit={throttle != null ? '%' : '—'}
                color="#06b6d4"
                size={140}
              />
              <AppText style={styles.caption} tone="secondary">
                {t('dynamics.throttlePosition', 'Throttle Position')}
              </AppText>
            </View>
            <View style={styles.gaugeCell}>
              <RadialGauge
                value={brakePos ?? 0}
                max={100}
                label={t('dynamics.brake', 'Brake')}
                unit={brakePos != null ? '%' : '—'}
                color="#ef4444"
                size={140}
              />
              <AppText style={styles.caption} tone="secondary">
                {t('dynamics.brakePedalPosition', 'Brake Pedal Position')}
              </AppText>
            </View>
            <View style={styles.statusCell}>
              <Glyph>{'\u{1F463}'}</Glyph>
              <Badge variant={brakeActive ? 'danger' : 'success'} size="lg">
                {brakeActive
                  ? t('dynamics.brakeActive', 'Brake Active')
                  : t('dynamics.brakeInactive', 'Brake Inactive')}
              </Badge>
              <AppText style={styles.caption} tone="secondary">
                {t('dynamics.brakePedal', 'Brake Pedal Status')}
              </AppText>
            </View>
          </GridRow>
        ) : (
          <EmptyState
            message={t('dynamics.pedalNoData', 'No pedal telemetry received yet')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  caption: {
    fontSize: 12, // text-xs
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 32, // py-16 condensed for a panel-embedded empty state
  },
  emptyStateMessage: {
    fontSize: 14, // text-bodySm
    maxWidth: 360, // max-w-md
    textAlign: 'center',
  },
  footprints: {
    fontSize: 32, // h-8 w-8
    lineHeight: 36,
  },
  gaugeCell: {
    alignItems: 'center',
    flexBasis: '30%',
    flexGrow: 1,
    gap: 8, // gap-2
    minWidth: 150, // default: 1 (phone) -> sm: 3 (wide)
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24, // gap-6
  },
  heading: {
    fontSize: 18, // text-lg
    lineHeight: 28,
    marginBottom: 16, // mb-4
  },
  panel: {
    padding: 24, // p-6
  },
  statusCell: {
    alignItems: 'center',
    flexBasis: '30%',
    flexGrow: 1,
    gap: 12, // gap-3
    justifyContent: 'center',
    minWidth: 150, // default: 1 (phone) -> sm: 3 (wide)
  },
});

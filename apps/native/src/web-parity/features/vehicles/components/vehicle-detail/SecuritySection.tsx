// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/SecuritySection.tsx.
//
// The web component is the vehicle-detail "Security" section: a GlassPanel (p-6)
// with a title row (Shield icon, --neon-cyan + a "Security" bold heading) and,
// when `securityData` is present, a responsive grid (2 cols base -> 3 at sm -> 4
// at lg) of four MetricCards —
//   1. Locked  — state.is_locked ? "Yes" : "No"           (Lock/Unlock, green/cyan)
//   2. Sentry  — state.sentry_mode ? "Active" : "Off"     (Eye, green/cyan)
//   3. Doors   — doorState ?? "Closed"                    (DoorClosed, cyan/green)
//   4. Windows — windowsOpen>0 ? "{{count}} open":"Closed"(Car, cyan/green)
// When `securityData` itself is null/undefined the section shows an EmptyState
// ("No security data available").
//
// The card values derive from two helpers preserved 1:1 from the web source:
//   - windowOpenCount(s): counts the *_window fields reading > 0 (percent open),
//     coercing the snake_case string/boolean JSON projection defensively.
//   - doorState: state.door_state when it is non-null and not the empty string,
//     else null (rendered as the "Closed" fallback).
//
// This native port preserves that contract 1:1 — the same `securityData` + `state`
// props, the same windowOpenCount / doorState logic, every i18n key + English
// default (including the `{{count}}` interpolation), and the same four MetricCard
// slots / colours / icons — using React Native primitives, the already-ported
// native web-parity MetricCard and the native GlassPanel + AppText + theme tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation (web L1): no native i18next runtime -> inline
//     useNativeTranslation() returns t(key, fallback, options?) = the English
//     default with any {{token}} substituted from `options`, preserving every key,
//     default string and the windows count interpolation verbatim.
//   - lucide-react Shield / Lock / Unlock / Eye / Car / DoorClosed (web L2): DOM
//     SVG icons -> semantic emoji glyph stand-ins (the sibling ChargingTelemetry-
//     Section / FleetSummary precedent); passed to MetricCard's string `icon` slot
//     (rendered in the tinted neon chip) and to the title glyph.
//   - @/components/ui GlassPanel (web L4): -> native GlassPanel.
//   - @/components/data-display MetricCard (web L5): -> the already-ported native
//     web-parity MetricCard (identical label / value / icon / color slots; value
//     accepts string|number so every translated string passes through; color
//     accepts the 'green'|'cyan' NeonColors used here).
//   - @/components/feedback EmptyState (web L6): -> a local native-safe icon +
//     message EmptyState mirroring the web layout (centred column, optional muted
//     icon above a centred message); this call site passes only `message`.
//   - @/api/types SecurityEvent / VehicleState (web L7): imported from the already-
//     ported native web-parity api/types so the prop contract is identical.
//   - the Tailwind responsive grid (grid-cols-2 sm:grid-cols-3 lg:grid-cols-4,
//     web L47) collapses to the native phone base (2 columns) via a flex-wrap row
//     of 48%-basis cells with a gap-3 (12px) gutter — the ChargingTelemetrySection
//     grid precedent.
//
// No DOM module, browser HTML element, Recharts, Leaflet, lucide DOM SVG,
// framer-motion, or old web @/components import appears in the native output.

import React, {useMemo, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import type {SecurityEvent, VehicleState} from '../../../../api/types';
import {MetricCard} from '../../../../components/data-display/MetricCard';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ── i18n: react-i18next useTranslation -> native-safe fallback shim ───────── */

type TranslateOptions = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, options?: TranslateOptions) => string;

// Mirrors the i18next default-value + {{token}} interpolation used by the web call
// sites (e.g. t('vehicles.detail.windowsOpen', '{{count}} open', { count })). No
// native i18next runtime is wired, so the English default is returned with its
// {{name}} tokens substituted from the options bag — preserving every key, default
// string and the count interpolation intent verbatim.
function interpolate(template: string, options?: TranslateOptions): string {
  if (!options) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = options[name];
    return value == null ? match : String(value);
  });
}

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (_key, fallback, options) => interpolate(fallback, options),
    [],
  );
}

/* ── lucide-react glyph stand-ins (web L2) ─────────────────────────────────── */

const ICON_SHIELD = '\uD83D\uDEE1'; // 🛡 (Shield)
const ICON_LOCK = '\uD83D\uDD12'; // 🔒 (Lock)
const ICON_UNLOCK = '\uD83D\uDD13'; // 🔓 (Unlock)
const ICON_EYE = '\uD83D\uDC41'; // 👁 (Eye)
const ICON_CAR = '\uD83D\uDE97'; // 🚗 (Car)
const ICON_DOOR = '\uD83D\uDEAA'; // 🚪 (DoorClosed)

const NEON_CYAN = '#00f0ff'; // --neon-cyan (tailwind neon cyan base)

/* ── EmptyState (native-safe port of @/components/feedback EmptyState) ─────── */

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessibilityRole="text" accessible style={styles.emptyState} testID="security-empty">
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── windowOpenCount (web L14-27) ──────────────────────────────────────────── */
// counts the number of windows reading > 0 (percent open). Backend `*_window`
// fields land as strings (snake_case JSON projection of the codec FdWindow/
// FpWindow/RdWindow/RpWindow signals) per internal/api/security_handler.go
// securityMappings; coerce defensively. The fields array is widened to include
// number so the web's `typeof v === 'number'` fast-path stays meaningful.
function windowOpenCount(s: SecurityEvent): number {
  const fields: Array<string | number | boolean | null | undefined> = [
    s.fd_window,
    s.fp_window,
    s.rd_window,
    s.rp_window,
  ];
  let open = 0;
  for (const v of fields) {
    if (v == null) {
      continue;
    }
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n) && n > 0) {
      open += 1;
    }
  }
  return open;
}

/* ── ported: SecuritySection (web L29-82) ──────────────────────────────────── */

interface SecuritySectionProps {
  securityData: SecurityEvent | null | undefined;
  state: VehicleState;
}

export function SecuritySection({securityData, state}: SecuritySectionProps) {
  const t = useNativeTranslation();

  const windowsOpen = securityData ? windowOpenCount(securityData) : 0;
  const doorState =
    securityData?.door_state != null && securityData.door_state !== ''
      ? String(securityData.door_state)
      : null;

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={styles.titleIcon}>{ICON_SHIELD}</AppText>
        <AppText style={styles.title} weight="bold">
          {t('vehicles.detail.security', 'Security')}
        </AppText>
      </View>

      {securityData ? (
        <View style={styles.grid}>
          <View style={styles.gridCell}>
            <MetricCard
              color={state.is_locked ? 'green' : 'cyan'}
              icon={state.is_locked ? ICON_LOCK : ICON_UNLOCK}
              label={t('common.locked', 'Locked')}
              value={state.is_locked ? t('common.yes', 'Yes') : t('common.no', 'No')}
            />
          </View>
          <View style={styles.gridCell}>
            <MetricCard
              color={state.sentry_mode ? 'green' : 'cyan'}
              icon={ICON_EYE}
              label={t('common.sentry', 'Sentry')}
              value={state.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off')}
            />
          </View>
          <View style={styles.gridCell}>
            <MetricCard
              color={doorState ? 'cyan' : 'green'}
              icon={ICON_DOOR}
              label={t('vehicles.detail.doors', 'Doors')}
              value={doorState ?? t('common.closed', 'Closed')}
            />
          </View>
          <View style={styles.gridCell}>
            <MetricCard
              color={windowsOpen > 0 ? 'cyan' : 'green'}
              icon={ICON_CAR}
              label={t('vehicles.detail.windows', 'Windows')}
              value={
                windowsOpen > 0
                  ? t('vehicles.detail.windowsOpen', '{{count}} open', {count: windowsOpen})
                  : t('common.closed', 'Closed')
              }
            />
          </View>
        </View>
      ) : (
        <EmptyState
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available (web L78).
          message={t('vehicles.detail.noSecurityData', 'No security data available')}
        />
      )}
    </GlassPanel>
  );
}

SecuritySection.displayName = 'SecuritySection';

const styles = StyleSheet.create({
  emptyIcon: {
    marginBottom: 16, // mb-4
  },
  emptyMessage: {
    maxWidth: 448, // max-w-md
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64, // py-16
  },
  grid: {
    columnGap: spacing.md, // gap-3 (12px)
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  gridCell: {
    flexBasis: '48%', // grid-cols-2 base (ChargingTelemetrySection precedent)
    flexGrow: 1,
  },
  panel: {
    padding: spacing.lg + 4, // p-6 (24px)
  },
  title: {
    color: colors.textPrimary, // --text-primary
    fontSize: 18, // text-lg
  },
  titleIcon: {
    color: NEON_CYAN, // text-[var(--neon-cyan)]
    fontSize: 16, // h-4 w-4
  },
  titleRow: {
    alignItems: 'center',
    columnGap: spacing.sm, // gap-2
    flexDirection: 'row',
    marginBottom: 16, // mb-4
  },
});

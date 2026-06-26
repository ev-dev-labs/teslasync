// Native parity port of web/src/features/system/components/FSMHealthPanel.tsx.
//
// A compact FSM-health summary panel for the system / FSM-debugger surface. It
// derives up to three health alerts from the raw FSMTransition log entirely on
// the client — the heavy lifting is pure, DOM-free reducer logic that is ported
// verbatim so the native panel surfaces exactly the same alerts the web panel
// does:
//   - Flap detection (web L27-63): >5 same-FSM transitions inside any rolling
//     1-minute window flags every transition in that window; emits ONE 'flap'
//     warning carrying the total flagged count.
//   - Stuck detection (web L65-93): the latest state per session instance
//     ('drive_session' / 'charge_session') that is still 'pending'/'active'
//     after >4 hours counts as stuck; emits a 'stuck' warning.
//   - Recovery count (web L95-104): transitions whose to_state is 'recovered'
//     emit a 'recovery' info alert.
// The redundant `tr.vehicle_id ?? tr.vehicle_id` key fragment (web L74) is a
// no-op in the source (vehicle_id is a required number) and is preserved
// verbatim so the grouping key is byte-identical. The exported computeFlapIds()
// helper (web L152-183) — used by the parent page to highlight flapped rows —
// is ported verbatim too.
//
// Web -> native presentation mapping (contract rules 4, 5 & 7); every
// browser-only dependency is replaced with a React Native-safe equivalent and
// documented in the sidecar:
//   - react-i18next `useTranslation` (web L2) -> the inlined GeofencesPage
//     i18n shim: a stable useNativeTranslation() that returns the web English
//     fallback verbatim and supports the same `{{count}}` interpolation the web
//     calls rely on (t('fsm.health.flapping','…{{count}}…',{count})). All eight
//     fsm.health.* keys + defaults are preserved.
//   - lucide-react AlertTriangle / RotateCw / Timer (web L3) -> tintable
//     monochrome AppText glyphs (the Toast.tsx / TOTPEnrollmentSection
//     lucide->glyph precedent), so each icon is tinted to its severity colour
//     exactly as the web `${textColor}` does — AlertTriangle -> '▲' (U+25B2,
//     Toast's mapping), Timer -> '◷' (U+25F7, a tintable clock-face from the
//     Geometric Shapes block), RotateCw -> '↻' (U+21BB, TOTPEnrollmentSection's
//     RefreshCw mapping). All are decorative (the adjacent title names them).
//   - `@/components/ui` GlassPanel (web L4) -> the existing native GlassPanel,
//     with the web `p-4` padding applied via styles.panel.
//   - `@/components/layout` Grid cols={{default:1,md:alerts.length}} gap={3}
//     (web L5) -> a vertical View stack (styles.grid, gap spacing.md=12): native
//     targets the mobile `default: 1` column, so the alert cards stack (the
//     MotorEfficiencyInsights "render the mobile default" approach).
//   - `@/lib/numberFormat` fmtInt (web L6) -> useFormatPrefs().fmt(count, 0):
//     fmt(v, 0) mirrors fmtInt(v) = fmtNumber(v, 0) (settings-driven, locale-
//     aware, 0 decimals) (the MotorEfficiencyInsights precedent).
//   - `@/types/fsm` FSMTransition (web L7) -> the structurally identical native
//     FSMTransition exported by web-parity/api/hooks/useFSM (import type only —
//     erased at compile time, so no react-query runtime dependency is pulled in).
//
// Tailwind shades absent from the native theme (green-400 / amber-500 / blue-500
// / blue-400) map to hex/rgba literals (the parity-tree convention). No DOM
// elements (div/span/h2), no lucide-react, no Recharts/Leaflet, and no web UI
// modules are imported — only React, react-native primitives, the existing
// native AppText / GlassPanel / theme tokens, the ported useFormatPrefs, and the
// FSMTransition type.

import React, {useMemo} from 'react';
import {
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import type {FSMTransition} from '../../../api/hooks/useFSM';
import {useFormatPrefs} from '../../../components/data-display/format/_formatPrimitives';

interface FSMHealthPanelProps {
  transitions: FSMTransition[];
}

interface HealthAlert {
  type: 'flap' | 'stuck' | 'recovery';
  severity: 'warning' | 'info';
  message: string;
  count: number;
}

// ─── i18n shim (web react-i18next useTranslation) ──────────────────────────
// Mirrors the GeofencesPage parity shim: returns the web English fallback
// verbatim and supports `{{count}}` interpolation so every t('key','copy',{…})
// call shape used by this panel is honoured.

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallbackOrOptions?: string | NativeTOptions,
  options?: NativeTOptions,
) => string;

function interpolate(template: string, values: NativeTOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = values[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslation(): NativeTFunction {
  return React.useCallback((key, fallbackOrOptions, options) => {
    const fallback =
      typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key;
    const opts = typeof fallbackOrOptions === 'string' ? options : fallbackOrOptions;
    return opts ? interpolate(fallback, opts) : fallback;
  }, []);
}

// ─── Tailwind shades absent from the native theme -> literals ───────────────
const GREEN_400 = '#4ade80'; // text-green-400 / bg-green-400 (all-clear)
const AMBER_400 = '#fbbf24'; // text-amber-400 (warning text/icon/count)
const AMBER_500_BORDER = 'rgba(245, 158, 11, 0.2)'; // border-amber-500/20
const AMBER_500_BG = 'rgba(245, 158, 11, 0.05)'; // bg-amber-500/5
const BLUE_400 = '#60a5fa'; // text-blue-400 (info text/icon/count)
const BLUE_500_BORDER = 'rgba(59, 130, 246, 0.2)'; // border-blue-500/20
const BLUE_500_BG = 'rgba(59, 130, 246, 0.05)'; // bg-blue-500/5

// lucide-react -> tintable monochrome glyphs (Toast / TOTPEnrollmentSection
// lucide->glyph precedent); tinted to the severity colour like the web icons.
const FLAP_GLYPH = '\u25B2'; // ▲ AlertTriangle (Toast's mapping)
const STUCK_GLYPH = '\u25F7'; // ◷ Timer (tintable clock face, Geometric Shapes)
const RECOVERY_GLYPH = '\u21BB'; // ↻ RotateCw (TOTPEnrollmentSection RefreshCw)

export function FSMHealthPanel({transitions}: FSMHealthPanelProps) {
  const t = useNativeTranslation();
  const {fmt} = useFormatPrefs();

  const {alerts} = useMemo(() => {
    const result: HealthAlert[] = [];
    const flapped = new Set<number>();

    // ── Flap detection: >5 transitions of same FSM within any 1-min window ──
    const byType = new Map<string, FSMTransition[]>();
    for (const tr of transitions) {
      const list = byType.get(tr.fsm_name) ?? [];
      list.push(tr);
      byType.set(tr.fsm_name, list);
    }

    for (const [, list] of byType) {
      const sorted = [...list].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
      );
      for (let i = 0; i < sorted.length; i++) {
        const windowEnd = new Date(sorted[i].ts).getTime() + 60_000;
        let count = 0;
        for (let j = i; j < sorted.length; j++) {
          if (new Date(sorted[j].ts).getTime() <= windowEnd) {
            count++;
          } else break;
        }
        if (count > 5) {
          for (let j = i; j < sorted.length; j++) {
            if (new Date(sorted[j].ts).getTime() <= windowEnd) {
              flapped.add(sorted[j].id);
            } else break;
          }
        }
      }
      if (flapped.size > 0 && !result.some(a => a.type === 'flap')) {
        result.push({
          type: 'flap',
          severity: 'warning',
          message: t(
            'fsm.health.flapping',
            '{{count}} transitions flagged as state flapping (>5 same-FSM transitions/min)',
            {count: flapped.size},
          ),
          count: flapped.size,
        });
      }
    }

    // ── Stuck detection: session FSMs in pending/active for >4 hours ──
    const now = Date.now();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const sessionTypes = ['drive_session', 'charge_session'];
    const stuckStates = ['pending', 'active'];
    // Group by instance to find latest state
    const instanceLatest = new Map<string, FSMTransition>();
    for (const tr of transitions) {
      if (!sessionTypes.includes(tr.fsm_name)) continue;
      const key = `${tr.fsm_name}:${tr.vehicle_id ?? tr.vehicle_id}`;
      const existing = instanceLatest.get(key);
      if (!existing || new Date(tr.ts).getTime() > new Date(existing.ts).getTime()) {
        instanceLatest.set(key, tr);
      }
    }
    let stuckCount = 0;
    for (const [, tr] of instanceLatest) {
      if (stuckStates.includes(tr.to_state) && now - new Date(tr.ts).getTime() > FOUR_HOURS) {
        stuckCount++;
      }
    }
    if (stuckCount > 0) {
      result.push({
        type: 'stuck',
        severity: 'warning',
        message: t(
          'fsm.health.stuck',
          '{{count}} session(s) stuck in pending/active for >4 hours',
          {count: stuckCount},
        ),
        count: stuckCount,
      });
    }

    // ── Recovery count: transitions to "recovered" state ──
    const recoveryCount = transitions.filter(tr => tr.to_state === 'recovered').length;
    if (recoveryCount > 0) {
      result.push({
        type: 'recovery',
        severity: 'info',
        message: t(
          'fsm.health.recoveries',
          '{{count}} session(s) recovered after pod restart',
          {count: recoveryCount},
        ),
        count: recoveryCount,
      });
    }

    return {alerts: result};
  }, [transitions, t]);

  if (alerts.length === 0) {
    return (
      <GlassPanel style={styles.panel}>
        <View style={styles.allClearRow}>
          <View style={styles.allClearDot} />
          <AppText style={styles.allClearText}>
            {t(
              'fsm.health.allClear',
              'All FSMs healthy — no flapping, stuck sessions, or recoveries detected',
            )}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={styles.panel}>
      <AppText style={styles.title}>{t('fsm.health.title', 'FSM Health')}</AppText>
      <View style={styles.grid}>
        {alerts.map(alert => {
          const glyph =
            alert.type === 'flap'
              ? FLAP_GLYPH
              : alert.type === 'stuck'
                ? STUCK_GLYPH
                : RECOVERY_GLYPH;
          const tintStyle = severityTextStyles[alert.severity];
          const cardSurface = cardSurfaceStyles[alert.severity];
          return (
            <View key={alert.type} style={[styles.card, cardSurface]}>
              <AppText
                importantForAccessibility="no"
                style={[styles.icon, tintStyle]}>
                {glyph}
              </AppText>
              <View style={styles.cardBody}>
                <AppText style={[styles.cardTitle, tintStyle]}>
                  {alert.type === 'flap'
                    ? t('fsm.health.flapTitle', 'State Flapping')
                    : alert.type === 'stuck'
                      ? t('fsm.health.stuckTitle', 'Stuck Sessions')
                      : t('fsm.health.recoveryTitle', 'Pod Recoveries')}
                </AppText>
                <AppText style={styles.cardMessage}>{alert.message}</AppText>
              </View>
              <AppText style={[styles.count, tintStyle]}>
                {fmt(alert.count, 0)}
              </AppText>
            </View>
          );
        })}
      </View>
    </GlassPanel>
  );
}

/** Re-export flapIds for use by parent */
export function computeFlapIds(transitions: FSMTransition[]): Set<number> {
  const flapped = new Set<number>();
  const byType = new Map<string, FSMTransition[]>();
  for (const tr of transitions) {
    const list = byType.get(tr.fsm_name) ?? [];
    list.push(tr);
    byType.set(tr.fsm_name, list);
  }
  for (const [, list] of byType) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = new Date(sorted[i].ts).getTime() + 60_000;
      let count = 0;
      for (let j = i; j < sorted.length; j++) {
        if (new Date(sorted[j].ts).getTime() <= windowEnd) {
          count++;
        } else break;
      }
      if (count > 5) {
        for (let j = i; j < sorted.length; j++) {
          if (new Date(sorted[j].ts).getTime() <= windowEnd) {
            flapped.add(sorted[j].id);
          } else break;
        }
      }
    }
  }
  return flapped;
}

const styles = StyleSheet.create({
  panel: {
    padding: 16, // p-4
  },
  allClearRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm, // gap-2
  },
  allClearDot: {
    backgroundColor: GREEN_400, // bg-green-400
    borderRadius: 999, // rounded-full
    height: 8, // h-2
    width: 8, // w-2
  },
  allClearText: {
    color: GREEN_400, // text-green-400
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  title: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    letterSpacing: 0.6, // tracking-wider
    lineHeight: 16,
    marginBottom: spacing.md, // mb-3
    textTransform: 'uppercase', // uppercase
  },
  grid: {
    flexDirection: 'column',
    gap: spacing.md, // gap-3
  },
  card: {
    alignItems: 'flex-start', // items-start
    borderRadius: 8, // rounded-lg
    borderWidth: 1, // border
    flexDirection: 'row',
    gap: spacing.md, // gap-3
    padding: spacing.md, // p-3
  },
  cardBody: {
    flex: 1, // lets the count sit at the right edge (web ml-auto)
  },
  icon: {
    fontSize: 14, // h-4 w-4 accent glyph
    lineHeight: 18,
    marginTop: 2, // mt-0.5
  },
  cardTitle: {
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  cardMessage: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 12, // text-xs
    lineHeight: 16,
    marginTop: 2, // mt-0.5
  },
  count: {
    fontSize: 18, // text-lg
    fontWeight: '700', // font-bold
    lineHeight: 24,
  },
});

const severityTextStyles = StyleSheet.create<Record<HealthAlert['severity'], TextStyle>>({
  warning: {color: AMBER_400}, // text-amber-400
  info: {color: BLUE_400}, // text-blue-400
});

const cardSurfaceStyles = StyleSheet.create<Record<HealthAlert['severity'], ViewStyle>>({
  warning: {
    backgroundColor: AMBER_500_BG, // bg-amber-500/5
    borderColor: AMBER_500_BORDER, // border-amber-500/20
  },
  info: {
    backgroundColor: BLUE_500_BG, // bg-blue-500/5
    borderColor: BLUE_500_BORDER, // border-blue-500/20
  },
});

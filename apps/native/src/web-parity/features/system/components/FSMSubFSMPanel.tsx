// Native parity port of web/src/features/system/components/FSMSubFSMPanel.tsx.
//
// Renders the "Active Sub-FSMs" panel that only appears while viewing a
// vehicle-level FSM (fsmType 'vehicle' | 'all'). Every behavioural decision in
// the web source is preserved 1:1:
//   - the `isVehicleView` gate (returns null for any other fsmType),
//   - `const subs = activeSubs ?? []`,
//   - the empty-state branch (subs.length === 0),
//   - per-sub `label`, `terminalStates`, and `isActive` derivations,
//   - `key={sub.type}`, and the drive/charge -> drive_session/charge_session
//     fsmType passed to the state badge.
//
// Browser-only dependencies are replaced per conversion rules 4/5/7 (recorded in
// the sidecar):
//   - @/components/ui `GlassPanel` (Tailwind `p-4` glass card) -> the native
//     `GlassPanel` primitive with an equivalent padding style.
//   - @/components/layout `Grid` cols={{ default: 1, md: 2 }} gap={3} -> a
//     flex-wrap row whose column count is resolved from `useWindowDimensions`
//     (>= 768px, the Tailwind `md` breakpoint, yields two columns); gap-3 ->
//     spacing.md (12).
//   - @/components/data-display `TimeStamp` -> the existing native-parity
//     `TimeStamp` port; the web `className="text-[10px] text-[var(--text-muted)]"`
//     becomes the equivalent native `style`.
//   - @/components/feedback `EmptyState` (react-router `Link`/DOM CTA) -> an
//     inline centered muted `AppText`; this panel only passes `message` (no
//     icon/title/action), so the native-safe empty state renders just that copy.
//   - `./StateBadge` (web StateBadge.tsx, itself a SEPARATE file in the
//     conversion queue) -> a local `StateBadge` modelled here so this port has no
//     dependency on the web `@/types/fsm` registry. `getStateColor`'s
//     lower-cased lookup + neutral-default semantics are reproduced for exactly
//     the two fsmTypes this panel uses (drive_session / charge_session), with the
//     Tailwind variant + per-state override hues ported to literal colors. This
//     mirrors the CommandConfirmDialog port, which modelled only the subset of a
//     queued-separately dependency that it actually reads.
//   - lucide-react `Car` / `Zap` SVG icons (react-native-svg is not a
//     dependency) -> decorative Unicode glyph stand-ins flagged aria-hidden, the
//     same precedent as the CommandConfirmDialog AlertTriangle glyph.
//   - react-i18next `useTranslation` -> a local useNativeTranslationFallback
//     returning the inline English fallback (and interpolating any {{token}}
//     options) so every t(key, fallback) call site + its i18n key survive (the
//     CommandConfirmDialog / ReauthDialog precedent). None of this panel's four
//     keys use interpolation.
//   - the web `animate-pulse` live dot has no CSS-animation analog on native; a
//     static green dot preserves the "live" semantic without an always-running
//     Animated loop (which would risk jest open-handle noise). The active state
//     is additionally conveyed by the green-tinted icon box and the state badge.
//
// `ActiveSubFSM` is imported from the native useFSM hook (the parity equivalent
// of the web `@/types/fsm` import), keeping the shape in one place.

import React, {useCallback} from 'react';
import {StyleSheet, useWindowDimensions, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import type {ActiveSubFSM} from '../../../api/hooks/useFSM';
import {TimeStamp} from '../../../components/data-display/TimeStamp';

type NativeTOptions = Record<string, string>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

// react-i18next has no native parity module; resolve to the inline English
// fallback and interpolate {{token}} options so the i18n key + copy intent
// survive (same pattern as the CommandConfirmDialog / ReauthDialog ports).
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.entries(options).reduce(
        (text, [token, value]) => text.split(`{{${token}}}`).join(value),
        fallback,
      );
    },
    [],
  );
}

interface BadgeColor {
  fg: string;
  bg: string;
}

// Tailwind variant + per-state override hues from the web FSM registry, ported
// to literal colors (the *-400 shade for text/dot, the *-500 shade at low alpha
// for the badge tint — visually equivalent to the web `bg-*-500/10`).
const VARIANT_COLORS = {
  green: {fg: '#4ade80', bg: 'rgba(34, 197, 94, 0.12)'},
  amber: {fg: '#fbbf24', bg: 'rgba(245, 158, 11, 0.12)'},
  blue: {fg: '#60a5fa', bg: 'rgba(59, 130, 246, 0.12)'},
  gray: {fg: '#9ca3af', bg: 'rgba(107, 114, 128, 0.12)'},
  orange: {fg: '#fb923c', bg: 'rgba(249, 115, 22, 0.12)'},
  indigo: {fg: '#818cf8', bg: 'rgba(99, 102, 241, 0.12)'},
  purple: {fg: '#c084fc', bg: 'rgba(168, 85, 247, 0.12)'},
  cyan: {fg: '#22d3ee', bg: 'rgba(6, 182, 212, 0.12)'},
} satisfies Record<string, BadgeColor>;

// drive_session state -> color (DRIVE_SESSION_STATE_ENTRIES from the web registry).
const DRIVE_STATE_COLORS: Record<string, BadgeColor> = {
  pending: VARIANT_COLORS.amber,
  active: VARIANT_COLORS.green,
  ending: VARIANT_COLORS.orange,
  completed: VARIANT_COLORS.indigo,
  recovered: VARIANT_COLORS.purple,
};

// charge_session state -> color (CHARGE_SESSION_STATE_ENTRIES from the web registry).
const CHARGE_STATE_COLORS: Record<string, BadgeColor> = {
  pending: VARIANT_COLORS.amber,
  active: VARIANT_COLORS.cyan,
  completing: VARIANT_COLORS.blue,
  done: VARIANT_COLORS.green,
  recovered: VARIANT_COLORS.purple,
};

// Mirrors web `getStateColor`: lower-cased lookup within the fsmType's state map,
// falling back to the neutral (gray) style for unknown states/fsmTypes.
function resolveStateColor(fsmType: string, state: string): BadgeColor {
  const map =
    fsmType === 'drive_session'
      ? DRIVE_STATE_COLORS
      : fsmType === 'charge_session'
        ? CHARGE_STATE_COLORS
        : undefined;
  return (map && map[state.toLowerCase()]) ?? VARIANT_COLORS.gray;
}

// Local port of web ./StateBadge (a separate file in the conversion queue): a
// pill with a leading colored dot and the raw state label.
function StateBadge({state, fsmType}: {state: string; fsmType: string}) {
  const color = resolveStateColor(fsmType, state);
  return (
    <View style={[styles.badge, {backgroundColor: color.bg}]}>
      <View style={[styles.badgeDot, {backgroundColor: color.fg}]} />
      <AppText style={[styles.badgeText, {color: color.fg}]} weight="semibold">
        {state}
      </AppText>
    </View>
  );
}

// Decorative glyph stand-ins for the lucide Car / Zap icons (react-native-svg is
// not a dependency).
const SUB_ICON_GLYPH: Record<ActiveSubFSM['type'], string> = {
  drive: '\u{1F697}', // car
  charge: '\u26A1', // high voltage
};

interface FSMSubFSMPanelProps {
  activeSubs?: ActiveSubFSM[];
  fsmType: string;
}

export function FSMSubFSMPanel({
  activeSubs,
  fsmType,
}: FSMSubFSMPanelProps): React.ReactElement | null {
  const t = useNativeTranslationFallback();
  const {width} = useWindowDimensions();

  // Only show when viewing vehicle-level FSMs
  const isVehicleView = fsmType === 'vehicle' || fsmType === 'all';
  if (!isVehicleView) {
    return null;
  }

  const subs = activeSubs ?? [];

  if (subs.length === 0) {
    return (
      <GlassPanel style={styles.panel}>
        <AppText
          style={styles.heading}
          tone="secondary"
          variant="caption"
          weight="semibold">
          {t('fsm.subFSMs', 'Active Sub-FSMs')}
        </AppText>
        <View style={styles.emptyState}>
          <AppText style={styles.emptyText} tone="muted" variant="caption">
            {t('fsm.noSubFSMs', 'No active drive or charge sessions')}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  // Tailwind `md` breakpoint (768px) -> two columns, otherwise one (the web
  // Grid cols={{ default: 1, md: 2 }}).
  const twoColumns = width >= 768;

  return (
    <GlassPanel style={styles.panel}>
      <AppText
        style={[styles.heading, styles.headingSpaced]}
        tone="secondary"
        variant="caption"
        weight="semibold">
        {t('fsm.subFSMs', 'Active Sub-FSMs')}
      </AppText>
      <View style={styles.grid}>
        {subs.map(sub => {
          const glyph = SUB_ICON_GLYPH[sub.type];
          const label =
            sub.type === 'drive'
              ? t('fsm.activeDrive', 'Drive Session')
              : t('fsm.activeCharge', 'Charge Session');
          const terminalStates =
            sub.type === 'drive'
              ? ['completed', 'recovered']
              : ['done', 'recovered'];
          const isActive = !terminalStates.includes(sub.state);

          return (
            <View
              key={sub.type}
              style={[
                styles.card,
                twoColumns ? styles.cardHalf : styles.cardFull,
              ]}
              testID={`fsm-sub-${sub.type}`}>
              <View
                style={[
                  styles.iconBox,
                  isActive ? styles.iconBoxActive : styles.iconBoxIdle,
                ]}>
                <AppText
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={[
                    styles.iconGlyph,
                    isActive ? styles.iconGlyphActive : styles.iconGlyphIdle,
                  ]}>
                  {glyph}
                </AppText>
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTitleRow}>
                  <AppText
                    style={styles.cardLabel}
                    variant="caption"
                    weight="semibold">
                    {label}
                  </AppText>
                  {isActive ? <View style={styles.livePulse} /> : null}
                </View>
                <View style={styles.cardMetaRow}>
                  <StateBadge
                    fsmType={
                      sub.type === 'drive' ? 'drive_session' : 'charge_session'
                    }
                    state={sub.state}
                  />
                  <TimeStamp style={styles.timestamp} value={sub.start_time} />
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </GlassPanel>
  );
}
FSMSubFSMPanel.displayName = 'FSMSubFSMPanel';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  badgeText: {
    fontSize: typography.caption,
    lineHeight: 16,
  },
  card: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  cardBody: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  cardFull: {
    flexBasis: '100%',
    flexGrow: 1,
  },
  cardHalf: {
    flexBasis: '48%',
    flexGrow: 1,
    minWidth: 0,
  },
  cardLabel: {
    color: colors.textPrimary,
  },
  cardMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  heading: {
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  headingSpaced: {
    marginBottom: spacing.xs,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    padding: spacing.sm,
  },
  iconBoxActive: {
    backgroundColor: 'rgba(34, 197, 94, 0.10)',
  },
  iconBoxIdle: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  iconGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  iconGlyphActive: {
    color: '#4ade80',
  },
  iconGlyphIdle: {
    color: colors.textMuted,
  },
  livePulse: {
    backgroundColor: '#4ade80',
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  panel: {
    gap: spacing.sm,
    padding: 16,
  },
  timestamp: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
  },
});

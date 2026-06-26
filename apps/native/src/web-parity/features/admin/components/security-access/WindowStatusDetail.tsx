// Native parity port of
// web/src/features/admin/components/security-access/WindowStatusDetail.tsx.
//
// `WindowStatusDetail` is the Security & Access "Window Status Detail" block: a
// section title above a responsive grid of four GlassPanel cards (Front Driver,
// Front Passenger, Rear Driver, Rear Passenger). Each card derives its window
// state from the latest SecurityEvent via `parseWindowState`, then colours its
// surface/border (`windowColor`) and value text (`windowTextClass`) by that
// state. The card shows a muted label and a bold state value. Behaviour is
// preserved verbatim: the grid always renders all four cards even when `latest`
// is undefined (parseWindowState(undefined) -> 'Unknown'), so there is no
// data-gated hiding.
//
// The web source pulls six modules; native-safe mapping (contract rules 4/5/6/7):
//   - react-i18next `useTranslation` (L1) has no native-parity module -> the
//     standard web-parity i18n shim returning the inline English fallback, so
//     the body's `t('key','English')` calls are unchanged (same approach as the
//     sibling EventTimeline / AuditPanel / FlagsTable ports).
//   - `cn` from `@/lib/cn` (L2) only composed the card className; React Native
//     has no className, so it is dropped and the static `p-4 border` + the
//     `windowColor(state)` variant become a StyleSheet style array.
//   - `GlassPanel` from `@/components/ui/GlassPanel` (L3) -> the existing native
//     shared `components/ui/GlassPanel` primitive; `className="p-4 border ..."`
//     -> padding 16 plus the state surface/border style (the panel already
//     carries borderWidth 1, matching the `border` utility).
//   - `FadeIn` from `@/components/motion/FadeIn` (L4) -> the web-parity
//     `components/motion` FadeIn (framer-motion entrance reproduced with RN
//     Animated); `delay={0.15}` (seconds) is passed through unchanged.
//   - `type SecurityEvent` from `@/types/admin` (L5) -> there is no native
//     `types/admin` port and the native `api/types` SecurityEvent is a different
//     snake_case API shape, so the minimal `fd/fp/rd/rpWindow` fields this
//     component reads are inlined verbatim from `@/types/admin`
//     (`string | boolean | null`) per contract rule 6 (same inline-the-type
//     approach the sibling EventTimeline port used for TimelineEvent).
//   - `parseWindowState`, `windowColor`, `windowTextClass` from `./helpers`
//     (L6) -> the web `./helpers` module has no native parity surface yet, so
//     `parseWindowState` (with its `asNonEmptyString` dependency) and the
//     `WindowState` union are inlined byte-for-byte; the two Tailwind-returning
//     helpers `windowColor`/`windowTextClass` become `windowPanelStyle`/
//     `windowTextStyle`, identical switches that return StyleSheet styles
//     instead of class strings.
//
// DOM -> native element mapping: `<h2 class="text-lg font-semibold text-gray-200
// mb-3">` -> AppText (role header, 18/24, weight 600, textPrimary, marginBottom
// 12); the `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6` container
// is mobile-first (the <640px base is grid-cols-1), so it resolves to a single
// column View (gap 16, marginBottom 24); each `<GlassPanel class="p-4 border
// {windowColor}">` -> GlassPanel (padding 16 + state surface/border); the label
// `<p class="text-xs text-[var(--text-muted)] mb-1">` -> AppText (12/16,
// textMuted, marginBottom 4); the value `<p class="text-xl font-bold
// {windowTextClass}">` -> AppText (20/28, weight 700 + state colour). Tailwind
// colour mapping: green-500/20+green-400 -> successSurface/successBorder+success,
// amber-500/20+amber-400 -> warningSurface/warningBorder+warning, red-500/20+
// red-400 -> dangerSurface/dangerBorder+danger, gray-500/20+--text-muted ->
// surfaceRaised/border+textMuted. No DOM-only modules, browser HTML elements,
// Recharts, Leaflet, or old web UI components are imported.

import React from 'react';
import {StyleSheet, View, type TextStyle, type ViewStyle} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {FadeIn} from '../../../../components/motion';

// ── i18n shim ──────────────────────────────────────────────────────────────
// react-i18next has no native parity module; like the other web-parity ports,
// translations resolve to their inline English fallback. The hook shape mirrors
// the web `const { t } = useTranslation()` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;
function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// `asNonEmptyString` inlined from web `@/lib/typeGuards` (no native typeGuards
// module). Returns `v` only when it is a non-empty string; `null` otherwise.
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// `WindowState` + `parseWindowState` inlined verbatim from web `./helpers`
// (no native helpers module yet, contract rule 6).
type WindowState = 'Closed' | 'Venting' | 'Open' | 'Unknown';

function parseWindowState(val: unknown): WindowState {
  const raw = asNonEmptyString(val);
  if (!raw) {
    return 'Unknown';
  }
  const lower = raw.toLowerCase();
  if (lower === 'closed' || lower === '0') {
    return 'Closed';
  }
  if (lower.includes('vent')) {
    return 'Venting';
  }
  if (lower.includes('open') || lower !== '0') {
    return 'Open';
  }
  return 'Unknown';
}

// Minimal `SecurityEvent` shape inlined from web `@/types/admin`; only the four
// window fields this component reads are carried over, with their original
// `string | boolean | null` union (the backend serializes raw signal values, so
// these can arrive as booleans or string enums).
interface SecurityEvent {
  fdWindow: string | boolean | null;
  fpWindow: string | boolean | null;
  rdWindow: string | boolean | null;
  rpWindow: string | boolean | null;
}

const WINDOW_KEYS = [
  {key: 'fdWindow' as const, i18nKey: 'admin.security.window.fd', fallback: 'Front Driver'},
  {key: 'fpWindow' as const, i18nKey: 'admin.security.window.fp', fallback: 'Front Passenger'},
  {key: 'rdWindow' as const, i18nKey: 'admin.security.window.rd', fallback: 'Rear Driver'},
  {key: 'rpWindow' as const, i18nKey: 'admin.security.window.rp', fallback: 'Rear Passenger'},
] as const;

// Web `windowColor(state)` returned the Tailwind card surface + border classes;
// native returns the equivalent StyleSheet style (same switch / default).
function windowPanelStyle(state: WindowState): ViewStyle {
  switch (state) {
    case 'Closed':
      return styles.panelClosed;
    case 'Venting':
      return styles.panelVenting;
    case 'Open':
      return styles.panelOpen;
    default:
      return styles.panelUnknown;
  }
}

// Web `windowTextClass(state)` returned the Tailwind value-text colour class;
// native returns the equivalent StyleSheet style (same switch / default).
function windowTextStyle(state: WindowState): TextStyle {
  switch (state) {
    case 'Closed':
      return styles.valueClosed;
    case 'Venting':
      return styles.valueVenting;
    case 'Open':
      return styles.valueOpen;
    default:
      return styles.valueUnknown;
  }
}

interface WindowStatusDetailProps {
  latest: SecurityEvent | undefined;
}

export function WindowStatusDetail({latest}: WindowStatusDetailProps) {
  const {t} = useTranslation();

  return (
    <FadeIn delay={0.15}>
      <AppText accessibilityRole="header" style={styles.heading}>
        {t('admin.security.windowDetail', 'Window Status Detail')}
      </AppText>
      <View style={styles.grid}>
        {WINDOW_KEYS.map(win => {
          const state = parseWindowState(latest?.[win.key]);
          return (
            <GlassPanel key={win.key} style={[styles.card, windowPanelStyle(state)]}>
              <AppText style={styles.label}>{t(win.i18nKey, win.fallback)}</AppText>
              <AppText style={[styles.value, windowTextStyle(state)]}>
                {t(`admin.security.windowState.${(state ?? '').toLowerCase()}`, state)}
              </AppText>
            </GlassPanel>
          );
        })}
      </View>
    </FadeIn>
  );
}

export default WindowStatusDetail;

const styles = StyleSheet.create({
  heading: {
    color: colors.textPrimary, // text-gray-200
    fontSize: 18, // text-lg
    fontWeight: '600', // font-semibold
    lineHeight: 24,
    marginBottom: 12, // mb-3
  },
  grid: {
    // grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 — mobile-first base is
    // grid-cols-1, so native resolves to a single-column stack.
    gap: 16, // gap-4
    marginBottom: 24, // mb-6
  },
  card: {
    padding: 16, // p-4
  },
  panelClosed: {
    backgroundColor: colors.successSurface, // bg-green-500/20
    borderColor: colors.successBorder, // border-green-500/40
  },
  panelVenting: {
    backgroundColor: colors.warningSurface, // bg-amber-500/20
    borderColor: colors.warningBorder, // border-amber-500/40
  },
  panelOpen: {
    backgroundColor: colors.dangerSurface, // bg-red-500/20
    borderColor: colors.dangerBorder, // border-red-500/40
  },
  panelUnknown: {
    backgroundColor: colors.surfaceRaised, // bg-gray-500/20
    borderColor: colors.border, // border-gray-500/40
  },
  label: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    lineHeight: 16,
    marginBottom: 4, // mb-1
  },
  value: {
    fontSize: 20, // text-xl
    fontWeight: '700', // font-bold
    lineHeight: 28,
  },
  valueClosed: {
    color: colors.success, // text-green-400
  },
  valueVenting: {
    color: colors.warning, // text-amber-400
  },
  valueOpen: {
    color: colors.danger, // text-red-400
  },
  valueUnknown: {
    color: colors.textMuted, // text-[var(--text-muted)]
  },
});

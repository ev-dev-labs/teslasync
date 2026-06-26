// FavoritesBar — React Native parity port of
// web/src/features/system/components/FavoritesBar.tsx.
//
// A thin presentational strip shown above the Vehicle Commands grid. Behaviors
// preserved 1:1 from the source:
//   - Filters the supplied commands down to the favorited ids
//     (`commands.filter(c => favorites.includes(c.id))`).
//   - Renders NOTHING when there are no favorites (`if (favCmds.length === 0)
//     return null`) — the early return is preserved exactly.
//   - Otherwise renders a "Quick Actions" header (filled star glyph + uppercase
//     label + a parenthesized favorite count) followed by a wrapping grid of
//     parent-provided tiles (`favCmds.map(cmd => renderTile(cmd))`).
//
// Browser-only dependencies are reduced explicitly and documented in the
// .parity.json sidecar:
//   - react-i18next useTranslation (web L2): native-safe
//     useNativeTranslationFallback returning t(key, default) — the translation
//     key + fallback intent ('commands.cat.quickActions' / 'Quick Actions') is
//     preserved verbatim.
//   - lucide-react Star (web L3): the DOM SVG icon is unavailable in React
//     Native, so it becomes a decorative filled-star AppText glyph (★) tinted
//     amber to mirror `text-neon-amber fill-neon-amber`; the implicit aria-hidden
//     becomes importantForAccessibility="no-hide-descendants".
//   - @/components/motion FadeIn (web L4): the framer-motion entrance wrapper has
//     no inert RN analog, so it is reproduced locally as a static
//     <View>{children}</View> pass-through (the ApiPlaygroundPage precedent).
//   - import type { CommandDef } from '../commands' (web L5): the sibling
//     commands module is not yet ported into web-parity, so the CommandDef
//     interface (and its transitive CommandCategory / InputField / InputConfig /
//     SelectOption / SelectConfig deps) is inlined here as a native-safe
//     projection — the only browser-coupled field, the lucide `icon` / `iconOff`
//     LucideIcon component, is narrowed to a glyph stand-in `string`
//     (the dashboard widget-registry precedent). Every other field mirrors the
//     web type so a future CommandsPage port round-trips faithfully.
//   - DOM <div> / <span> (web L20-26): replaced by react-native View / AppText.
//   - Tailwind class strings (grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4,
//     text-xs uppercase tracking-wider, …): reproduced with StyleSheet + theme
//     tokens. The responsive CSS grid (RN has no CSS grid / media queries)
//     collapses to a mobile-first wrapping row whose tile widths are owned by the
//     parent-provided renderTile, faithful to the source intent.

import React, {useRef, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../theme/tokens';

// ── inlined native-safe CommandDef projection (web ../commands.ts) ──
// `icon` / `iconOff` are narrowed from the DOM-only lucide `LucideIcon`
// component to a glyph stand-in string; every other field mirrors the web type.
export type CommandCategory =
  | 'security'
  | 'climate'
  | 'climate_protection'
  | 'charging'
  | 'doors'
  | 'drive'
  | 'windows'
  | 'sunroof'
  | 'schedules'
  | 'alerts'
  | 'navigation'
  | 'software'
  | 'vehicle'
  | 'media';

export interface InputField {
  name: string;
  labelKey: string;
  labelFallback: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'password';
  validation?: 'pin' | 'number' | 'decimal' | 'text';
  min?: number;
  max?: number;
}

export interface InputConfig {
  promptKey: string;
  promptFallback: string;
  paramName: string;
  defaultValue?: string;
  validation?: 'pin' | 'number' | 'decimal' | 'text';
  min?: number;
  max?: number;
  transform?: (value: string) => unknown;
  fields?: InputField[];
  buildParams?: (values: Record<string, string>) => Record<string, unknown>;
  getDefaultValue?: (ctx: {vehicle?: {display_name: string}}) => string;
}

export interface SelectOption {
  value: string;
  labelKey: string;
  labelFallback: string;
  description?: string;
}

export interface SelectConfig {
  paramName: string;
  options: SelectOption[];
}

export interface CommandDef {
  id: string;
  command: string;
  commandOff?: string;
  labelKey: string;
  labelFallback: string;
  sublabelKey?: string;
  sublabelFallback?: string;
  icon: string;
  iconOff?: string;
  category: CommandCategory;
  variant?: 'default' | 'danger' | 'success';
  type: 'action' | 'toggle' | 'input';
  stateField?: string;
  dangerous?: boolean;
  confirmKey?: string;
  confirmFallback?: string;
  defaultFavorite?: boolean;
  inputConfig?: InputConfig;
  selectConfig?: SelectConfig;
  params?: Record<string, unknown>;
  countdown?: number;
  confirmInput?: string;
}

// ── native translation fallback (native-safe port of react-i18next) ──
type NativeTFunction = (key: string, defaultValue: string) => string;

/** Mirrors react-i18next's t(key, default): native has no i18n backend wired
 *  yet, so the English fallback is returned while the key + intent are kept. */
function useNativeTranslationFallback(): NativeTFunction {
  return useRef<NativeTFunction>((_key, defaultValue) => defaultValue).current;
}

// ── static entrance wrapper (native-safe port of @/components/motion FadeIn) ──
function FadeIn({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

// Decorative filled-star glyph standing in for the lucide Star icon.
const STAR_GLYPH = '\u2605'; // ★

interface FavoritesBarProps {
  favorites: string[];
  commands: CommandDef[];
  renderTile: (cmd: CommandDef) => ReactNode;
}

/**
 * Strip of favorited command tiles rendered above the full commands grid.
 * Renders nothing when no commands are favorited.
 */
export function FavoritesBar({favorites, commands, renderTile}: FavoritesBarProps) {
  const t = useNativeTranslationFallback();
  const favCmds = commands.filter(c => favorites.includes(c.id));
  if (favCmds.length === 0) {
    return null;
  }

  return (
    <FadeIn>
      <View testID="favorites-bar-root">
        <View style={styles.header}>
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.star}>
            {STAR_GLYPH}
          </AppText>
          <AppText style={styles.label}>
            {t('commands.cat.quickActions', 'Quick Actions')}
          </AppText>
          <AppText style={styles.count} testID="favorites-bar-count">
            ({favCmds.length})
          </AppText>
        </View>
        <View style={styles.grid}>{favCmds.map(cmd => renderTile(cmd))}</View>
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  star: {
    color: colors.warning,
    fontSize: 16,
    lineHeight: 18,
  },
  label: {
    fontSize: typography.caption,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.textSecondary,
  },
  count: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
});

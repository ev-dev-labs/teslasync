// Native parity port of
// web/src/features/system/components/InputCommandTile.tsx.
//
// A single command tile for the command palette grid: a pressable glass card
// showing the command's icon (or a spinner while its request is in flight), its
// translated label + optional sublabel, an optional last-status line, and a
// top-left favorite toggle. Every prop/state name, the i18n keys + English
// fallbacks, the `def.variant` -> interactive-border mapping, the
// loading/favorite/last-status visual intent, and the early-return-while-loading
// click guard are preserved.
//
// Native adaptations vs. the web source (behaviour / keys kept):
//   - react-i18next `useTranslation` (web L1) -> the shared native-safe
//     `useNativeTranslationFallback` t(key, fallback) hook (no i18n runtime in
//     the parity tree); every t() key + English fallback is copied verbatim.
//   - `@/lib/cn` cn (web L2) -> dropped; React Native uses StyleSheet.
//   - `@/components/ui` GlassPanel (web L3) -> the converted native GlassPanel,
//     wrapped in a <Pressable> so the whole tile is tappable (web `onClick`).
//   - `@/components/ui` Button (web L3, the favorite toggle) -> a nested ghost
//     <Pressable>. RN's responder system makes the inner press win without the
//     web's explicit e.stopPropagation().
//   - lucide-react Loader2 (web L4) -> <ActivityIndicator> (the native spinner);
//     Star (web L4) -> the canonical SemanticIcon 'star' glyph rendered as text.
//   - `../commands` CommandDef (web L5) is not yet ported to the parity tree, so
//     a focused native `CommandDef` is defined locally with the fields this tile
//     consumes; the lucide `icon` component becomes a native `SemanticIconName`.
//   - The web hover-only affordances have no touch analogue: the
//     `hover:border-{variant}` tint is applied while the tile is pressed (the
//     native interaction), and the `group-hover` star reveal becomes an always
//     visible star that is dimmed until favorited.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

// Web lucide <Star/> -> canonical native SemanticIcon glyph (rendered as text).
const STAR_GLYPH = getSemanticIconDefinition('star').glyph;

type CommandVariant = 'default' | 'danger' | 'success';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/**
 * Native-parity subset of the web `CommandDef`
 * (web/src/features/system/commands.ts), which is not yet ported into the
 * parity tree. Only the fields this tile consumes are modelled; the web
 * `icon: LucideIcon` component becomes a canonical native `SemanticIconName`
 * (resolved to a glyph at render time).
 */
export interface CommandDef {
  labelKey: string;
  labelFallback: string;
  sublabelKey?: string;
  sublabelFallback?: string;
  icon: SemanticIconName;
  variant?: CommandVariant;
}

interface InputCommandTileProps {
  def: CommandDef;
  onRequestDialog: (def: CommandDef) => void;
  loading: boolean;
  lastStatus?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

// Web hover-border tint per variant -> native pressed-border tint (no hover).
const variantBorderStyles = StyleSheet.create({
  default: {
    borderColor: colors.borderAccent,
  },
  danger: {
    borderColor: colors.dangerBorder,
  },
  success: {
    borderColor: colors.successBorder,
  },
});

export function InputCommandTile({
  def,
  onRequestDialog,
  loading,
  lastStatus,
  isFavorite,
  onToggleFavorite,
}: InputCommandTileProps) {
  const t = useNativeTranslationFallback();
  const iconGlyph = getSemanticIconDefinition(def.icon).glyph;
  const variant = def.variant ?? 'default';
  const [pressed, setPressed] = useState(false);

  const handleClick = () => {
    if (loading) {
      return;
    }
    onRequestDialog(def);
  };

  const label = t(def.labelKey, def.labelFallback);
  const statusOk = lastStatus ? lastStatus.startsWith('✓') : false;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: loading}}
      onPress={handleClick}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={styles.pressable}>
      <GlassPanel
        style={[
          styles.panel,
          pressed && !loading && variantBorderStyles[variant],
          loading && styles.panelLoading,
        ]}>
        <Pressable
          accessibilityLabel={t('commands.toggleFavorite', 'Toggle favorite')}
          accessibilityRole="button"
          accessibilityState={{selected: isFavorite}}
          hitSlop={8}
          onPress={onToggleFavorite}
          style={styles.favorite}>
          <AppText
            style={[
              styles.favoriteGlyph,
              isFavorite ? styles.favoriteActive : styles.favoriteInactive,
            ]}
            variant="caption"
            weight="bold">
            {STAR_GLYPH}
          </AppText>
        </Pressable>

        <View style={styles.iconBox}>
          {loading ? (
            <ActivityIndicator color={colors.textMuted} size="small" />
          ) : (
            <AppText style={styles.iconGlyph} variant="caption" weight="bold">
              {iconGlyph}
            </AppText>
          )}
        </View>

        <View style={styles.labels}>
          <AppText style={styles.label} variant="caption">
            {label}
          </AppText>
          {def.sublabelFallback ? (
            <AppText style={styles.sublabel} variant="caption">
              {t(def.sublabelKey ?? '', def.sublabelFallback)}
            </AppText>
          ) : null}
          {lastStatus ? (
            <AppText
              style={[
                styles.status,
                statusOk ? styles.statusOk : styles.statusErr,
              ]}>
              {lastStatus}
            </AppText>
          ) : null}
        </View>
      </GlassPanel>
    </Pressable>
  );
}

InputCommandTile.displayName = 'InputCommandTile';

const styles = StyleSheet.create({
  favorite: {
    borderRadius: 4,
    left: 6,
    padding: 2,
    position: 'absolute',
    top: 6,
    zIndex: 1,
  },
  favoriteActive: {
    color: colors.warning,
    opacity: 1,
  },
  favoriteGlyph: {
    letterSpacing: 0.4,
  },
  favoriteInactive: {
    color: colors.textMuted,
    opacity: 0.5,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    justifyContent: 'center',
    padding: spacing.sm + 2,
  },
  iconGlyph: {
    color: colors.textMuted,
    letterSpacing: 0.4,
  },
  label: {
    color: colors.textPrimary,
    fontWeight: '500',
    textAlign: 'center',
  },
  labels: {
    alignItems: 'center',
  },
  panel: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 100,
    padding: spacing.md + spacing.xs,
  },
  panelLoading: {
    opacity: 0.5,
  },
  pressable: {
    width: '100%',
  },
  status: {
    fontSize: 9,
    lineHeight: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  statusErr: {
    color: colors.danger,
  },
  statusOk: {
    color: colors.success,
  },
  sublabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 14,
    marginTop: 2,
    textAlign: 'center',
  },
});

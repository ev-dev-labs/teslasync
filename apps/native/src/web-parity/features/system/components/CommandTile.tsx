// Native parity port of web/src/features/system/components/CommandTile.tsx.
//
// The web source (84 lines) renders a single Tesla vehicle-command tile inside
// the Vehicle Commands grid: a clickable GlassPanel holding a top-left favorite
// toggle (lucide Star), an optional top-right "dangerous command" marker (lucide
// AlertTriangle), a central neutral icon box that swaps the command's own lucide
// icon for a spinning lucide Loader2 while a command is in flight, and a label /
// optional sublabel / optional last-status line. Pressing the tile no-ops while
// loading, opens a confirmation dialog for dangerous commands, or fires the
// command otherwise. The favorite button stops event propagation so a favorite
// toggle never also fires the command.
//
// Native-targeting decisions (no DOM, no lucide-react, no web UI kit, no
// Tailwind / cn):
//   * `@/components/ui` GlassPanel + Button -> the native GlassPanel primitive
//     wrapped in a Pressable for the tile press, plus a nested Pressable for the
//     favorite toggle. React Native's responder system lets the inner Pressable
//     swallow the touch, so the web `e.stopPropagation()` is reproduced without
//     an explicit call (documented in the sidecar).
//   * lucide-react Star / AlertTriangle / Loader2 and the command's own
//     `def.icon` -> the repo SemanticIcon glyph set. The command glyph plus the
//     two tiny corner markers are resolved through
//     getSemanticIconDefinition(...).glyph and rendered as text (the same way
//     sibling native ports render small lucide glyphs); Loader2's animate-spin
//     maps to <ActivityIndicator>.
//   * react-i18next useTranslation -> the established native
//     useNativeTranslationFallback() returning the English fallback, preserving
//     every (key, fallback) pair.
//   * `../commands` CommandDef -> a native-safe local mirror (the shared
//     commands module is its own, not-yet-ported conversion). Its single
//     DOM/lucide-shaped field, `icon: LucideIcon`, is retyped to the repo
//     `SemanticIconName`; every field CommandTile reads is preserved.
//   * Tailwind class strings -> StyleSheet styles. The variant `hover:border-*`
//     affordance has no native hover, so it is mapped to the pressed state
//     (touch's analogue of hover), and the favorite star's
//     `opacity-0 group-hover:opacity-50` (invisible until hover) becomes a
//     permanently half-visible, tappable star since touch has no hover.
//
// Line coverage: see the CommandTile.tsx.parity.json sidecar.

import { useCallback } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';

type CommandVariant = 'default' | 'danger' | 'success';

// Native-safe mirror of the fields web ./commands `CommandDef` exposes to
// CommandTile. `icon` is retyped from the lucide `LucideIcon` component to the
// repo `SemanticIconName` (native has no lucide); every other consumed field is
// preserved verbatim. The shared commands module is its own conversion, so this
// subset is inlined to keep the port self-contained.
export interface CommandDef {
  command: string;
  labelKey: string;
  labelFallback: string;
  sublabelKey?: string;
  sublabelFallback?: string;
  icon: SemanticIconName;
  variant?: CommandVariant;
  dangerous?: boolean;
  params?: Record<string, unknown>;
}

interface CommandTileProps {
  def: CommandDef;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
  onRequestDialog: (def: CommandDef) => void;
  loading: boolean;
  lastStatus?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

type NativeTFunction = (key: string, fallback: string) => string;

// The web tile read `t` from react-i18next. Native parity has no i18n runtime
// wired, so this returns the English fallback, preserving the
// `t('commands.toggleFavorite', 'Toggle favorite')` key/fallback intent and the
// `t(def.labelKey, def.labelFallback)` / sublabel calls.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// lucide AlertTriangle's repo-canonical SemanticIcon equivalent is `warning`;
// lucide Star maps to `star`. Resolved once at module scope.
const DANGER_GLYPH = getSemanticIconDefinition('warning').glyph;
const FAVORITE_GLYPH = getSemanticIconDefinition('star').glyph;

export function CommandTile({
  def,
  onExecute,
  onRequestDialog,
  loading,
  lastStatus,
  isFavorite,
  onToggleFavorite,
}: CommandTileProps) {
  const t = useNativeTranslationFallback();
  const variant: CommandVariant = def.variant ?? 'default';
  const commandGlyph = getSemanticIconDefinition(def.icon).glyph;

  const handlePress = () => {
    if (loading) {
      return;
    }
    if (def.dangerous) {
      onRequestDialog(def);
      return;
    }
    onExecute(def.command, def.params);
  };

  const statusOk = lastStatus?.startsWith('✓') ?? false;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading }}
      onPress={handlePress}>
      {({ pressed }) => (
        <GlassPanel
          style={[
            styles.tile,
            loading ? styles.tileLoading : null,
            pressed ? pressedBorderStyles[variant] : null,
          ]}>
          <Pressable
            accessibilityLabel={t('commands.toggleFavorite', 'Toggle favorite')}
            accessibilityRole="button"
            accessibilityState={{ selected: isFavorite }}
            hitSlop={8}
            onPress={onToggleFavorite}
            style={styles.favorite}>
            <AppText
              style={[
                styles.favoriteGlyph,
                isFavorite ? styles.favoriteActive : styles.favoriteInactive,
              ]}>
              {FAVORITE_GLYPH}
            </AppText>
          </Pressable>

          {def.dangerous ? (
            <View style={styles.danger}>
              <AppText style={styles.dangerGlyph}>{DANGER_GLYPH}</AppText>
            </View>
          ) : null}

          <View style={styles.iconBox}>
            {loading ? (
              <ActivityIndicator color={colors.textMuted} size="small" />
            ) : (
              <AppText style={styles.iconGlyph}>{commandGlyph}</AppText>
            )}
          </View>

          <View style={styles.labels}>
            <AppText style={styles.label}>
              {t(def.labelKey, def.labelFallback)}
            </AppText>
            {def.sublabelFallback ? (
              <AppText style={styles.sublabel}>
                {t(def.sublabelKey ?? '', def.sublabelFallback)}
              </AppText>
            ) : null}
            {lastStatus ? (
              <AppText
                style={[
                  styles.status,
                  statusOk ? styles.statusOk : styles.statusError,
                ]}>
                {lastStatus}
              </AppText>
            ) : null}
          </View>
        </GlassPanel>
      )}
    </Pressable>
  );
}

CommandTile.displayName = 'CommandTile';

const styles = StyleSheet.create({
  danger: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 1,
  },
  dangerGlyph: {
    color: colors.danger,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
    opacity: 0.6,
  },
  favorite: {
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
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
  favoriteInactive: {
    color: colors.textMuted,
    opacity: 0.5,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconGlyph: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  label: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    textAlign: 'center',
  },
  labels: {
    alignItems: 'center',
  },
  status: {
    fontSize: 9,
    lineHeight: 12,
    marginTop: 2,
    textAlign: 'center',
  },
  statusError: {
    color: colors.danger,
  },
  statusOk: {
    color: colors.success,
  },
  sublabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 13,
    marginTop: 2,
    textAlign: 'center',
  },
  tile: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 100,
    padding: 16,
  },
  tileLoading: {
    opacity: 0.5,
  },
});

const pressedBorderStyles = StyleSheet.create<Record<CommandVariant, ViewStyle>>(
  {
    danger: {
      borderColor: colors.dangerBorder,
    },
    default: {
      borderColor: colors.borderAccent,
    },
    success: {
      borderColor: colors.successBorder,
    },
  },
);

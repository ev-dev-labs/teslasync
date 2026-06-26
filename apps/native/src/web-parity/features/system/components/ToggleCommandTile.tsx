// Native parity port of web/src/features/system/components/ToggleCommandTile.tsx.
//
// The web component is a single command "tile" on the Vehicle Commands page: a
// clickable GlassPanel that toggles a Tesla vehicle feature on/off. It shows a
// favorite-star toggle button (top-left), a status dot (top-right), a tinted
// icon chip (the command's lucide icon, or a spinner while a command is in
// flight), the command label, an ON/OFF state line, and an optional last-status
// line. `isOn` is read from `state[def.stateField]` when the def has a state
// field, otherwise from a local optimistic `localToggle`. Clicking dispatches
// `commandOff` when on, opens the input dialog when off + the def has an
// inputConfig, or dispatches `command`(+`params`) otherwise. It is reproduced
// here with React Native primitives, preserving state, the click logic, the
// isOn derivation, the variant color treatment, i18n keys + copy, and visual
// intent:
//
//   - The shared web `<GlassPanel onClick={handleClick}>` is a DOM <div> with a
//     click handler; GlassPanel has no native onPress (the native parity
//     GlassPanel is a View), so the tile is wrapped in a `<Pressable
//     onPress={handleClick}>` whose child is the native parity `<GlassPanel>`.
//     The web `cursor-pointer`/`group`/`transition-all duration-normal` and the
//     `hover:border-[--border-subtle]` off-state hover are browser-only and
//     dropped; `min-h-[100px]`, `p-4`, `flex-col items-center justify-center
//     gap-2 text-center` map to the GlassPanel style override, and the on-state
//     neon panel tint (`border-neon-*/20 bg-neon-*/5`) + the `opacity-50` loading
//     dim are applied as style. The `e.stopPropagation()` the favorite button
//     used to keep the panel click from firing is automatic on native (the inner
//     Pressable becomes the touch responder), so it is not needed.
//   - The shared web `<Button as ControlButton variant='ghost' size='sm'>`
//     favorite toggle -> the already-converted native parity `<Button
//     variant='ghost' size='sm'>` (the same ControlButton->Button mapping the
//     CommandInputDialog port used), positioned absolutely + shrunk via a `style`
//     override. The web aria-label -> accessibilityLabel. The lucide `<Star>`
//     (filled when favorite) -> a unicode star glyph (★ filled / ☆ outline), the
//     same lucide->glyph approach the FeatureToggles port took for Flag/RefreshCw.
//     Web `opacity-0 group-hover:opacity-50` (invisible until pointer hover) has
//     no touch analog, so the inactive star is shown statically at 0.5 opacity so
//     it stays tappable — the native hover->static convention the Button/GlassPanel
//     ports established.
//   - The lucide command `def.icon`/`def.iconOff` are `SemanticIconName`s in the
//     native commands.ts, rendered here as the icon's semantic 2-char glyph
//     (`getSemanticIconDefinition(name).glyph`) inside a tinted IconBox View so
//     the web's variant-colored chip (`bg-neon-*/20 text-neon-*`, or
//     `bg-[--surface-2] text-[--text-muted]` when off) is preserved — the
//     SemanticIcon chip is NOT used directly here because it carries its own
//     tone-based color, which would override the command variant tint.
//   - The lucide `<Loader2 className='animate-spin'>` spinner -> a native
//     `<ActivityIndicator>` tinted with the on/off icon color, occupying the same
//     icon-chip slot ({loading ? spinner : icon}) — the Button-port spinner idiom.
//   - cn() (clsx + tailwind-merge) is browser/Tailwind-only and dropped; the
//     conditional classes become native style arrays. The neon palette is carried
//     as literal hex matching the web tailwind config (neon-cyan #00f0ff, neon-red
//     #ef4444, neon-green #10b981); `--surface-2` (#151621), `--text-primary`,
//     `--text-muted` map to the theme tokens / the documented literal.
//   - react-i18next is unavailable in native parity; a local t() shim returns the
//     English fallback verbatim while preserving every i18n key (commands.on,
//     commands.off, commands.toggleFavorite, def.labelKey).

import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {Button} from '../../../components/ui/Button';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import type {CommandDef, VehicleState} from '../commands';

interface ToggleCommandTileProps {
  def: CommandDef;
  state: VehicleState | null;
  onExecute: (command: string, params?: Record<string, unknown>) => void;
  onRequestDialog: (def: CommandDef) => void;
  loading: boolean;
  lastStatus?: string;
  isFavorite: boolean;
  onToggleFavorite: () => void;
}

// react-i18next is unavailable in native parity; this shim returns the English
// fallback copy verbatim while preserving the i18n keys.
type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

type ToggleVariant = NonNullable<CommandDef['variant']>;

// Web tailwind config neon palette, preserved as literal hex.
const NEON: Record<ToggleVariant, string> = {
  default: '#00f0ff', // neon-cyan
  danger: '#ef4444', // neon-red
  success: '#10b981', // neon-green
};

// --surface-2 (the off-state icon chip + dot fill, same as the panel surface).
const SURFACE_2 = '#151621';
// lastStatus success/error tints (text-neon-green/60 + text-neon-red/60).
const STATUS_OK_COLOR = 'rgba(16, 185, 129, 0.6)';
const STATUS_ERR_COLOR = 'rgba(239, 68, 68, 0.6)';
// The ✓ prefix the web checks to color the last-status line green vs red.
const STATUS_OK_PREFIX = '\u2713';
// lucide <Star> -> unicode star glyph (filled when favorite, outline otherwise).
const STAR_FILLED = '\u2605'; // ★
const STAR_OUTLINE = '\u2606'; // ☆

export function ToggleCommandTile({
  def,
  state,
  onExecute,
  onRequestDialog,
  loading,
  lastStatus,
  isFavorite,
  onToggleFavorite,
}: ToggleCommandTileProps) {
  const t = useNativeTranslationFallback();
  const [localToggle, setLocalToggle] = useState(false);

  const isOn =
    def.stateField && state
      ? Boolean((state as unknown as Record<string, unknown>)[def.stateField])
      : localToggle;

  const variant: ToggleVariant = def.variant ?? 'default';
  const iconName: SemanticIconName = isOn ? def.icon : def.iconOff ?? def.icon;
  const iconGlyph = getSemanticIconDefinition(iconName).glyph;

  const handleClick = () => {
    if (loading) {
      return;
    }

    if (isOn) {
      if (!def.stateField) {
        setLocalToggle(false);
      }
      onExecute(def.commandOff!);
    } else {
      if (def.inputConfig) {
        onRequestDialog(def);
      } else {
        if (!def.stateField) {
          setLocalToggle(true);
        }
        onExecute(def.command, def.params);
      }
    }
  };

  const onColor = NEON[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{busy: loading}}
      onPress={handleClick}
      testID="toggle-command-tile">
      <GlassPanel
        style={[
          styles.tile,
          isOn ? panelOnStyles[variant] : null,
          loading ? styles.loading : null,
        ]}>
        <Button
          accessibilityLabel={t('commands.toggleFavorite', 'Toggle favorite')}
          hitSlop={8}
          onPress={onToggleFavorite}
          size="sm"
          style={[
            styles.favorite,
            isFavorite ? styles.favoriteActive : styles.favoriteInactive,
          ]}
          testID="toggle-command-favorite"
          variant="ghost">
          <AppText
            importantForAccessibility="no"
            style={[
              styles.favoriteGlyph,
              isFavorite
                ? styles.favoriteGlyphActive
                : styles.favoriteGlyphInactive,
            ]}>
            {isFavorite ? STAR_FILLED : STAR_OUTLINE}
          </AppText>
        </Button>

        <View style={[styles.dot, isOn ? dotOnStyles[variant] : styles.dotOff]} />

        <View
          style={[
            styles.iconBox,
            isOn ? iconBoxOnStyles[variant] : styles.iconBoxOff,
          ]}>
          {loading ? (
            <ActivityIndicator
              color={isOn ? onColor : colors.textMuted}
              size="small"
            />
          ) : (
            <AppText
              importantForAccessibility="no"
              style={[
                styles.iconGlyph,
                isOn ? onTextStyles[variant] : styles.iconGlyphOff,
              ]}>
              {iconGlyph}
            </AppText>
          )}
        </View>

        <AppText style={styles.label} weight="semibold">
          {t(def.labelKey, def.labelFallback)}
        </AppText>

        <AppText
          style={[
            styles.stateText,
            isOn ? onTextStyles[variant] : styles.stateTextOff,
          ]}>
          {isOn ? t('commands.on', 'ON') : t('commands.off', 'OFF')}
        </AppText>

        {lastStatus ? (
          <AppText
            style={[
              styles.statusText,
              lastStatus.startsWith(STATUS_OK_PREFIX)
                ? styles.statusOk
                : styles.statusErr,
            ]}>
            {lastStatus}
          </AppText>
        ) : null}
      </GlassPanel>
    </Pressable>
  );
}

ToggleCommandTile.displayName = 'ToggleCommandTile';

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    minHeight: 100,
    padding: 16,
  },
  loading: {
    opacity: 0.5,
  },
  favorite: {
    borderRadius: 6,
    height: 24,
    left: 6,
    paddingHorizontal: 4,
    position: 'absolute',
    top: 6,
    zIndex: 1,
  },
  favoriteActive: {
    opacity: 1,
  },
  // Web `opacity-0 group-hover:opacity-50` -> a static 0.5 so the star stays
  // tappable on touch (no pointer hover).
  favoriteInactive: {
    opacity: 0.5,
  },
  favoriteGlyph: {
    fontSize: 12,
    lineHeight: 14,
  },
  favoriteGlyphActive: {
    color: '#fcd34d', // text-amber-300
  },
  favoriteGlyphInactive: {
    color: colors.textMuted,
  },
  dot: {
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: 8,
    top: 8,
    width: 8,
  },
  dotOff: {
    backgroundColor: SURFACE_2,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    padding: 10,
  },
  iconBoxOff: {
    backgroundColor: SURFACE_2,
  },
  iconGlyph: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 22,
    textAlign: 'center',
  },
  iconGlyphOff: {
    color: colors.textMuted,
  },
  label: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
  stateText: {
    fontSize: 10,
    fontWeight: '500',
  },
  stateTextOff: {
    color: colors.textMuted,
  },
  statusText: {
    fontSize: 9,
    textAlign: 'center',
  },
  statusOk: {
    color: STATUS_OK_COLOR,
  },
  statusErr: {
    color: STATUS_ERR_COLOR,
  },
});

// Web `onStyles[variant]` neon treatment, split into the per-element style maps
// (panel border+fill, icon chip fill, dot fill, on-text color) keyed by variant.
const panelOnStyles = StyleSheet.create<Record<ToggleVariant, ViewStyle>>({
  default: {
    backgroundColor: 'rgba(0, 240, 255, 0.05)',
    borderColor: 'rgba(0, 240, 255, 0.2)',
  },
  danger: {
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  success: {
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
});

const iconBoxOnStyles = StyleSheet.create<Record<ToggleVariant, ViewStyle>>({
  default: {
    backgroundColor: 'rgba(0, 240, 255, 0.2)',
  },
  danger: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  success: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
});

const dotOnStyles = StyleSheet.create<Record<ToggleVariant, ViewStyle>>({
  default: {
    backgroundColor: NEON.default,
  },
  danger: {
    backgroundColor: NEON.danger,
  },
  success: {
    backgroundColor: NEON.success,
  },
});

const onTextStyles = StyleSheet.create<Record<ToggleVariant, TextStyle>>({
  default: {
    color: NEON.default,
  },
  danger: {
    color: NEON.danger,
  },
  success: {
    color: NEON.success,
  },
});

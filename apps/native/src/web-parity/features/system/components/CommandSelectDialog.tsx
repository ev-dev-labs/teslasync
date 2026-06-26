// Native parity port of web/src/features/system/components/CommandSelectDialog.tsx.
//
// `<CommandSelectDialog>` is the option-picker the Vehicle Commands page opens
// for a command whose `selectConfig` enumerates a small set of choices (e.g. a
// charge-port "open/close", a seat-heater level). It renders the command's icon
// + label as a header, one tappable card per option (label + optional
// description), and a trailing Cancel control. Picking an option fires
// `onSelect(value)`; Cancel (or dismissing the sheet) fires `onClose()`.
//
// Behavioural contract (identical to web):
//   - `def.selectConfig` supplies the `options`; each option renders its
//     translated `labelKey`/`labelFallback` and, when present, its raw
//     `description` string (descriptions are not run through i18n on web either).
//   - `loading` disables every option button (and dims it) so a tap cannot be
//     double-submitted while the prior command is in flight. Cancel stays
//     enabled.
//   - The header label is `t(def.labelKey, def.labelFallback)`; Cancel is
//     `t('common.cancel', 'Cancel')` — the web i18n keys are preserved verbatim.
//
// Web -> native adaptations (documented in the sidecar):
//   - The shared <Modal open onClose size="sm"> (web/src/components/ui/Modal.tsx,
//     which portals a fixed overlay + backdrop) becomes a transparent fade RN
//     <Modal visible transparent> with an overlay <View> + a full-bleed backdrop
//     <Pressable onPress={onClose}> and a centred dialog card — the same idiom as
//     the already-converted ShareDriveDialog / SignalConfigModal ports. The
//     `size="sm"` width preset (Tailwind `sm:max-w-sm`, 24rem) maps to
//     maxWidth 384.
//   - The web L25-30 `handleKeyDown` (Escape -> onClose) has no DOM-key analogue
//     in RN; the platform-native equivalent (Android hardware back / OS dismiss)
//     is wired through the RN Modal's `onRequestClose={onClose}`, preserving the
//     "press-Escape-to-close" intent.
//   - `def.icon` is a lucide `LucideIcon` React component (browser-only). Native
//     has no icon font, so the web `CommandDef`'s `icon: LucideIcon` is mirrored
//     here as `iconName: SemanticIconName` (the established
//     `icon: LucideIcon` -> name-string idiom) and rendered as the shared
//     SemanticIcon glyph inside the same neutral rounded box the web uses
//     (`bg-[var(--surface-2)] text-[var(--text-secondary)]`), so the box stays
//     visually neutral rather than tinted.
//   - The shared <Button variant="ghost" size="sm"> option/cancel controls become
//     <Pressable accessibilityRole="button">s; `:hover`/`:focus-ring` (no native
//     analogue) collapse to a pressed/disabled style. `cn(...)` className merges
//     resolve to RN style arrays.
//   - react-i18next is not wired in native, so `useTranslation().t` becomes a
//     `(key, fallback) => fallback` shim that returns the English defaultValue,
//     preserving every web i18n key + copy verbatim.
//   - The Tailwind/CSS-var classes resolve to a StyleSheet: var(--surface-2) ->
//     colors.surfaceRaised, var(--border-subtle) -> colors.border,
//     var(--text-primary) -> colors.textPrimary, var(--text-secondary) ->
//     colors.textSecondary, var(--text-muted) -> colors.textMuted,
//     neon-cyan/30 (hover border) -> colors.borderAccent on press.

import React, {useCallback} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';

// ---------------------------------------------------------------------------
// Native-safe mirror of the slice of `../commands` this dialog consumes. The
// web module imports lucide-react (`LucideIcon`) and is browser-only, so the
// only types this component reads are re-declared here with `icon: LucideIcon`
// adapted to `iconName: SemanticIconName`.
// ---------------------------------------------------------------------------

/** Mirror of the web `SelectOption` (web/src/features/system/commands.ts). */
export interface SelectOption {
  value: string;
  labelKey: string;
  labelFallback: string;
  description?: string;
}

/** Mirror of the web `SelectConfig` (web/src/features/system/commands.ts). */
export interface SelectConfig {
  paramName: string;
  options: SelectOption[];
}

/**
 * Native-safe slice of the web `CommandDef` — exactly the fields this dialog
 * reads. `icon: LucideIcon` (browser-only) becomes `iconName: SemanticIconName`.
 */
export interface CommandDef {
  labelKey: string;
  labelFallback: string;
  iconName: SemanticIconName;
  selectConfig?: SelectConfig;
}

export interface CommandSelectDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  def: CommandDef;
  loading?: boolean;
}

// react-i18next is not wired in native; return the English defaultValue so the
// web i18n keys + copy are preserved verbatim.
type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export function CommandSelectDialog({
  open,
  onClose,
  onSelect,
  def,
  loading,
}: CommandSelectDialogProps) {
  const t = useNativeTranslationFallback();
  const sc = def.selectConfig;
  const options = sc?.options ?? [];
  const iconGlyph = getSemanticIconDefinition(def.iconName).glyph;
  const title = t(def.labelKey, def.labelFallback);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />

        <View
          accessibilityViewIsModal
          accessible
          accessibilityLabel={title}
          style={styles.dialog}
          testID="command-select-dialog">
          <View style={styles.header}>
            <View style={styles.iconBox}>
              <AppText
                accessible={false}
                allowFontScaling={false}
                style={styles.iconGlyph}
                weight="bold">
                {iconGlyph}
              </AppText>
            </View>
            <AppText style={styles.title} testID="command-select-title" weight="semibold">
              {title}
            </AppText>
          </View>

          <ScrollView
            contentContainerStyle={styles.optionList}
            style={styles.optionScroll}>
            {options.map(opt => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t(opt.labelKey, opt.labelFallback)}
                accessibilityState={{disabled: Boolean(loading)}}
                disabled={loading}
                key={opt.value}
                onPress={() => onSelect(opt.value)}
                style={({pressed}) => [
                  styles.option,
                  pressed && !loading && styles.optionPressed,
                  loading && styles.optionDisabled,
                ]}
                testID={`command-select-option-${opt.value}`}>
                <AppText style={styles.optionLabel}>
                  {t(opt.labelKey, opt.labelFallback)}
                </AppText>
                {opt.description ? (
                  <AppText style={styles.optionDescription}>
                    {opt.description}
                  </AppText>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel', 'Cancel')}
              onPress={onClose}
              style={({pressed}) => [styles.cancel, pressed && styles.cancelPressed]}
              testID="command-select-cancel">
              <AppText style={styles.cancelText}>
                {t('common.cancel', 'Cancel')}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

CommandSelectDialog.displayName = 'CommandSelectDialog';

const styles = StyleSheet.create({
  // Modal overlay scrim (web fixed inset-0 backdrop + centering wrapper).
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  // size="sm" card: bg-gray-900/95 + border-[var(--border-subtle)].
  dialog: {
    alignSelf: 'center',
    width: '92%',
    maxWidth: 384,
    maxHeight: '86%',
    margin: spacing.lg,
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  // flex items-center gap-3 mb-5
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  // rounded-xl p-2.5 bg-[var(--surface-2)] text-[var(--text-secondary)]
  iconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 40,
    minHeight: 40,
    padding: 10,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  iconGlyph: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  // text-base font-semibold text-[var(--text-primary)]
  title: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  // space-y-2 list
  optionScroll: {
    flexGrow: 0,
  },
  optionList: {
    gap: spacing.sm,
  },
  // h-auto w-full flex-col items-start gap-0.5 rounded-lg p-3
  // bg-[var(--surface-2)] border border-[var(--border-subtle)]
  option: {
    width: '100%',
    alignItems: 'flex-start',
    gap: 2,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  // hover:border-neon-cyan/30 + focus:ring-neon-cyan/30
  optionPressed: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceHover,
  },
  // loading && opacity-50 cursor-not-allowed
  optionDisabled: {
    opacity: 0.5,
  },
  // text-sm font-medium text-[var(--text-primary)]
  optionLabel: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  // text-xs text-[var(--text-muted)] mt-0.5
  optionDescription: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  // flex justify-end pt-4
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.md + spacing.xs,
  },
  // ghost sm Cancel: text-[var(--text-secondary)] hover:bg-[var(--surface-2)]
  cancel: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 10,
  },
  cancelPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  cancelText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
});

export default CommandSelectDialog;

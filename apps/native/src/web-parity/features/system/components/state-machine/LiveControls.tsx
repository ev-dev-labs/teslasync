// Native parity port of
// web/src/features/system/components/state-machine/LiveControls.tsx.
//
// The Live/Freeze/Step toolbar for the FSM debugger. It is purely controlled —
// the page owns whether streaming is "live" or "frozen", the active buffer
// Window choice, the index into the transition buffer (for stepping), and
// whether step-prev / step-next are valid right now. The right-hand counter
// distinguishes the Window dropdown's slice from the underlying 24 h fetch
// ("{{n}} in window · {{N}} in 24 h") with a hover tooltip explaining the scope
// difference; the legacy single-scope `bufferCount` prop is preserved as a
// deprecated fallback so external callers don't break mid-migration.
//
// Web -> native adaptations (documented in the sidecar):
//   - react-i18next is not wired in native, so `useTranslation().t` becomes a
//     local `t(key, fallback, vars?)` shim returning the English defaultValue
//     and substituting `{{var}}` placeholders (the established DrivetrainHealth
//     idiom). Every web i18n key + English copy is preserved verbatim, including
//     the bufferedDual / buffered / bufferedTooltip interpolations.
//   - The shared <Button size="sm" variant="primary|secondary|ghost"> controls
//     (web/src/components/ui/Button.tsx) become a reusable inline <ToolbarButton>
//     <Pressable accessibilityRole="button">: aria-pressed -> accessibilityState
//     {selected}, disabled -> accessibilityState {disabled} + dimmed, :hover ->
//     a pressed style. The blue-600/gray-700/gray-100/gray-800 Tailwind hues the
//     web Button resolves to are mapped to their literal hexes (the established
//     "exact Tailwind hue verbatim" idiom).
//   - The shared <Select size="sm" options> dropdown (no DOM <select> on native)
//     becomes an inline <WindowSelect>: a Pressable trigger showing the active
//     option label that opens a transparent fade <Modal> popover of accessible
//     option rows (the DashboardSettingsModal / GeneralSettings.SelectField
//     idiom). onChange(e) => Number(e.target.value) maps onto onValueChange ->
//     onWindowChange(Number(value)), preserving the numeric contract.
//   - The shared <Tooltip content> wrapping the counter <Caption> becomes the
//     shared native <HelpTooltip text>: web :hover/:focus reveal has no native
//     analog, so tap-to-reveal (a fade Modal popover) replaces it, the same
//     contract HelpTooltip already mirrors for the web <Tooltip>. The counter
//     text is passed as the tooltip trigger child and keeps testID
//     "live-controls-counter".
//   - The live dot's `animate-pulse` has no static-StyleSheet analog (and an
//     Animated.loop risks --detectOpenHandles leaks), so the dot renders solid:
//     emerald-300 (#6ee7b7) when live, var(--surface-2) when frozen — the live
//     state is still primarily signalled by the Live button's primary variant.
//   - The `hidden sm:inline` "Window" label (hidden on phones, shown >=640px)
//     has no RN responsive analog; it is kept visible since the Select's
//     accessibilityLabel already carries "Window" and hiding labels reduces
//     clarity on native. The web `className` styling prop is accepted-but-ignored
//     for source compatibility and mirrored by a native `style` override.
//   - The Tailwind/CSS-var classes resolve to a StyleSheet: var(--border-subtle)
//     -> colors.border, var(--surface-2) -> colors.surfaceRaised,
//     var(--surface-1) -> colors.surface, var(--text-*) -> colors.text*,
//     bg-white/[0.02] -> rgba(255,255,255,0.02).

import React, {useCallback, useState} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../../../theme/tokens';
import {HelpTooltip} from '../../../../components/ui/HelpTooltip';

// react-i18next is not wired in native; this shim returns the English
// defaultValue and substitutes {{var}} placeholders so the web i18n keys + copy
// (and their interpolations) are preserved verbatim.
type TVars = Record<string, string | number>;

function t(_key: string, fallback: string, vars?: TVars): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const value = vars[k];
    return value == null ? '' : String(value);
  });
}

// Exact Tailwind hues the web <Button> resolves to (mapped verbatim to hex).
const BLUE_600 = '#2563eb'; // variant="primary" bg
const BLUE_700 = '#1d4ed8'; // primary :hover bg
const GRAY_700 = '#374151'; // variant="secondary" dark bg
const GRAY_600 = '#4b5563'; // secondary :hover bg
const GRAY_800 = '#1f2937'; // ghost :hover bg (dark:hover:bg-gray-800)
const GRAY_100 = '#f3f4f6'; // secondary dark text
const EMERALD_300 = '#6ee7b7'; // live dot (bg-emerald-300)
const WHITE_FILL_02 = 'rgba(255, 255, 255, 0.02)'; // container bg-white/[0.02]
const POPOVER_SCRIM = 'rgba(0, 0, 0, 0.45)';
const CHEVRON_GLYPH = '\u25BE'; // ▾ select caret
const ARROW_PREV_GLYPH = '\u2190'; // ←
const ARROW_NEXT_GLYPH = '\u2192'; // →

export interface LiveControlsProps {
  isLive: boolean;
  onToggleLive: (live: boolean) => void;
  onStepPrev: () => void;
  onStepNext: () => void;
  canStepPrev?: boolean;
  canStepNext?: boolean;
  windowMinutes: number;
  onWindowChange: (minutes: number) => void;
  onClearBuffer: () => void;
  /** Number of transitions inside the active Window dropdown slice. */
  windowCount?: number;
  /** Total transitions fetched (typically the last 24 h). */
  totalCount?: number;
  /**
   * @deprecated Use `windowCount` + `totalCount`. Kept for one Phase as a
   * fallback so external callers don't break mid-migration; if both new
   * props are absent, this scalar drives both counts (preserving the old
   * "{{n}} buffered" copy).
   */
  bufferCount?: number;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the toolbar container (RN equivalent of `className`). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const WINDOW_OPTIONS = [
  {value: '5', label: '5 min'},
  {value: '10', label: '10 min'},
  {value: '30', label: '30 min'},
  {value: '120', label: '2 h'},
];

// ---------------------------------------------------------------------------
// ToolbarButton — native replacement for the shared web <Button size="sm">.
// ---------------------------------------------------------------------------

type ToolbarVariant = 'primary' | 'secondary' | 'ghost';

interface ToolbarButtonProps {
  label: string;
  onPress: () => void;
  variant?: ToolbarVariant;
  disabled?: boolean;
  /** aria-pressed parity (omit for non-toggle buttons). */
  selected?: boolean;
  accessibilityLabel?: string;
  /** Leading status dot — Live button only. */
  dot?: 'live' | 'idle';
  testID?: string;
}

function ToolbarButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  selected,
  accessibilityLabel,
  dot,
  testID,
}: ToolbarButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{
        disabled,
        ...(selected === undefined ? {} : {selected}),
      }}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        pressed && !disabled
          ? variant === 'primary'
            ? styles.btnPrimaryPressed
            : variant === 'secondary'
              ? styles.btnSecondaryPressed
              : styles.btnGhostPressed
          : null,
        disabled && styles.btnDisabled,
      ]}
      testID={testID}>
      {dot ? (
        <View style={[styles.dot, dot === 'live' ? styles.dotLive : styles.dotIdle]} />
      ) : null}
      <AppText
        style={[
          styles.btnLabel,
          variant === 'primary' && styles.btnLabelPrimary,
          variant === 'secondary' && styles.btnLabelSecondary,
          variant === 'ghost' && styles.btnLabelGhost,
        ]}>
        {label}
      </AppText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// WindowSelect — native replacement for the shared web <Select size="sm">.
// ---------------------------------------------------------------------------

interface WindowSelectOption {
  value: string;
  label: string;
}

interface WindowSelectProps {
  value: string;
  options: WindowSelectOption[];
  onValueChange: (value: string) => void;
  accessibilityLabel: string;
  testID?: string;
}

function WindowSelect({
  value,
  options,
  onValueChange,
  accessibilityLabel,
  testID,
}: WindowSelectProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find(o => o.value === value);
  const triggerLabel = selectedOption?.label ?? value;

  const choose = (next: string) => {
    setOpen(false);
    onValueChange(next);
  };

  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.selectTriggerPressed]}
        testID={testID}>
        <AppText numberOfLines={1} style={styles.selectTriggerText}>
          {triggerLabel}
        </AppText>
        <AppText accessible={false} allowFontScaling={false} style={styles.selectCaret}>
          {CHEVRON_GLYPH}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <View style={styles.popoverOverlay}>
          <Pressable
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="menu"
            style={styles.popoverMenu}
            testID={testID ? `${testID}-menu` : undefined}>
            {options.map(opt => {
              const isActive = opt.value === value;
              return (
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityState={{selected: isActive}}
                  key={opt.value}
                  onPress={() => choose(opt.value)}
                  style={({pressed}) => [
                    styles.popoverItem,
                    isActive && styles.popoverItemActive,
                    pressed && styles.popoverItemPressed,
                  ]}
                  testID={testID ? `${testID}-option-${opt.value}` : undefined}>
                  <AppText
                    style={[
                      styles.popoverItemText,
                      isActive && styles.popoverItemTextActive,
                    ]}>
                    {opt.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

export function LiveControls({
  isLive,
  onToggleLive,
  onStepPrev,
  onStepNext,
  canStepPrev = false,
  canStepNext = false,
  windowMinutes,
  onWindowChange,
  onClearBuffer,
  windowCount,
  totalCount,
  bufferCount,
  className: _className,
  style,
  testID = 'live-controls',
}: LiveControlsProps) {
  const inWindow = windowCount ?? bufferCount ?? 0;
  const total = totalCount ?? bufferCount ?? 0;
  const outside = Math.max(0, total - inWindow);
  const dual = totalCount != null || windowCount != null;

  const counterLabel =
    dual && outside > 0
      ? t('debugger.controls.bufferedDual', '{{inWindow}} in window · {{total}} in 24 h', {
          inWindow,
          total,
        })
      : t('debugger.controls.buffered', '{{n}} buffered', {n: inWindow});

  const tooltipLabel = t(
    'debugger.controls.bufferedTooltip',
    'Counts inside the {{minutes}}-minute Window dropdown. {{outside}} more transitions fetched in the last 24 h.',
    {minutes: windowMinutes, outside},
  );

  const handleWindowChange = useCallback(
    (next: string) => onWindowChange(Number(next)),
    [onWindowChange],
  );

  return (
    <View style={[styles.container, style]} testID={testID}>
      <ToolbarButton
        dot={isLive ? 'live' : 'idle'}
        label={t('debugger.controls.live', 'Live')}
        onPress={() => onToggleLive(true)}
        selected={isLive}
        testID="live-controls-live"
        variant={isLive ? 'primary' : 'secondary'}
      />
      <ToolbarButton
        label={t('debugger.controls.freeze', 'Freeze')}
        onPress={() => onToggleLive(false)}
        selected={!isLive}
        testID="live-controls-freeze"
        variant={!isLive ? 'primary' : 'secondary'}
      />

      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.divider}
      />

      <ToolbarButton
        accessibilityLabel={t('debugger.controls.stepPrev', 'Step to previous transition')}
        disabled={!canStepPrev}
        label={ARROW_PREV_GLYPH}
        onPress={onStepPrev}
        testID="live-controls-step-prev"
        variant="ghost"
      />
      <ToolbarButton
        accessibilityLabel={t('debugger.controls.stepNext', 'Step to next transition')}
        disabled={!canStepNext}
        label={ARROW_NEXT_GLYPH}
        onPress={onStepNext}
        testID="live-controls-step-next"
        variant="ghost"
      />

      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.divider}
      />

      <AppText style={styles.windowLabel}>{t('debugger.controls.window', 'Window')}</AppText>
      <WindowSelect
        accessibilityLabel={t('debugger.controls.window', 'Window')}
        onValueChange={handleWindowChange}
        options={WINDOW_OPTIONS}
        testID="live-controls-window"
        value={String(windowMinutes)}
      />
      <ToolbarButton
        label={t('debugger.controls.clear', 'Clear buffer')}
        onPress={onClearBuffer}
        testID="live-controls-clear"
        variant="ghost"
      />

      <View style={styles.counterWrap}>
        <HelpTooltip
          ariaLabel={counterLabel}
          testID="live-controls-counter"
          text={tooltipLabel}>
          <AppText style={styles.counterText} testID="live-controls-counter-label">
            {counterLabel}
          </AppText>
        </HelpTooltip>
      </View>
    </View>
  );
}

LiveControls.displayName = 'LiveControls';

const styles = StyleSheet.create({
  // flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)]
  // bg-white/[0.02] px-3 py-2
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: WHITE_FILL_02,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Button size="sm": h-8 px-3 text-xs rounded-md inline-flex items-center
  btn: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: 6,
  },
  btnPrimary: {
    backgroundColor: BLUE_600,
  },
  btnPrimaryPressed: {
    backgroundColor: BLUE_700,
  },
  btnSecondary: {
    backgroundColor: GRAY_700,
  },
  btnSecondaryPressed: {
    backgroundColor: GRAY_600,
  },
  btnGhost: {
    backgroundColor: 'transparent',
  },
  btnGhostPressed: {
    backgroundColor: GRAY_800,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  // text-xs font-medium
  btnLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  btnLabelPrimary: {
    color: '#ffffff',
  },
  btnLabelSecondary: {
    color: GRAY_100,
  },
  btnLabelGhost: {
    color: colors.textPrimary,
  },
  // mr-1.5 inline-block h-2 w-2 rounded-full
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  dotLive: {
    backgroundColor: EMERALD_300,
  },
  dotIdle: {
    backgroundColor: colors.surfaceRaised,
  },
  // mx-1 h-5 w-px bg-[var(--surface-2)]
  divider: {
    width: 1,
    height: 20,
    marginHorizontal: 4,
    backgroundColor: colors.surfaceRaised,
  },
  // Caption "Window" (hidden sm:inline on web; kept visible on native).
  windowLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  // Select size="sm": px-2 py-1.5 text-xs rounded-md border bg-[var(--surface-1)]
  selectTrigger: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selectTriggerPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  selectTriggerText: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  selectCaret: {
    fontSize: 10,
    lineHeight: 16,
    color: colors.textMuted,
  },
  // Transparent popover layer for the native Select (DashboardSettingsModal idiom).
  popoverOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: POPOVER_SCRIM,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  popoverMenu: {
    ...shadows.panel,
    minWidth: 168,
    maxHeight: '70%',
    paddingVertical: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  popoverItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  popoverItemActive: {
    backgroundColor: colors.surfaceSelected,
  },
  popoverItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  popoverItemText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  popoverItemTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  // ml-auto counter wrapper.
  counterWrap: {
    marginLeft: 'auto',
  },
  // Caption counter (cursor-help on web -> HelpTooltip press affordance).
  counterText: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
});

export default LiveControls;

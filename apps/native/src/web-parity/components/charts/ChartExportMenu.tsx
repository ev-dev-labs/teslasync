// Native parity port of web/src/components/charts/ChartExportMenu.tsx.
// Replaces DOM outside-click/Escape handling, lucide icons, and web toasts
// with a React Native modal menu, semantic glyph icons, and inline feedback.

import React, {useCallback, useState} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

export type ClipboardOutcome = 'copied' | 'fallback' | 'failed';

type NativeTFunction = (key: string, fallback: string) => string;

export interface ChartExportMenuProps {
  /** Triggered when "Save as PNG" is selected. */
  onExportPNG: () => void | Promise<void>;
  /** Triggered when "Save as SVG" is selected. */
  onExportSVG: () => void | Promise<void>;
  /**
   * Triggered when "Copy image to clipboard" is selected. Must resolve to one
   * of the ClipboardOutcome values so the menu can announce the result.
   */
  onCopyImage: () => Promise<ClipboardOutcome>;
  /** Optional CSV download -- when provided, "Download data as CSV" appears first. */
  onExportCsv?: () => void;
  /** Disable the trigger button while the chart is loading or empty. */
  disabled?: boolean;
  /** Disable image-capture items while a snapshot is in flight. CSV ignores this. */
  busy?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

export function ChartExportMenu({
  onExportPNG,
  onExportSVG,
  onCopyImage,
  onExportCsv,
  disabled = false,
  busy = false,
  className: _className,
  style,
  testID,
}: ChartExportMenuProps) {
  const t = useNativeTranslationFallback();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('info');

  const close = useCallback(() => setOpen(false), []);

  const triggerLabel = disabled
    ? t('chart.export.disabledTooltip', 'Chart not ready to export')
    : t('chart.export.menuLabel', 'Export chart');

  const showNotice = useCallback((message: string, tone: NoticeTone) => {
    setNotice(message);
    setNoticeTone(tone);
  }, []);

  const handlePng = useCallback(() => {
    close();
    void onExportPNG();
  }, [onExportPNG, close]);

  const handleSvg = useCallback(() => {
    close();
    void onExportSVG();
  }, [onExportSVG, close]);

  const handleCopy = useCallback(async () => {
    close();
    const result = await onCopyImage();
    if (result === 'copied') {
      showNotice(
        t('chart.export.copySuccess', 'Chart image copied to clipboard'),
        'success',
      );
    } else if (result === 'fallback') {
      showNotice(
        t(
          'chart.export.copyFallback',
          'Clipboard not available - image downloaded instead',
        ),
        'info',
      );
    } else {
      showNotice(
        t('chart.export.copyFailed', 'Failed to copy chart image'),
        'error',
      );
    }
  }, [onCopyImage, close, showNotice, t]);

  const handleCsv = useCallback(() => {
    if (!onExportCsv) {
      return;
    }
    close();
    onExportCsv();
  }, [onExportCsv, close]);

  const toggleOpen = useCallback(() => {
    if (disabled) {
      return;
    }
    setOpen(value => !value);
  }, [disabled]);

  return (
    <View style={[styles.root, style]} testID={testID ?? 'chart-export-menu'}>
      <Pressable
        accessibilityLabel={triggerLabel}
        accessibilityRole="button"
        accessibilityState={{disabled, expanded: open}}
        disabled={disabled}
        hitSlop={8}
        onPress={toggleOpen}
        style={({pressed}) => [
          styles.trigger,
          disabled && styles.disabled,
          pressed && !disabled && styles.pressed,
          open && !disabled && styles.triggerOpen,
        ]}>
        <SemanticIcon
          decorative
          name="download"
          size="sm"
          style={styles.triggerIcon}
        />
      </Pressable>

      {notice ? (
        <View
          accessibilityRole={noticeTone === 'error' ? 'alert' : 'text'}
          style={[styles.notice, noticeToneStyles[noticeTone]]}
          testID="chart-export-menu-notice">
          <AppText
            numberOfLines={2}
            style={[styles.noticeText, noticeTextToneStyles[noticeTone]]}
            variant="caption"
            weight="semibold">
            {notice}
          </AppText>
        </View>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open && !disabled}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel={t('chart.export.closeMenu', 'Close export menu')}
            accessibilityRole="button"
            onPress={close}
            style={styles.backdrop}
          />
          <View
            accessibilityLabel={t('chart.export.menuLabel', 'Export chart')}
            accessibilityRole="menu"
            style={styles.menu}
            testID="chart-export-menu-items">
            {onExportCsv ? (
              <MenuItem
                icon="fileSpreadsheet"
                label={t('chart.export.csv', 'Download data as CSV')}
                onPress={handleCsv}
              />
            ) : null}
            <MenuItem
              disabled={busy}
              icon="fileDown"
              label={t('chart.export.png', 'Save as PNG')}
              onPress={handlePng}
            />
            <MenuItem
              disabled={busy}
              icon="fileText"
              label={t('chart.export.svg', 'Save as SVG')}
              onPress={handleSvg}
            />
            <MenuItem
              disabled={busy}
              icon="copy"
              label={t('chart.export.copy', 'Copy image to clipboard')}
              onPress={handleCopy}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

ChartExportMenu.displayName = 'ChartExportMenu';

type NoticeTone = 'success' | 'info' | 'error';

interface MenuItemProps {
  disabled?: boolean;
  icon: SemanticIconName;
  label: string;
  onPress: () => void;
}

function MenuItem({disabled = false, icon, label, onPress}: MenuItemProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="menuitem"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.menuItem,
        disabled && styles.disabled,
        pressed && !disabled && styles.menuItemPressed,
      ]}>
      <SemanticIcon decorative name={icon} size="sm" style={styles.menuIcon} />
      <AppText
        numberOfLines={2}
        style={styles.menuLabel}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const noticeToneStyles = StyleSheet.create<Record<NoticeTone, ViewStyle>>({
  error: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  info: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

const noticeTextToneStyles = StyleSheet.create<Record<NoticeTone, TextStyle>>({
  error: {
    color: colors.danger,
  },
  info: {
    color: colors.accent,
  },
  success: {
    color: colors.success,
  },
});

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  disabled: {
    opacity: 0.48,
  },
  menu: {
    ...shadows.panel,
    alignSelf: 'flex-end',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.xs,
    marginRight: spacing.lg,
    marginTop: spacing.xxl,
    maxWidth: 260,
    minWidth: 224,
    padding: spacing.xs,
  },
  menuIcon: {
    flexShrink: 0,
  },
  menuItem: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  menuItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  menuLabel: {
    color: colors.textSecondary,
    flex: 1,
    minWidth: 0,
  },
  notice: {
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xs,
    maxWidth: 260,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  noticeText: {
    letterSpacing: 0.1,
  },
  overlay: {
    flex: 1,
    paddingTop: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  root: {
    alignItems: 'flex-end',
    position: 'relative',
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  triggerIcon: {
    borderWidth: 0,
  },
  triggerOpen: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
});

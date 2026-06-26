// Native parity port of web/src/components/ui/DataTableColumnsMenu.tsx.
//
// Popover with checkboxes for toggling DataTable column visibility. Persists
// nothing on its own — the owning DataTable holds the visible-key list and
// drives this control through `visibleKeys` + `onChange`, exactly like the web
// component.
//
// The web version anchors an absolutely-positioned `<div role="menu">` under a
// trigger `<button>` and closes it via a `document.addEventListener('mousedown',
// …)` outside-click handler plus an Escape `keydown` listener. React Native has
// no DOM `document`, `<div>`/`<button>`/`<input type="checkbox">`/`<label>`,
// lucide SVGs, the `@/lib/cn` Tailwind merge, or react-i18next, so the contract
// is reproduced with the established native menu idiom (see ChartExportMenu):
//   - The trigger becomes a <Pressable accessibilityRole="button"> carrying
//     accessibilityState={{expanded}} (mirrors aria-haspopup="menu" +
//     aria-expanded), with the lucide Columns3 affordance rendered as a small
//     U+25A5 (▥) text glyph next to the "Columns" caption. The optional
//     `trigger` render-prop is preserved verbatim and receives a toggle fn,
//     matching the web `trigger(() => setOpen(v => !v))`.
//   - The popover becomes a transparent fade <Modal>. The web outside-click
//     close maps onto a full-screen backdrop <Pressable> and the Escape close
//     maps onto the Modal's onRequestClose (Android back / desktop Escape).
//   - role="menu" + aria-label -> the panel View carries
//     accessibilityRole="menu" + accessibilityLabel.
//   - Each `<label><input type="checkbox">…</label>` row reuses the already-
//     ported shared native <Checkbox> (controlled `checked`, `disabled`,
//     `onChange`), so the toggle / disable-last-visible / required semantics
//     stay centralised rather than re-implemented here.
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next is not wired in native, so the web useTranslation() `t` is
//     replaced by a fallback that returns the English defaultValue; the same
//     i18n keys/copy (table.columns.menu/button/heading/showAll) are preserved.
//   - The Tailwind utility classes + CSS custom properties become StyleSheet
//     styles against theme tokens with the handful of literal white/cyan
//     overlays resolved inline. The optional web `className` is accepted-but-
//     ignored for source compatibility and mirrored by a native `style` prop.

import React, {useCallback, useMemo, useState, type ReactNode} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';
import {Checkbox} from './Checkbox';

export interface ColumnDescriptor {
  key: string;
  header: string;
  /** When true, this column cannot be hidden (e.g. selection / expand columns). */
  required?: boolean;
}

export interface DataTableColumnsMenuProps {
  columns: ColumnDescriptor[];
  visibleKeys: string[];
  onChange: (next: string[]) => void;
  /** Optional trigger render-prop. Defaults to a small "Columns" glyph button. */
  trigger?: (open: () => void) => ReactNode;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the root container (RN equivalent of `className`). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * Native i18n fallback: react-i18next is not wired in native, so this returns
 * the English defaultValue — preserving the web i18n keys and copy verbatim.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// lucide Columns3 affordance rendered as a centered text glyph.
const COLUMNS_GLYPH = '\u25A5'; // ▥ — vertical-fill square reads as table columns.

// Literal resolutions of the web Tailwind palette so visual intent survives
// without Tailwind: bg-white/[0.03] fill, hover bg-white/[0.06], border-white/
// [0.08] border, text-cyan-300 "Show all" link.
const TRIGGER_FILL = 'rgba(255, 255, 255, 0.03)';
const TRIGGER_FILL_PRESSED = 'rgba(255, 255, 255, 0.06)';
const HAIRLINE = 'rgba(255, 255, 255, 0.08)';
const CYAN_300 = '#67e8f9';

/**
 * Popover with checkboxes for toggling column visibility.
 *
 * Mirrors the web shared control: it owns no persistence, takes the current
 * `visibleKeys` + `columns`, and reports the next visible-key list via
 * `onChange`. Tapping the backdrop or pressing the platform back/Escape closes
 * the popover; toggling a column or "Show all" keeps it open (web parity).
 */
export function DataTableColumnsMenu({
  columns,
  visibleKeys,
  onChange,
  trigger,
  className: _className,
  style,
  testID,
}: DataTableColumnsMenuProps) {
  const t = useNativeTranslationFallback();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  const toggleOpen = useCallback(() => setOpen(value => !value), []);

  const visibleSet = useMemo(() => new Set(visibleKeys), [visibleKeys]);

  const toggle = useCallback(
    (key: string) => {
      if (visibleSet.has(key)) {
        // Don't allow hiding the last visible column — at least one must stay.
        if (visibleKeys.length <= 1) {
          return;
        }
        onChange(visibleKeys.filter(k => k !== key));
      } else {
        // Preserve original column order in the persisted list.
        const order = columns.map(c => c.key);
        onChange(order.filter(k => visibleSet.has(k) || k === key));
      }
    },
    [visibleSet, visibleKeys, columns, onChange],
  );

  const showAll = useCallback(
    () => onChange(columns.map(c => c.key)),
    [columns, onChange],
  );

  const menuLabel = t('table.columns.menu', 'Show or hide columns');

  return (
    <View style={[styles.root, style]} testID={testID}>
      {trigger ? (
        trigger(toggleOpen)
      ) : (
        <Pressable
          accessibilityLabel={menuLabel}
          accessibilityRole="button"
          accessibilityState={{expanded: open}}
          hitSlop={8}
          onPress={toggleOpen}
          style={({pressed}) => [
            styles.trigger,
            pressed && styles.triggerPressed,
          ]}
          testID={testID ? `${testID}-trigger` : undefined}>
          <AppText
            accessible={false}
            allowFontScaling={false}
            style={styles.triggerIcon}>
            {COLUMNS_GLYPH}
          </AppText>
          <AppText style={styles.triggerLabel} variant="caption">
            {t('table.columns.button', 'Columns')}
          </AppText>
        </Pressable>
      )}

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel={menuLabel}
            accessibilityRole="button"
            onPress={close}
            style={styles.backdrop}
          />
          <View
            accessibilityLabel={menuLabel}
            accessibilityRole="menu"
            style={styles.menu}
            testID={testID ? `${testID}-menu` : undefined}>
            <View style={styles.header}>
              <AppText style={styles.heading}>
                {t('table.columns.heading', 'Visible columns')}
              </AppText>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={showAll}
                style={({pressed}) => pressed && styles.showAllPressed}>
                <AppText style={styles.showAll} weight="semibold">
                  {t('table.columns.showAll', 'Show all')}
                </AppText>
              </Pressable>
            </View>
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              style={styles.list}>
              {columns.map(col => {
                const checked = visibleSet.has(col.key);
                const disabled =
                  Boolean(col.required) ||
                  (checked && visibleKeys.length <= 1);
                const headerLabel = col.header || col.key;
                return (
                  <Checkbox
                    accessibilityLabel={headerLabel}
                    checked={checked}
                    disabled={disabled}
                    key={col.key}
                    label={
                      <AppText
                        numberOfLines={1}
                        style={styles.rowLabel}
                        tone="secondary">
                        {headerLabel}
                      </AppText>
                    }
                    onChange={() => toggle(col.key)}
                    style={styles.row}
                  />
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

DataTableColumnsMenu.displayName = 'DataTableColumnsMenu';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  heading: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.6,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  list: {
    maxHeight: 256,
  },
  listContent: {
    gap: 2,
  },
  menu: {
    ...shadows.panel,
    alignSelf: 'flex-end',
    backgroundColor: colors.surface,
    borderColor: HAIRLINE,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: spacing.lg,
    marginTop: spacing.xxl,
    padding: spacing.sm,
    width: 224,
  },
  overlay: {
    flex: 1,
    paddingTop: spacing.lg,
  },
  root: {
    alignSelf: 'flex-start',
  },
  row: {
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  showAll: {
    color: CYAN_300,
    fontSize: 10,
  },
  showAllPressed: {
    opacity: 0.7,
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: TRIGGER_FILL,
    borderColor: HAIRLINE,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  triggerIcon: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 14,
  },
  triggerLabel: {
    color: colors.textSecondary,
  },
  triggerPressed: {
    backgroundColor: TRIGGER_FILL_PRESSED,
  },
});

export default DataTableColumnsMenu;

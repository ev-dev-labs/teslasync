/**
 * `ListExportMenu` — React Native parity port of
 * web/src/components/forms/ListExportMenu.tsx.
 *
 * CSV / JSON export control with an optional scope toggle. Distinct from
 * `ChartExportMenu` (chart images) — this one exports tabular row data and
 * lives in the list-controls strip on history pages (Drives, Charging, Trips).
 *
 * Behaviour (preserved verbatim from the web component):
 *   - Trigger is a download icon button.
 *   - Menu shows a "Visible (N)" radio + "Selected (M)" radio (when M > 0).
 *   - Then two file-format rows: CSV / JSON.
 *   - Both `onExportCsv` and `onExportJson` receive the chosen scope.
 *   - When the selection count drops to 0 mid-menu, the scope snaps back to
 *     'visible' so the chosen scope can never become unselectable.
 *
 * The component is purely presentational: the caller serialises the data,
 * generates the filename, and triggers the actual download/share.
 *
 * Browser-only dependencies are reduced explicitly and documented in the
 * `.parity.json` sidecar:
 *   - react-i18next `useTranslation`: replaced by a native-safe
 *     `t(key, fallback, params?)` that interpolates i18next-style `{{count}}`
 *     placeholders, keeping the i18n intent + every translation key.
 *   - lucide-react `Download` / `FileSpreadsheet` / `FileJson`: rendered via the
 *     existing `SemanticIcon` (download / fileSpreadsheet / fileJson), decorative.
 *     `ListChecks` has no semantic-icon name, so the scope legend marker is a
 *     decorative `AppText` glyph (the label text carries the meaning).
 *   - `@/components/ui` `Button`: replaced by a `Pressable` styled from tokens.
 *   - The absolutely-positioned `<div role="menu">` dropdown plus the
 *     `document` `mousedown` (click-outside) + `keydown` Escape listeners are
 *     replaced by a React Native `<Modal>` with a full-screen backdrop
 *     `Pressable` (outside tap → close) and `onRequestClose` (Android back ≈
 *     Escape). The web `containerRef` (used only for click-outside hit-testing)
 *     becomes a `triggerRef` measured on open to anchor the dropdown.
 *   - `<fieldset>` / `<label>` / `<input type="radio">` become `View` /
 *     `Pressable` (accessibilityRole="radio") with a custom dot indicator.
 *   - `className` is retained on the props for source compatibility but ignored
 *     on native; `testId` maps to RN `testID`.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// ── native translation fallback (native-safe port of react-i18next) ──
type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, params?: NativeTParams) =>
      interpolate(fallback, params),
    [],
  );
}

export type ExportScope = 'visible' | 'selected';

export interface ListExportMenuProps {
  /** Triggered when "Download as CSV" is selected. */
  onExportCsv: (scope: ExportScope) => void | Promise<void>;
  /** Triggered when "Download as JSON" is selected. */
  onExportJson: (scope: ExportScope) => void | Promise<void>;
  /**
   * Number of rows currently selected. When > 0, an extra "Selected only"
   * radio appears so the user can scope the export. Pass `0` to hide it
   * (export will always cover the visible result set).
   */
  selectedCount?: number;
  /** Number of visible (filtered) rows — used for the All… count. */
  visibleCount?: number;
  /** Disable the trigger (e.g. while data is loading or empty). */
  disabled?: boolean;
  /** Retained for source compatibility with the web Tailwind API; ignored on native. */
  className?: string;
  testId?: string;
}

/** Width of the dropdown (web `w-56` = 14rem = 224px). */
const MENU_WIDTH = 224;

interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * `ListExportMenu` — CSV / JSON export with optional scope toggle.
 *
 * See the file header for the full behavioural contract and the list of
 * browser-only dependencies that were reduced for native.
 */
export function ListExportMenu({
  onExportCsv,
  onExportJson,
  selectedCount = 0,
  visibleCount,
  disabled = false,
  className: _className,
  testId,
}: ListExportMenuProps) {
  const t = useNativeTranslationFallback();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ExportScope>(
    selectedCount > 0 ? 'selected' : 'visible',
  );
  // Replaces the web `containerRef` (HTMLDivElement). The web ref existed only
  // for `mousedown` click-outside hit-testing — handled here by the Modal
  // backdrop — so on native it is used to measure the trigger and anchor the
  // dropdown below/right of it (the web `absolute right-0 mt-1`).
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

  const close = useCallback(() => setOpen(false), []);

  // When the selection count drops to 0 mid-menu, snap back to 'visible'
  // so the chosen scope can never be unselectable.
  useEffect(() => {
    if (selectedCount === 0 && scope === 'selected') {
      setScope('visible');
    }
  }, [selectedCount, scope]);

  const triggerLabel = disabled
    ? t('listExport.disabledTooltip', 'No data to export')
    : t('listExport.menuLabel', 'Export list');

  const visibleLabel =
    visibleCount != null
      ? t('listExport.visibleWithCount', 'Visible ({{count}})', {
          count: visibleCount,
        })
      : t('listExport.visible', 'Visible');
  const selectedLabel = t(
    'listExport.selectedWithCount',
    'Selected ({{count}})',
    {count: selectedCount},
  );

  const handleCsv = useCallback(() => {
    close();
    void onExportCsv(scope);
  }, [close, onExportCsv, scope]);
  const handleJson = useCallback(() => {
    close();
    void onExportJson(scope);
  }, [close, onExportJson, scope]);

  const toggle = useCallback(() => {
    if (disabled) {
      return;
    }
    if (open) {
      close();
      return;
    }
    // Measure the trigger so the dropdown can anchor to it (web `right-0 mt-1`).
    // In test / headless environments measureInWindow is a no-op; the menu then
    // falls back to a sensible top-right position.
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({x, y, width, height});
    });
    setOpen(true);
  }, [close, disabled, open]);

  const menuPosition = useMemo<StyleProp<ViewStyle>>(() => {
    if (!anchor) {
      return {top: spacing.xxl, right: spacing.md};
    }
    const left = Math.max(spacing.sm, anchor.x + anchor.width - MENU_WIDTH);
    return {top: anchor.y + anchor.height + spacing.xs, left};
  }, [anchor]);

  return (
    <View style={styles.root} testID={testId}>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={triggerLabel}
        accessibilityState={{disabled, expanded: open}}
        disabled={disabled}
        hitSlop={6}
        onPress={toggle}
        style={({pressed}) => [
          styles.trigger,
          disabled && styles.triggerDisabled,
          pressed && !disabled && styles.pressed,
        ]}
        testID={testId ? `${testId}-trigger` : undefined}>
        <SemanticIcon decorative name="download" size="sm" />
        <AppText style={styles.triggerText} variant="caption" weight="semibold">
          {t('listExport.button', 'Export')}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open && !disabled}>
        {/* Backdrop tap closes the menu — native analog of the web
            `document` mousedown click-outside listener. */}
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={close}
          style={styles.backdrop}
          testID={testId ? `${testId}-backdrop` : undefined}
        />
        <View
          accessibilityLabel={triggerLabel}
          accessibilityRole="menu"
          accessibilityViewIsModal
          style={[styles.menu, menuPosition]}
          testID={testId ? `${testId}-menu` : undefined}>
          {selectedCount > 0 ? (
            <View
              accessibilityLabel={t('listExport.scopeLegend', 'Export scope')}
              style={styles.scopeSection}>
              <View style={styles.legendRow}>
                <AppText
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.legendGlyph}>
                  {'\u2611'}
                </AppText>
                <AppText style={styles.legendText} weight="semibold">
                  {t('listExport.scopeLegend', 'Export scope')}
                </AppText>
              </View>
              <ScopeRadio
                checked={scope === 'visible'}
                label={visibleLabel}
                onChange={() => setScope('visible')}
                testId={testId ? `${testId}-scope-visible` : undefined}
              />
              <ScopeRadio
                checked={scope === 'selected'}
                label={selectedLabel}
                onChange={() => setScope('selected')}
                testId={testId ? `${testId}-scope-selected` : undefined}
              />
            </View>
          ) : null}

          <Pressable
            accessibilityRole="menuitem"
            onPress={handleCsv}
            style={({pressed}) => [
              styles.menuItem,
              pressed && styles.menuItemPressed,
            ]}
            testID={testId ? `${testId}-csv` : undefined}>
            <SemanticIcon decorative name="fileSpreadsheet" size="sm" />
            <AppText style={styles.menuItemText}>
              {t('listExport.csv', 'Download as CSV')}
            </AppText>
          </Pressable>

          <Pressable
            accessibilityRole="menuitem"
            onPress={handleJson}
            style={({pressed}) => [
              styles.menuItem,
              pressed && styles.menuItemPressed,
            ]}
            testID={testId ? `${testId}-json` : undefined}>
            <SemanticIcon decorative name="fileJson" size="sm" />
            <AppText style={styles.menuItemText}>
              {t('listExport.json', 'Download as JSON')}
            </AppText>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

ListExportMenu.displayName = 'ListExportMenu';

interface ScopeRadioProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  testId?: string;
}

function ScopeRadio({checked, onChange, label, testId}: ScopeRadioProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="radio"
      accessibilityState={{checked}}
      onPress={onChange}
      style={({pressed}) => [styles.radioRow, pressed && styles.menuItemPressed]}
      testID={testId}>
      <View style={[styles.radioOuter, checked && styles.radioOuterChecked]}>
        {checked ? <View style={styles.radioDot} /> : null}
      </View>
      <AppText style={styles.radioLabel} variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'flex-start',
    position: 'relative',
  },
  trigger: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  triggerDisabled: {
    opacity: 0.48,
  },
  triggerText: {
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.82,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  menu: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    elevation: 12,
    padding: spacing.sm,
    position: 'absolute',
    // Soft elevation for the floating menu (web `shadow-xl`).
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 0.34,
    shadowRadius: 18,
    width: MENU_WIDTH,
  },
  scopeSection: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
  },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  legendGlyph: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  legendText: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.6,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  menuItem: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  menuItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  menuItemText: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  radioRow: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  radioOuter: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  radioOuterChecked: {
    borderColor: colors.accent,
  },
  radioDot: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  radioLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
});

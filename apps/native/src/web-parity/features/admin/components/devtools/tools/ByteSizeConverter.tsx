// Native parity port of
// web/src/features/admin/components/devtools/tools/ByteSizeConverter.tsx.
//
// The web tool is a developer utility card: type a number, pick a byte unit
// (B/KB/MB/GB/TB), and see the value rendered in every other unit at once
// (base-1024 powers, 4 decimals except bytes). It is reproduced here with
// React Native primitives, preserving the `value`/`unit` state, the i18n key
// strings, the conversion math, and the cyan HardDrive visual intent:
//
//   - The web `@/components/ui/Input` (a DOM `<input>` with a leading icon) is
//     browser-only and becomes a labelled `TextInput` with a leading HardDrive
//     glyph. `onChange={e => setValue(e.target.value)}` maps to
//     `onChangeText={setValue}`. A numeric keyboard is requested since the
//     field only ever holds a parseFloat-able byte count (placeholder "1024").
//   - The web `@/components/ui/Select` (a DOM `<select>`) is browser-only and is
//     replaced by a trigger `Pressable` + `Modal` option list — the same
//     pattern the native SortControl / VehiclePicker parity ports use. Picking
//     an option runs the web `onChange` body verbatim (`setUnit(value)`).
//   - The lucide `HardDrive` icon (browser-only) becomes a compact "HD" glyph,
//     rendered cyan in the card badge (mirroring the web `color="cyan"` ->
//     `ICON_COLOR_MAP.cyan` accent tint) and muted as the input's leading icon.
//   - react-i18next `useTranslation` is not a native-parity dependency; a local
//     t() shim returns the fallback (the source passes the English copy as the
//     key, so the key is preserved verbatim as the visible string).
//   - `ToolCard` (`../ToolCard`) and `BYTE_UNITS` (`../constants`) have not yet
//     been ported to native; their standalone modules are separate conversion
//     targets in this file-by-file loop, so a self-contained native ToolCard
//     equivalent and the `BYTE_UNITS` tuple are inlined here (the same
//     inlining precedent set by the converted devtools/helpers.ts). The
//     `ICON_COLOR_MAP` cyan/green/purple/amber/red tints are reproduced as a
//     local token map.
//   - `fmtNumber` from `@/lib/numberFormat` is inlined as a native-safe
//     fmtNumber/safeNumber (same toLocaleString min/maxFractionDigits behaviour
//     and en-US fallback), matching the existing Energy/Temperature parity
//     ports. The `cn` Tailwind merge is web-only and is dropped in favour of
//     RN style arrays.

import React, {useMemo, useState, type ReactNode} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {SemanticIcon} from '../../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../../theme/tokens';

/* ─── inlined constants (web `../constants`) ──────────────────────────────── */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

type ByteUnit = (typeof BYTE_UNITS)[number];

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (key: string, fallback?: string) => fallback ?? key;
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ─────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

/* ─── ToolCard equivalent (web `../ToolCard` + `ICON_COLOR_MAP`) ───────────── */

type ToolColor = 'cyan' | 'green' | 'purple' | 'amber' | 'red';

interface ToolTint {
  surface: string;
  border: string;
  glyph: string;
}

const TOOL_TINTS: Record<ToolColor, ToolTint> = {
  cyan: {
    surface: colors.accentSoft,
    border: colors.borderAccent,
    glyph: colors.accent,
  },
  green: {
    surface: colors.successSurface,
    border: colors.successBorder,
    glyph: colors.success,
  },
  purple: {
    surface: colors.violetSurface,
    border: colors.violetBorder,
    glyph: colors.violet,
  },
  amber: {
    surface: colors.warningSurface,
    border: colors.warningBorder,
    glyph: colors.warning,
  },
  red: {
    surface: colors.dangerSurface,
    border: colors.dangerBorder,
    glyph: colors.danger,
  },
};

interface ToolCardProps {
  iconGlyph: string;
  color: ToolColor;
  title: string;
  description: string;
  children: ReactNode;
}

function ToolCard({iconGlyph, color, title, description, children}: ToolCardProps) {
  const tint = TOOL_TINTS[color] ?? TOOL_TINTS.cyan;
  return (
    <GlassPanel style={styles.card}>
      <View style={styles.cardHeader}>
        <View
          style={[
            styles.iconBadge,
            {backgroundColor: tint.surface, borderColor: tint.border},
          ]}>
          <AppText style={[styles.iconBadgeGlyph, {color: tint.glyph}]} weight="bold">
            {iconGlyph}
          </AppText>
        </View>
        <View style={styles.cardHeaderText}>
          <AppText variant="body" weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.cardDesc} tone="secondary" variant="caption">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

ToolCard.displayName = 'ToolCard';

/* ─── ByteSizeConverterTool ────────────────────────────────────────────────── */

export function ByteSizeConverterTool() {
  const t = useNativeTranslationFallback();
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<ByteUnit>('B');
  const [pickerOpen, setPickerOpen] = useState(false);

  const conversions = useMemo(() => {
    const num = parseFloat(value);
    if (isNaN(num)) {
      return null;
    }
    const unitIdx = BYTE_UNITS.indexOf(unit);
    if (unitIdx < 0) {
      return null;
    }
    const bytes = num * Math.pow(1024, unitIdx);
    return BYTE_UNITS.map((u, i) => ({
      unit: u,
      value: fmtNumber(bytes / Math.pow(1024, i), i === 0 ? 0 : 4),
    }));
  }, [value, unit]);

  const unitOptions = BYTE_UNITS.map(u => ({value: u, label: u}));

  return (
    <ToolCard
      iconGlyph="HD"
      color="cyan"
      title={t('Byte Size')}
      description={t('Byte Size Desc')}>
      <View style={styles.body}>
        <View style={styles.fields}>
          <View style={styles.field}>
            <AppText style={styles.label} tone="secondary" variant="caption">
              {t('Value')}
            </AppText>
            <View style={styles.inputRow}>
              <SemanticIcon decorative name="hardDrive" size="sm" style={styles.inputIcon} />
              <TextInput
                keyboardType="numeric"
                onChangeText={setValue}
                placeholder="1024"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                value={value}
              />
            </View>
          </View>

          <View style={styles.field}>
            <AppText style={styles.label} tone="secondary" variant="caption">
              {t('Unit')}
            </AppText>
            <Pressable
              accessibilityLabel={t('Unit')}
              accessibilityRole="button"
              accessibilityState={{expanded: pickerOpen}}
              onPress={() => setPickerOpen(true)}
              style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}>
              <AppText style={styles.selectValue} variant="caption" weight="semibold">
                {unit}
              </AppText>
              <AppText style={styles.caret} variant="caption">
                {'\u25BE'}
              </AppText>
            </Pressable>
          </View>
        </View>

        {conversions ? (
          <View style={styles.grid}>
            {conversions.map(c => {
              const active = c.unit === unit;
              return (
                <View
                  key={c.unit}
                  style={[styles.cell, active ? styles.cellActive : styles.cellIdle]}>
                  <AppText style={styles.cellUnit} tone="secondary" variant="caption">
                    {c.unit}
                  </AppText>
                  <AppText
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    style={styles.cellValue}>
                    {c.value}
                  </AppText>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
        transparent
        visible={pickerOpen}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityLabel={t('Unit')}
            accessibilityRole="button"
            onPress={() => setPickerOpen(false)}
            style={styles.backdrop}
          />
          <View accessibilityRole="menu" style={styles.menu}>
            {unitOptions.map(option => {
              const active = option.value === unit;
              return (
                <Pressable
                  accessibilityLabel={option.label}
                  accessibilityRole="menuitem"
                  accessibilityState={{selected: active}}
                  key={option.value}
                  onPress={() => {
                    setUnit(option.value);
                    setPickerOpen(false);
                  }}
                  style={({pressed}) => [
                    styles.option,
                    active && styles.optionActive,
                    pressed && styles.optionPressed,
                  ]}>
                  <AppText
                    style={[styles.optionText, active && styles.optionTextActive]}
                    variant="caption"
                    weight="semibold">
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </ToolCard>
  );
}

ByteSizeConverterTool.displayName = 'ByteSizeConverterTool';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    gap: spacing.md,
  },
  caret: {
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },
  card: {
    padding: spacing.lg,
  },
  cardDesc: {
    marginTop: 2,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  cardHeaderText: {
    flexShrink: 1,
  },
  cell: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  cellActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  cellIdle: {
    backgroundColor: colors.surfaceRaised,
    borderColor: 'transparent',
  },
  cellUnit: {
    marginBottom: 2,
  },
  cellValue: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 16,
  },
  field: {
    flex: 1,
    gap: spacing.xs,
  },
  fields: {
    gap: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconBadgeGlyph: {
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    padding: 0,
  },
  inputIcon: {
    marginRight: spacing.sm,
  },
  inputRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  label: {
    marginBottom: 2,
  },
  menu: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.xs,
    maxWidth: 320,
    minWidth: 200,
    padding: spacing.xs,
    width: '70%',
  },
  option: {
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  optionActive: {
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionText: {
    color: colors.textSecondary,
  },
  optionTextActive: {
    color: colors.accent,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  selectValue: {
    color: colors.textPrimary,
  },
});

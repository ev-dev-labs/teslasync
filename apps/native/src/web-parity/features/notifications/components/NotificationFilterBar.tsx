// Native parity port of
// web/src/features/notifications/components/NotificationFilterBar.tsx.
//
// NotificationFilterBar — the fully-controlled controls for the notifications
// inbox. The parent owns the `NotificationFilters` state; this component emits
// `onChange` patches that the parent merges in. The wired controls are kept 1:1
// with the web original:
//   - Severity chips (info/warn/critical) — multi-select toggle.
//   - Vehicle single-select ("All vehicles" option).
//   - Rule single-select ("All rules" option).
//   - Debounced message-text search.
//   - From/To date range (ISO `YYYY-MM-DD`).
//   - Active-filter chips with per-chip remove + "Clear all".
//
// Web -> native mapping (each web dependency documented here + in the sidecar):
//   - react-i18next useTranslation (web L15, L44) -> inlined
//     useNativeTranslationFallback(): a stable (key, fallback) => fallback shim
//     so every t('notifications.inbox.filter.*', 'English') call keeps its
//     English default + translation-key intent (matches the VehicleSelect /
//     DatePresetChips / BrowserPushChannelCard parity precedent).
//   - lucide-react Info / AlertTriangle / AlertOctagon (web L16) -> per-severity
//     colored leading dots (info -> accent, warn -> warning, critical -> danger).
//     The SemanticIcon boxed glyph is sized for header/action affordances and is
//     too large for an inline chip, so the color-coded dot + the distinct label
//     carry the same severity differentiation the lucide icons did.
//   - cn from @/lib/cn (web L17) -> StyleSheet arrays; the web className becomes
//     native style composition (React Native has no className / utility classes).
//   - Select from @/components/ui (web L18) -> the inline NativeSelect below: a
//     Pressable trigger that opens a Modal single-select list (the same picker
//     pattern proven in the VehicleSelect parity port). The DOM <select> has no
//     native analogue; value / onChange(value) / options / aria-label semantics
//     are all preserved.
//   - FilterBar / SearchInput / RangePicker / ActiveFilterChips +
//     FilterChipDescriptor from @/components/forms (web L19) -> inlined
//     native-safe implementations (none of these are ported yet), each kept
//     behaviourally faithful:
//       * FilterBar -> a flex-wrap row container.
//       * SearchInput -> a debounced TextInput (250ms, web default) with a
//         leading magnifier glyph + clear button. The web localStorage-backed
//         recent-searches dropdown (@/lib/searchHistory, historyScope) is a
//         browser-only affordance and is omitted with no native dependency.
//       * RangePicker -> two From/To `YYYY-MM-DD` TextInput fields. The web
//         react-day-picker calendar popover (+ presets + compare toggle) is
//         DOM-only; the value `{start, end}` ISO contract and the onChange
//         (setFrom(r.start)/setTo(r.end)) wiring are preserved verbatim. A side
//         only propagates to the parent when it is empty (clear) or a complete
//         ISO date, mirroring the web "commit a valid range" semantics.
//       * ActiveFilterChips -> a flex-wrap row of label:value chips with a
//         per-chip remove (×) + a "Clear all" button. FilterChipDescriptor is
//         redeclared inline. The web overflow "+N more" popover (maxVisible=8),
//         the VisuallyHidden a11y live region, and the Backspace/Delete keyboard
//         removal are DOM/keyboard-only; this bar emits at most 6 chips (well
//         under 8) so every chip renders inline.
//   - NotificationFilters type (web L20) -> imported from the ported native
//     api/hooks/useNotifications (identical shape).
//   - Vehicle / AlertRule types (web L21) -> imported from the ported native
//     api/types (identical shape).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported — only react, react-native
// primitives, the shared native AppText, and the theme tokens.

import React, {useCallback, useEffect, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import type {NotificationFilters} from '../../../api/hooks/useNotifications';
import type {AlertRule, Vehicle} from '../../../api/types';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_GLYPH = '\u{1F50D}'; // 🔍 — web lucide Search affix.
const CLEAR_GLYPH = '\u00D7'; // × — web lucide X clear/remove affix.
const CALENDAR_GLYPH = '\u{1F4C5}'; // 📅 — web lucide Calendar affix.
const CHEVRON_GLYPH = '\u2304'; // ⌄ — Select trigger chevron.
const CHECK_GLYPH = '\u2713'; // ✓ — selected-option marker.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Inlined react-i18next fallback: returns the web English fallback copy verbatim
 * (no interpolation is needed in this file), matching the established parity
 * ports (VehicleSelect / DatePresetChips / BrowserPushChannelCard).
 */
function useNativeTranslationFallback(): (
  key: string,
  fallback: string,
) => string {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Severity options (web L23-29). The lucide Info / AlertTriangle / AlertOctagon
// icons + tailwind ring/bg/text class triplets degrade to a per-severity colored
// dot + the per-severity active surface/text resolved from the native tokens.
const SEVERITY_OPTIONS = [
  {value: 'info', label: 'Info'},
  {value: 'warn', label: 'Warn'},
  {value: 'critical', label: 'Critical'},
] as const;

type Severity = (typeof SEVERITY_OPTIONS)[number]['value'];

interface SelectOption {
  value: string;
  label: string;
}

/**
 * Native analogue of the shared web <Select> (a styled DOM <select>): a Pressable
 * trigger that opens a Modal single-select list. Mirrors the VehicleSelect parity
 * port. value / onValueChange / options / accessibilityLabel are preserved.
 */
function NativeSelect({
  options,
  value,
  onValueChange,
  accessibilityLabel,
  testID,
}: {
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = options.find(o => o.value === value) ?? options[0];

  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={({pressed}) => [
          styles.selectTrigger,
          pressed && styles.pressed,
        ]}
        testID={testID}>
        <AppText numberOfLines={1} style={styles.selectLabel}>
          {selectedOption?.label ?? accessibilityLabel}
        </AppText>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.selectChevron}>
          {CHEVRON_GLYPH}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.menu} onPress={() => undefined}>
            <ScrollView style={styles.menuList}>
              {options.map(opt => {
                const selected = opt.value === value;
                return (
                  <Pressable
                    accessibilityLabel={opt.label}
                    accessibilityRole="button"
                    accessibilityState={{selected}}
                    key={opt.value || '__all__'}
                    onPress={() => {
                      onValueChange(opt.value);
                      setOpen(false);
                    }}
                    style={({pressed}) => [
                      styles.option,
                      selected && styles.optionSelected,
                      pressed && styles.optionPressed,
                    ]}
                    testID={testID ? `${testID}-option-${opt.value}` : undefined}>
                    <AppText
                      numberOfLines={1}
                      style={[
                        styles.optionLabel,
                        selected && styles.optionLabelSelected,
                      ]}
                      weight={selected ? 'semibold' : 'regular'}>
                      {opt.label}
                    </AppText>
                    {selected ? (
                      <AppText style={styles.check}>{CHECK_GLYPH}</AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Native analogue of the shared web <SearchInput>: a debounced TextInput with a
 * leading magnifier glyph + a clear button. The 250ms debounce (web default) and
 * the controlled value/onChange contract are preserved; onChange emits the raw
 * (untrimmed) text so the parent's setQuery() can own the trim, matching web.
 * The web localStorage recent-searches dropdown (historyScope) is browser-only
 * and intentionally omitted.
 */
function SearchField({
  value,
  onChange,
  placeholder,
  accessibilityLabel,
  clearLabel,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  accessibilityLabel: string;
  clearLabel: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [local, setLocal] = useState(value);

  // Re-sync from the parent when the controlled value changes externally
  // (e.g. the consumer resets the filter via a chip removal / clear-all).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  // Debounce: only emit onChange once typing pauses for SEARCH_DEBOUNCE_MS.
  useEffect(() => {
    if (local === value) {
      return;
    }
    const id = setTimeout(() => onChange(local), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [local, value, onChange]);

  return (
    <View style={[styles.searchRow, style]}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.fieldGlyph}>
        {SEARCH_GLYPH}
      </AppText>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        onChangeText={setLocal}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.fieldInput}
        value={local}
      />
      {local ? (
        <Pressable
          accessibilityLabel={clearLabel}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setLocal('')}
          style={({pressed}) => [styles.searchClear, pressed && styles.pressed]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.searchClearGlyph}>
            {CLEAR_GLYPH}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

interface RangeValue {
  start: string;
  end: string;
}

/**
 * Native analogue of the shared web <RangePicker>: From/To `YYYY-MM-DD` text
 * fields. The web react-day-picker calendar popover (+ presets + compare toggle)
 * is DOM-only and has no native renderer, so dates are edited as ISO text. The
 * value `{start, end}` contract and onChange wiring are preserved; a side only
 * propagates to the parent when it is empty (clear) or a complete ISO date,
 * mirroring the web "only a committed valid range reaches the parent" semantics.
 */
function RangeField({
  value,
  onChange,
  fromLabel,
  toLabel,
}: {
  value: RangeValue;
  onChange: (value: RangeValue) => void;
  fromLabel: string;
  toLabel: string;
}) {
  const [startText, setStartText] = useState(value.start);
  const [endText, setEndText] = useState(value.end);

  useEffect(() => {
    setStartText(value.start);
  }, [value.start]);
  useEffect(() => {
    setEndText(value.end);
  }, [value.end]);

  const handleStart = (text: string) => {
    setStartText(text);
    if (text === '' || ISO_DATE.test(text)) {
      onChange({start: text, end: value.end});
    }
  };

  const handleEnd = (text: string) => {
    setEndText(text);
    if (text === '' || ISO_DATE.test(text)) {
      onChange({start: value.start, end: text});
    }
  };

  return (
    <View style={styles.rangeRow}>
      <View style={styles.rangeField}>
        <AppText style={styles.rangeLabel}>{fromLabel}</AppText>
        <View style={styles.fieldRow}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.fieldGlyph}>
            {CALENDAR_GLYPH}
          </AppText>
          <TextInput
            accessibilityLabel={fromLabel}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            onChangeText={handleStart}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            style={styles.fieldInput}
            value={startText}
          />
        </View>
      </View>

      <View style={styles.rangeField}>
        <AppText style={styles.rangeLabel}>{toLabel}</AppText>
        <View style={styles.fieldRow}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.fieldGlyph}>
            {CALENDAR_GLYPH}
          </AppText>
          <TextInput
            accessibilityLabel={toLabel}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            onChangeText={handleEnd}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            style={styles.fieldInput}
            value={endText}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Inline FilterChipDescriptor — redeclared from the web @/components/forms type
 * (the source imports it as a type only).
 */
interface FilterChipDescriptor {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

/**
 * Native analogue of the shared web <ActiveFilterChips>: a row of label:value
 * chips, each with a remove (×) button, plus a "Clear all" affordance. The web
 * overflow "+N more" popover, the VisuallyHidden live region, and the keyboard
 * removal are DOM/keyboard-only and omitted (this bar emits <=6 chips).
 */
function ActiveFilterChips({
  filters,
  onClearAll,
  activeLabel,
  clearAllLabel,
  removeLabel,
}: {
  filters: readonly FilterChipDescriptor[];
  onClearAll: () => void;
  activeLabel: string;
  clearAllLabel: string;
  removeLabel: (label: string) => string;
}) {
  if (filters.length === 0) {
    return null;
  }

  return (
    <View
      accessibilityLabel={activeLabel}
      accessibilityRole="summary"
      style={styles.chipsRow}
      testID="active-filter-chips">
      {filters.map(descriptor => (
        <View key={descriptor.key} style={styles.chip}>
          <AppText numberOfLines={1} style={styles.chipText}>
            <AppText style={styles.chipLabel}>{descriptor.label}: </AppText>
            <AppText style={styles.chipValue}>{descriptor.value}</AppText>
          </AppText>
          <Pressable
            accessibilityLabel={removeLabel(descriptor.label)}
            accessibilityRole="button"
            hitSlop={8}
            onPress={descriptor.onRemove}
            style={({pressed}) => [
              styles.chipRemove,
              pressed && styles.pressed,
            ]}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.chipRemoveGlyph}>
              {CLEAR_GLYPH}
            </AppText>
          </Pressable>
        </View>
      ))}

      <Pressable
        accessibilityLabel={clearAllLabel}
        accessibilityRole="button"
        onPress={onClearAll}
        style={({pressed}) => [styles.clearAll, pressed && styles.pressed]}>
        <AppText style={styles.clearAllLabel}>{clearAllLabel}</AppText>
      </Pressable>
    </View>
  );
}

export interface NotificationFilterBarProps {
  filters: NotificationFilters;
  onChange: (next: NotificationFilters) => void;
  vehicles: Vehicle[];
  rules: AlertRule[];
}

export function NotificationFilterBar({
  filters,
  onChange,
  vehicles,
  rules,
}: NotificationFilterBarProps) {
  const t = useNativeTranslationFallback();

  const toggleSeverity = (sev: Severity) => {
    const current = filters.severity ?? [];
    const next = current.includes(sev)
      ? current.filter(s => s !== sev)
      : [...current, sev];
    onChange({...filters, severity: next.length ? next : undefined});
  };

  const setVehicle = (value: string) => {
    const id = value ? Number(value) : undefined;
    onChange({...filters, vehicle_id: id ? [id] : undefined});
  };

  const setRule = (value: string) => {
    const id = value ? Number(value) : undefined;
    onChange({...filters, rule_id: id ? [id] : undefined});
  };

  const setQuery = (q: string) => {
    onChange({...filters, q: q.trim() ? q : undefined});
  };

  const setFrom = (date: string) => {
    onChange({...filters, from: date || undefined});
  };
  const setTo = (date: string) => {
    onChange({...filters, to: date || undefined});
  };

  const selectedSeverities = new Set<Severity>(filters.severity ?? []);

  const vehicleOptions: SelectOption[] = [
    {value: '', label: t('notifications.inbox.filter.allVehicles', 'All vehicles')},
    ...vehicles.map(v => ({value: String(v.id), label: v.display_name || `#${v.id}`})),
  ];

  const ruleOptions: SelectOption[] = [
    {value: '', label: t('notifications.inbox.filter.allRules', 'All rules')},
    ...rules.map(r => ({value: String(r.id), label: r.name})),
  ];

  const severityLabels: Record<Severity, string> = {
    info: t('notifications.inbox.filter.severity.info', 'Info'),
    warn: t('notifications.inbox.filter.severity.warn', 'Warn'),
    critical: t('notifications.inbox.filter.severity.critical', 'Critical'),
  };

  const activeFilterChips: FilterChipDescriptor[] = [];
  if (filters.severity?.length) {
    const summary = filters.severity.map(s => severityLabels[s]).join(', ');
    activeFilterChips.push({
      key: 'severity',
      label: t('notifications.inbox.filter.severity', 'Severity'),
      value: summary,
      onRemove: () => onChange({...filters, severity: undefined}),
    });
  }
  if (filters.vehicle_id?.length) {
    const id = filters.vehicle_id[0];
    const match = vehicles.find(v => v.id === id);
    activeFilterChips.push({
      key: 'vehicle_id',
      label: t('notifications.inbox.filter.vehicle', 'Vehicle'),
      value: match?.display_name || `#${id}`,
      onRemove: () => onChange({...filters, vehicle_id: undefined}),
    });
  }
  if (filters.rule_id?.length) {
    const id = filters.rule_id[0];
    const match = rules.find(r => r.id === id);
    activeFilterChips.push({
      key: 'rule_id',
      label: t('notifications.inbox.filter.rule', 'Rule'),
      value: match?.name || `#${id}`,
      onRemove: () => onChange({...filters, rule_id: undefined}),
    });
  }
  if (filters.q) {
    activeFilterChips.push({
      key: 'q',
      label: t('notifications.inbox.filter.searchLabel', 'Search'),
      value: filters.q,
      onRemove: () => onChange({...filters, q: undefined}),
    });
  }
  if (filters.from) {
    activeFilterChips.push({
      key: 'from',
      label: t('notifications.inbox.filter.from', 'From'),
      value: filters.from.slice(0, 10),
      onRemove: () => onChange({...filters, from: undefined}),
    });
  }
  if (filters.to) {
    activeFilterChips.push({
      key: 'to',
      label: t('notifications.inbox.filter.to', 'To'),
      value: filters.to.slice(0, 10),
      onRemove: () => onChange({...filters, to: undefined}),
    });
  }

  const handleClearAll = () => {
    onChange({
      ...filters,
      severity: undefined,
      vehicle_id: undefined,
      rule_id: undefined,
      q: undefined,
      from: undefined,
      to: undefined,
    });
  };

  const severityGroupLabel = t('notifications.inbox.filter.severity', 'Severity');

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        <View
          accessibilityLabel={severityGroupLabel}
          accessibilityRole="radiogroup"
          style={styles.severityGroup}>
          {SEVERITY_OPTIONS.map(opt => {
            const active = selectedSeverities.has(opt.value);
            return (
              <Pressable
                accessibilityLabel={opt.label}
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                key={opt.value}
                onPress={() => toggleSeverity(opt.value)}
                style={({pressed}) => [
                  styles.severityChip,
                  active
                    ? severityChipActiveStyles[opt.value]
                    : styles.severityChipIdle,
                  pressed && styles.pressed,
                ]}>
                <View
                  pointerEvents="none"
                  style={[styles.severityDot, severityDotStyles[opt.value]]}
                />
                <AppText
                  style={[
                    styles.severityLabel,
                    active
                      ? severityLabelActiveStyles[opt.value]
                      : styles.severityLabelIdle,
                  ]}
                  weight="semibold">
                  {t(
                    `notifications.inbox.filter.severity.${opt.value}`,
                    opt.label,
                  )}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <NativeSelect
          accessibilityLabel={t('notifications.inbox.filter.vehicle', 'Vehicle')}
          onValueChange={setVehicle}
          options={vehicleOptions}
          testID="notification-filter-vehicle"
          value={filters.vehicle_id?.[0] ? String(filters.vehicle_id[0]) : ''}
        />

        <NativeSelect
          accessibilityLabel={t('notifications.inbox.filter.rule', 'Rule')}
          onValueChange={setRule}
          options={ruleOptions}
          testID="notification-filter-rule"
          value={filters.rule_id?.[0] ? String(filters.rule_id[0]) : ''}
        />

        <SearchField
          accessibilityLabel={t('notifications.inbox.filter.searchLabel', 'Search')}
          clearLabel={t('common.clear', 'Clear')}
          onChange={setQuery}
          placeholder={t(
            'notifications.inbox.filter.searchPlaceholder',
            'Search messages…',
          )}
          style={styles.searchField}
          value={filters.q ?? ''}
        />
      </View>

      <RangeField
        fromLabel={t('notifications.inbox.filter.from', 'From')}
        onChange={r => {
          setFrom(r.start);
          setTo(r.end);
        }}
        toLabel={t('notifications.inbox.filter.to', 'To')}
        value={{
          start: filters.from?.slice(0, 10) ?? '',
          end: filters.to?.slice(0, 10) ?? '',
        }}
      />

      <ActiveFilterChips
        activeLabel={t('filters.activeLabel', 'Active filters')}
        clearAllLabel={t('filters.clearAll', 'Clear all')}
        filters={activeFilterChips}
        onClearAll={handleClearAll}
        removeLabel={label =>
          t('filters.removeAria', `Remove filter ${label}`)
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  filterBar: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.78,
  },
  severityGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  severityChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  severityChipIdle: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  severityDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  severityLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  severityLabelIdle: {
    color: colors.textSecondary,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    justifyContent: 'space-between',
    minWidth: 150,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  selectChevron: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: 4,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  menu: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 360,
    padding: spacing.sm,
    width: '92%',
    ...shadows.panel,
  },
  menuList: {
    maxHeight: 320,
  },
  option: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  optionLabelSelected: {
    color: colors.accent,
  },
  check: {
    color: colors.accent,
    fontSize: 14,
  },
  searchField: {
    flexBasis: '100%',
    flexGrow: 1,
  },
  searchRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  searchClear: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  searchClearGlyph: {
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 18,
  },
  rangeRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  rangeField: {
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 150,
  },
  rangeLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  fieldRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  fieldGlyph: {
    color: colors.textMuted,
    fontSize: 14,
  },
  fieldInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    paddingVertical: spacing.sm,
  },
  chipsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 12,
    lineHeight: 16,
    maxWidth: 220,
  },
  chipLabel: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  chipValue: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
  chipRemove: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  chipRemoveGlyph: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 14,
  },
  clearAll: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  clearAllLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
});

const severityChipActiveStyles = StyleSheet.create<Record<Severity, ViewStyle>>({
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  warn: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  critical: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
});

const severityDotStyles = StyleSheet.create<Record<Severity, ViewStyle>>({
  info: {
    backgroundColor: colors.accent,
  },
  warn: {
    backgroundColor: colors.warning,
  },
  critical: {
    backgroundColor: colors.danger,
  },
});

const severityLabelActiveStyles = StyleSheet.create<Record<Severity, TextStyle>>({
  info: {
    color: colors.accent,
  },
  warn: {
    color: colors.warning,
  },
  critical: {
    color: colors.danger,
  },
});

export default NotificationFilterBar;

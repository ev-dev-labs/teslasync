// Native parity port of web/src/components/ui/SignalConfigModal.tsx.
//
// Full-screen "Fleet Telemetry Signal Configuration" dialog. Lets an operator
// pick which Fleet Telemetry signals to subscribe to and at what per-signal
// sampling interval, with eight one-tap PRESETS, a master select-all + master
// interval, a per-signal search filter, and collapsible per-category groups that
// carry a tri-state (all / some / none) checkbox plus a "set all" interval
// shortcut. Submitting reports the selected `{ name, interval }[]` to onSubmit.
//
// The web version composes the shared <Modal> / <Input> / <Select>, the lucide
// Search/Zap/Battery/Gauge/Shield/Thermometer/Radio/Settings/Wrench/ChevronDown/
// CheckCircle SVGs, `clsx`, and Tailwind utility classes + CSS custom properties.
// React Native has none of those (no DOM <button>/<p>/<span>/<div>, no <select>/
// <input>, no lucide SVGs, no clsx/Tailwind, no sticky positioning), so this port
// reproduces the same behavioural + visual contract with native primitives:
//   - The shared <Modal size="full"> becomes a transparent fade RN <Modal> with a
//     backdrop <Pressable> (tap-to-close) + a centered dialog card, following the
//     established native modal idiom (see FeedbackModal). The web `sticky` master
//     controls + footer become fixed (non-scrolling) flex sections wrapping a
//     single scrolling signal-list <ScrollView>, preserving the "controls + footer
//     always visible while the list scrolls" intent.
//   - The shared <Select> dropdowns (master interval, per-category "set all",
//     per-signal interval) become a reusable inline <IntervalSelect> built on the
//     same RN Modal-popover idiom as Combobox / DataTableColumnsMenu: a Pressable
//     trigger showing the current label opens a transparent popover listing the
//     options as accessible Pressable rows.
//   - The shared <Input> search field becomes a <TextInput> with a leading search
//     glyph. The custom checkbox <button>s reuse the already-ported shared native
//     <Checkbox> (size="sm", with `indeterminate` for the category tri-state);
//     the master "Select All / Deselect All" stays a custom pill to keep its
//     distinctive active styling.
//   - The lucide category SVGs become compact two-letter glyph codes (the same
//     native "no SVG icons" idiom used by SemanticIcon), the lucide ChevronDown
//     becomes a "\u25BE" caret that rotates via state, and CheckCircle becomes the
//     shared Checkbox's own check glyph. The lucide Zap on the submit button
//     becomes a "\u26A1" glyph; the lucide Search becomes a "\u26B2"/"?"-free
//     magnifier-style glyph.
//
// Native-safe adaptations (documented in the sidecar):
//   - The web copy is plain English literals (no react-i18next in the source), so
//     the same strings are preserved verbatim; the only i18n-adjacent change is
//     that touch has no `title=` hover tooltip, so each preset's `desc` is surfaced
//     through accessibilityHint instead.
//   - Tailwind classes + CSS custom properties (var(--text-muted), var(--surface),
//     var(--border)) and the `text-neon-cyan` accent resolve to StyleSheet styles
//     against the native theme tokens (neon-cyan -> colors.accent). The per-signal
//     interval `color` (formerly a Tailwind text class) is carried as a resolved
//     hex so the colour-by-cadence cue survives.

import React, {useMemo, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';
import {Checkbox} from './Checkbox';

// ---------------------------------------------------------------------------
// Resolved palette. The web uses Tailwind tokens / CSS vars; native carries the
// literal hexes so the visual intent survives without Tailwind.
// ---------------------------------------------------------------------------

// bg-neon-cyan / text-neon-cyan / border-neon-cyan -> the native bright-cyan
// accent. Active checkboxes, the master toggle, and the submit button use it.
const NEON_CYAN = colors.accent; // #35d5ff
const CYAN_300 = '#67e8f9'; // text-cyan-300
const BLUE_400 = '#60a5fa'; // text-blue-400
const GRAY_700 = '#6b7280'; // text-gray-700 toned for legibility on dark bg
const HAIRLINE = 'rgba(255, 255, 255, 0.08)'; // border-white/[0.08]
const HAIRLINE_FAINT = 'rgba(255, 255, 255, 0.06)'; // border-white/[0.06]
const FILL_FAINT = 'rgba(255, 255, 255, 0.03)'; // bg-white/[0.03]

// lucide affordances rendered as text glyphs (the native "no SVG icons" idiom).
const CHEVRON_GLYPH = '\u25BE'; // ▾ ChevronDown (rotates -90deg when collapsed)
const BOLT_GLYPH = '\u26A1'; // ⚡ Zap (submit button)
const SEARCH_GLYPH = '\u2315'; // ⌕ Search (leading magnifier)

// INTERVAL_OPTIONS — verbatim from the web source, with the Tailwind `color`
// class resolved to a native hex so the per-signal colour-by-cadence cue holds.
interface IntervalOption {
  value: number;
  label: string;
  color: string;
  desc: string;
}

const INTERVAL_OPTIONS: IntervalOption[] = [
  {value: 0, label: '500ms', color: NEON_CYAN, desc: 'Real-time'},
  {value: 1, label: '1s', color: CYAN_300, desc: 'Fast'},
  {value: 5, label: '5s', color: BLUE_400, desc: 'Medium'},
  {value: 10, label: '10s', color: colors.textSecondary, desc: 'Default'},
  {value: 30, label: '30s', color: colors.textMuted, desc: 'Slow'},
  {value: 60, label: '60s', color: colors.textMuted, desc: '1 min'},
  {value: 300, label: '5m', color: colors.textMuted, desc: 'Rare'},
  {value: 900, label: '15m', color: colors.textMuted, desc: '15 min'},
  {value: 3600, label: '1h', color: colors.textMuted, desc: '1 hour'},
  {value: 86400, label: '24h', color: GRAY_700, desc: 'Daily'},
];

export interface SignalConfig {
  name: string;
  category: string;
  selected: boolean;
  interval: number;
}

export interface CategoryDef {
  category: string;
  fields: string[];
}

interface Preset {
  name: string;
  desc: string;
  apply: (fields: SignalConfig[]) => SignalConfig[];
}

// PRESETS — ported verbatim from the web source (emoji names preserved). Each
// `apply` is a pure transform over the signal list, identical to the web logic.
const PRESETS: Preset[] = [
  {
    name: '⚡ Real-time Driving',
    desc: 'Driving signals at 1s, battery at 10s, config at 24h',
    apply: (fields: SignalConfig[]) =>
      fields.map(f => ({
        ...f,
        selected: true,
        interval: ['Driving', 'Powertrain', 'Location'].includes(f.category)
          ? 1
          : ['Charging', 'Climate', 'Tires & Service'].includes(f.category)
            ? 10
            : ['Vehicle Config', 'User Preference'].includes(f.category)
              ? 86400
              : 10,
      })),
  },
  {
    name: '⚖️ Balanced',
    desc: 'All signals at 10s — good balance of data and battery',
    apply: (fields: SignalConfig[]) =>
      fields.map(f => ({...f, selected: true, interval: 10})),
  },
  {
    name: '🔋 Low Power',
    desc: 'All signals at 60s — minimal battery impact',
    apply: (fields: SignalConfig[]) =>
      fields.map(f => ({...f, selected: true, interval: 60})),
  },
  {
    name: '🏎️ Track Mode',
    desc: 'Driving & powertrain at 1s, everything else at 30s',
    apply: (fields: SignalConfig[]) =>
      fields.map(f => ({
        ...f,
        selected: true,
        interval: ['Driving', 'Powertrain', 'Location'].includes(f.category)
          ? 1
          : ['Vehicle Config', 'User Preference'].includes(f.category)
            ? 3600
            : 30,
      })),
  },
  {
    name: '💰 Cost Saver',
    desc: 'Essential signals only at 5–15min, non-essentials off',
    apply: (fields: SignalConfig[]) =>
      fields.map(f => ({
        ...f,
        selected: ['Location', 'Charging', 'Vehicle State', 'Safety'].includes(
          f.category,
        ),
        interval:
          f.category === 'Vehicle State'
            ? 900
            : ['Location', 'Charging', 'Safety'].includes(f.category)
              ? 300
              : 300,
      })),
  },
  {
    name: '😴 Sleep Watch',
    desc: 'Security & location at 60s, charging at 1min, rest off',
    apply: (fields: SignalConfig[]) =>
      fields.map(f => ({
        ...f,
        selected: [
          'Safety',
          'Vehicle State',
          'Location',
          'Charging',
          'Climate',
        ].includes(f.category),
        interval: ['Safety', 'Vehicle State', 'Charging'].includes(f.category)
          ? 60
          : ['Location', 'Climate'].includes(f.category)
            ? 300
            : 300,
      })),
  },
  {
    name: '🔧 Diagnostics',
    desc: 'Powertrain/tires/climate at 5s, driving at 10s',
    apply: (fields: SignalConfig[]) =>
      fields.map(f => ({
        ...f,
        selected: true,
        interval: ['Powertrain', 'Tires & Service', 'Climate'].includes(
          f.category,
        )
          ? 5
          : [
                'Driving',
                'Charging',
                'Vehicle State',
                'Safety',
                'Location',
              ].includes(f.category)
            ? 10
            : f.category === 'Media'
              ? 60
              : 3600,
      })),
  },
  {
    name: '🗺️ Trip Logger',
    desc: 'Location at 1s, driving at 5s — optimized for routes',
    apply: (fields: SignalConfig[]) =>
      fields.map(f => ({
        ...f,
        selected: !['Media', 'User Preference', 'Vehicle Config'].includes(
          f.category,
        ),
        interval:
          f.category === 'Location'
            ? 1
            : f.category === 'Driving'
              ? 5
              : ['Powertrain', 'Charging'].includes(f.category)
                ? 30
                : ['Climate', 'Vehicle State', 'Safety'].includes(f.category)
                  ? 60
                  : 300,
      })),
  },
];

// CATEGORY_ICONS — the web maps each category to a lucide SVG; native maps to a
// compact two-letter glyph code (the SemanticIcon "no SVG icons" idiom). The
// fallback mirrors the web `CATEGORY_ICONS[category] || Zap` default.
const CATEGORY_ICONS: Record<string, string> = {
  Driving: 'DR', // Gauge
  Charging: 'CH', // Battery
  Climate: 'CL', // Thermometer
  'Vehicle State': 'VS', // Shield
  Safety: 'SF', // Shield
  Powertrain: 'PT', // Zap
  'Tires & Service': 'TS', // Wrench
  Media: 'MD', // Radio
  Location: 'LO', // Gauge
  'User Preference': 'UP', // Settings
  'Vehicle Config': 'VC', // Settings
};
const DEFAULT_CATEGORY_GLYPH = 'ZP'; // Zap fallback

export interface SignalConfigModalProps {
  open: boolean;
  onClose: () => void;
  categories: CategoryDef[];
  initialSelected: string[];
  initialInterval: number;
  onSubmit: (signals: {name: string; interval: number}[]) => void;
}

// ---------------------------------------------------------------------------
// IntervalSelect — native replacement for the shared web <Select>. A Pressable
// trigger showing the current label opens a transparent Modal popover listing
// the options as accessible rows (the Combobox / DataTableColumnsMenu idiom).
// ---------------------------------------------------------------------------

interface SelectOption {
  value: string;
  label: string;
}

interface IntervalSelectProps {
  /** Current selected value; when it matches no option, `placeholder` shows. */
  value: string;
  options: SelectOption[];
  onSelect: (value: string) => void;
  /** Shown on the trigger when no option matches (web's empty `value` row). */
  placeholder?: string;
  /** Resolved colour for the trigger label (per-signal colour-by-cadence cue). */
  valueColor?: string;
  accessibilityLabel: string;
  triggerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

function IntervalSelect({
  value,
  options,
  onSelect,
  placeholder,
  valueColor,
  accessibilityLabel,
  triggerStyle,
  testID,
}: IntervalSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const triggerLabel = selected?.label ?? placeholder ?? '';

  const choose = (next: string) => {
    setOpen(false);
    onSelect(next);
  };

  return (
    <View>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        hitSlop={6}
        onPress={() => setOpen(true)}
        style={({pressed}) => [
          styles.selectTrigger,
          triggerStyle,
          pressed && styles.pressed,
        ]}
        testID={testID}>
        <AppText
          numberOfLines={1}
          style={[styles.selectTriggerText, valueColor ? {color: valueColor} : null]}>
          {triggerLabel}
        </AppText>
        <AppText
          accessible={false}
          allowFontScaling={false}
          style={styles.selectCaret}>
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
            accessibilityRole="menu"
            accessibilityLabel={accessibilityLabel}
            style={styles.popoverMenu}
            testID={testID ? `${testID}-menu` : undefined}>
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.popoverList}
              keyboardShouldPersistTaps="handled">
              {options.map(opt => {
                const isActive = opt.value === value;
                return (
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityState={{selected: isActive}}
                    key={opt.value || '__placeholder__'}
                    onPress={() => choose(opt.value)}
                    style={({pressed}) => [
                      styles.popoverItem,
                      isActive && styles.popoverItemActive,
                      pressed && styles.popoverItemPressed,
                    ]}
                    testID={
                      testID ? `${testID}-option-${opt.value}` : undefined
                    }>
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
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Fleet Telemetry signal configuration dialog.
 *
 * Mirrors the web shared <SignalConfigModal>: it seeds a flat signal list from
 * `categories` + `initialSelected` + `initialInterval`, exposes the eight
 * PRESETS, a master select-all + master interval, a search filter, and
 * collapsible per-category groups, then reports the chosen `{ name, interval }[]`
 * via `onSubmit` (and closes) on Subscribe.
 */
export function SignalConfigModal({
  open,
  onClose,
  categories,
  initialSelected,
  initialInterval,
  onSubmit,
}: SignalConfigModalProps) {
  const [signals, setSignals] = useState<SignalConfig[]>(() =>
    categories.flatMap(cat =>
      cat.fields.map(f => ({
        name: f,
        category: cat.category,
        selected: initialSelected.includes(f),
        interval: initialInterval,
      })),
    ),
  );
  const [search, setSearch] = useState('');
  const [masterInterval, setMasterInterval] = useState(initialInterval);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(
    () => new Set(categories.map(c => c.category)),
  );

  const filtered = useMemo(
    () =>
      signals.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [signals, search],
  );

  const selectedCount = signals.filter(s => s.selected).length;
  const totalCount = signals.length;
  const allSelected = selectedCount === totalCount;

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, SignalConfig[]>();
    for (const s of filtered) {
      const arr = map.get(s.category) || [];
      arr.push(s);
      map.set(s.category, arr);
    }
    return map;
  }, [filtered]);

  const updateSignal = (name: string, updates: Partial<SignalConfig>) => {
    setSignals(prev =>
      prev.map(s => (s.name === name ? {...s, ...updates} : s)),
    );
  };

  const toggleAll = (selected: boolean) => {
    setSignals(prev => prev.map(s => ({...s, selected})));
  };

  const setMasterIntervalAll = (interval: number) => {
    setMasterInterval(interval);
    setSignals(prev => prev.map(s => ({...s, interval})));
  };

  const toggleCategory = (category: string) => {
    const catSignals = signals.filter(s => s.category === category);
    const allCatSelected = catSignals.every(s => s.selected);
    setSignals(prev =>
      prev.map(s =>
        s.category === category ? {...s, selected: !allCatSelected} : s,
      ),
    );
  };

  const setCategoryInterval = (category: string, interval: number) => {
    setSignals(prev =>
      prev.map(s => (s.category === category ? {...s, interval} : s)),
    );
  };

  const applyPreset = (preset: Preset) => {
    setSignals(prev => preset.apply(prev));
  };

  const toggleCategoryExpanded = (category: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleSubmit = () => {
    const selected = signals
      .filter(s => s.selected)
      .map(s => ({name: s.name, interval: s.interval}));
    onSubmit(selected);
    onClose();
  };

  const masterOptions: SelectOption[] = INTERVAL_OPTIONS.map(o => ({
    value: String(o.value),
    label: `${o.label} (${o.desc})`,
  }));
  const intervalLabelOptions: SelectOption[] = INTERVAL_OPTIONS.map(o => ({
    value: String(o.value),
    label: o.label,
  }));

  const at500ms = signals.filter(s => s.selected && s.interval === 0).length;
  const at10s = signals.filter(s => s.selected && s.interval === 10).length;

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

        <View style={styles.dialog} testID="signal-config-modal">
          <AppText style={styles.title} variant="title" weight="bold">
            Fleet Telemetry Signal Configuration
          </AppText>
          <AppText style={styles.subtitle}>
            {selectedCount} / {totalCount} signals selected
          </AppText>

          {/* Master Controls — fixed to the top of the dialog (web `sticky`). */}
          <View style={styles.masterControls}>
            {/* Presets — web flex-wrap becomes a horizontal chip scroller. */}
            <ScrollView
              contentContainerStyle={styles.presetRow}
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}>
              {PRESETS.map(p => (
                <Pressable
                  accessibilityHint={p.desc}
                  accessibilityLabel={p.name}
                  accessibilityRole="button"
                  key={p.name}
                  onPress={() => applyPreset(p)}
                  style={({pressed}) => [
                    styles.presetChip,
                    pressed && styles.presetChipPressed,
                  ]}>
                  <AppText style={styles.presetChipText} weight="semibold">
                    {p.name}
                  </AppText>
                </Pressable>
              ))}
            </ScrollView>

            {/* Master Toggle + Master Interval + Search */}
            <View style={styles.masterRow}>
              <Pressable
                accessibilityLabel={
                  allSelected ? 'Deselect All' : 'Select All'
                }
                accessibilityRole="button"
                accessibilityState={{selected: allSelected}}
                onPress={() => toggleAll(!allSelected)}
                style={({pressed}) => [
                  styles.masterToggle,
                  allSelected
                    ? styles.masterToggleActive
                    : styles.masterToggleIdle,
                  pressed && styles.pressed,
                ]}
                testID="signal-config-select-all">
                <View
                  style={[
                    styles.masterToggleBox,
                    allSelected
                      ? styles.masterToggleBoxActive
                      : styles.masterToggleBoxIdle,
                  ]}>
                  {allSelected ? (
                    <AppText
                      accessible={false}
                      allowFontScaling={false}
                      style={styles.masterToggleCheck}>
                      {'\u2713'}
                    </AppText>
                  ) : null}
                </View>
                <AppText
                  style={[
                    styles.masterToggleText,
                    allSelected && styles.masterToggleTextActive,
                  ]}
                  weight="semibold">
                  {allSelected ? 'Deselect All' : 'Select All'}
                </AppText>
              </Pressable>

              <View style={styles.masterIntervalGroup}>
                <AppText style={styles.masterIntervalLabel}>
                  MASTER INTERVAL:
                </AppText>
                <IntervalSelect
                  accessibilityLabel="Master interval"
                  onSelect={v => setMasterIntervalAll(Number(v))}
                  options={masterOptions}
                  testID="signal-config-master-interval"
                  value={String(masterInterval)}
                />
              </View>

              <View style={styles.searchWrap}>
                <AppText
                  accessible={false}
                  allowFontScaling={false}
                  style={styles.searchIcon}>
                  {SEARCH_GLYPH}
                </AppText>
                <TextInput
                  accessibilityLabel="Search signals"
                  onChangeText={setSearch}
                  placeholder="Search signals..."
                  placeholderTextColor={colors.textMuted}
                  style={styles.searchInput}
                  testID="signal-config-search"
                  value={search}
                />
              </View>
            </View>
          </View>

          {/* Signal List — the only scrolling region. */}
          <ScrollView
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            testID="signal-config-list">
            {Array.from(grouped.entries()).map(([category, catSignals]) => {
              const expanded = expandedCats.has(category);
              const allCatSelected = catSignals.every(s => s.selected);
              const someCatSelected = catSignals.some(s => s.selected);
              const catGlyph =
                CATEGORY_ICONS[category] || DEFAULT_CATEGORY_GLYPH;
              const catSelectedCount = catSignals.filter(
                s => s.selected,
              ).length;

              return (
                <View key={category} style={styles.categoryCard}>
                  {/* Category Header */}
                  <Pressable
                    accessibilityLabel={`${category} category`}
                    accessibilityRole="button"
                    accessibilityState={{expanded}}
                    onPress={() => toggleCategoryExpanded(category)}
                    style={styles.categoryHeader}
                    testID={`signal-config-category-${category}`}>
                    <AppText
                      accessible={false}
                      allowFontScaling={false}
                      style={[
                        styles.categoryCaret,
                        !expanded && styles.categoryCaretCollapsed,
                      ]}>
                      {CHEVRON_GLYPH}
                    </AppText>
                    <Checkbox
                      accessibilityLabel={`Toggle ${category}`}
                      checked={allCatSelected}
                      indeterminate={someCatSelected && !allCatSelected}
                      onChange={() => toggleCategory(category)}
                      size="sm"
                      testID={`signal-config-category-toggle-${category}`}
                    />
                    <AppText
                      accessible={false}
                      allowFontScaling={false}
                      style={styles.categoryGlyph}>
                      {catGlyph}
                    </AppText>
                    <AppText style={styles.categoryName} weight="semibold">
                      {category}
                    </AppText>
                    <AppText style={styles.categoryCount}>
                      ({catSelectedCount}/{catSignals.length})
                    </AppText>
                    <View style={styles.categoryHeaderRight}>
                      <IntervalSelect
                        accessibilityLabel={`Set all ${category} intervals`}
                        onSelect={v => {
                          if (v) {
                            setCategoryInterval(category, Number(v));
                          }
                        }}
                        options={intervalLabelOptions}
                        placeholder="Set all..."
                        testID={`signal-config-category-setall-${category}`}
                        triggerStyle={styles.categorySetAllTrigger}
                        value=""
                      />
                    </View>
                  </Pressable>

                  {/* Signal Rows */}
                  {expanded ? (
                    <View style={styles.signalRows}>
                      {catSignals.map(sig => {
                        const intervalOpt =
                          INTERVAL_OPTIONS.find(
                            o => o.value === sig.interval,
                          ) || INTERVAL_OPTIONS[3];
                        return (
                          <View
                            key={sig.name}
                            style={[
                              styles.signalRow,
                              !sig.selected && styles.signalRowDimmed,
                            ]}>
                            <Checkbox
                              accessibilityLabel={sig.name}
                              checked={sig.selected}
                              onChange={() =>
                                updateSignal(sig.name, {
                                  selected: !sig.selected,
                                })
                              }
                              size="sm"
                              testID={`signal-config-signal-${sig.name}`}
                            />
                            <AppText
                              numberOfLines={1}
                              style={styles.signalName}>
                              {sig.name}
                            </AppText>
                            <IntervalSelect
                              accessibilityLabel={`${sig.name} interval`}
                              onSelect={v =>
                                updateSignal(sig.name, {
                                  interval: Number(v),
                                })
                              }
                              options={intervalLabelOptions}
                              testID={`signal-config-signal-interval-${sig.name}`}
                              triggerStyle={styles.signalIntervalTrigger}
                              value={String(sig.interval)}
                              valueColor={intervalOpt.color}
                            />
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          {/* Footer — fixed to the bottom of the dialog (web `sticky`). */}
          <View style={styles.footer}>
            <AppText numberOfLines={2} style={styles.footerSummary}>
              {selectedCount} signals selected
              {selectedCount > 0 ? ` • ${at500ms} at 500ms` : ''}
              {selectedCount > 0 ? ` • ${at10s} at 10s` : ''}
            </AppText>
            <View style={styles.footerActions}>
              <Pressable
                accessibilityLabel="Cancel"
                accessibilityRole="button"
                onPress={onClose}
                style={({pressed}) => [
                  styles.cancelButton,
                  pressed && styles.pressed,
                ]}
                testID="signal-config-cancel">
                <AppText style={styles.cancelButtonText} weight="semibold">
                  Cancel
                </AppText>
              </Pressable>
              <Pressable
                accessibilityLabel={`Subscribe ${selectedCount} Signals`}
                accessibilityRole="button"
                accessibilityState={{disabled: selectedCount === 0}}
                disabled={selectedCount === 0}
                onPress={handleSubmit}
                style={({pressed}) => [
                  styles.submitButton,
                  selectedCount === 0 && styles.submitButtonDisabled,
                  pressed && selectedCount > 0 && styles.pressed,
                ]}
                testID="signal-config-submit">
                <AppText
                  accessible={false}
                  allowFontScaling={false}
                  style={styles.submitGlyph}>
                  {BOLT_GLYPH}
                </AppText>
                <AppText style={styles.submitButtonText} weight="semibold">
                  Subscribe {selectedCount} Signals
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

SignalConfigModal.displayName = 'SignalConfigModal';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  cancelButton: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  cancelButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  categoryCard: {
    borderColor: HAIRLINE_FAINT,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  categoryCaret: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    width: 14,
  },
  categoryCaretCollapsed: {
    transform: [{rotate: '-90deg'}],
  },
  categoryCount: {
    color: colors.textMuted,
    fontSize: 10,
  },
  categoryGlyph: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  categoryHeader: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  categoryHeaderRight: {
    marginLeft: 'auto',
  },
  categoryName: {
    color: colors.textSecondary,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  categorySetAllTrigger: {
    minWidth: 92,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: spacing.sm,
    margin: spacing.md,
    maxHeight: '92%',
    maxWidth: 720,
    padding: spacing.lg,
    width: '94%',
    ...shadows.panel,
  },
  footer: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  footerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  footerSummary: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: 12,
  },
  list: {
    flexGrow: 1,
    flexShrink: 1,
  },
  listContent: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  masterControls: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  masterIntervalGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  masterIntervalLabel: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  masterRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  masterToggle: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  masterToggleActive: {
    backgroundColor: 'rgba(53, 213, 255, 0.1)',
    borderColor: colors.borderAccent,
  },
  masterToggleBox: {
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1,
    height: 14,
    justifyContent: 'center',
    width: 14,
  },
  masterToggleBoxActive: {
    backgroundColor: NEON_CYAN,
    borderColor: NEON_CYAN,
  },
  masterToggleBoxIdle: {
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  masterToggleCheck: {
    color: colors.background,
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 12,
  },
  masterToggleIdle: {
    backgroundColor: FILL_FAINT,
    borderColor: HAIRLINE,
  },
  masterToggleText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  masterToggleTextActive: {
    color: NEON_CYAN,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  popoverItem: {
    borderRadius: 8,
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
    color: colors.textSecondary,
    fontSize: 13,
  },
  popoverItemTextActive: {
    color: colors.textPrimary,
  },
  popoverList: {
    gap: 2,
    padding: spacing.xs,
  },
  popoverMenu: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: HAIRLINE,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 320,
    maxWidth: 280,
    minWidth: 160,
  },
  popoverOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  presetChip: {
    backgroundColor: FILL_FAINT,
    borderColor: HAIRLINE,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  presetChipPressed: {
    backgroundColor: 'rgba(53, 213, 255, 0.05)',
    borderColor: colors.borderAccent,
  },
  presetChipText: {
    color: colors.textPrimary,
    fontSize: 12,
  },
  presetRow: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  pressed: {
    opacity: 0.82,
  },
  searchIcon: {
    color: colors.textMuted,
    fontSize: 14,
    marginRight: spacing.xs,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 12,
    paddingVertical: 0,
  },
  searchWrap: {
    alignItems: 'center',
    backgroundColor: FILL_FAINT,
    borderColor: HAIRLINE,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    flexGrow: 1,
    flexShrink: 1,
    maxWidth: 320,
    minWidth: 160,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  selectCaret: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  selectTrigger: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'space-between',
    minWidth: 80,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  selectTriggerText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  signalIntervalTrigger: {
    minWidth: 80,
  },
  signalName: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  signalRow: {
    alignItems: 'center',
    borderTopColor: 'rgba(255, 255, 255, 0.03)',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  signalRowDimmed: {
    opacity: 0.4,
  },
  signalRows: {
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: NEON_CYAN,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitButtonText: {
    color: colors.background,
    fontSize: 12,
  },
  submitGlyph: {
    color: colors.background,
    fontSize: 13,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
  },
  title: {
    color: colors.textPrimary,
  },
});

export default SignalConfigModal;

// WidgetCatalogueDialog — native parity port of
// web/src/features/dashboard/components/WidgetCatalogueDialog.tsx.
//
// A discoverable, category-grouped widget picker. It lists every widget in the
// registry grouped by category, badges widgets already on the active dashboard
// as "Added" (and disables their Add button so they can't be double-added),
// supports a name/description/category search with a result count + empty
// state, and on pick calls `onAdd(widgetId)` then immediately `onClose()`.
// Every state name, derivation (activeSet / groupedEntries / filteredEntries /
// visibleCount), the handleAdd guard, the i18n keys + English defaults and the
// testIDs are preserved 1:1 (every source line is mapped in the .parity.json
// sidecar).
//
// Native adaptations vs. the web source (browser-only bits become native-safe):
//   - lucide-react `Search` (web L3) -> a small decorative magnifier glyph in
//     the search field (lucide is browser-only; the DashboardGrid/LayoutSwitcher
//     glyph precedent).
//   - `@/components/ui` Modal/Button/Badge/Input (web L4) -> react-native
//     <Modal> (transparent overlay + backdrop press + onRequestClose honoring
//     the web onClose), <TextInput> (the search box), a module-scope
//     CatalogueButton Pressable (Button), and an inline pill (Badge). Those
//     barrels aren't native parity manifest entries (the AcknowledgeAlertDialog
//     dialog precedent).
//   - `../widgets/registry` WIDGET_REGISTRY + `../widgets/types`
//     WidgetCategory/WidgetDef (web L5-6) -> the registry is not in the native
//     parity manifest and the web one maps each id to a browser-only LucideIcon
//     + a React.lazy widget bundle. Per conversion-contract rule 7 the native
//     data source is the existing native registry (`NATIVE_WIDGET_REGISTRY`
//     from src/widgets — the same module DashboardWidgets.test.tsx exercises),
//     adapted into a minimal WidgetDef whose `icon` is a native SemanticIconName.
//     `WidgetCategory` is derived from that registry's category union, so the
//     catalogue groups REAL native widgets (no empty/stubbed catalogue).
//   - react-i18next useTranslation (web L2/99) -> a native-safe
//     t(key, fallback, options?) shim preserving every key, English default and
//     {{var}} interpolation (the LayoutSwitcher/AcknowledgeAlertDialog precedent).
//   - the `HTMLInputElement` searchRef + `window.setTimeout/clearTimeout` focus
//     defer (web L102/111-112) -> a TextInput ref + setTimeout/clearTimeout
//     (no `window` in RN); the 50ms defer-until-mounted intent is kept and the
//     timer is cleared on cleanup (safe under the --detectOpenHandles gate).
//   - the web `grid-cols-1 sm:grid-cols-2` entry grid (web L271) -> a single
//     vertical column: a phone is the base (xs) breakpoint, so the sm(>=640px)
//     two-column layout is the desktop branch (the DashboardGrid xs-stack
//     precedent). Tailwind utility classes / CSS vars -> StyleSheet + theme tokens.
//
// No DOM / lucide-react / Recharts / Leaflet / old web-UI imports reach the
// native output — only react, react-native primitives, the canonical AppText +
// SemanticIcon, the native widget registry, and theme tokens.

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
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { colors, shadows, spacing, typography } from '../../../../theme/tokens';
import {
  NATIVE_WIDGET_REGISTRY,
  type NativeWidgetDefinition,
} from '../../../../widgets';

/* ─── Native-safe i18n fallback (web react-i18next useTranslation) ───────────
 * Preserves every key + English default and the {{var}} interpolation used by
 * the subtitle / result-count / empty-body / add-label strings. */
type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useTranslation(): { t: NativeTFunction } {
  const t = useCallback<NativeTFunction>(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
  return { t };
}

/* ─── Inlined widget types (web ../widgets/types) ────────────────────────────
 * `WidgetCategory` is derived from the native registry's category union so the
 * source's category ordering/labels/emoji apply to real native categories.
 * `WidgetDef` is reduced to the fields this catalogue reads; the web
 * `icon: LucideIcon` becomes a native `SemanticIconName`. */
type WidgetCategory = NativeWidgetDefinition['category'];

interface WidgetDef {
  id: string;
  name: string;
  description: string;
  icon: SemanticIconName;
  category: WidgetCategory;
}

/* ─── Native widget registry (web ../widgets/registry WIDGET_REGISTRY) ───────
 * The web registry maps each id to a browser-only LucideIcon + React.lazy
 * bundle. The native catalogue is sourced from the existing NATIVE_WIDGET_
 * REGISTRY metadata (rule 7), adapted to the WidgetDef shape (title -> name). */
const WIDGET_REGISTRY: WidgetDef[] = NATIVE_WIDGET_REGISTRY.map(widget => ({
  id: widget.id,
  name: widget.title,
  description: widget.description,
  icon: widget.icon,
  category: widget.category,
}));

const CATEGORY_ORDER: WidgetCategory[] = [
  'vehicle',
  'battery',
  'energy',
  'charging',
  'driving',
  'climate',
  'tires',
  'security',
  'media',
  'analytics',
  'alerts',
  'automation',
  'system',
  'maps',
  'navigation',
  'auth',
  'settings',
];

const CATEGORY_FALLBACK_LABELS: Record<WidgetCategory, string> = {
  vehicle: 'Vehicle',
  battery: 'Battery & Range',
  energy: 'Energy',
  driving: 'Driving',
  charging: 'Charging',
  climate: 'Climate',
  tires: 'Tires',
  security: 'Security',
  media: 'Media',
  analytics: 'Analytics',
  alerts: 'Alerts',
  automation: 'Automations',
  system: 'System',
  maps: 'Maps',
  navigation: 'Navigation',
  auth: 'Account',
  settings: 'Settings',
};

const CATEGORY_EMOJI: Record<WidgetCategory, string> = {
  vehicle: '🚗',
  battery: '🔋',
  energy: '⚡',
  driving: '🛣',
  charging: '🔌',
  climate: '🌡',
  tires: '🛞',
  security: '🛡',
  media: '🎵',
  analytics: '📊',
  alerts: '🔔',
  automation: '🤖',
  system: '⚙',
  maps: '🗺',
  navigation: '🧭',
  auth: '👤',
  settings: '🎛',
};

export interface WidgetCatalogueDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user picks a widget from the catalogue. The dialog
   * closes after invoking. */
  onAdd: (widgetId: string) => void;
  /** Widget ids already present on the active dashboard. Used to disable
   * duplicate adds. */
  activeWidgetIds: string[];
}

export function WidgetCatalogueDialog({
  open,
  onClose,
  onAdd,
  activeWidgetIds,
}: WidgetCatalogueDialogProps): React.ReactElement {
  const { t } = useTranslation();

  const [query, setQuery] = useState('');
  const searchRef = useRef<TextInput | null>(null);

  // Reset the filter every time the dialog re-opens so a stale search from
  // a prior session never hides the full catalogue on the next open.
  useEffect(() => {
    if (open) {
      setQuery('');
      // Defer focus until after the modal mounts so the input is actually
      // attached when we call .focus().
      const id = setTimeout(() => searchRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const activeSet = useMemo(() => new Set(activeWidgetIds), [activeWidgetIds]);

  const groupedEntries = useMemo<[WidgetCategory, WidgetDef[]][]>(() => {
    const buckets = new Map<WidgetCategory, WidgetDef[]>();
    for (const widget of WIDGET_REGISTRY) {
      const existing = buckets.get(widget.category);
      if (existing) {
        existing.push(widget);
      } else {
        buckets.set(widget.category, [widget]);
      }
    }
    const entries: [WidgetCategory, WidgetDef[]][] = [];
    for (const cat of CATEGORY_ORDER) {
      const items = buckets.get(cat);
      if (items && items.length > 0) {
        entries.push([cat, items]);
      }
    }
    // Surface any registry categories we forgot to order so nothing is hidden.
    for (const [cat, items] of buckets.entries()) {
      if (!CATEGORY_ORDER.includes(cat)) entries.push([cat, items]);
    }
    return entries;
  }, []);

  const totalCount = WIDGET_REGISTRY.length;
  const addedCount = activeSet.size;

  const trimmedQuery = query.trim().toLowerCase();
  const isFiltering = trimmedQuery.length > 0;

  // Filter by name + description + category label so users can search either
  // a widget by name ("range") or a topic by category ("battery").
  const filteredEntries = useMemo<[WidgetCategory, WidgetDef[]][]>(() => {
    if (!isFiltering) return groupedEntries;
    const out: [WidgetCategory, WidgetDef[]][] = [];
    for (const [category, widgets] of groupedEntries) {
      const categoryLabel = (
        t(
          `dashboard.catalogue.category.${category}`,
          CATEGORY_FALLBACK_LABELS[category],
        ) ?? CATEGORY_FALLBACK_LABELS[category]
      ).toLowerCase();
      const categoryHit = categoryLabel.includes(trimmedQuery);
      const matches = widgets.filter(w => {
        if (categoryHit) return true;
        const haystack = `${w.name ?? ''} ${w.description ?? ''} ${
          w.id ?? ''
        }`.toLowerCase();
        return haystack.includes(trimmedQuery);
      });
      if (matches.length > 0) out.push([category, matches]);
    }
    return out;
  }, [groupedEntries, isFiltering, trimmedQuery, t]);

  const visibleCount = useMemo(
    () => filteredEntries.reduce((acc, [, widgets]) => acc + widgets.length, 0),
    [filteredEntries],
  );

  const handleAdd = (widgetId: string) => {
    if (activeSet.has(widgetId)) return;
    onAdd(widgetId);
    onClose();
  };

  const title = t('dashboard.catalogue.title', 'Widget catalogue');

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />

        <View
          accessibilityViewIsModal
          style={styles.dialog}
          testID="widget-catalogue-dialog"
        >
          <View style={styles.header}>
            <AppText
              numberOfLines={1}
              style={styles.title}
              variant="title"
              weight="bold"
            >
              {title}
            </AppText>
            <Pressable
              accessibilityLabel={t('common.close', 'Close')}
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}
              testID="widget-catalogue-close"
            >
              <AppText style={styles.closeGlyph} weight="bold">
                ✕
              </AppText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.headerBlock}>
              <AppText style={styles.subtitle} tone="secondary">
                {t(
                  'dashboard.catalogue.subtitle',
                  'Pick a widget to add to your dashboard. {{added}} of {{total}} widgets are already on your layout.',
                  { added: addedCount, total: totalCount },
                )}
              </AppText>
              <View style={styles.searchRow}>
                <AppText
                  importantForAccessibility="no"
                  style={styles.searchIcon}
                >
                  🔍
                </AppText>
                <TextInput
                  accessibilityLabel={t(
                    'dashboard.catalogue.searchLabel',
                    'Search widgets',
                  )}
                  onChangeText={setQuery}
                  placeholder={t(
                    'dashboard.catalogue.searchPlaceholder',
                    'Search widgets by name, description, or category…',
                  )}
                  placeholderTextColor={colors.textMuted}
                  ref={searchRef}
                  returnKeyType="search"
                  style={styles.searchInput}
                  testID="widget-catalogue-search"
                  value={query}
                />
              </View>
              {isFiltering ? (
                <AppText
                  accessibilityLiveRegion="polite"
                  style={styles.resultCount}
                  testID="widget-catalogue-result-count"
                  tone="muted"
                  variant="caption"
                >
                  {t(
                    'dashboard.catalogue.resultCount',
                    '{{count}} of {{total}} widgets match',
                    { count: visibleCount, total: totalCount },
                  )}
                </AppText>
              ) : null}
            </View>

            {isFiltering && visibleCount === 0 ? (
              <View style={styles.emptyState} testID="widget-catalogue-empty">
                <AppText style={styles.emptyTitle} weight="semibold">
                  {t(
                    'dashboard.catalogue.emptyTitle',
                    'No widgets match your search',
                  )}
                </AppText>
                <AppText
                  style={styles.emptyBody}
                  tone="muted"
                  variant="caption"
                >
                  {t(
                    'dashboard.catalogue.emptyBody',
                    'Try a different keyword, or clear the search to browse all {{total}} widgets.',
                    { total: totalCount },
                  )}
                </AppText>
                <View style={styles.emptyAction}>
                  <CatalogueButton
                    label={t('dashboard.catalogue.clearSearch', 'Clear search')}
                    onPress={() => setQuery('')}
                    testID="widget-catalogue-clear-search"
                    variant="ghost"
                  />
                </View>
              </View>
            ) : (
              filteredEntries.map(([category, widgets]) => (
                <View
                  key={category}
                  style={styles.section}
                  testID={`widget-catalogue-category-${category}`}
                >
                  <View style={styles.sectionHeading}>
                    <AppText
                      importantForAccessibility="no"
                      style={styles.sectionEmoji}
                    >
                      {CATEGORY_EMOJI[category]}
                    </AppText>
                    <AppText
                      style={styles.sectionLabel}
                      variant="caption"
                      weight="semibold"
                    >
                      {t(
                        `dashboard.catalogue.category.${category}`,
                        CATEGORY_FALLBACK_LABELS[category],
                      )}
                    </AppText>
                    <AppText
                      style={styles.sectionCount}
                      tone="muted"
                      variant="caption"
                    >
                      ({widgets.length})
                    </AppText>
                  </View>
                  <View style={styles.entries}>
                    {widgets.map(widget => {
                      const isAdded = activeSet.has(widget.id);
                      return (
                        <View
                          key={widget.id}
                          style={styles.entry}
                          testID={`widget-catalogue-entry-${widget.id}`}
                        >
                          <SemanticIcon
                            decorative
                            name={widget.icon}
                            size="sm"
                            style={styles.entryIcon}
                          />
                          <View style={styles.entryBody}>
                            <View style={styles.entryTitleRow}>
                              <AppText
                                numberOfLines={1}
                                style={styles.entryName}
                                weight="semibold"
                              >
                                {widget.name}
                              </AppText>
                              {isAdded ? (
                                <View style={styles.addedBadge}>
                                  <AppText
                                    style={styles.addedBadgeText}
                                    variant="caption"
                                    weight="semibold"
                                  >
                                    {t('dashboard.added', 'Added')}
                                  </AppText>
                                </View>
                              ) : null}
                            </View>
                            <AppText
                              style={styles.entryDescription}
                              tone="muted"
                              variant="caption"
                            >
                              {widget.description}
                            </AppText>
                          </View>
                          <CatalogueButton
                            accessibilityLabel={t(
                              'dashboard.catalogue.addLabel',
                              'Add {{name}} widget',
                              { name: widget.name },
                            )}
                            disabled={isAdded}
                            label={
                              isAdded
                                ? t('dashboard.added', 'Added')
                                : t('dashboard.catalogue.add', 'Add')
                            }
                            onPress={() => handleAdd(widget.id)}
                            variant="ghost"
                          />
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
WidgetCatalogueDialog.displayName = 'WidgetCatalogueDialog';

/* ─── CatalogueButton (web @/components/ui Button, size="sm") ─────────────────
 * The native AppButton is label-only with no compact size, so the catalogue's
 * small ghost buttons are Pressables (the AcknowledgeAlertDialog DialogAction
 * precedent), honoring the disabled gating + accessibility label. */
function CatalogueButton({
  label,
  onPress,
  disabled = false,
  variant = 'ghost',
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
  accessibilityLabel?: string;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}
    >
      <AppText
        style={
          variant === 'primary'
            ? styles.primaryButtonText
            : styles.ghostButtonText
        }
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addedBadge: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  addedBadgeText: {
    color: colors.textSecondary,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  closeGlyph: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    flex: 1,
    maxWidth: 720,
    overflow: 'hidden',
    width: '100%',
    ...shadows.panel,
  },
  disabled: {
    opacity: 0.48,
  },
  emptyAction: {
    marginTop: spacing.sm,
  },
  emptyBody: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.xl,
  },
  emptyTitle: {
    color: colors.textPrimary,
  },
  entries: {
    gap: spacing.sm,
  },
  entry: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  entryBody: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  entryDescription: {
    color: colors.textMuted,
  },
  entryIcon: {
    marginTop: 2,
  },
  entryName: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  entryTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  ghostButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerBlock: {
    gap: spacing.md,
  },
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
  },
  resultCount: {
    color: colors.textMuted,
  },
  searchIcon: {
    color: colors.textMuted,
    fontSize: 14,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
    paddingVertical: spacing.sm,
  },
  searchRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  sectionCount: {
    color: colors.textMuted,
  },
  sectionEmoji: {
    fontSize: 14,
  },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  subtitle: {
    lineHeight: 20,
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
  },
});

export default WidgetCatalogueDialog;

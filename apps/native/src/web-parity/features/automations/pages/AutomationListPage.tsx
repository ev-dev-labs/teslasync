// Native parity port of web/src/features/automations/pages/AutomationListPage.tsx.
//
// AutomationListPage — focused list view of every automation with bulk enable,
// disable, and delete actions. It is the streamlined "manage many at once"
// alternative to the card-based AutomationsListPage; both pages co-exist and
// users with dozens of automations gain bulk control here.
//
// Every web behavior, state name, API path, and i18n key is preserved (the
// `useAutomations` query -> `rowsRaw`/`isLoading`/`error`, the `automations`
// `?? []` guard, `visibleIds`, the `useBulkSelection<number>()` selection
// primitive -> `sel`, `useBulkAutomationsUpdate()` -> `bulkUpdate`,
// `masterState`, `onMasterToggle`, and the loading/error/empty/table branches).
// The web DOM/Tailwind/lucide/react-router stack is replaced with React Native
// primitives + the native parity component library:
//
//   - `@/components/layout` `PageContainer` (title/subtitle) has no native
//     parity component, so a local ScrollView screen scaffold reproduces the
//     header (title + subtitle). Precedent: DiskForecastPage / SlowQueriesPage.
//   - `@/components/data-display` `BulkActionToolbar` (singular alias) reuses
//     the already-ported native parity `BulkActionsToolbar`, imported under the
//     singular name to match the web source; the `actions` confirm/onClick/icon
//     contract is identical.
//   - `@/components/ui` `GlassPanel` reuses the native parity `GlassPanel`; the
//     `overflow-hidden` Tailwind becomes `overflow: 'hidden'` so the flush table
//     rows clip to the panel radius.
//   - `@/components/ui` `Badge` (variant chip) becomes a local themed
//     `StatusBadge` (success/neutral), matching the SeverityBadge precedent.
//   - `@/components/feedback` `EmptyState` reuses the native parity EmptyState
//     and the web `actionTo` CTA ("Open builder" -> `/automations/new`) becomes
//     a native Pressable link routed through `onNavigate`.
//   - `@/components/feedback` `Skeleton` (3 loading bars) becomes a local
//     reduced-motion-aware pulsing `SkeletonBar`.
//   - `@/components/feedback` `ErrorDisplay` becomes a local status-aware native
//     ErrorDisplay mirroring the web 404 / 401-403 / 5xx / network branches and
//     keeping every `error.*` i18n key; `useOnlineStatus()` has no native
//     equivalent (no navigator.onLine / NetInfo dependency) so connectivity is
//     assumed up and only an ApiError status 0 is treated as offline.
//   - `@/components/motion` `FadeIn` becomes a reduced-motion-aware mount fade.
//   - `@/components/a11y` `VisuallyHidden as="label" htmlFor=...` is a web
//     <label>/<input> association; React Native has no label-for, so the visible
//     checkbox carries its `bulk.selectAll` / `automationList.selectAutomation`
//     copy directly on `accessibilityLabel` (same screen-reader meaning).
//   - the browser `<input type="checkbox">` (incl. the `ref.indeterminate`
//     master state) becomes a local accessible `Checkbox` (Pressable,
//     `accessibilityRole="checkbox"` with `checked: true | false | 'mixed'`).
//   - react-router `Link to={...}` navigation (row name + empty CTA) becomes an
//     `onNavigate(path)` callback wired to a Pressable with
//     `accessibilityRole="link"`, preserving the `/automations/{id}` and
//     `/automations/new` paths. Precedent: Breadcrumbs parity port.
//   - `@/lib/icons` `Icons.play`/`Icons.pause`/`Icons.delete` (lucide) are
//     decorative; they map to text glyphs (play/pause/cross) — the action labels
//     carry the meaning.
//   - `@/hooks/useBulkSelection` has no native parity module, so the generic
//     selection hook is inlined verbatim (pure logic, no DOM).
//   - `@/hooks/usePageTitle` (sets document.title) is a native no-op shim.
//   - react-i18next `useTranslation` becomes a local t(key, fallback, vars?)
//     shim that interpolates `{{name}}`, preserving every key + English copy.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {isApiError} from '../../../api/client';
import {
  useAutomations,
  useBulkAutomationsUpdate,
  type Automation,
} from '../../../api/hooks/useAutomations';
import {BulkActionsToolbar as BulkActionToolbar} from '../../../components/data-display/BulkActionsToolbar';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type TranslationVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, vars?: TranslationVars) => {
      if (vars == null) {
        return fallback;
      }
      return fallback.replace(
        /\{\{\s*([^}\s]+)\s*\}\}/g,
        (match, name: string) =>
          Object.prototype.hasOwnProperty.call(vars, name)
            ? String(vars[name])
            : match,
      );
    },
    [],
  );
}

/* ─── usePageTitle (web sets document.title; native has no document) ───────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── useReduceMotion + FadeIn (web `@/components/motion` FadeIn) ───────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      duration: 320,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

FadeIn.displayName = 'FadeIn';

/* ─── useBulkSelection (web `@/hooks/useBulkSelection`, inlined verbatim) ───── */

interface BulkSelection<T> {
  selectedIds: Set<T>;
  count: number;
  isSelected: (id: T) => boolean;
  toggle: (id: T) => void;
  setSelected: (id: T, selected: boolean) => void;
  selectAll: (ids: T[]) => void;
  clear: () => void;
  masterState: (visibleIds: T[]) => 'none' | 'some' | 'all';
  toggleAll: (visibleIds: T[]) => void;
}

function useBulkSelection<T = number>(): BulkSelection<T> {
  const [selectedIds, setIds] = useState<Set<T>>(() => new Set<T>());

  const isSelected = useCallback((id: T) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id: T) => {
    setIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const setSelected = useCallback((id: T, sel: boolean) => {
    setIds(prev => {
      const has = prev.has(id);
      if (has === sel) {
        return prev;
      }
      const next = new Set(prev);
      if (sel) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: T[]) => {
    if (ids.length === 0) {
      return;
    }
    setIds(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const clear = useCallback(() => {
    setIds(prev => (prev.size === 0 ? prev : new Set<T>()));
  }, []);

  const masterState = useCallback(
    (visible: T[]): 'none' | 'some' | 'all' => {
      if (visible.length === 0) {
        return 'none';
      }
      let hits = 0;
      for (const id of visible) {
        if (selectedIds.has(id)) {
          hits++;
        }
      }
      if (hits === 0) {
        return 'none';
      }
      if (hits === visible.length) {
        return 'all';
      }
      return 'some';
    },
    [selectedIds],
  );

  const toggleAll = useCallback((visible: T[]) => {
    if (visible.length === 0) {
      return;
    }
    setIds(prev => {
      const allSelected = visible.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of visible) {
          next.delete(id);
        }
      } else {
        for (const id of visible) {
          next.add(id);
        }
      }
      return next;
    });
  }, []);

  return useMemo<BulkSelection<T>>(
    () => ({
      selectedIds,
      count: selectedIds.size,
      isSelected,
      toggle,
      setSelected,
      selectAll,
      clear,
      masterState,
      toggleAll,
    }),
    [
      selectedIds,
      isSelected,
      toggle,
      setSelected,
      selectAll,
      clear,
      masterState,
      toggleAll,
    ],
  );
}

/* ─── Checkbox (web `<input type="checkbox">` incl. ref.indeterminate) ─────── */

function Checkbox({
  accessibilityLabel,
  checked,
  indeterminate = false,
  onToggle,
  testID,
}: {
  accessibilityLabel: string;
  checked: boolean;
  indeterminate?: boolean;
  onToggle: () => void;
  testID?: string;
}) {
  const on = checked || indeterminate;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="checkbox"
      accessibilityState={{checked: indeterminate ? 'mixed' : checked}}
      hitSlop={8}
      onPress={onToggle}
      style={({pressed}) => [
        styles.checkbox,
        on && styles.checkboxOn,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      {indeterminate ? (
        <View style={styles.checkboxDash} />
      ) : checked ? (
        <AppText style={styles.checkboxGlyph} weight="bold">
          {'\u2713'}
        </AppText>
      ) : null}
    </Pressable>
  );
}

Checkbox.displayName = 'Checkbox';

/* ─── StatusBadge (web `@/components/ui` Badge variant) ─────────────────────── */

type StatusVariant = 'success' | 'neutral';

function StatusBadge({label, variant}: {label: string; variant: StatusVariant}) {
  return (
    <View style={[styles.badge, badgeStyles[variant]]}>
      <AppText
        style={[styles.badgeText, badgeTextStyles[variant]]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

StatusBadge.displayName = 'StatusBadge';

/* ─── ActionGlyph (web `@/lib/icons` lucide icons, decorative) ──────────────── */

function ActionGlyph({danger, glyph}: {danger?: boolean; glyph: string}) {
  return (
    <AppText
      style={[styles.actionGlyph, danger ? styles.actionGlyphDanger : null]}
      weight="bold">
      {glyph}
    </AppText>
  );
}

/* ─── SkeletonBar (web `@/components/feedback` Skeleton) ────────────────────── */

function SkeletonBar() {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 720,
          easing: Easing.inOut(Easing.ease),
          toValue: 0.45,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return <Animated.View style={[styles.skeletonBar, {opacity: pulse}]} />;
}

function SkeletonRows() {
  return (
    <View style={styles.skeletonWrap} testID="automation-list-skeleton">
      <SkeletonBar />
      <SkeletonBar />
      <SkeletonBar />
    </View>
  );
}

/* ─── ErrorDisplay (web `@/components/feedback` ErrorDisplay) ───────────────── */

function useOnlineStatus(): boolean {
  // Native parity: web `useOnlineStatus()` reads navigator.onLine + online/offline
  // events. React Native has no navigator.onLine and this app does not depend on
  // @react-native-community/netinfo, so connectivity is assumed up; only an
  // ApiError with status 0 (transport failure) is treated as offline below.
  return true;
}

function ErrorActionButton({
  disabled = false,
  label,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.errorAction,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <AppText style={styles.errorActionText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

function ErrorPanel({
  action,
  compact,
  glyph,
  message,
  title,
}: {
  action?: ReactNode;
  compact?: boolean;
  glyph: string;
  message: string;
  title: string;
}) {
  return (
    <View
      accessibilityRole="alert"
      style={[styles.errorRoot, compact && styles.errorCompact]}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.errorGlyph}>
        {glyph}
      </AppText>
      <AppText style={styles.errorTitle} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.errorMessage} tone="muted" variant="caption">
        {message}
      </AppText>
      {action}
    </View>
  );
}

function ErrorDisplay({
  compact = false,
  error,
  listHref,
  onNavigate,
  onRetry,
  resourceName,
}: {
  compact?: boolean;
  error: unknown;
  listHref?: string;
  onNavigate?: (path: string) => void;
  onRetry?: () => void;
  resourceName?: string;
}) {
  const t = useNativeTranslationFallback();
  const online = useOnlineStatus();

  if (!error) {
    return null;
  }

  const status = isApiError(error) ? error.status : undefined;

  // 404 — record was deleted or URL is wrong.
  if (status === 404) {
    const thing = resourceName ?? t('error.notFound.thingDefault', 'Resource');
    return (
      <ErrorPanel
        action={
          listHref ? (
            <ErrorActionButton
              label={t('error.notFound.cta', 'Back to list')}
              onPress={() => onNavigate?.(listHref)}
            />
          ) : undefined
        }
        compact={compact}
        glyph={'\u2370'}
        message={t(
          'error.notFound.message',
          'It may have been deleted or the link is wrong.',
        )}
        title={t('error.notFound.title', '{{thing}} not found', {thing})}
      />
    );
  }

  // 401 / 403 — session expired or RBAC mismatch.
  if (status === 401 || status === 403) {
    return (
      <ErrorPanel
        action={
          <ErrorActionButton
            label={t('error.unauthorized.cta', 'Sign in')}
            onPress={() => onNavigate?.('/login')}
          />
        }
        compact={compact}
        glyph={'\u26BF'}
        message={t(
          'error.unauthorized.message',
          'Your session has expired. Please sign in again.',
        )}
        title={t('error.unauthorized.title', 'Sign in required')}
      />
    );
  }

  // 5xx — backend failure.
  if (status !== undefined && status >= 500) {
    return (
      <ErrorPanel
        action={
          onRetry ? (
            <ErrorActionButton
              label={t('error.retry', 'Retry')}
              onPress={onRetry}
            />
          ) : undefined
        }
        compact={compact}
        glyph={'\u26A0'}
        message={t(
          'error.serverError.message',
          'Something went wrong on our end. Please try again.',
        )}
        title={t('error.serverError.title', 'Server error')}
      />
    );
  }

  // Network / offline / unknown.
  const isOffline = !online || status === 0;
  return (
    <ErrorPanel
      action={
        onRetry ? (
          <ErrorActionButton
            disabled={isOffline}
            label={
              isOffline
                ? t('error.network.retryWhenOnline', 'Retry when online')
                : t('error.retry', 'Retry')
            }
            onPress={onRetry}
          />
        ) : undefined
      }
      compact={compact}
      glyph={isOffline ? '\u2601' : '\u26A0'}
      message={
        isOffline
          ? t(
              'error.network.offlineDetail',
              "We'll retry automatically when your connection returns.",
            )
          : t(
              'error.network.message',
              'Check your internet connection and try again.',
            )
      }
      title={
        isOffline
          ? t('error.network.offlineTitle', "You're offline")
          : t('error.network.title', "Can't reach server")
      }
    />
  );
}

ErrorDisplay.displayName = 'ErrorDisplay';

/* ─── column widths (web <table> columns) ──────────────────────────────────── */

const COL = {
  desc: 240,
  name: 200,
  runs: 88,
  select: 48,
  status: 132,
} as const;

/* ─── AutomationListPage ───────────────────────────────────────────────────── */

interface AutomationListPageProps {
  /**
   * Native-safe replacement for react-router `Link` navigation. Invoked with the
   * web path when a row name link or the empty-state CTA is pressed
   * (`/automations/{id}`, `/automations/new`). Optional so the screen can mount
   * before wiring its navigator; absent => links render but are inert.
   */
  onNavigate?: (path: string) => void;
}

export default function AutomationListPage({
  onNavigate,
}: AutomationListPageProps = {}) {
  const t = useNativeTranslationFallback();
  usePageTitle(t('automationList.title', 'Automations (list)'));

  const {data: rowsRaw, isLoading, error} = useAutomations();
  const automations: Automation[] = useMemo(() => rowsRaw ?? [], [rowsRaw]);
  const visibleIds = useMemo(() => automations.map(a => a.id), [automations]);

  const sel = useBulkSelection<number>();
  const bulkUpdate = useBulkAutomationsUpdate();

  const masterState = sel.masterState(visibleIds);

  const onMasterToggle = useCallback(() => {
    sel.toggleAll(visibleIds);
  }, [sel, visibleIds]);

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="automation-list-page">
      <View style={styles.header}>
        <AppText style={styles.pageTitle} variant="title" weight="bold">
          {t('automationList.title', 'Automations (list)')}
        </AppText>
        <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
          {t(
            'automationList.subtitle',
            'Bulk-manage automations. Click an automation to edit it in the builder.',
          )}
        </AppText>
      </View>

      <FadeIn style={styles.stack}>
        <BulkActionToolbar
          actions={[
            {
              id: 'enable',
              label: t('automationList.bulk.enable', 'Enable'),
              icon: <ActionGlyph glyph={'\u25B6'} />,
              onClick: async ids => {
                await bulkUpdate.mutateAsync({
                  ids: ids.map(i => Number(i)),
                  op: 'enable',
                });
                sel.clear();
              },
            },
            {
              id: 'disable',
              label: t('automationList.bulk.disable', 'Disable'),
              icon: <ActionGlyph glyph={'\u2225'} />,
              onClick: async ids => {
                await bulkUpdate.mutateAsync({
                  ids: ids.map(i => Number(i)),
                  op: 'disable',
                });
                sel.clear();
              },
            },
            {
              id: 'delete',
              label: t('automationList.bulk.delete', 'Delete'),
              variant: 'danger',
              icon: <ActionGlyph danger glyph={'\u2715'} />,
              confirm: {
                title: t(
                  'automationList.bulk.deleteConfirm.title',
                  'Delete automations?',
                ),
                description: t(
                  'automationList.bulk.deleteConfirm.body',
                  'Selected automations will stop running and be removed permanently. This cannot be undone.',
                ),
                confirmLabel: t('common.delete', 'Delete'),
              },
              onClick: async ids => {
                await bulkUpdate.mutateAsync({
                  ids: ids.map(i => Number(i)),
                  op: 'delete',
                });
                sel.clear();
              },
            },
          ]}
          itemNoun={{
            one: t('automationList.noun.one', 'automation'),
            other: t('automationList.noun.other', 'automations'),
          }}
          onClear={sel.clear}
          selectedIds={Array.from(sel.selectedIds)}
          total={visibleIds.length}
        />

        <GlassPanel style={styles.panel}>
          {isLoading ? (
            <SkeletonRows />
          ) : error ? (
            <ErrorDisplay error={error} onNavigate={onNavigate} />
          ) : automations.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                message={t(
                  'automationList.empty.body',
                  'Create your first automation in the builder.',
                )}
                title={t('automationList.empty.title', 'No automations yet')}
              />
              <Pressable
                accessibilityLabel={t(
                  'automationList.empty.cta',
                  'Open builder',
                )}
                accessibilityRole="link"
                hitSlop={6}
                onPress={() => onNavigate?.('/automations/new')}
                style={({pressed}) => [
                  styles.emptyCta,
                  pressed && styles.pressed,
                ]}
                testID="automation-list-empty-cta">
                <AppText
                  style={styles.emptyCtaText}
                  variant="caption"
                  weight="semibold">
                  {t('automationList.empty.cta', 'Open builder')}
                </AppText>
              </Pressable>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.table}>
                <View style={styles.headerRow}>
                  <View style={[styles.cell, {width: COL.select}]}>
                    <Checkbox
                      accessibilityLabel={t('bulk.selectAll', 'Select all')}
                      checked={masterState === 'all'}
                      indeterminate={masterState === 'some'}
                      onToggle={onMasterToggle}
                      testID="automation-list-master"
                    />
                  </View>
                  <View style={[styles.cell, {width: COL.name}]}>
                    <AppText
                      style={styles.headerText}
                      tone="secondary"
                      variant="caption"
                      weight="semibold">
                      {t('automationList.col.name', 'Name')}
                    </AppText>
                  </View>
                  <View style={[styles.cell, {width: COL.desc}]}>
                    <AppText
                      style={styles.headerText}
                      tone="secondary"
                      variant="caption"
                      weight="semibold">
                      {t('automationList.col.desc', 'Description')}
                    </AppText>
                  </View>
                  <View
                    style={[styles.cell, styles.cellRight, {width: COL.runs}]}>
                    <AppText
                      style={styles.headerText}
                      tone="secondary"
                      variant="caption"
                      weight="semibold">
                      {t('automationList.col.runs', 'Runs')}
                    </AppText>
                  </View>
                  <View style={[styles.cell, {width: COL.status}]}>
                    <AppText
                      style={styles.headerText}
                      tone="secondary"
                      variant="caption"
                      weight="semibold">
                      {t('automationList.col.status', 'Status')}
                    </AppText>
                  </View>
                </View>

                {automations.map(a => {
                  const checked = sel.isSelected(a.id);
                  return (
                    <View
                      key={a.id}
                      style={[styles.row, checked && styles.rowSelected]}>
                      <View style={[styles.cell, {width: COL.select}]}>
                        <Checkbox
                          accessibilityLabel={t(
                            'automationList.selectAutomation',
                            'Select automation {{name}}',
                            {name: a.name},
                          )}
                          checked={checked}
                          onToggle={() => sel.toggle(a.id)}
                          testID={`automation-${a.id}-select`}
                        />
                      </View>
                      <View style={[styles.cell, {width: COL.name}]}>
                        <Pressable
                          accessibilityLabel={a.name}
                          accessibilityRole="link"
                          hitSlop={4}
                          onPress={() => onNavigate?.(`/automations/${a.id}`)}
                          testID={`automation-${a.id}-link`}>
                          {({pressed}) => (
                            <AppText
                              numberOfLines={1}
                              style={[
                                styles.linkText,
                                pressed && styles.linkPressed,
                              ]}>
                              {a.name}
                            </AppText>
                          )}
                        </Pressable>
                      </View>
                      <View style={[styles.cell, {width: COL.desc}]}>
                        <AppText
                          numberOfLines={2}
                          style={styles.descText}
                          tone="secondary"
                          variant="caption">
                          {a.description ?? '\u2014'}
                        </AppText>
                      </View>
                      <View
                        style={[
                          styles.cell,
                          styles.cellRight,
                          {width: COL.runs},
                        ]}>
                        <AppText style={styles.runsText} tone="secondary">
                          {a.execution_count ?? 0}
                        </AppText>
                      </View>
                      <View style={[styles.cell, {width: COL.status}]}>
                        {a.enabled ? (
                          <StatusBadge
                            label={t('common.enabled', 'Enabled')}
                            variant="success"
                          />
                        ) : (
                          <StatusBadge
                            label={t('common.disabled', 'Disabled')}
                            variant="neutral"
                          />
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </GlassPanel>
      </FadeIn>
    </ScrollView>
  );
}

AutomationListPage.displayName = 'AutomationListPage';

const styles = StyleSheet.create({
  actionGlyph: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    lineHeight: 16,
  },
  actionGlyphDanger: {
    color: colors.danger,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  cell: {
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  checkbox: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkboxDash: {
    backgroundColor: colors.accent,
    borderRadius: 1,
    height: 2,
    width: 10,
  },
  checkboxGlyph: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 15,
  },
  checkboxOn: {
    borderColor: colors.borderAccent,
  },
  descText: {
    lineHeight: 16,
  },
  disabled: {
    opacity: 0.48,
  },
  emptyCta: {
    alignSelf: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  emptyCtaText: {
    color: colors.accent,
    textAlign: 'center',
  },
  emptyWrap: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  errorAction: {
    alignSelf: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  errorActionText: {
    color: colors.danger,
  },
  errorCompact: {
    paddingVertical: spacing.md,
  },
  errorGlyph: {
    color: colors.danger,
    fontSize: 28,
    lineHeight: 32,
  },
  errorMessage: {
    lineHeight: 18,
    maxWidth: 360,
    textAlign: 'center',
  },
  errorRoot: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  errorTitle: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  header: {
    gap: spacing.xs,
  },
  headerRow: {
    backgroundColor: colors.surfaceRaised,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
  },
  headerText: {
    letterSpacing: 0.3,
  },
  linkPressed: {
    opacity: 0.7,
  },
  linkText: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  pageSubtitle: {
    lineHeight: 18,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.82,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  rowSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  runsText: {
    fontVariant: ['tabular-nums'],
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  skeletonBar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 40,
    width: '100%',
  },
  skeletonWrap: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  stack: {
    gap: spacing.md,
  },
  table: {
    flexDirection: 'column',
  },
});

const badgeStyles = StyleSheet.create<Record<StatusVariant, ViewStyle>>({
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

const badgeTextStyles = StyleSheet.create<Record<StatusVariant, TextStyle>>({
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
});

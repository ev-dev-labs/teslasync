/**
 * Native parity port of web/src/features/exports/pages/ExportsPage.tsx.
 *
 * The web page lists past export jobs with bulk delete: it reads the
 * `/export/jobs` query via `useExportJobs`, tracks row selection with the
 * shared `useBulkSelection` primitive, renders the shared
 * `AIPiiRedactionSharedExports` AI card + a `BulkActionToolbar` (bulk delete
 * backed by `POST /export/jobs/bulk`), and shows the jobs in a table with
 * loading / error / empty states plus a per-row Download link for `ready`
 * jobs (`exportDownloadUrl`).
 *
 * This native port preserves that contract 1:1 — the same `useExportJobs` /
 * `useBulkExportsDelete` / `exportDownloadUrl` hooks + exact API paths (via the
 * already-ported native useExports hook), the same `jobs` / `visibleIds` /
 * `sel` / `masterState` / `onMasterToggle` / `statusVariant` state + the same
 * delete action (label, danger variant, confirm copy, `mutateAsync` of
 * stringified ids + `sel.clear()`), every i18n key + fallback verbatim, and
 * every table column + loading / error / empty branch — using React Native
 * primitives, the existing native AppText / GlassPanel / EmptyState + design
 * tokens, the already-ported web-parity BulkActionsToolbar +
 * AIPiiRedactionSharedExports, and locally-reproduced native-safe shims for the
 * remaining web-only dependencies.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2): no native i18next runtime, so an
 *     inline native-safe `t(key, fallback?, vars?)` shim returns the English
 *     fallback (else the key) and supports the `{{id}}` interpolation used by
 *     `exportsList.selectExport`.
 *   - `@/components/ui` GlassPanel/Badge (web L4): GlassPanel is the existing
 *     native port; Badge reproduced locally as a native chip with the same
 *     success/danger/info/neutral variant intent.
 *   - `@/components/data-display` BulkActionToolbar (web L5): imported from the
 *     already-ported native BulkActionsToolbar (same selectedIds/total/onClear/
 *     itemNoun/actions contract).
 *   - `@/components/layout` PageContainer (web L6): reproduced locally as a
 *     native-safe ScrollView scaffold (title / subtitle / children).
 *   - `@/components/motion` FadeIn (web L7): framer-motion entrance → static
 *     passthrough View (the established Layout precedent).
 *   - `@/components/feedback` EmptyState/Skeleton/ErrorDisplay (web L8):
 *     EmptyState is the existing native port (title/message); Skeleton → static
 *     placeholder bars; ErrorDisplay → an inline error box showing the message.
 *   - `@/components/a11y` VisuallyHidden (web L9): the DOM `<label>`/`htmlFor`
 *     association is reduced — native checkboxes carry their label via
 *     `accessibilityLabel` directly, so no off-screen label node is needed.
 *   - `@/components/ai/AIPiiRedactionSharedExports` (web L10): imported from the
 *     already-ported native component.
 *   - `@/hooks/usePageTitle` (web L12): `document.title` is browser-only → a
 *     no-op shim (the navigator owns the native header title).
 *   - `@/hooks/useBulkSelection` (web L13): ported verbatim below (generic
 *     Set-backed selection with masterState/toggleAll).
 *   - `@/api/hooks/useExports` (web L15-20): imported from the already-ported
 *     native hook (same `/export/jobs` + `/export/jobs/bulk` paths + shapes).
 *   - `@/lib/icons` Icons.delete (web L21, lucide Trash2): → a semantic trash
 *     glyph constant (the icon→glyph precedent).
 *   - `@/lib/dateFormat` formatDateTime + `@/lib/numberFormat` formatBytes
 *     (web L22-23): ported verbatim below.
 *   - the DOM `<table>`/`<thead>`/`<tbody>`/`<input type=checkbox>`/`<a download>`
 *     (web L115-194): reproduced as native View rows + Pressable checkboxes +
 *     a Pressable Download link that opens `exportDownloadUrl` via `Linking`.
 */
import React, {useCallback, useMemo, useState, type ReactNode} from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  BulkActionsToolbar,
  type BulkAction,
} from '../../../components/data-display/BulkActionsToolbar';
import {AIPiiRedactionSharedExports} from '../../../components/ai/AIPiiRedactionSharedExports';
import {
  exportDownloadUrl,
  useBulkExportsDelete,
  useExportJobs,
  type ExportJobSummary,
} from '../../../api/hooks/useExports';
import {AppText} from '../../../../components/ui/AppText';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react icon stand-in (web L21 Icons.delete = Trash2)         */
/* ------------------------------------------------------------------ */

const ICON_DELETE = '\uD83D\uDDD1'; // 🗑 (Trash2)
const CHECK_MARK = '\u2713'; // ✓

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback?: string, vars?: TVars) => string;

/** Mirrors `t(key, default?, vars?)`: the English default else the key, with
 *  `{{name}}` interpolation for the parameterised `selectExport` label. */
function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, vars) => {
      const base = fallback ?? key;
      if (!vars) {
        return base;
      }
      return base.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        vars[name] === undefined ? '' : String(vars[name]),
      );
    },
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  native-safe usePageTitle (web document.title is browser-only)      */
/* ------------------------------------------------------------------ */

function usePageTitle(_title: string): void {
  // The web hook writes document.title; on native the navigator owns the
  // header title, so the resolved title is intentionally not applied here.
}

/* ------------------------------------------------------------------ */
/*  ported lib helpers (web @/lib/numberFormat + @/lib/dateFormat)     */
/* ------------------------------------------------------------------ */

/** Ported from web `formatBytes` — binary units with the dashboard's exact
 *  thresholds and one-decimal output. */
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Ported from web `formatDateTime` — full date + time, "—" for nullish /
 *  unparseable input. */
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ------------------------------------------------------------------ */
/*  ported selection primitive (web @/hooks/useBulkSelection)          */
/* ------------------------------------------------------------------ */

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

  const isSelected = useCallback(
    (id: T) => selectedIds.has(id),
    [selectedIds],
  );

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

/* ------------------------------------------------------------------ */
/*  native motion (web @/components/motion FadeIn)                     */
/* ------------------------------------------------------------------ */

function FadeIn({children}: {children: ReactNode}) {
  return <View style={styles.section}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  native PageContainer (web @/components/layout PageContainer)        */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  testID?: string;
}

function PageContainer({title, subtitle, children, testID}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'exports-page'}>
      <View style={styles.scaffoldHeader}>
        <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.scaffoldSubtitle} tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={styles.scaffoldBody}>{children}</View>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  native Badge (web @/components/ui Badge variants)                  */
/* ------------------------------------------------------------------ */

type BadgeVariant = 'success' | 'danger' | 'info' | 'neutral';

function Badge({variant, children}: {variant: BadgeVariant; children: ReactNode}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText
        numberOfLines={1}
        style={[styles.badgeText, badgeTextStyles[variant]]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native Checkbox (web <input type="checkbox"> + indeterminate)      */
/* ------------------------------------------------------------------ */

function Checkbox({
  accessibilityLabel,
  checked,
  indeterminate = false,
  onToggle,
}: {
  accessibilityLabel: string;
  checked: boolean;
  indeterminate?: boolean;
  onToggle: () => void;
}) {
  const active = checked || indeterminate;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="checkbox"
      accessibilityState={{checked: indeterminate ? 'mixed' : checked}}
      hitSlop={8}
      onPress={onToggle}
      style={({pressed}) => [styles.checkbox, pressed && styles.pressed]}>
      <View style={[styles.checkboxBox, active && styles.checkboxBoxActive]}>
        {checked ? (
          <AppText style={styles.checkboxMark} variant="caption" weight="bold">
            {CHECK_MARK}
          </AppText>
        ) : indeterminate ? (
          <View style={styles.checkboxDash} />
        ) : null}
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Page (web L33-200)                                                 */
/* ------------------------------------------------------------------ */

export default function ExportsPage() {
  const t = useNativeTranslation();
  usePageTitle(t('exportsList.title', 'Exports'));

  const {data: jobsRaw, isLoading, error} = useExportJobs();
  const jobs = useMemo<ExportJobSummary[]>(() => jobsRaw ?? [], [jobsRaw]);
  const visibleIds = useMemo(() => jobs.map(j => j.id), [jobs]);

  const sel = useBulkSelection<string>();
  const bulkDelete = useBulkExportsDelete();

  const masterState = sel.masterState(visibleIds);

  const onMasterToggle = useCallback(() => {
    sel.toggleAll(visibleIds);
  }, [sel, visibleIds]);

  const statusVariant = (s: ExportJobSummary['status']): BadgeVariant => {
    if (s === 'ready') {
      return 'success';
    }
    if (s === 'failed') {
      return 'danger';
    }
    if (s === 'processing' || s === 'queued') {
      return 'info';
    }
    return 'neutral';
  };

  const actions: BulkAction[] = [
    {
      id: 'delete',
      label: t('exportsList.bulk.delete', 'Delete'),
      variant: 'danger',
      icon: ICON_DELETE,
      confirm: {
        title: t('exportsList.bulk.deleteConfirm.title', 'Delete export jobs?'),
        description: t(
          'exportsList.bulk.deleteConfirm.body',
          'Selected jobs and their downloadable artifacts will be permanently removed.',
        ),
        confirmLabel: t('common.delete', 'Delete'),
      },
      onClick: async ids => {
        await bulkDelete.mutateAsync(ids.map(i => String(i)));
        sel.clear();
      },
    },
  ];

  return (
    <PageContainer
      subtitle={t(
        'exportsList.subtitle',
        'Manage your past export jobs. Select rows to delete in bulk.',
      )}
      title={t('exportsList.title', 'Exports')}>
      <FadeIn>
        <AIPiiRedactionSharedExports />
        <BulkActionsToolbar
          actions={actions}
          itemNoun={{
            one: t('exportsList.noun.one', 'export'),
            other: t('exportsList.noun.other', 'exports'),
          }}
          onClear={sel.clear}
          selectedIds={Array.from(sel.selectedIds)}
          total={visibleIds.length}
        />

        <GlassPanel style={styles.panel}>
          {isLoading ? (
            <View style={styles.skeletonWrap} testID="exports-loading">
              <View style={styles.skeletonBar} />
              <View style={styles.skeletonBar} />
              <View style={styles.skeletonBar} />
            </View>
          ) : error ? (
            <View style={styles.errorBox} testID="exports-error">
              <AppText style={styles.errorText} tone="danger" variant="caption">
                {error.message}
              </AppText>
            </View>
          ) : jobs.length === 0 ? (
            <EmptyState
              message={t(
                'exportsList.empty.body',
                'Your future exports will appear here for download or deletion.',
              )}
              title={t('exportsList.empty.title', 'No exports yet')}
            />
          ) : (
            <View testID="exports-table">
              <View style={[styles.row, styles.headerRow]}>
                <View style={styles.checkboxCell}>
                  <Checkbox
                    accessibilityLabel={t('bulk.selectAll', 'Select all')}
                    checked={masterState === 'all'}
                    indeterminate={masterState === 'some'}
                    onToggle={onMasterToggle}
                  />
                </View>
                <AppText
                  numberOfLines={1}
                  style={[styles.headerCell, styles.colType]}>
                  {t('exportsList.col.type', 'Type')}
                </AppText>
                <AppText
                  numberOfLines={1}
                  style={[styles.headerCell, styles.colFormat]}>
                  {t('exportsList.col.format', 'Format')}
                </AppText>
                <AppText
                  numberOfLines={1}
                  style={[styles.headerCell, styles.colSize]}>
                  {t('exportsList.col.size', 'Size')}
                </AppText>
                <AppText
                  numberOfLines={1}
                  style={[styles.headerCell, styles.colCreated]}>
                  {t('exportsList.col.created', 'Created')}
                </AppText>
                <AppText
                  numberOfLines={1}
                  style={[styles.headerCell, styles.colStatus]}>
                  {t('exportsList.col.status', 'Status')}
                </AppText>
                <View style={styles.colAction} />
              </View>

              {jobs.map(j => {
                const checked = sel.isSelected(j.id);
                return (
                  <View
                    key={j.id}
                    style={[styles.row, checked && styles.rowSelected]}>
                    <View style={styles.checkboxCell}>
                      <Checkbox
                        accessibilityLabel={t(
                          'exportsList.selectExport',
                          'Select export {{id}}',
                          {id: j.id},
                        )}
                        checked={checked}
                        onToggle={() => sel.toggle(j.id)}
                      />
                    </View>
                    <AppText
                      numberOfLines={1}
                      style={[styles.cell, styles.colType, styles.cellPrimary]}>
                      {j.type}
                    </AppText>
                    <AppText
                      numberOfLines={1}
                      style={[styles.cell, styles.colFormat, styles.cellUpper]}
                      tone="secondary">
                      {j.format}
                    </AppText>
                    <AppText
                      numberOfLines={1}
                      style={[styles.cell, styles.colSize]}
                      tone="secondary">
                      {j.file_size != null ? formatBytes(j.file_size) : '—'}
                    </AppText>
                    <AppText
                      numberOfLines={1}
                      style={[styles.cell, styles.colCreated]}
                      tone="secondary">
                      {formatDateTime(j.created_at)}
                    </AppText>
                    <View style={[styles.cell, styles.colStatus]}>
                      <Badge variant={statusVariant(j.status)}>
                        {t(`exportsList.status.${j.status}`, j.status)}
                      </Badge>
                    </View>
                    <View style={[styles.cell, styles.colAction]}>
                      {j.status === 'ready' ? (
                        <Pressable
                          accessibilityLabel={t(
                            'exportsList.download',
                            'Download',
                          )}
                          accessibilityRole="link"
                          hitSlop={6}
                          onPress={() => {
                            Linking.openURL(exportDownloadUrl(j.id)).catch(
                              () => undefined,
                            );
                          }}
                          style={({pressed}) => [pressed && styles.pressed]}>
                          <AppText
                            numberOfLines={1}
                            style={styles.downloadText}
                            variant="caption"
                            weight="semibold">
                            {t('exportsList.download', 'Download')}
                          </AppText>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: typography.caption,
  },
  cell: {
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  cellPrimary: {
    color: colors.textPrimary,
  },
  cellUpper: {
    textTransform: 'uppercase',
  },
  checkbox: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 32,
    minWidth: 32,
  },
  checkboxBox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkboxBoxActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxCell: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
  },
  checkboxDash: {
    backgroundColor: colors.accent,
    borderRadius: 1,
    height: 2,
    width: 10,
  },
  checkboxMark: {
    color: colors.accent,
  },
  colAction: {
    alignItems: 'flex-end',
    flexBasis: 0,
    flexGrow: 1.4,
  },
  colCreated: {
    flexBasis: 0,
    flexGrow: 2,
  },
  colFormat: {
    flexBasis: 0,
    flexGrow: 1,
  },
  colSize: {
    flexBasis: 0,
    flexGrow: 1.2,
  },
  colStatus: {
    alignItems: 'flex-start',
    flexBasis: 0,
    flexGrow: 1.4,
  },
  colType: {
    flexBasis: 0,
    flexGrow: 2,
  },
  downloadText: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    margin: spacing.md,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  headerCell: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  headerRow: {
    backgroundColor: colors.surfaceRaised,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  panel: {
    marginTop: spacing.md,
    overflow: 'hidden',
    padding: 0,
  },
  pressed: {
    opacity: 0.7,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  scaffold: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  scaffoldBody: {
    gap: spacing.md,
  },
  scaffoldHeader: {
    gap: spacing.xs,
  },
  scaffoldSubtitle: {
    fontSize: typography.body,
  },
  scaffoldTitle: {
    color: colors.textPrimary,
  },
  section: {
    gap: spacing.md,
  },
  skeletonBar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 40,
  },
  skeletonWrap: {
    gap: spacing.sm,
    padding: spacing.md,
  },
});

const badgeVariantStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  danger: {
    color: colors.danger,
  },
  info: {
    color: colors.accent,
  },
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
});

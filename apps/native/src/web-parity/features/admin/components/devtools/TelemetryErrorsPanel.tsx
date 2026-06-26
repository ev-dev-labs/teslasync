// Native parity port of
// web/src/features/admin/components/devtools/TelemetryErrorsPanel.tsx.
//
// Renders the 4-state UI for the "View Errors" button: idle | loading | error |
// empty | data. The pre-fix web code only rendered the data state, which
// silently disappeared on the much more common empty / error / loading states.
// The raw-response disclosure beneath the empty state helps the operator
// distinguish "Tesla returned zero errors" (healthy) from "Tesla returned a
// shape we did not recognise" (which would also produce zero rows). The whole
// state machine, prop contract, state names, and copy-routing are preserved.
//
// Web dependencies absent from the native parity manifest are made native-safe
// (contract rules 4 & 5) and documented in the sidecar:
//
//   - `@/components/ui` Badge / Button / DataTable + `Column<T>` (web L1) have no
//     native module. Badge -> inline dot-pill, Button -> ghost Pressable,
//     DataTable -> a static native table (header + rows keyed by `rowKey`, with
//     lightweight `defaultPageSize: 50` paging preserved). `Column<T>` is carried
//     as a native-pragmatic subset (key / header / render / align); the web
//     DataTable's interactive features (sort, resize, column menu, virtualization)
//     have no native analogue here.
//   - `@/components/feedback` Skeleton (web L2) -> inline 3-bar shimmer placeholder
//     mirroring `<Skeleton lines={3} />`.
//   - `@/lib/icons` Icons.download (web L3) -> shared SemanticIcon `download` glyph.
//   - `./types` TelemetryError (web L5): the native sibling is not yet ported, so
//     the 4-field interface is mirrored locally and re-exported to keep this file
//     self-contained and typecheck-clean.
//   - Blob / URL.createObjectURL / document.createElement('a').click() /
//     URL.revokeObjectURL (web L84-90): browser-only file download is unavailable
//     on native. The same serialization (`JSON.stringify(errors, null, 2)`) and
//     filename (`telemetry-errors-${vin || 'all'}.json`) are handed to the
//     platform share sheet via React Native `Share.share`, preserving the export
//     intent without a DOM. Failures are swallowed so the button never crashes.
//   - HTML `<details>/<summary>/<pre>` raw disclosure (web L113-120) -> a native
//     collapsible (Pressable summary + caret) revealing the pretty-printed JSON in
//     a max-height ScrollView with a monospace block.
//
// This component receives all display copy as props (title, idleMessage,
// emptyMessage, rawDisclosureLabel, downloadLabel), exactly like the web source,
// so i18n intent is preserved upstream — no strings are hardcoded here.

import React, {useCallback, useState, type ReactNode} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

/**
 * Native mirror of web/src/features/admin/components/devtools/types.ts
 * `TelemetryError` (sibling not yet ported). Re-exported so native consumers and
 * the eventual ported types module share the same UI-normalised shape.
 */
export interface TelemetryError {
  rowKey: string;
  timestamp: string;
  code: string;
  message: string;
}

/**
 * Native-pragmatic subset of the web `@/components/ui` DataTable `Column<T>`.
 * Only the fields the panel actually consumes are carried; the web DataTable's
 * interactive column features (sortable / resizable / visibility / widths) are
 * runtime concerns with no analogue in this static native table.
 */
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'center' | 'right';
}

// Mirrors web `pagination={{ defaultPageSize: 50 }}`.
const DEFAULT_PAGE_SIZE = 50;
// Mirrors web `tableId="admin:fleet-api-errors"`.
const TABLE_ID = 'admin:fleet-api-errors';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

export interface TelemetryErrorsPanelProps {
  title: string;
  loading: boolean;
  error: string | undefined;
  requested: boolean;
  ok: boolean;
  errors: TelemetryError[];
  columns: Column<TelemetryError>[];
  vin: string;
  idleMessage: string;
  emptyMessage: string;
  rawData: unknown;
  rawDisclosureLabel: string;
  downloadLabel: string;
}

export function TelemetryErrorsPanel({
  title,
  loading,
  error,
  requested,
  ok,
  errors,
  columns,
  vin,
  idleMessage,
  emptyMessage,
  rawData,
  rawDisclosureLabel,
  downloadLabel,
}: TelemetryErrorsPanelProps) {
  // Idle: the operator has not pressed "View Errors" yet.
  if (!requested) {
    return (
      <View style={styles.panel}>
        <PanelTitle title={title} />
        <AppText style={styles.idleText} tone="muted">
          {idleMessage}
        </AppText>
      </View>
    );
  }

  // Loading: request in flight.
  if (loading) {
    return (
      <View style={styles.panel}>
        <PanelTitle title={title} />
        <View style={styles.skeletonWrap}>
          <SkeletonLines lines={3} />
        </View>
      </View>
    );
  }

  // Error: request failed.
  if (error) {
    return (
      <View style={styles.panelError}>
        <PanelTitle title={title} />
        <AppText style={styles.errorText}>{error}</AppText>
      </View>
    );
  }

  // Data: request succeeded and produced rows.
  if (errors.length > 0) {
    return (
      <View style={styles.dataWrap}>
        <ErrorsTable columns={columns} rows={errors} />
        <DownloadButton errors={errors} label={downloadLabel} vin={vin} />
      </View>
    );
  }

  // Empty: request succeeded but produced zero rows. If extraction returned
  // ok=false (unknown shape) we surface the raw response so the operator can
  // debug Tesla's wire-shape drift; if ok=true the vehicle simply has no errors.
  return (
    <View style={styles.panel}>
      <View style={styles.titleRow}>
        <PanelTitle title={title} />
        <StateBadge ok={ok} />
      </View>
      <AppText style={styles.emptyText} tone="secondary">
        {emptyMessage}
      </AppText>
      {!ok && rawData != null ? (
        <RawDisclosure label={rawDisclosureLabel} rawData={rawData} />
      ) : null}
    </View>
  );
}

function PanelTitle({title}: {title: string}) {
  return (
    <AppText style={styles.title} tone="secondary" variant="caption" weight="semibold">
      {title}
    </AppText>
  );
}

function SkeletonLines({lines}: {lines: number}) {
  const widths = ['100%', '92%', '80%', '88%', '76%'];
  return (
    <View style={styles.skeletonLines}>
      {Array.from({length: lines}).map((_, index) => (
        <View
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          style={[styles.skeletonBar, {width: widths[index % widths.length] as ViewStyle['width']}]}
        />
      ))}
    </View>
  );
}

function StateBadge({ok}: {ok: boolean}) {
  const variant = ok ? 'success' : 'warning';
  return (
    <View style={[styles.badge, badgeToneStyles[variant]]}>
      <View style={[styles.badgeDot, badgeDotStyles[variant]]} />
      <AppText style={[styles.badgeLabel, badgeTextStyles[variant]]} variant="caption" weight="semibold">
        {ok ? '0' : '?'}
      </AppText>
    </View>
  );
}

interface ErrorsTableProps {
  columns: Column<TelemetryError>[];
  rows: TelemetryError[];
}

function ErrorsTable({columns, rows}: ErrorsTableProps) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * DEFAULT_PAGE_SIZE;
  const visibleRows = rows.slice(start, start + DEFAULT_PAGE_SIZE);

  return (
    <View>
      <View accessibilityRole="summary" style={styles.table} testID={TABLE_ID}>
        <View style={[styles.row, styles.headerRow]}>
          {columns.map(column => (
            <View key={column.key} style={[styles.cell, alignStyle(column.align)]}>
              <AppText
                style={[styles.headerCellText, headerTextAlign(column.align)]}
                tone="muted"
                variant="caption"
                weight="semibold">
                {column.header}
              </AppText>
            </View>
          ))}
        </View>
        {visibleRows.map(row => (
          <View key={row.rowKey} style={[styles.row, styles.bodyRow]}>
            {columns.map(column => (
              <View key={column.key} style={[styles.cell, alignStyle(column.align)]}>
                {column.render(row)}
              </View>
            ))}
          </View>
        ))}
      </View>
      {pageCount > 1 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityLabel="Previous page"
            accessibilityRole="button"
            accessibilityState={{disabled: currentPage === 0}}
            disabled={currentPage === 0}
            hitSlop={8}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            style={({pressed}) => [
              styles.pagerButton,
              currentPage === 0 && styles.disabled,
              pressed && currentPage !== 0 && styles.pressed,
            ]}>
            <SemanticIcon decorative name="previous" size="sm" style={styles.pagerIcon} />
          </Pressable>
          <AppText style={styles.pagerLabel} tone="muted" variant="caption">
            {`${currentPage + 1} / ${pageCount}`}
          </AppText>
          <Pressable
            accessibilityLabel="Next page"
            accessibilityRole="button"
            accessibilityState={{disabled: currentPage >= pageCount - 1}}
            disabled={currentPage >= pageCount - 1}
            hitSlop={8}
            onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            style={({pressed}) => [
              styles.pagerButton,
              currentPage >= pageCount - 1 && styles.disabled,
              pressed && currentPage < pageCount - 1 && styles.pressed,
            ]}>
            <SemanticIcon decorative name="next" size="sm" style={styles.pagerIcon} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

interface DownloadButtonProps {
  errors: TelemetryError[];
  vin: string;
  label: string;
}

function DownloadButton({errors, vin, label}: DownloadButtonProps) {
  const handlePress = useCallback(() => {
    const filename = `telemetry-errors-${vin || 'all'}.json`;
    const payload = JSON.stringify(errors, null, 2);
    Promise.resolve()
      .then(() => Share.share({title: filename, message: payload}))
      .catch(() => undefined);
  }, [errors, vin]);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={4}
      onPress={handlePress}
      style={({pressed}) => [styles.downloadButton, pressed && styles.pressed]}>
      <SemanticIcon decorative name="download" size="sm" style={styles.downloadIcon} />
      <AppText style={styles.downloadLabel} tone="secondary" variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

interface RawDisclosureProps {
  label: string;
  rawData: unknown;
}

function RawDisclosure({label, rawData}: RawDisclosureProps) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        hitSlop={4}
        onPress={() => setOpen(value => !value)}
        style={styles.summaryRow}>
        <SemanticIcon
          decorative
          name={open ? 'expand' : 'next'}
          size="sm"
          style={styles.summaryIcon}
        />
        <AppText style={styles.summaryText} tone="muted" variant="caption">
          {label}
        </AppText>
      </Pressable>
      {open ? (
        <ScrollView style={styles.preScroll} contentContainerStyle={styles.preContent}>
          <AppText style={styles.preText}>{JSON.stringify(rawData, null, 2)}</AppText>
        </ScrollView>
      ) : null}
    </View>
  );
}

function alignStyle(align: Column<TelemetryError>['align']): ViewStyle {
  if (align === 'right') {
    return styles.cellRight;
  }
  if (align === 'center') {
    return styles.cellCenter;
  }
  return styles.cellLeft;
}

function headerTextAlign(align: Column<TelemetryError>['align']): TextStyle {
  if (align === 'right') {
    return styles.textRight;
  }
  if (align === 'center') {
    return styles.textCenter;
  }
  return styles.textLeft;
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  panelError: {
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 12,
    lineHeight: 16,
  },
  idleText: {
    fontSize: 14,
    fontStyle: 'italic',
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  skeletonWrap: {
    marginTop: spacing.sm,
  },
  skeletonLines: {
    gap: spacing.sm,
  },
  skeletonBar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    height: 12,
  },
  dataWrap: {
    gap: spacing.sm,
  },
  table: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  headerRow: {
    backgroundColor: colors.surfaceSelected,
  },
  bodyRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.surfaceRaised,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  cellLeft: {
    alignItems: 'flex-start',
  },
  cellCenter: {
    alignItems: 'center',
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  headerCellText: {
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  textLeft: {
    textAlign: 'left',
  },
  textCenter: {
    textAlign: 'center',
  },
  textRight: {
    textAlign: 'right',
  },
  pager: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  pagerButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  pagerIcon: {
    borderWidth: 0,
  },
  pagerLabel: {
    minWidth: 36,
    textAlign: 'center',
  },
  downloadButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  downloadIcon: {
    borderWidth: 0,
  },
  downloadLabel: {
    letterSpacing: 0.2,
  },
  disclosure: {
    marginTop: spacing.sm,
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  summaryIcon: {
    borderWidth: 0,
  },
  summaryText: {
    fontSize: 12,
    lineHeight: 16,
  },
  preScroll: {
    backgroundColor: colors.surfaceGlass,
    borderRadius: 8,
    marginTop: spacing.xs,
    maxHeight: 256,
  },
  preContent: {
    padding: spacing.sm,
  },
  preText: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  badgeLabel: {
    letterSpacing: 0.2,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.82,
  },
});

const badgeToneStyles = StyleSheet.create<Record<'success' | 'warning', ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeDotStyles = StyleSheet.create<Record<'success' | 'warning', ViewStyle>>({
  success: {
    backgroundColor: colors.success,
  },
  warning: {
    backgroundColor: colors.warning,
  },
});

const badgeTextStyles = StyleSheet.create<Record<'success' | 'warning', TextStyle>>({
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});

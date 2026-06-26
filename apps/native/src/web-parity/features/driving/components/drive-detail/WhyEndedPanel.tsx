// Native parity port of
// web/src/features/driving/components/drive-detail/WhyEndedPanel.tsx.
//
// Drive Detail — "Why did this drive end?" diagnostic panel. Joins the FSM
// transition history with the raw signal window around `end_ts` (or `now()`
// while live) so an operator can correlate state changes with what the vehicle
// was reporting. Lazy by default: the panel starts collapsed and only fires the
// `useDriveWhyEnded` query once expanded (preserved verbatim — the hook's
// `enabled` flag is driven by `expanded`). The server validates
// `window ∈ {30s, 60s, 5m, 15m}`; the selector only ever emits those four.
//
// Web -> native mapping (contract rules 4, 5 & 7); each browser-only dependency
// is replaced with a React Native-safe equivalent and documented in the sidecar:
//   - react-i18next `useTranslation` (web L17, L45) -> inline useNativeTranslation():
//     a stable (key, fallback, params) => string shim that returns the English
//     fallback and interpolates {{trigger}}-style placeholders, preserving every
//     translation key + the trigger interpolation intent.
//   - lucide-react ChevronDown/ChevronRight/GitBranch/Radio (web L18) -> the
//     disclosure chevron becomes a muted ▾/▸ triangle glyph (a tiny inline
//     affordance, matching ElevationChart's tiny-glyph precedent); the FSM and
//     signal section markers become the shared SemanticIcon 'gitCompare' /
//     'radio' chips (guaranteed cross-platform render via the app icon system;
//     the web text-muted tone maps to each icon's semantic tone).
//   - `@/components/ui` Button/DataTable/GlassPanel/Select + Column/SelectOption
//     (web L20-27) -> native GlassPanel; a Pressable disclosure header (ghost,
//     aria-expanded -> accessibilityState.expanded); the window Select becomes
//     the shared single-select PillFilterBar (the documented native "pick one"
//     replacement); the signal DataTable becomes a static native table (header +
//     keyed rows + prev/next pager, defaultPageSize 25) — the web DataTable's
//     interactive sort/resize/column-menu/page-size dropdown are DOM concerns
//     with no native analogue (TelemetryErrorsPanel precedent). `Column<T>` and
//     `SelectOption` are mirrored locally as the field subset actually consumed.
//   - `@/components/ui/Typography` PanelTitle (web L28) -> local PanelTitle built
//     from AppText (semibold), matching the TelemetryErrorsPanel parity port.
//   - `@/components/data-display` Timeline/TimeStamp (web L29) -> the ported
//     native parity Timeline + TimeStamp from the same barrel.
//   - `@/components/feedback` EmptyState/Spinner (web L30) -> native EmptyState
//     (title+message); the error EmptyState's `action` retry is rendered as a
//     ghost AppButton beneath it; Spinner -> RN ActivityIndicator.
//   - `@/api/hooks/useDriving` useDriveWhyEnded + `@/types/admin-diagnostics`
//     types (web L31-36) -> the ported native useDriving hook, which also
//     re-exports DriveDiagnosticWindow/Transition/Signal (the native parity tree
//     has no separate admin-diagnostics module).

import React, {useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppButton} from '../../../../../components/ui/AppButton';
import {AppText} from '../../../../../components/ui/AppText';
import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {Timeline} from '../../../../components/data-display/Timeline';
import {TimeStamp} from '../../../../components/data-display/TimeStamp';
import {PillFilterBar} from '../../../../components/forms/PillFilterBar';
import {
  useDriveWhyEnded,
  type DriveDiagnosticSignal,
  type DriveDiagnosticTransition,
  type DriveDiagnosticWindow,
} from '../../../../api/hooks/useDriving';

interface WhyEndedPanelProps {
  driveId: string | number;
}

/** Native-pragmatic mirror of the web `@/components/ui` `SelectOption`. */
interface SelectOption {
  value: string;
  label: string;
}

/**
 * Native-pragmatic subset of the web `@/components/ui` DataTable `Column<T>`.
 * Only the fields this panel consumes are carried; the web DataTable's
 * interactive column features (sort / resize / visibility / widths) are runtime
 * concerns with no analogue in this static native table.
 */
interface Column<T> {
  key: string;
  header: string;
  visibleOnMobile?: boolean;
  render: (row: T) => ReactNode;
}

const WINDOWS: DriveDiagnosticWindow[] = ['30s', '60s', '5m', '15m'];

// Mirrors web `pagination={{ defaultPageSize: 25 }}`. The web pageSizeOptions
// dropdown is a DOM DataTable affordance represented on native by this fixed
// default plus prev/next pager navigation.
const DEFAULT_PAGE_SIZE = 25;
// Mirrors web `tableId="drive:why-ended-signals"`.
const SIGNAL_TABLE_ID = 'drive:why-ended-signals';

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

type TParams = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, params?: TParams) => string;

// react-i18next useTranslation replacement: returns the English fallback so the
// translation-key intent is preserved at every call site, interpolating
// {{name}} placeholders from params (e.g. web's `{ trigger }`).
const nativeTranslate: NativeTFunction = (_key, fallback, params) =>
  params
    ? fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name)
          ? String(params[name])
          : match,
      )
    : fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// Keyed signal rows for the table — `ts+field` is not guaranteed unique (the
// same field can re-emit at the same second on busy vehicles) so the array
// index is spliced in to keep reconciliation stable (web parity comment).
type KeyedSignal = DriveDiagnosticSignal & {__idx: number};

function PanelTitle({children}: {children: ReactNode}) {
  return (
    <AppText tone="secondary" variant="body" weight="semibold">
      {children}
    </AppText>
  );
}

export function WhyEndedPanel({driveId}: WhyEndedPanelProps) {
  const t = useNativeTranslation();
  const [expanded, setExpanded] = useState(false);
  const [windowSel, setWindowSel] = useState<DriveDiagnosticWindow>('60s');

  const why = useDriveWhyEnded(driveId, windowSel, expanded);

  const windowOptions: SelectOption[] = WINDOWS.map((w) => ({
    value: w,
    label: t(`driveDetail.whyEnded.windowOption.${w}`, w),
  }));

  const signalColumns: Column<KeyedSignal>[] = [
    {
      key: 'ts',
      header: t('driveDetail.whyEnded.signal.cols.ts', 'Timestamp'),
      visibleOnMobile: true,
      render: (row) => <TimeStamp value={row.ts} format="absolute" />,
    },
    {
      key: 'field',
      header: t('driveDetail.whyEnded.signal.cols.field', 'Field'),
      visibleOnMobile: true,
      render: (row) => (
        <AppText style={styles.mono} variant="caption">
          {row.field}
        </AppText>
      ),
    },
    {
      key: 'value',
      header: t('driveDetail.whyEnded.signal.cols.value', 'Value'),
      visibleOnMobile: true,
      render: (row) => (
        <AppText style={styles.mono} tone="muted" variant="caption">
          {row.value}
        </AppText>
      ),
    },
  ];

  const transitions: DriveDiagnosticTransition[] = why.data?.fsm_transitions ?? [];
  const signals: DriveDiagnosticSignal[] = why.data?.signal_window ?? [];
  const keyedSignals: KeyedSignal[] = signals.map((s, idx) => ({...s, __idx: idx}));

  const title = t('driveDetail.whyEnded.title', 'Why did this drive end?');

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.headerRow}>
        <Pressable
          accessibilityLabel={title}
          accessibilityRole="button"
          accessibilityState={{expanded}}
          hitSlop={6}
          onPress={() => setExpanded((p) => !p)}
          style={({pressed}) => [styles.toggle, pressed && styles.pressed]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.chevron}
            tone="muted">
            {expanded ? '\u25BE' : '\u25B8'}
          </AppText>
          <PanelTitle>{title}</PanelTitle>
        </Pressable>

        {expanded ? (
          <View style={styles.windowSelect}>
            <PillFilterBar
              activeKey={windowSel}
              ariaLabel={t('driveDetail.whyEnded.windowAria', 'Diagnostic window')}
              items={windowOptions.map((o) => ({key: o.value, label: o.label}))}
              onChange={(key) => setWindowSel(key as DriveDiagnosticWindow)}
              scrollable={false}
            />
          </View>
        ) : null}
      </View>

      {expanded ? (
        <View style={styles.body}>
          {why.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : why.error ? (
            <View style={styles.errorWrap}>
              <EmptyState
                message={
                  why.error instanceof Error
                    ? why.error.message
                    : t(
                        'driveDetail.whyEnded.error.message',
                        'Try a different window or reload the page.',
                      )
                }
                title={t(
                  'driveDetail.whyEnded.error.title',
                  'Could not load diagnostic',
                )}
              />
              <AppButton
                label={t('common.retry', 'Retry')}
                onPress={() => why.refetch()}
                variant="ghost"
              />
            </View>
          ) : (
            <>
              <View style={styles.section}>
                <View style={styles.sectionTitleRow}>
                  <SemanticIcon decorative name="gitCompare" size="sm" />
                  <PanelTitle>
                    {t('driveDetail.whyEnded.fsmTitle', 'FSM transitions')}
                  </PanelTitle>
                </View>
                {transitions.length === 0 ? (
                  <EmptyState
                    message={t(
                      'driveDetail.whyEnded.fsmEmpty.message',
                      'No FSM state changes recorded near the drive end. Try a wider window.',
                    )}
                    title={t(
                      'driveDetail.whyEnded.fsmEmpty.title',
                      'No transitions in window',
                    )}
                  />
                ) : (
                  <Timeline
                    items={transitions.map((tx) => ({
                      title: (
                        <AppText style={styles.mono} variant="body" weight="semibold">
                          {`${tx.fsm_name}: ${tx.from_state} \u2192 ${tx.to_state}`}
                        </AppText>
                      ),
                      subtitle: (
                        <AppText tone="muted" variant="caption">
                          {t(
                            'driveDetail.whyEnded.trigger',
                            'trigger: {{trigger}}',
                            {trigger: tx.trigger || '\u2014'},
                          )}
                        </AppText>
                      ),
                      time: new Date(tx.ts).toLocaleString(),
                      color: colors.accent,
                    }))}
                  />
                )}
              </View>

              <View style={styles.section}>
                <View style={styles.sectionTitleRow}>
                  <SemanticIcon decorative name="radio" size="sm" />
                  <PanelTitle>
                    {t('driveDetail.whyEnded.signalTitle', 'Signal window')}
                  </PanelTitle>
                </View>
                <SignalTable
                  columns={signalColumns}
                  data={keyedSignals}
                  emptyMessage={t(
                    'driveDetail.whyEnded.signalEmpty',
                    'No signals in this window for the default whitelist.',
                  )}
                  keyExtractor={(row) => `${row.ts}-${row.field}-${row.__idx}`}
                  mobileColumns={['ts', 'field', 'value']}
                />
              </View>
            </>
          )}
        </View>
      ) : null}
    </GlassPanel>
  );
}

interface SignalTableProps {
  columns: Column<KeyedSignal>[];
  data: KeyedSignal[];
  keyExtractor: (row: KeyedSignal) => string;
  emptyMessage: string;
  mobileColumns: string[];
}

function SignalTable({
  columns,
  data,
  keyExtractor,
  emptyMessage,
  mobileColumns,
}: SignalTableProps) {
  const [page, setPage] = useState(0);

  // Native renders the mobile column set, in the order the consumer specified.
  const cols = mobileColumns
    .map((key) => columns.find((c) => c.key === key))
    .filter((c): c is Column<KeyedSignal> => Boolean(c));

  if (data.length === 0) {
    return (
      <View style={styles.tableEmpty}>
        <AppText tone="muted" variant="caption">
          {emptyMessage}
        </AppText>
      </View>
    );
  }

  const pageCount = Math.max(1, Math.ceil(data.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const start = currentPage * DEFAULT_PAGE_SIZE;
  const visibleRows = data.slice(start, start + DEFAULT_PAGE_SIZE);

  return (
    <View>
      <View accessibilityRole="summary" style={styles.table} testID={SIGNAL_TABLE_ID}>
        <View style={[styles.tableRow, styles.tableHeaderRow]}>
          {cols.map((column) => (
            <View key={column.key} style={styles.cell}>
              <AppText
                style={styles.headerCellText}
                tone="muted"
                variant="caption"
                weight="semibold">
                {column.header}
              </AppText>
            </View>
          ))}
        </View>
        {visibleRows.map((row) => (
          <View key={keyExtractor(row)} style={[styles.tableRow, styles.tableBodyRow]}>
            {cols.map((column) => (
              <View key={column.key} style={styles.cell}>
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
            onPress={() => setPage((p) => Math.max(0, p - 1))}
            style={({pressed}) => [
              styles.pagerButton,
              currentPage === 0 && styles.disabled,
              pressed && currentPage !== 0 && styles.pressed,
            ]}>
            <AppText tone="secondary">{'\u2039'}</AppText>
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
            onPress={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            style={({pressed}) => [
              styles.pagerButton,
              currentPage >= pageCount - 1 && styles.disabled,
              pressed && currentPage < pageCount - 1 && styles.pressed,
            ]}>
            <AppText tone="secondary">{'\u203A'}</AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
  },
  headerRow: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  toggle: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.78,
  },
  chevron: {
    fontSize: 12,
    lineHeight: 16,
    width: 14,
  },
  windowSelect: {
    maxWidth: 200,
  },
  body: {
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  errorWrap: {
    alignItems: 'center',
    gap: spacing.md,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mono: {
    fontFamily: MONO_FONT,
  },
  tableEmpty: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  table: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  tableHeaderRow: {
    backgroundColor: colors.surfaceSelected,
  },
  tableBodyRow: {
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  cell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  headerCellText: {
    letterSpacing: 0.4,
  } as TextStyle,
  pager: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    paddingTop: spacing.sm,
  },
  pagerButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  pagerLabel: {
    minWidth: 48,
    textAlign: 'center',
  },
  disabled: {
    opacity: 0.4,
  },
});

// Native parity port of
// web/src/features/admin/components/dlq-inspector/AuditPanel.tsx.
//
// `AuditPanel` is the DLQ Inspector replay-audit panel: it renders the recent
// replay-audit log either globally or scoped to a single DLQ entry. When there
// are no rows and nothing is loading it shows an `EmptyState`; otherwise it
// renders a paginated `DataTable` of audit records (replayed-at timestamp,
// actor, DLQ id, result badge, destination topic, error, trace id). The panel
// is always mounted so the loading + empty states render in-place rather than
// gating the surface — behaviour preserved verbatim from the web source.
//
// Props (`rows` / `loading` / `scopedDlqId`), the `RESULT_VARIANT` result→Badge
// map, every `t('admin.dlq.audit.*', 'English')` i18n key + fallback, the two
// `tableId`s (`admin:dlq-audit-scoped` / `admin:dlq-audit`), the `name`, the
// `keyExtractor`, the pagination config ({25, [25,50,100]}) and the
// `mobileColumns` list are all carried over unchanged.
//
// The web source pulls four modules; native-safe mapping (contract rules 4/5/7):
//   - react-i18next `useTranslation` (L8) has no native-parity module -> the
//     standard web-parity i18n shim returning the inline English fallback, so
//     the component body's `t('key', 'English')` calls are unchanged (same
//     approach as the sibling FleetTelemetryHealth port).
//   - `Badge` + `DataTable` + `type Column` from `@/components/ui` (L10) ->
//     reused as-is from the web-parity `components/ui` ports. `Badge` variants
//     (`success`/`danger`/`warning`/`neutral`) and the `DataTable` props
//     (`tableId`/`name`/`columns`/`data`/`keyExtractor`/`emptyMessage`/
//     `pagination`/`mobileColumns`) match the web API 1:1.
//   - `TimeStamp` from `@/components/data-display` (L11) -> reused as-is from the
//     web-parity `components/data-display` port; `format="absolute"` is honored.
//   - `EmptyState` from `@/components/feedback` (L12) -> the existing native
//     shared `components/feedback/EmptyState` primitive (the same one the
//     ChartContainer / MetricSwitcherChart / ElevationProfile parity ports use).
//     It accepts `title` + `message`, exactly the props this panel passes. The
//     web `EmptyState` exposes an optional action/CTA prop; this panel passes
//     none ("panel sits beneath the live trigger surface; no separate CTA
//     needed."), which the action-less native primitive naturally satisfies.
//   - the `DLQReplayAuditRecord` / `DLQReplayResult` types (L13-16, web
//     `@/types/admin-diagnostics`) -> imported from the web-parity
//     `api/hooks/useDLQ` module, where the native parity surface re-declares
//     them with identical shape (id/replayed_at/actor/.../result/trace_id).
//
// Each column `render` returned a DOM `<span className=…>` on web; React Native
// has no `<span>` / className, so the cells become `AppText` carrying the
// equivalent styling via `StyleSheet`: `font-mono text-xs text-[var(--text-
// muted)]` -> mono + 12/16 + colors.textMuted (actor / dst_topic / trace_id),
// `font-mono text-xs` -> mono + 12/16 + colors.textPrimary (dlq_id), and
// `text-xs text-[var(--text-muted)]` -> 12/16 + colors.textMuted (error). The
// `||  '—'` fallbacks are preserved as `|| '\u2014'`. font-mono -> a
// Platform.select monospace family (Menlo on iOS), matching the sibling ports.

import React from 'react';
import {Platform, StyleSheet} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {EmptyState} from '../../../../../components/feedback/EmptyState';
import {colors} from '../../../../../theme/tokens';
import {Badge} from '../../../../components/ui/Badge';
import {DataTable, type Column} from '../../../../components/ui/DataTable';
import {TimeStamp} from '../../../../components/data-display/TimeStamp';
import type {
  DLQReplayAuditRecord,
  DLQReplayResult,
} from '../../../../api/hooks/useDLQ';

// ── i18n shim ──────────────────────────────────────────────────────────────
// react-i18next has no native parity module; like the other web-parity ports,
// translations resolve to their inline English fallback. The hook shape mirrors
// the web `const { t } = useTranslation()` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;
function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// font-mono has no className analog on native; resolve to a monospace family.
const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

interface AuditPanelProps {
  rows: DLQReplayAuditRecord[];
  loading: boolean;
  scopedDlqId?: number | null;
}

const RESULT_VARIANT: Record<
  DLQReplayResult,
  'success' | 'danger' | 'warning' | 'neutral'
> = {
  ok: 'success',
  publish_failed: 'danger',
  rate_limited: 'warning',
  disabled: 'warning',
  not_found: 'neutral',
  unparseable: 'danger',
};

export function AuditPanel({rows, loading, scopedDlqId}: AuditPanelProps) {
  const {t} = useTranslation();

  const columns: Column<DLQReplayAuditRecord>[] = [
    {
      key: 'replayed_at',
      header: t('admin.dlq.audit.cols.replayedAt', 'Replayed at'),
      visibleOnMobile: true,
      render: row => <TimeStamp value={row.replayed_at} format="absolute" />,
    },
    {
      key: 'actor',
      header: t('admin.dlq.audit.cols.actor', 'Actor'),
      visibleOnMobile: true,
      render: row => (
        <AppText style={styles.monoMuted}>{row.actor || '\u2014'}</AppText>
      ),
    },
    {
      key: 'dlq_id',
      header: t('admin.dlq.audit.cols.dlqId', 'DLQ ID'),
      render: row => <AppText style={styles.mono}>{row.dlq_id}</AppText>,
    },
    {
      key: 'result',
      header: t('admin.dlq.audit.cols.result', 'Result'),
      visibleOnMobile: true,
      render: row => (
        <Badge variant={RESULT_VARIANT[row.result] ?? 'neutral'}>
          {row.result}
        </Badge>
      ),
    },
    {
      key: 'dst_topic',
      header: t('admin.dlq.audit.cols.dstTopic', 'Destination'),
      render: row => (
        <AppText style={styles.monoMuted}>{row.dst_topic || '\u2014'}</AppText>
      ),
    },
    {
      key: 'error',
      header: t('admin.dlq.audit.cols.error', 'Error'),
      render: row => (
        <AppText style={styles.muted}>{row.error || '\u2014'}</AppText>
      ),
    },
    {
      key: 'trace_id',
      header: t('admin.dlq.audit.cols.traceId', 'Trace ID'),
      render: row => (
        <AppText style={styles.monoMuted}>{row.trace_id || '\u2014'}</AppText>
      ),
    },
  ];

  if (!loading && rows.length === 0) {
    return (
      <EmptyState
        title={t('admin.dlq.audit.empty.title', 'No replay attempts yet')}
        message={
          scopedDlqId
            ? t(
                'admin.dlq.audit.empty.scopedMessage',
                'This entry has not been replayed. Use the Replay action above to send it back to its source topic.',
              )
            : t(
                'admin.dlq.audit.empty.globalMessage',
                'Replay attempts will appear here once an operator triggers one.',
              )
        }
        // no-action: panel sits beneath the live trigger surface; no separate CTA needed.
      />
    );
  }

  return (
    <DataTable<DLQReplayAuditRecord>
      tableId={scopedDlqId ? 'admin:dlq-audit-scoped' : 'admin:dlq-audit'}
      name="dlq-audit"
      columns={columns}
      data={rows}
      keyExtractor={row => row.id}
      emptyMessage={
        loading
          ? t('admin.dlq.audit.loading', 'Loading audit log…')
          : t('admin.dlq.audit.empty.title', 'No replay attempts yet')
      }
      pagination={{defaultPageSize: 25, pageSizeOptions: [25, 50, 100]}}
      mobileColumns={['replayed_at', 'actor', 'result']}
    />
  );
}

export default AuditPanel;

const styles = StyleSheet.create({
  mono: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  monoMuted: {
    color: colors.textMuted,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  muted: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
});

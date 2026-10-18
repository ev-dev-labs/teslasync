/**
 * DLQ Inspector — entry drawer.
 *
 * Slide-in side panel that lazy-loads the FULL DLQ entry (summary +
 * base64 raw + inner payloads). Footer hosts the Replay CTA which is
 * disabled when:
 *   - The server's `replay_enabled` flag is false (warning banner above
 *     the page already explains why)
 *   - The entry's own `replayable` flag is false (no source topic to
 *     publish to)
 *   - A replay is in flight
 *
 * Payloads retain distinct missing, empty UTF-8, binary and invalid-base64
 * outcomes. Copy preserves decoded text or the original opaque encoding.
 * Summary metadata never establishes that detail bytes loaded successfully.
 */
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';

import {
  Button,
  Caption,
  CopyButton,
  Drawer,
  GlassPanel,
  Tabs,
  Text,
  type TabItem,
} from '@/components/ui';
import { KVList, TimeStamp } from '@/components/data-display';
import { AlertBanner, EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';

import type { DLQEntryFull, DLQEntrySummary } from '@/types/admin-diagnostics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { deriveDataState, type DataState } from '@/api/dataState';

interface EntryDrawerProps {
  open: boolean;
  summary: DLQEntrySummary | null;
  full: DLQEntryFull | undefined;
  loading: boolean;
  state?: DataState<DLQEntryFull>;
  replayEnabled: boolean;
  replayInFlight: boolean;
  onClose: () => void;
  onReplay: () => void;
}

type DecodedPayload =
  | { kind: 'missing' }
  | { kind: 'invalid'; encoded: string }
  | { kind: 'text'; text: string; encoded: string; size: number }
  | { kind: 'binary'; encoded: string; size: number };

function decodeBase64Utf8(b64: string): DecodedPayload {
  let bytes: Uint8Array;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return { kind: 'invalid', encoded: b64 };
  }
  try {
    return {
      kind: 'text',
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
      encoded: b64,
      size: bytes.length,
    };
  } catch {
    return { kind: 'binary', encoded: b64, size: bytes.length };
  }
}

export function EntryDrawer({
  open,
  summary,
  full,
  loading,
  state,
  replayEnabled,
  replayInFlight,
  onClose,
  onReplay,
}: EntryDrawerProps) {
  const { fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>('inner');
  const tabId = useId();
  const idBase = `dlq-entry-${tabId}`;
  const detail = state ?? deriveDataState({ data: full, isLoading: loading });
  // A prior entry's bytes must never be shown or replayed under a new summary.
  const payload = full && (!summary || full.id === summary.id) ? full : undefined;

  const inner = useMemo(
    () => typeof payload?.inner_payload_b64 === 'string'
      ? decodeBase64Utf8(payload.inner_payload_b64)
      : { kind: 'missing' as const },
    [payload],
  );
  const raw = useMemo(
    () => typeof payload?.raw_payload_b64 === 'string'
      ? decodeBase64Utf8(payload.raw_payload_b64)
      : { kind: 'missing' as const },
    [payload],
  );

  // Summary fields used when the full payload is still loading — pulled
  // from the summary row that was already in cache.
  const head: DLQEntryFull | DLQEntrySummary | null = payload ?? summary;

  const tabs = useMemo<TabItem[]>(
    () => [
      { key: 'inner', label: t('admin.dlq.drawer.tabs.inner', 'Inner payload') },
      { key: 'raw', label: t('admin.dlq.drawer.tabs.raw', 'Raw envelope') },
    ],
    [t],
  );

  // Metadata rows above the payload viewer. Memoised so the KVList prop
  // keeps a stable reference across re-renders (e.g. tab switches) instead
  // of receiving a fresh array literal in a hot path.
  const summaryItems = useMemo(
    () =>
      head
        ? [
            {
              label: t('admin.dlq.drawer.id', 'ID'),
              value: <Text mono>{head.id}</Text>,
            },
            {
              label: t('admin.dlq.drawer.arrivedAt', 'Arrived'),
              value: <TimeStamp value={head.arrived_at} format="absolute" />,
            },
            {
              label: t('admin.dlq.drawer.dlqTopic', 'DLQ topic'),
              value: <Text mono size="xs">{head.dlq_topic || '—'}</Text>,
            },
            {
              label: t('admin.dlq.drawer.reason', 'Reason'),
              value: <Text mono size="xs">{head.parsed_reason || '—'}</Text>,
            },
            {
              label: t('admin.dlq.drawer.vin', 'VIN'),
              value: <Text mono size="xs">{head.parsed_vin ?? '—'}</Text>,
            },
            {
              label: t('admin.dlq.drawer.sourceTopic', 'Source topic'),
              value: (
                <Text mono size="xs">
                  {head.parsed_source_topic ?? '—'}
                </Text>
              ),
            },
            {
              label: t('admin.dlq.drawer.redeliveries', 'Redeliveries'),
              value:
                head.parsed_redeliveries != null
                  ? fmtInt(head.parsed_redeliveries)
                  : '—',
            },
            {
              label: t('admin.dlq.drawer.parseError', 'Parse error'),
              value: <Caption>{head.parse_error || '—'}</Caption>,
            },
          ]
        : [],
    [head, t, fmtInt],
  );

  const panels = tabs.map(tab => {
    const decoded = tab.key === 'inner' ? inner : raw;
    const body = decoded.kind === 'missing'
      ? t('admin.dlq.drawer.payloadMissing', 'This payload was not included in the entry details.')
      : decoded.kind === 'invalid'
        ? t('admin.dlq.drawer.payloadInvalid', 'This payload is not valid base64. Copy preserves the original encoded value.')
        : decoded.kind === 'text'
          ? decoded.text === ''
            ? t('admin.dlq.drawer.payloadEmpty', 'Empty UTF-8 payload (0 bytes).')
            : decoded.text
          : tab.key === 'inner'
            ? t(
                'admin.dlq.drawer.binaryPayload',
                '(non-UTF-8 binary, {{n}} bytes — use the copy button to download base64)',
                { n: fmtInt(decoded.size) },
              )
            : t(
                'admin.dlq.drawer.binaryEnvelope',
                '(non-UTF-8 envelope, {{n}} bytes — use the copy button to download base64)',
                { n: fmtInt(decoded.size) },
              );
    return { ...tab, body };
  });
  const activePayload = activeTab === 'inner' ? inner : raw;
  const copyText = activePayload.kind === 'missing'
    ? undefined
    : activePayload.kind === 'text' ? activePayload.text : activePayload.encoded;

  const replayDisabled =
    !replayEnabled || !payload?.replayable || replayInFlight || loading
    || detail.status !== 'ok' || detail.isRefreshing || detail.isRefreshBlocked
    || inner.kind === 'missing' || inner.kind === 'invalid';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={
        head
          ? t('admin.dlq.drawer.title', 'DLQ entry #{{id}}', { id: head.id })
          : t('admin.dlq.drawer.titleFallback', 'DLQ entry')
      }
      size="lg"
      tabs={
        payload ? (
          <Tabs
            idBase={idBase}
            tabs={tabs}
            activeTab={activeTab}
            onChange={setActiveTab}
            ariaLabel={t('admin.dlq.drawer.payloadView', 'Payload view')}
            className="border-b-0"
          />
        ) : undefined
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.close', 'Close')}
          </Button>
          <Button
            variant="primary"
            disabled={replayDisabled}
            loading={replayInFlight}
            icon={<Send className="h-4 w-4" />}
            onClick={onReplay}
          >
            {t('admin.dlq.drawer.replay', 'Replay')}
          </Button>
        </div>
      }
    >
      {head ? (
        <div className="space-y-4">
          <GlassPanel className="p-4">
            <KVList items={summaryItems} />
          </GlassPanel>
          <GlassPanel className="p-4">
            <StaleRefreshWarning
              state={detail}
              label={t('admin.dlq.drawer.payloadView', 'Payload view')}
              message={detail.isRefreshBlocked
                ? t('admin.dlq.drawer.pausedRetained', 'Payload refresh is paused. Previously loaded details remain visible.')
                : undefined}
            />
            {detail.hasData && detail.updatedAt != null && detail.status === 'stale' && (
              <TimeStamp value={new Date(detail.updatedAt).toISOString()} format="absolute" />
            )}
            {detail.fatalError ? (
              <QueryError error={detail.fatalError} onRetry={detail.retry ?? undefined} />
            ) : !payload && detail.isRefreshBlocked ? (
              <AlertBanner variant="info" title={t('dataSources.status.pending', 'Pending')}>
                <Text as="p" variant="bodySm">
                  {t('admin.dlq.drawer.pausedInitial', 'The payload request is paused. No entry details have loaded yet.')}
                </Text>
                {detail.retry && (
                  <Button variant="secondary" onClick={detail.retry}>{t('common.retry', 'Retry')}</Button>
                )}
              </AlertBanner>
            ) : !payload ? (
              <div
                role="status"
                aria-busy="true"
                aria-label={t('admin.dlq.drawer.loading', 'Loading payload details…')}
                className="space-y-3"
                data-testid="dlq-entry-loading"
              >
                <Skeleton className="h-9 w-48" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : (
              <div>
                {detail.isRefreshing && (
                  <Text role="status">{t('freshness.updating', "updating…")}</Text>
                )}
                <div className="mb-2 flex items-center justify-end gap-2">
                  {copyText !== undefined && <CopyButton text={copyText} />}
                </div>
                {panels.map(panel => (
                  <Text
                    key={panel.key}
                    as="pre"
                    variant="code"
                    role="tabpanel"
                    id={`${idBase}-panel-${panel.key}`}
                    aria-labelledby={`${idBase}-tab-${panel.key}`}
                    aria-label={panel.label}
                    hidden={activeTab !== panel.key}
                    className="max-h-80 overflow-auto rounded-md border border-[var(--glass-border)] bg-[var(--surface-2)] p-3"
                  >
                    {panel.body}
                  </Text>
                ))}
              </div>
            )}
          </GlassPanel>
        </div>
      ) : loading ? (
        <div
          role="status"
          aria-busy="true"
          aria-label={t('admin.dlq.drawer.loading', 'Loading payload details…')}
          className="space-y-4"
          data-testid="dlq-entry-loading"
        >
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : (
        // no-action: this drawer only mounts once a DLQ entry is selected —
        // selecting a row in the inspector list is the trigger surface.
        <EmptyState
          message={t('admin.dlq.drawer.empty', 'No DLQ entry selected.')}
        />
      )}
    </Drawer>
  );
}

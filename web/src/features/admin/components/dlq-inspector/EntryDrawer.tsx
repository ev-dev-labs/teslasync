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
 * Heavy payload viewer is a `<pre>` rendering the base64 of the inner
 * payload (decoded as UTF-8 best-effort) — operators rarely need the
 * raw envelope; that's a CopyButton further down.
 */
import { useMemo, useState } from 'react';
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
import { EmptyState, Skeleton } from '@/components/feedback';
import { fmtInt } from '@/lib/numberFormat';
import type { DLQEntryFull, DLQEntrySummary } from '@/types/admin-diagnostics';

interface EntryDrawerProps {
  open: boolean;
  summary: DLQEntrySummary | null;
  full: DLQEntryFull | undefined;
  loading: boolean;
  replayEnabled: boolean;
  replayInFlight: boolean;
  onClose: () => void;
  onReplay: () => void;
}

/**
 * Decodes base64 → UTF-8 string when possible; falls back to a short
 * "(non-UTF-8 binary, {{n}} bytes)" marker for opaque payloads so we
 * never crash the drawer on a binary protobuf body.
 */
function decodeBase64Utf8(b64: string): string {
  if (!b64) return '';
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // TextDecoder with fatal=true throws on invalid UTF-8 sequences
    // so binary protobuf payloads cleanly hit the catch block.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return '';
  }
}

export function EntryDrawer({
  open,
  summary,
  full,
  loading,
  replayEnabled,
  replayInFlight,
  onClose,
  onReplay,
}: EntryDrawerProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>('inner');

  const innerText = useMemo(
    () => (full ? decodeBase64Utf8(full.inner_payload_b64) : ''),
    [full],
  );
  const rawText = useMemo(
    () => (full ? decodeBase64Utf8(full.raw_payload_b64) : ''),
    [full],
  );

  // Summary fields used when the full payload is still loading — pulled
  // from the summary row that was already in cache.
  const head: DLQEntryFull | DLQEntrySummary | null = full ?? summary;

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
    [head, t],
  );

  // Active payload panel: its accessible label (mirrors the selected tab)
  // plus the body text. Falls back to a "(non-UTF-8 …)" marker with the
  // byte size when the blob isn't valid UTF-8 so a binary protobuf body
  // never blanks the viewer.
  const panel = useMemo(() => {
    if (activeTab === 'inner') {
      return {
        label: t('admin.dlq.drawer.tabs.inner', 'Inner payload'),
        body:
          innerText ||
          t(
            'admin.dlq.drawer.binaryPayload',
            '(non-UTF-8 binary, {{n}} bytes — use the copy button to download base64)',
            { n: head?.inner_payload_size ?? 0 },
          ),
      };
    }
    return {
      label: t('admin.dlq.drawer.tabs.raw', 'Raw envelope'),
      body:
        rawText ||
        t(
          'admin.dlq.drawer.binaryEnvelope',
          '(non-UTF-8 envelope, {{n}} bytes — use the copy button to download base64)',
          { n: head?.raw_payload_size ?? 0 },
        ),
    };
  }, [activeTab, head, innerText, rawText, t]);

  // Text handed to the CopyButton: prefer decoded UTF-8, fall back to the
  // raw base64 so operators can still copy an opaque binary body.
  const copyText = useMemo(
    () =>
      activeTab === 'inner'
        ? innerText || full?.inner_payload_b64 || ''
        : rawText || full?.raw_payload_b64 || '',
    [activeTab, innerText, rawText, full],
  );

  const replayDisabled =
    !replayEnabled || !head?.replayable || replayInFlight || loading;

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
        head && !loading ? (
          <Tabs
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
            {loading && !full ? (
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
              <div className="mb-2 flex items-center justify-end gap-2">
                <CopyButton text={copyText} />
              </div>
              <Text
                as="pre"
                variant="code"
                role="tabpanel"
                aria-label={panel.label}
                className="max-h-80 overflow-auto rounded-md border border-[var(--glass-border)] bg-[var(--surface-2)] p-3"
              >
                {panel.body}
              </Text>
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

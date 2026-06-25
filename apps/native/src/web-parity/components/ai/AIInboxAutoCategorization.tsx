// Native parity port of web/src/components/ai/AIInboxAutoCategorization.tsx.
//
// The Suggest categories button streams from POST /api/v1/ai/alerts/inbox/categorize,
// captures draft_alert_categories tool_result envelopes, and only calls the
// parent with proposed rule_ids when the user presses Apply categories as filter.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../../components/ui/AppText';
import { colors, spacing } from '../../../theme/tokens';
import { AI_FEATURES, type AiFeatureId } from '../../ai/features';
import { apiUrl } from '../../api/client';
import { useSettings } from '../../api/hooks/useSettings';
import { AIFeatureCard } from './AIFeatureCard';

export interface CategoryBucket {
  category: string;
  count: number;
  rule_ids?: number[];
  sample_titles?: string[];
}

export interface AIInboxAutoCategorizationProps {
  vehicleId?: number | null;
  severities?: string[];
  ruleIds?: number[];
  windowDays?: number | null;
  onApplyCategories: (ruleIds: number[]) => void;
}

type AiStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; arguments: unknown }
  | {
      type: 'tool_result';
      id: string;
      name: string;
      ok: boolean;
      data?: unknown;
      error?: string;
    }
  | {
      type: 'confirm_request';
      continuation_id: string;
      tool: string;
      args: unknown;
      summary: string;
    }
  | { type: 'done'; finish_reason: string; usage: { in: number; out: number } }
  | {
      type: 'error';
      message: string;
      reason?: string;
      retry_after_s?: number;
      banner_level?: 'warn' | 'critical' | '';
      baseline_available?: boolean;
    };

type AiStreamState = 'idle' | 'streaming' | 'paused-confirm' | 'done' | 'error';

interface AiLimitInfo {
  reason: string;
  retryAfterS: number;
  bannerLevel: 'warn' | 'critical' | '';
  baselineAvailable: boolean;
  message: string;
}

interface UseAiStreamArgs {
  url: string;
  body?: unknown;
  onEvent: (ev: AiStreamEvent) => void;
}

interface UseAiStreamResult {
  start: () => void;
  cancel: () => void;
  state: AiStreamState;
  text: string;
  error: string | null;
  limit: AiLimitInfo | null;
}

interface NativeReadableStreamReader {
  read(): Promise<{
    value?: ArrayBuffer | ArrayBufferView | number[] | string;
    done?: boolean;
  }>;
  releaseLock?: () => void;
}

interface NativeReadableStreamBody {
  getReader(): NativeReadableStreamReader;
}

interface ResponseWithNativeStream extends Response {
  body?: NativeReadableStreamBody | null;
}

interface TextDecoderLike {
  decode(
    input?: ArrayBuffer | ArrayBufferView,
    options?: { stream?: boolean },
  ): string;
}

type TextDecoderConstructorLike = new (label?: string) => TextDecoderLike;
type NativeTFunction = (key: string, fallback: string) => string;

const FEATURE_ID: AiFeatureId = 'inbox-auto-categorization';
const AI_STREAM_UNAVAILABLE_REASON =
  'React Native fetch did not expose a readable response body for AI SSE streaming.';
const SSE_DELIM_RE = /\r?\n\r?\n/;
const LINE_DELIM_RE = /\r?\n/;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

function useAiEnabled(feature: AiFeatureId): boolean {
  const { data: settings } = useSettings();
  if (!AI_FEATURES[feature]) {
    return false;
  }
  if (!settings) {
    return false;
  }
  if (settings.ai_mode === undefined || settings.ai_mode === 'off') {
    return false;
  }
  const flags = settings.ai_features;
  if (!flags) {
    return false;
  }
  return flags[feature] === true;
}

function withAiFeature<P extends object>(
  feature: AiFeatureId,
  Inner: ComponentType<P>,
): ComponentType<P> {
  if (!AI_FEATURES[feature]) {
    throw new Error(
      `withAiFeature: unknown AI feature id ${JSON.stringify(feature)}.`,
    );
  }

  const meta = AI_FEATURES[feature];
  const namedInner = Inner as ComponentType<P> & { displayName?: string };
  const innerName = namedInner.displayName ?? Inner.name ?? 'Component';

  const Wrapped: ComponentType<P> & { displayName?: string } = (props: P) => {
    const enabled = useAiEnabled(feature);
    if (!enabled) {
      return null;
    }

    return (
      <View
        accessibilityLabel={`AI feature ${feature}`}
        testID={meta.uiTestIds[0] ?? `ai-feature-${feature}`}
      >
        <Inner {...props} />
      </View>
    );
  };

  Wrapped.displayName = `withAiFeature(${feature}, ${innerName})`;
  return Wrapped;
}

function getFetch(): typeof fetch | null {
  const candidate = (globalThis as typeof globalThis & { fetch?: unknown })
    .fetch;
  return typeof candidate === 'function' ? (candidate as typeof fetch) : null;
}

function getReadableStreamBody(res: Response): NativeReadableStreamBody | null {
  const body = (res as ResponseWithNativeStream).body;
  if (body && typeof body.getReader === 'function') {
    return body;
  }
  return null;
}

function getTextDecoder(): TextDecoderLike | null {
  const candidate = (
    globalThis as typeof globalThis & { TextDecoder?: unknown }
  ).TextDecoder;
  return typeof candidate === 'function'
    ? new (candidate as TextDecoderConstructorLike)('utf-8')
    : null;
}

function toUint8Array(
  value: ArrayBuffer | ArrayBufferView | number[],
): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function decodeAscii(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 8192) {
    result += String.fromCharCode(...bytes.subarray(index, index + 8192));
  }
  return result;
}

function decodeStreamChunk(
  value: ArrayBuffer | ArrayBufferView | number[] | string | undefined,
  decoder: TextDecoderLike | null,
  stream: boolean,
): string {
  if (value == null) {
    return decoder ? decoder.decode(undefined, { stream }) : '';
  }
  if (typeof value === 'string') {
    return value;
  }

  const bytes = toUint8Array(value);
  if (decoder) {
    return decoder.decode(bytes, { stream });
  }
  if (bytes.every(byte => byte < 0x80)) {
    return decodeAscii(bytes);
  }
  throw new Error(
    `${AI_STREAM_UNAVAILABLE_REASON} UTF-8 TextDecoder is unavailable.`,
  );
}

function parseSSEFrame(raw: string): AiStreamEvent | null {
  let event = '';
  const dataParts: string[] = [];
  for (const line of raw.split(LINE_DELIM_RE)) {
    if (line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event: ')) {
      event = line.slice('event: '.length);
    } else if (line.startsWith('data: ')) {
      dataParts.push(line.slice('data: '.length));
    } else if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trimStart();
    } else if (line.startsWith('data:')) {
      dataParts.push(line.slice('data:'.length).trimStart());
    }
  }
  if (!event) {
    return null;
  }

  const dataStr = dataParts.join('\n');
  let data: unknown = null;
  if (dataStr) {
    try {
      data = JSON.parse(dataStr);
    } catch {
      return null;
    }
  }
  return toTypedEvent(event, data);
}

function toTypedEvent(event: string, data: unknown): AiStreamEvent | null {
  if (data === null || typeof data !== 'object') {
    return null;
  }
  const d = data as Record<string, unknown>;
  switch (event) {
    case 'delta':
      return typeof d.text === 'string'
        ? { type: 'delta', text: d.text }
        : null;
    case 'tool_call':
      if (typeof d.id !== 'string' || typeof d.name !== 'string') {
        return null;
      }
      return {
        type: 'tool_call',
        id: d.id,
        name: d.name,
        arguments: d.arguments,
      };
    case 'tool_result':
      if (
        typeof d.id !== 'string' ||
        typeof d.name !== 'string' ||
        typeof d.ok !== 'boolean'
      ) {
        return null;
      }
      return {
        type: 'tool_result',
        id: d.id,
        name: d.name,
        ok: d.ok,
        data: d.data,
        error: typeof d.error === 'string' ? d.error : undefined,
      };
    case 'confirm_request':
      if (
        typeof d.continuation_id !== 'string' ||
        typeof d.tool !== 'string' ||
        typeof d.summary !== 'string'
      ) {
        return null;
      }
      return {
        type: 'confirm_request',
        continuation_id: d.continuation_id,
        tool: d.tool,
        args: d.args,
        summary: d.summary,
      };
    case 'done': {
      const usage = d.usage as { in?: number; out?: number } | undefined;
      return {
        type: 'done',
        finish_reason:
          typeof d.finish_reason === 'string' ? d.finish_reason : 'stop',
        usage: {
          in: typeof usage?.in === 'number' ? usage.in : 0,
          out: typeof usage?.out === 'number' ? usage.out : 0,
        },
      };
    }
    case 'error': {
      const bannerLevelRaw =
        typeof d.banner_level === 'string' ? d.banner_level : undefined;
      const bannerLevel =
        bannerLevelRaw === 'warn' ||
        bannerLevelRaw === 'critical' ||
        bannerLevelRaw === ''
          ? bannerLevelRaw
          : undefined;
      return {
        type: 'error',
        message: typeof d.message === 'string' ? d.message : 'unknown',
        reason: typeof d.reason === 'string' ? d.reason : undefined,
        retry_after_s:
          typeof d.retry_after_s === 'number' ? d.retry_after_s : undefined,
        banner_level: bannerLevel,
        baseline_available:
          typeof d.baseline_available === 'boolean'
            ? d.baseline_available
            : undefined,
      };
    }
    default:
      return null;
  }
}

function useAiStream({
  url,
  body,
  onEvent,
}: UseAiStreamArgs): UseAiStreamResult {
  const [state, setState] = useState<AiStreamState>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState<AiLimitInfo | null>(null);
  const onEventRef = useRef(onEvent);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const cancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    runningRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) {
      return;
    }
    runningRef.current = true;
    setState('streaming');
    setText('');
    setError(null);
    setLimit(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const requestBody = body !== undefined ? JSON.stringify(body) : undefined;

    const finalizeError = (message: string) => {
      setError(message);
      setState('error');
    };

    const handleEvent = (ev: AiStreamEvent) => {
      onEventRef.current(ev);
      switch (ev.type) {
        case 'delta':
          setText(prev => prev + ev.text);
          break;
        case 'confirm_request':
          setState('paused-confirm');
          break;
        case 'done':
          setState('done');
          break;
        case 'error':
          if (ev.reason) {
            setLimit({
              reason: ev.reason,
              retryAfterS: ev.retry_after_s ?? 0,
              bannerLevel: ev.banner_level ?? '',
              baselineAvailable: ev.baseline_available ?? true,
              message: ev.message,
            });
          }
          finalizeError(ev.message);
          break;
        default:
          break;
      }
    };

    void (async () => {
      let reader: NativeReadableStreamReader | null = null;
      try {
        const fetcher = getFetch();
        if (fetcher == null) {
          finalizeError('React Native fetch is unavailable.');
          return;
        }

        const res = await fetcher(apiUrl(url), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: requestBody,
          signal: controller.signal,
          credentials: 'include',
        });

        if (!res.ok) {
          finalizeError(`stream_http_${res.status}`);
          return;
        }

        const streamBody = getReadableStreamBody(res);
        if (streamBody == null) {
          finalizeError(AI_STREAM_UNAVAILABLE_REASON);
          return;
        }

        reader = streamBody.getReader();
        const decoder = getTextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decodeStreamChunk(value, decoder, true);
          const parts = buffer.split(SSE_DELIM_RE);
          buffer = parts.pop() ?? '';
          for (const raw of parts) {
            if (!raw.trim()) {
              continue;
            }
            const ev = parseSSEFrame(raw);
            if (ev) {
              handleEvent(ev);
            }
          }
        }

        buffer += decodeStreamChunk(undefined, decoder, false);
        if (buffer.trim()) {
          const ev = parseSSEFrame(buffer);
          if (ev) {
            handleEvent(ev);
          }
        }
        setState(cur => (cur === 'streaming' ? 'done' : cur));
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setState(cur => (cur === 'streaming' ? 'idle' : cur));
          return;
        }
        finalizeError(err instanceof Error ? err.message : String(err));
      } finally {
        if (reader?.releaseLock) {
          reader.releaseLock();
        }
        runningRef.current = false;
        abortRef.current = null;
      }
    })();
  }, [body, url]);

  return { start, cancel, state, text, error, limit };
}

function normalizeCategoryBuckets(value: unknown): CategoryBucket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const buckets: CategoryBucket[] = [];
  for (const raw of value) {
    if (raw == null || typeof raw !== 'object') {
      continue;
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.category !== 'string' || r.category === '') {
      continue;
    }
    if (typeof r.count !== 'number' || r.count < 0) {
      continue;
    }

    const bucket: CategoryBucket = {
      category: r.category,
      count: r.count,
    };
    if (Array.isArray(r.rule_ids)) {
      const ids: number[] = [];
      for (const v of r.rule_ids) {
        if (typeof v === 'number' && v > 0) {
          ids.push(v);
        }
      }
      if (ids.length > 0) {
        bucket.rule_ids = ids;
      }
    }
    if (Array.isArray(r.sample_titles)) {
      const titles: string[] = [];
      for (const v of r.sample_titles) {
        if (typeof v === 'string' && v !== '') {
          titles.push(v);
        }
      }
      if (titles.length > 0) {
        bucket.sample_titles = titles;
      }
    }
    buckets.push(bucket);
  }

  return buckets;
}

function ApplyCategoriesButton({
  disabled,
  label,
  onPress,
}: {
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.applyButton,
        disabled && styles.applyButtonDisabled,
        pressed && !disabled && styles.applyButtonPressed,
      ]}
      testID="ai-feature-inbox-auto-categorization-apply"
    >
      <AppText style={styles.applyButtonText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

function InnerSection({
  vehicleId,
  severities,
  ruleIds,
  windowDays,
  onApplyCategories,
}: AIInboxAutoCategorizationProps) {
  const t = useNativeTranslationFallback();
  const [proposal, setProposal] = useState<CategoryBucket[] | null>(null);

  const body = useMemo(() => {
    const out: Record<string, unknown> = {};
    if (vehicleId != null) {
      out.vehicle_id = vehicleId;
    }
    if (windowDays != null) {
      out.window_days = windowDays;
    }
    if (severities && severities.length > 0) {
      out.severities = severities;
    }
    if (ruleIds && ruleIds.length > 0) {
      out.rule_ids = ruleIds;
    }
    return out;
  }, [vehicleId, windowDays, severities, ruleIds]);

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (
      ev.type === 'tool_result' &&
      ev.name === 'draft_alert_categories' &&
      ev.ok
    ) {
      const data = ev.data as
        | { status?: string; categories?: unknown }
        | undefined;
      if (!data || data.status !== 'ok' || !Array.isArray(data.categories)) {
        return;
      }
      const buckets = normalizeCategoryBuckets(data.categories);
      if (buckets.length > 0) {
        setProposal(buckets);
      }
    }
  }, []);

  const stream = useAiStream({
    url: '/ai/alerts/inbox/categorize',
    body,
    onEvent: handleEvent,
  });
  const { cancel: cancelStream, start: startStream, state: streamState } = stream;

  useEffect(() => {
    return () => {
      cancelStream();
      setProposal(null);
    };
  }, [vehicleId, windowDays, severities, ruleIds, cancelStream]);

  const isBusy = streamState === 'streaming' || streamState === 'paused-confirm';

  const handleCategorize = useCallback(() => {
    if (isBusy) {
      return;
    }
    setProposal(null);
    startStream();
  }, [isBusy, startStream]);

  const allRuleIds = useMemo(() => {
    if (!proposal || proposal.length === 0) {
      return [] as number[];
    }
    const seen = new Set<number>();
    for (const bucket of proposal) {
      if (!bucket.rule_ids) {
        continue;
      }
      for (const id of bucket.rule_ids) {
        seen.add(id);
      }
    }
    return Array.from(seen).sort((a, b) => a - b);
  }, [proposal]);

  const handleApply = useCallback(() => {
    if (allRuleIds.length === 0) {
      return;
    }
    onApplyCategories(allRuleIds);
  }, [allRuleIds, onApplyCategories]);

  const applyDisabled = allRuleIds.length === 0 || isBusy;

  return (
    <AIFeatureCard
      badgeLabel={t('notifications.inbox.aiCategorize.badge', 'Helix')}
      buttonLabel={t(
        'notifications.inbox.aiCategorize.suggestButton',
        'Suggest categories',
      )}
      buttonPlacement="below"
      buttonTestId="ai-feature-inbox-auto-categorization-categorize"
      canStart={streamState !== 'paused-confirm'}
      description={t(
        'notifications.inbox.aiCategorize.description',
        'Bucket recent alerts into categories from your inbox history. Descriptive replay only - review before applying.',
      )}
      onAction={handleCategorize}
      stream={stream}
      title={t(
        'notifications.inbox.aiCategorize.title',
        'Suggest inbox categories',
      )}
    >
      {proposal && proposal.length > 0 ? (
        <View style={styles.proposalArea}>
          <View style={styles.applyRow}>
            <ApplyCategoriesButton
              disabled={applyDisabled}
              label={t(
                'notifications.inbox.aiCategorize.applyButton',
                'Apply categories as filter',
              )}
              onPress={handleApply}
            />
          </View>
          <View style={styles.previewBox}>
            <AppText style={styles.previewLabel} weight="semibold">
              {t(
                'notifications.inbox.aiCategorize.previewLabel',
                'Proposed categories (review before applying):',
              )}
            </AppText>
            <View style={styles.bucketList}>
              {proposal.map(bucket => (
                <View
                  key={bucket.category}
                  style={styles.bucketPill}
                  testID={`ai-feature-inbox-auto-categorization-bucket-${bucket.category}`}
                >
                  <AppText
                    style={styles.bucketText}
                    variant="caption"
                    weight="semibold"
                  >
                    {bucket.category}
                  </AppText>
                  <AppText style={styles.bucketSeparator} variant="caption">
                    {'\u00B7'}
                  </AppText>
                  <AppText
                    style={styles.bucketText}
                    variant="caption"
                    weight="semibold"
                  >
                    {bucket.count}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : null}
    </AIFeatureCard>
  );
}

(
  InnerSection as ComponentType<AIInboxAutoCategorizationProps> & {
    displayName?: string;
  }
).displayName = 'AIInboxAutoCategorizationInner';

export const AIInboxAutoCategorization = withAiFeature(FEATURE_ID, InnerSection);
AIInboxAutoCategorization.displayName = 'AIInboxAutoCategorization';

const styles = StyleSheet.create({
  applyButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  applyButtonDisabled: {
    opacity: 0.48,
  },
  applyButtonPressed: {
    opacity: 0.82,
  },
  applyButtonText: {
    color: colors.textPrimary,
    lineHeight: 18,
  },
  applyRow: {
    alignItems: 'flex-end',
  },
  bucketList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  bucketPill: {
    alignItems: 'center',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
  },
  bucketSeparator: {
    color: colors.textMuted,
    lineHeight: 16,
  },
  bucketText: {
    color: colors.success,
    lineHeight: 16,
  },
  previewBox: {
    backgroundColor: 'rgba(52, 211, 153, 0.05)',
    borderColor: colors.successBorder,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  previewLabel: {
    color: colors.success,
    lineHeight: 20,
  },
  proposalArea: {
    gap: spacing.sm,
  },
});

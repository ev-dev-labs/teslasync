// Native parity port of web/src/components/ai/AIQuietHoursSuggestion.tsx.
//
// The source Helix card streams from POST /api/v1/ai/settings/quiet-hours/draft,
// captures draft_quiet_hours_window tool_result envelopes, and only copies a
// typed proposal into the parent quiet-hours form when Apply to form is pressed.

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
import type { QuietHoursWindowInput } from '../../api/types';
import { AIFeatureCard, type AiStreamState } from './AIFeatureCard';

export interface QuietHoursDraftProposal {
  start_local: string;
  end_local: string;
  timezone: string;
  weekdays: number;
  bypass_severities: string[];
  status: string;
  existing_windows_count: number;
}

export interface AIQuietHoursSuggestionProps {
  onApplyDraft: (patch: QuietHoursWindowInput) => void;
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

const FEATURE_ID: AiFeatureId = 'quiet-hours-suggestion';
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
      return typeof d.text === 'string' ? { type: 'delta', text: d.text } : null;
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

    const handleStreamEvent = (ev: AiStreamEvent) => {
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
              handleStreamEvent(ev);
            }
          }
        }

        buffer += decodeStreamChunk(undefined, decoder, false);
        if (buffer.trim()) {
          const ev = parseSSEFrame(buffer);
          if (ev) {
            handleStreamEvent(ev);
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

function ApplyButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID="ai-feature-quiet-hours-suggestion-apply"
      style={({ pressed }) => [
        styles.applyButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <AppText style={styles.applyButtonText} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

function InnerSection({ onApplyDraft }: AIQuietHoursSuggestionProps) {
  const t = useNativeTranslationFallback();
  const [proposal, setProposal] = useState<QuietHoursDraftProposal | null>(null);
  const body = useMemo(() => ({}), []);

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (
      ev.type === 'tool_result' &&
      ev.name === 'draft_quiet_hours_window' &&
      ev.ok
    ) {
      const data = ev.data as
        | {
            start_local?: unknown;
            end_local?: unknown;
            timezone?: unknown;
            weekdays?: unknown;
            bypass_severities?: unknown;
            status?: unknown;
            existing_windows_count?: unknown;
          }
        | undefined;
      if (
        !data ||
        typeof data.start_local !== 'string' ||
        typeof data.end_local !== 'string' ||
        typeof data.timezone !== 'string' ||
        typeof data.weekdays !== 'number' ||
        !Array.isArray(data.bypass_severities)
      ) {
        return;
      }
      setProposal({
        start_local: data.start_local,
        end_local: data.end_local,
        timezone: data.timezone,
        weekdays: data.weekdays,
        bypass_severities: data.bypass_severities.filter(
          (s): s is string => typeof s === 'string',
        ),
        status: typeof data.status === 'string' ? data.status : 'ok',
        existing_windows_count:
          typeof data.existing_windows_count === 'number'
            ? data.existing_windows_count
            : 0,
      });
    }
  }, []);

  const stream = useAiStream({
    url: '/ai/settings/quiet-hours/draft',
    body,
    onEvent: handleEvent,
  });
  const { cancel: cancelStream, start: startStream } = stream;

  useEffect(() => {
    return () => {
      cancelStream();
      setProposal(null);
    };
  }, [cancelStream]);

  const isBusy =
    stream.state === 'streaming' || stream.state === 'paused-confirm';

  const handleSuggest = useCallback(() => {
    if (isBusy) {
      return;
    }
    setProposal(null);
    startStream();
  }, [isBusy, startStream]);

  const handleApply = useCallback(() => {
    if (!proposal) {
      return;
    }
    onApplyDraft({
      enabled: true,
      start_local: proposal.start_local,
      end_local: proposal.end_local,
      timezone: proposal.timezone,
      weekdays: proposal.weekdays,
      bypass_severities: proposal.bypass_severities,
    });
  }, [proposal, onApplyDraft]);

  return (
    <AIFeatureCard
      badgeLabel={t('notifications.quietHours.aiSuggestion.badge', 'Helix')}
      buttonLabel={t(
        'notifications.quietHours.aiSuggestion.button',
        'Suggest quiet hours',
      )}
      buttonPlacement="below"
      buttonTestId="ai-feature-quiet-hours-suggestion-suggest"
      canStart={stream.state !== 'paused-confirm'}
      description={t(
        'notifications.quietHours.aiSuggestion.description',
        'Ask Helix to recommend ONE quiet-hours window based on the trailing 30 days of your notification cadence. Helix never reads individual notification titles or messages - it consults a per-hour aggregate of non-critical events to find the sparsest interval. Apply the recommendation to seed the form below; you remain in control of the Save button.',
      )}
      onAction={handleSuggest}
      stream={stream}
      title={t(
        'notifications.quietHours.aiSuggestion.title',
        'Suggest a quiet-hours window from your notification history',
      )}
    >
      {proposal ? (
        <View style={styles.proposalArea}>
          <View style={styles.applyRow}>
            <ApplyButton
              disabled={proposal == null || isBusy}
              label={t(
                'notifications.quietHours.aiSuggestion.applyButton',
                'Apply to form',
              )}
              onPress={handleApply}
            />
          </View>
          <View style={styles.previewBox}>
            <AppText style={styles.previewLabel} weight="semibold">
              {t(
                'notifications.quietHours.aiSuggestion.previewLabel',
                'Proposed window (review before saving):',
              )}
            </AppText>
            <View style={styles.previewList}>
              <AppText style={styles.previewRow} variant="caption">
                {'\u2022'}{' '}
                {t(
                  'notifications.quietHours.aiSuggestion.previewWindow',
                  `Window: ${proposal.start_local} -> ${proposal.end_local} (${proposal.timezone})`,
                )}
              </AppText>
              <AppText style={styles.previewRow} variant="caption">
                {'\u2022'}{' '}
                {t(
                  'notifications.quietHours.aiSuggestion.previewWeekdays',
                  `Weekday bitmask: ${proposal.weekdays}`,
                )}
              </AppText>
              <AppText style={styles.previewRow} variant="caption">
                {'\u2022'}{' '}
                {t(
                  'notifications.quietHours.aiSuggestion.previewBypass',
                  `Bypass severities: ${proposal.bypass_severities.join(', ')}`,
                )}
              </AppText>
              {proposal.status === 'insufficient_history' ? (
                <AppText style={styles.insufficientRow} variant="caption">
                  {'\u2022'}{' '}
                  {t(
                    'notifications.quietHours.aiSuggestion.previewInsufficientHistory',
                    'Helix had insufficient notification history; this is a conservative default.',
                  )}
                </AppText>
              ) : null}
              {proposal.existing_windows_count > 0 ? (
                <AppText style={styles.previewRow} variant="caption">
                  {'\u2022'}{' '}
                  {t(
                    'notifications.quietHours.aiSuggestion.previewExistingCount',
                    `You already have ${proposal.existing_windows_count} quiet-hours window(s) configured.`,
                  )}
                </AppText>
              ) : null}
            </View>
          </View>
        </View>
      ) : null}
    </AIFeatureCard>
  );
}

(
  InnerSection as ComponentType<AIQuietHoursSuggestionProps> & {
    displayName?: string;
  }
).displayName = 'AIQuietHoursSuggestionInner';

export const AIQuietHoursSuggestion = withAiFeature(FEATURE_ID, InnerSection);
AIQuietHoursSuggestion.displayName = 'AIQuietHoursSuggestion';

const styles = StyleSheet.create({
  applyButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  applyButtonText: {
    color: colors.background,
  },
  applyRow: {
    alignItems: 'flex-end',
  },
  disabled: {
    opacity: 0.48,
  },
  insufficientRow: {
    color: colors.warning,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.82,
  },
  previewBox: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  previewLabel: {
    color: colors.success,
  },
  previewList: {
    gap: spacing.xs,
  },
  previewRow: {
    color: colors.textSecondary,
    lineHeight: 18,
  },
  proposalArea: {
    gap: spacing.sm,
  },
});

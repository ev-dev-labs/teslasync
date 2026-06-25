// Native parity port of web/src/components/ai/AIBatteryHealthForecastNarrative.tsx.
// The Narrate button streams from POST /api/v1/ai/battery/health/narrate.

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
import { PremiumCard } from '../../../components/ui/PremiumCard';
import { colors, spacing } from '../../../theme/tokens';
import { AI_FEATURES, type AiFeatureId } from '../../ai/features';
import { apiUrl } from '../../api/client';
import { useSettings } from '../../api/hooks/useSettings';

interface InnerSectionProps {
  vehicleId?: string | number;
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

type AiStreamState =
  | 'idle'
  | 'streaming'
  | 'paused-confirm'
  | 'done'
  | 'error';

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
  cancel?: () => Promise<void> | void;
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

const FEATURE_ID: AiFeatureId = 'battery-health-forecast-narrative';
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
  if (value === undefined) {
    return decoder?.decode(undefined, { stream }) ?? '';
  }
  if (typeof value === 'string') {
    return value;
  }

  const bytes = toUint8Array(value);
  return decoder?.decode(bytes, { stream }) ?? decodeAscii(bytes);
}

function parseDataLine(line: string): string | null {
  if (line === 'data') {
    return '';
  }
  if (line.startsWith('data:')) {
    return line.slice(5).replace(/^ /, '');
  }
  return null;
}

function parseSSEFrame(frame: string): AiStreamEvent | null {
  let eventName = '';
  const dataLines: string[] = [];

  for (const line of frame.split(LINE_DELIM_RE)) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    const data = parseDataLine(line);
    if (data !== null) {
      dataLines.push(data);
    }
  }

  const raw = dataLines.join('\n');
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const d = parsed as Record<string, unknown>;
  const type = typeof d.type === 'string' ? d.type : eventName;
  switch (type) {
    case 'delta':
      return {
        type: 'delta',
        text: typeof d.text === 'string' ? d.text : '',
      };
    case 'tool_call':
      return {
        type: 'tool_call',
        id: typeof d.id === 'string' ? d.id : '',
        name: typeof d.name === 'string' ? d.name : '',
        arguments: d.arguments,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        id: typeof d.id === 'string' ? d.id : '',
        name: typeof d.name === 'string' ? d.name : '',
        ok: d.ok === true,
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

interface AIFeatureStream {
  state: AiStreamState;
  text: string;
  error: string | null;
  start: () => void;
}

interface AIFeatureCardProps {
  title: string;
  description: string;
  buttonLabel: string;
  badgeLabel?: string;
  canStart: boolean;
  stream: AIFeatureStream;
  accessibilityHint?: string;
}

function NativeHelixButton({
  label,
  accessibilityLabel,
  accessibilityHint,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <AppText style={styles.buttonText} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

function AIBadge({ label }: { label: string }) {
  return (
    <View accessibilityLabel="Helix" style={styles.badge}>
      <View style={styles.badgeDot} />
      <AppText style={styles.badgeText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

function AiOutputPanel({
  text,
  state,
  error,
  t,
}: {
  text: string;
  state: AiStreamState;
  error: string | null;
  t: NativeTFunction;
}) {
  const hasAnything =
    text.length > 0 ||
    state === 'streaming' ||
    state === 'error' ||
    state === 'done';

  if (!hasAnything) {
    return null;
  }

  return (
    <View style={styles.outputPanel} testID="ai-output-panel">
      {state === 'error' ? (
        <AppText style={styles.errorText}>
          <AppText style={styles.errorLabel} weight="semibold">
            {t('helix.errorLabel', 'Helix error:')}{' '}
          </AppText>
          {error ?? t('ai.common.errorUnknown', 'unknown')}
        </AppText>
      ) : text.length === 0 && state === 'streaming' ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="text"
          style={styles.thinkingBlock}
          testID="ai-thinking-indicator"
        >
          <View style={styles.thinkingRow}>
            <View style={styles.badgeDot} />
            <AppText style={styles.thinkingText} weight="semibold">
              {t('helix.thinking', 'Helix is thinking...')}
            </AppText>
          </View>
          <View style={styles.skeletonLine} />
          <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
          <View style={[styles.skeletonLine, styles.skeletonLineShortest]} />
        </View>
      ) : (
        <AppText style={styles.outputText}>{text}</AppText>
      )}
    </View>
  );
}

function AIFeatureCard({
  title,
  description,
  buttonLabel,
  badgeLabel = 'Helix',
  canStart,
  stream,
  accessibilityHint,
}: AIFeatureCardProps) {
  const t = useNativeTranslationFallback();
  const isStreaming = stream.state === 'streaming';
  const buttonDisabled = !canStart || isStreaming;
  const askHelixLabel = t('helix.askHelix', 'Ask Helix');
  const thinkingLabel = t('helix.thinking', 'Helix is thinking...');

  return (
    <PremiumCard style={styles.card} tone="accent">
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <AppText style={styles.title} weight="semibold">
            {title}
          </AppText>
          <AIBadge label={badgeLabel} />
        </View>
        <AppText style={styles.description} tone="secondary">
          {description}
        </AppText>
      </View>
      <View style={styles.actionRow}>
        <NativeHelixButton
          accessibilityHint={accessibilityHint}
          accessibilityLabel={`${askHelixLabel} - ${buttonLabel}`}
          disabled={buttonDisabled}
          label={isStreaming ? thinkingLabel : askHelixLabel}
          onPress={stream.start}
        />
      </View>
      <AiOutputPanel
        error={stream.error}
        state={stream.state}
        t={t}
        text={stream.text}
      />
    </PremiumCard>
  );
}

function InnerSection({ vehicleId }: InnerSectionProps) {
  const t = useNativeTranslationFallback();
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId);
  const body = useMemo(
    () => ({
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
    }),
    [numericVehicleId],
  );
  const stream = useAiStream({
    url: '/ai/battery/health/narrate',
    body,
    onEvent: () => undefined,
  });
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0;

  return (
    <AIFeatureCard
      accessibilityHint={t(
        'battery.aiNarrative.privacyHint',
        'Only the vehicle name may be narrated; lat/long, street addresses, place names, and charging-location identifiers remain redacted. The narrator explains the deterministic forecast drivers without changing the forecast.',
      )}
      badgeLabel={t('battery.aiNarrative.badge', 'Helix')}
      buttonLabel={t(
        'battery.aiNarrative.generateButton',
        'Narrate forecast',
      )}
      canStart={haveInputs}
      description={t(
        'battery.aiNarrative.description',
        'Ask Helix to explain which charging habits and risk factors drive your deterministic battery-health forecast. The narrator never changes the forecast \u2014 it grounds every sentence in the same numbers the chart below renders.',
      )}
      stream={stream}
      title={t(
        'battery.aiNarrative.title',
        'Explain the battery health forecast',
      )}
    />
  );
}

(
  InnerSection as ComponentType<InnerSectionProps> & {
    displayName?: string;
  }
).displayName = 'AIBatteryHealthForecastNarrativeInner';

export const AIBatteryHealthForecastNarrative = withAiFeature(
  FEATURE_ID,
  InnerSection,
);
AIBatteryHealthForecastNarrative.displayName =
  'AIBatteryHealthForecastNarrative';

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  description: {
    maxWidth: 720,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeDot: {
    backgroundColor: colors.accent,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  badgeText: {
    color: colors.accent,
    letterSpacing: 0.4,
  },
  actionRow: {
    alignItems: 'flex-end',
  },
  button: {
    alignItems: 'center',
    backgroundColor: 'rgba(53, 213, 255, 0.08)',
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.78,
  },
  buttonText: {
    color: colors.textPrimary,
  },
  outputPanel: {
    backgroundColor: 'rgba(15, 23, 42, 0.68)',
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.lg,
  },
  outputText: {
    color: colors.textSecondary,
  },
  errorText: {
    color: colors.danger,
  },
  errorLabel: {
    color: colors.danger,
  },
  thinkingBlock: {
    gap: spacing.md,
  },
  thinkingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  thinkingText: {
    color: colors.accent,
  },
  skeletonLine: {
    backgroundColor: 'rgba(53, 213, 255, 0.16)',
    borderRadius: 999,
    height: 10,
    width: '100%',
  },
  skeletonLineShort: {
    width: '76%',
  },
  skeletonLineShortest: {
    width: '52%',
  },
});

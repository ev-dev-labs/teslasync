// Native parity port of web/src/components/ai/AIPeriodCompareNarration.tsx.
// The Narrate comparison action streams from POST /api/v1/ai/analytics/period-compare/narrate.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { View } from 'react-native';

import { AI_FEATURES, type AiFeatureId } from '../../ai/features';
import { apiUrl } from '../../api/client';
import { useSettings } from '../../api/hooks/useSettings';
import {
  AIFeatureCard,
  type AiStreamState,
} from './AIFeatureCard';

interface InnerSectionProps {
  vehicleId?: string | number;
  daysA?: number;
  daysB?: number;
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

const FEATURE_ID: AiFeatureId = 'period-compare-narration';
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

  const data = parsed as Record<string, unknown>;
  const type = typeof data.type === 'string' ? data.type : eventName;
  switch (type) {
    case 'delta':
      return {
        type: 'delta',
        text: typeof data.text === 'string' ? data.text : '',
      };
    case 'tool_call':
      return {
        type: 'tool_call',
        id: typeof data.id === 'string' ? data.id : '',
        name: typeof data.name === 'string' ? data.name : '',
        arguments: data.arguments,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        id: typeof data.id === 'string' ? data.id : '',
        name: typeof data.name === 'string' ? data.name : '',
        ok: data.ok === true,
        data: data.data,
        error: typeof data.error === 'string' ? data.error : undefined,
      };
    case 'confirm_request':
      if (
        typeof data.continuation_id !== 'string' ||
        typeof data.tool !== 'string' ||
        typeof data.summary !== 'string'
      ) {
        return null;
      }
      return {
        type: 'confirm_request',
        continuation_id: data.continuation_id,
        tool: data.tool,
        args: data.args,
        summary: data.summary,
      };
    case 'done': {
      const usage = data.usage as { in?: number; out?: number } | undefined;
      return {
        type: 'done',
        finish_reason:
          typeof data.finish_reason === 'string' ? data.finish_reason : 'stop',
        usage: {
          in: typeof usage?.in === 'number' ? usage.in : 0,
          out: typeof usage?.out === 'number' ? usage.out : 0,
        },
      };
    }
    case 'error': {
      const bannerLevelRaw =
        typeof data.banner_level === 'string' ? data.banner_level : undefined;
      const bannerLevel =
        bannerLevelRaw === 'warn' ||
        bannerLevelRaw === 'critical' ||
        bannerLevelRaw === ''
          ? bannerLevelRaw
          : undefined;
      return {
        type: 'error',
        message: typeof data.message === 'string' ? data.message : 'unknown',
        reason: typeof data.reason === 'string' ? data.reason : undefined,
        retry_after_s:
          typeof data.retry_after_s === 'number'
            ? data.retry_after_s
            : undefined,
        banner_level: bannerLevel,
        baseline_available:
          typeof data.baseline_available === 'boolean'
            ? data.baseline_available
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

    const runStream = async () => {
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
    };

    runStream().catch(err => {
      finalizeError(err instanceof Error ? err.message : String(err));
      runningRef.current = false;
      abortRef.current = null;
    });
  }, [body, url]);

  return { start, cancel, state, text, error, limit };
}

function InnerSection({ vehicleId, daysA, daysB }: InnerSectionProps) {
  const t = useNativeTranslationFallback();
  const numericVehicleId =
    typeof vehicleId === 'number' ? vehicleId : Number(vehicleId);
  const body = useMemo(() => {
    const out: { vehicle_id: number; days_a?: number; days_b?: number } = {
      vehicle_id: Number.isFinite(numericVehicleId) ? numericVehicleId : 0,
    };
    if (typeof daysA === 'number' && Number.isFinite(daysA) && daysA >= 0) {
      out.days_a = daysA;
    }
    if (typeof daysB === 'number' && Number.isFinite(daysB) && daysB >= 0) {
      out.days_b = daysB;
    }
    return out;
  }, [numericVehicleId, daysA, daysB]);
  const stream = useAiStream({
    url: '/ai/analytics/period-compare/narrate',
    body,
    onEvent: () => undefined,
  });
  const haveInputs = Number.isFinite(numericVehicleId) && numericVehicleId > 0;

  return (
    <AIFeatureCard
      badgeLabel={t('compare.aiNarrative.badge', 'Helix')}
      buttonLabel={t(
        'compare.aiNarrative.generateButton',
        'Narrate comparison',
      )}
      canStart={haveInputs}
      description={t(
        'compare.aiNarrative.description',
        'Ask Helix to explain the deterministic period-over-period analytics - which one or two metrics moved most between Period A and Period B, with directional phrasing keyed to the percent_change sign. The numbers are the same the chart and table below show; the narrator only explains them and is honest about zero-baseline windows and best-effort cost figures.',
      )}
      stream={stream}
      title={t(
        'compare.aiNarrative.title',
        'Narrate the period comparison',
      )}
    />
  );
}

(
  InnerSection as ComponentType<InnerSectionProps> & {
    displayName?: string;
  }
).displayName = 'AIPeriodCompareNarrationInner';

export const AIPeriodCompareNarration = withAiFeature(
  FEATURE_ID,
  InnerSection,
);
AIPeriodCompareNarration.displayName = 'AIPeriodCompareNarration';

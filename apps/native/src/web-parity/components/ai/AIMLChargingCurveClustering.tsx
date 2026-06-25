// Native parity port of web/src/components/ai/AIMLChargingCurveClustering.tsx.
//
// The Train charging-curve clusters button streams from
// POST /api/v1/ai/ml/charging-curves/cluster.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import {View} from 'react-native';

import {AI_FEATURES, type AiFeatureId} from '../../ai/features';
import {apiUrl} from '../../api/client';
import {useSettings} from '../../api/hooks/useSettings';
import {AIFeatureCard, type AiStreamState} from './AIFeatureCard';

interface InnerSectionProps {
  vehicleId?: number;
}

type AiStreamEvent =
  | {type: 'delta'; text: string}
  | {type: 'tool_call'; id: string; name: string; arguments: unknown}
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
  | {type: 'done'; finish_reason: string; usage: {in: number; out: number}}
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
    options?: {stream?: boolean},
  ): string;
}

type TextDecoderConstructorLike = new (label?: string) => TextDecoderLike;
type NativeTFunction = (key: string, fallback: string) => string;

const FEATURE_ID: AiFeatureId = 'ml-charging-curve-clustering';
const AI_STREAM_UNAVAILABLE_REASON =
  'React Native fetch did not expose a readable response body for AI SSE streaming.';
const FETCH_UNAVAILABLE_REASON =
  'React Native fetch is unavailable for AI SSE streaming.';
const SSE_DELIM_RE = /\r?\n\r?\n/;
const LINE_DELIM_RE = /\r?\n/;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

function useAiEnabled(feature: AiFeatureId): boolean {
  const {data: settings} = useSettings();
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
  const namedInner = Inner as ComponentType<P> & {displayName?: string};
  const innerName = namedInner.displayName ?? Inner.name ?? 'Component';

  const Wrapped: ComponentType<P> & {displayName?: string} = (props: P) => {
    const enabled = useAiEnabled(feature);
    if (!enabled) {
      return null;
    }

    return (
      <View
        accessibilityLabel={`AI feature ${feature}`}
        testID={meta.uiTestIds[0] ?? `ai-feature-${feature}`}>
        <Inner {...props} />
      </View>
    );
  };

  Wrapped.displayName = `withAiFeature(${feature}, ${innerName})`;
  return Wrapped;
}

function getFetch(): typeof fetch | null {
  const candidate = (globalThis as typeof globalThis & {fetch?: unknown}).fetch;
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
    globalThis as typeof globalThis & {TextDecoder?: unknown}
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
    return decoder?.decode(undefined, {stream}) ?? '';
  }
  if (typeof value === 'string') {
    return value;
  }

  const bytes = toUint8Array(value);
  return decoder?.decode(bytes, {stream}) ?? decodeAscii(bytes);
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

  const payload = parsed as Record<string, unknown>;
  const type = typeof payload.type === 'string' ? payload.type : eventName;
  switch (type) {
    case 'delta':
      return {
        type: 'delta',
        text: typeof payload.text === 'string' ? payload.text : '',
      };
    case 'tool_call':
      return {
        type: 'tool_call',
        id: typeof payload.id === 'string' ? payload.id : '',
        name: typeof payload.name === 'string' ? payload.name : '',
        arguments: payload.arguments,
      };
    case 'tool_result':
      return {
        type: 'tool_result',
        id: typeof payload.id === 'string' ? payload.id : '',
        name: typeof payload.name === 'string' ? payload.name : '',
        ok: payload.ok === true,
        data: payload.data,
        error: typeof payload.error === 'string' ? payload.error : undefined,
      };
    case 'confirm_request':
      if (
        typeof payload.continuation_id !== 'string' ||
        typeof payload.tool !== 'string' ||
        typeof payload.summary !== 'string'
      ) {
        return null;
      }
      return {
        type: 'confirm_request',
        continuation_id: payload.continuation_id,
        tool: payload.tool,
        args: payload.args,
        summary: payload.summary,
      };
    case 'done': {
      const usage = payload.usage as {in?: number; out?: number} | undefined;
      return {
        type: 'done',
        finish_reason:
          typeof payload.finish_reason === 'string'
            ? payload.finish_reason
            : 'stop',
        usage: {
          in: typeof usage?.in === 'number' ? usage.in : 0,
          out: typeof usage?.out === 'number' ? usage.out : 0,
        },
      };
    }
    case 'error': {
      const bannerLevelRaw =
        typeof payload.banner_level === 'string'
          ? payload.banner_level
          : undefined;
      const bannerLevel =
        bannerLevelRaw === 'warn' ||
        bannerLevelRaw === 'critical' ||
        bannerLevelRaw === ''
          ? bannerLevelRaw
          : undefined;
      return {
        type: 'error',
        message:
          typeof payload.message === 'string' ? payload.message : 'unknown',
        reason:
          typeof payload.reason === 'string' ? payload.reason : undefined,
        retry_after_s:
          typeof payload.retry_after_s === 'number'
            ? payload.retry_after_s
            : undefined,
        banner_level: bannerLevel,
        baseline_available:
          typeof payload.baseline_available === 'boolean'
            ? payload.baseline_available
            : undefined,
      };
    }
    default:
      return null;
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) {
    return res.statusText || `HTTP ${res.status}`;
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.error === 'string' && parsed.error.trim() !== '') {
      return parsed.error;
    }
    if (typeof parsed.message === 'string' && parsed.message.trim() !== '') {
      return parsed.message;
    }
  } catch {
    return text;
  }

  return text;
}

function limitFromError(ev: Extract<AiStreamEvent, {type: 'error'}>): AiLimitInfo {
  return {
    reason: ev.reason ?? 'error',
    retryAfterS: ev.retry_after_s ?? 0,
    bannerLevel: ev.banner_level ?? '',
    baselineAvailable: ev.baseline_available ?? false,
    message: ev.message,
  };
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

  const finalizeError = useCallback((message: string) => {
    setError(message);
    setLimit(null);
    setState('error');
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    runningRef.current = false;
    setState(cur =>
      cur === 'streaming' || cur === 'paused-confirm' ? 'idle' : cur,
    );
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) {
      return;
    }

    const fetchImpl = getFetch();
    if (fetchImpl === null) {
      finalizeError(FETCH_UNAVAILABLE_REASON);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    runningRef.current = true;
    setText('');
    setError(null);
    setLimit(null);
    setState('streaming');

    void (async () => {
      let reader: NativeReadableStreamReader | null = null;
      let terminalEventSeen = false;
      const decoder = getTextDecoder();
      let buffer = '';

      const handleEvent = (event: AiStreamEvent) => {
        onEventRef.current(event);
        switch (event.type) {
          case 'delta':
            setText(current => current + event.text);
            break;
          case 'confirm_request':
            terminalEventSeen = true;
            setState('paused-confirm');
            break;
          case 'done':
            terminalEventSeen = true;
            setState('done');
            break;
          case 'error':
            terminalEventSeen = true;
            setError(event.message);
            setLimit(limitFromError(event));
            setState('error');
            break;
          case 'tool_call':
          case 'tool_result':
            break;
        }
      };

      try {
        const res = await fetchImpl(apiUrl(url), {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body ?? {}),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(await readErrorMessage(res));
        }

        const streamBody = getReadableStreamBody(res);
        if (streamBody === null) {
          finalizeError(AI_STREAM_UNAVAILABLE_REASON);
          return;
        }

        reader = streamBody.getReader();
        while (true) {
          const {done, value} = await reader.read();
          if (done) {
            break;
          }

          buffer += decodeStreamChunk(value, decoder, true);
          const parts = buffer.split(SSE_DELIM_RE);
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const event = parseSSEFrame(part);
            if (event !== null) {
              handleEvent(event);
            }
          }
        }

        buffer += decodeStreamChunk(undefined, decoder, false);
        if (buffer.trim() !== '') {
          const event = parseSSEFrame(buffer);
          if (event !== null) {
            handleEvent(event);
          }
        }

        if (!terminalEventSeen) {
          setState('done');
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setState(cur => (cur === 'streaming' ? 'idle' : cur));
          return;
        }
        finalizeError(err instanceof Error ? err.message : String(err));
      } finally {
        reader?.releaseLock?.();
        runningRef.current = false;
        abortRef.current = null;
      }
    })();
  }, [body, finalizeError, url]);

  useEffect(() => cancel, [cancel]);

  return {start, cancel, state, text, error, limit};
}

function InnerSection({vehicleId}: InnerSectionProps) {
  const t = useNativeTranslationFallback();
  // Preserve the web trainer's 90-day learning window and snake_case body keys.
  const body = useMemo(
    () => ({vehicle_id: vehicleId ?? 0, lookback_days: 90}),
    [vehicleId],
  );
  const stream = useAiStream({
    url: '/ai/ml/charging-curves/cluster',
    body,
    onEvent: () => undefined,
  });

  return (
    <AIFeatureCard
      badgeLabel={t('charging.aiMlClustering.badge', 'Helix')}
      buttonLabel={t(
        'charging.aiMlClustering.generateButton',
        'Train charging-curve clusters',
      )}
      canStart={vehicleId != null}
      description={t(
        'charging.aiMlClustering.description',
        'Compute per-cluster (L1 overnight / L2 workplace / DC fast) learned charging envelope from this vehicle’s recent sessions and walk through how each cluster compares to the deterministic rule-label baseline used by the Charging Curve page today.',
      )}
      stream={stream}
      title={t(
        'charging.aiMlClustering.title',
        'Learn per-vehicle charging-curve clusters',
      )}
    />
  );
}

(
  InnerSection as ComponentType<InnerSectionProps> & {
    displayName?: string;
  }
).displayName = 'AIMLChargingCurveClusteringInner';

export const AIMLChargingCurveClustering = withAiFeature(
  FEATURE_ID,
  InnerSection,
);
AIMLChargingCurveClustering.displayName = 'AIMLChargingCurveClustering';

// Native parity port of web/src/components/ai/AIVehiclePaintPreview.tsx.
//
// The Preview paint color button streams from
// POST /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft. Helix drafts a
// propose-only paint preview image prompt; deterministic vehicle configuration
// and manual appearance controls remain the source of truth.

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
import {AIFeatureCard} from './AIFeatureCard';

interface InnerSectionProps {
  /**
   * vehicleId surfaced by the parent VehicleDetailPage. Required for the
   * backend call: /api/v1/ai/vehicles/{vehicleID}/paint-preview/draft.
   */
  vehicleId?: number;

  /**
   * Optional one-word style hint the user can pass to Helix. Empty values are
   * omitted so the strategy can choose a sensible default.
   */
  styleHint?: string;
}

type AiStreamEvent =
  | {type: 'delta'; text: string}
  | {type: 'done'; finish_reason: string; usage: {in: number; out: number}}
  | {
      type: 'error';
      message: string;
      reason?: string;
      retry_after_s?: number;
      banner_level?: 'warn' | 'critical' | '';
      baseline_available?: boolean;
    }
  | {
      type: 'confirm_request';
      continuation_id: string;
      tool: string;
      args: unknown;
      summary: string;
    }
  | {
      type: 'tool_call' | 'tool_result';
      id: string;
      name: string;
      arguments?: unknown;
      ok?: boolean;
      data?: unknown;
      error?: string;
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

const FEATURE_ID: AiFeatureId = 'vehicle-paint-preview';
const AI_STREAM_UNAVAILABLE_REASON =
  'React Native fetch did not expose a readable response body for AI SSE streaming.';
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
  const candidate = (globalThis as typeof globalThis & {TextDecoder?: unknown})
    .TextDecoder;
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
    return decoder ? decoder.decode(undefined, {stream}) : '';
  }
  if (typeof value === 'string') {
    return value;
  }

  const bytes = toUint8Array(value);
  if (decoder) {
    return decoder.decode(bytes, {stream});
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
      return typeof d.text === 'string' ? {type: 'delta', text: d.text} : null;
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
      const usage = d.usage as {in?: number; out?: number} | undefined;
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

function useAiStream({url, body, onEvent}: UseAiStreamArgs): UseAiStreamResult {
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
          const {value, done} = await reader.read();
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

  return {start, cancel, state, text, error, limit};
}

function InnerSection({vehicleId, styleHint}: InnerSectionProps) {
  const t = useNativeTranslationFallback();
  const numericVehicleId =
    typeof vehicleId === 'number' && Number.isFinite(vehicleId)
      ? vehicleId
      : 0;
  const body = useMemo(() => {
    const payload: {style_hint?: string} = {};
    if (typeof styleHint === 'string' && styleHint.trim() !== '') {
      payload.style_hint = styleHint.trim();
    }
    return payload;
  }, [styleHint]);
  const urlPath =
    numericVehicleId > 0
      ? `/ai/vehicles/${numericVehicleId}/paint-preview/draft`
      : '/ai/vehicles/0/paint-preview/draft';
  const stream = useAiStream({
    url: urlPath,
    body,
    onEvent: () => undefined,
  });
  const haveInputs = numericVehicleId > 0;

  return (
    <AIFeatureCard
      badgeLabel={t('vehicles.aiPaintPreview.badge', 'Helix')}
      buttonLabel={t(
        'vehicles.aiPaintPreview.button',
        'Preview paint color',
      )}
      canStart={haveInputs}
      description={t(
        'vehicles.aiPaintPreview.description',
        'Ask Helix to draft a propose-only paint-color image prompt for this vehicle. Helix only sees the redacted vehicle context (model, trim, current exterior color) \u2014 never the display name, VIN, license plate, or location. The draft is never applied automatically; review the proposed image prompt here, then use the existing Color setting below to apply the new paint if you\u2019d like to keep it.',
      )}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'vehicles.aiPaintPreview.noVehicleHint',
              'Open a vehicle detail page to enable Helix.',
            )
      }
      stream={stream}
      title={t(
        'vehicles.aiPaintPreview.title',
        'Draft a Helix paint preview',
      )}
    />
  );
}

(
  InnerSection as ComponentType<InnerSectionProps> & {
    displayName?: string;
  }
).displayName = 'AIVehiclePaintPreviewInner';

export const AIVehiclePaintPreview = withAiFeature(FEATURE_ID, InnerSection);
AIVehiclePaintPreview.displayName = 'AIVehiclePaintPreview';

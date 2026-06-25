// Native parity port of web/src/components/ai/AIPiiRedactionSharedExports.tsx.
// The Suggest redactions button streams from POST /api/v1/ai/exports/redaction/draft.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {AI_FEATURES, type AiFeatureId} from '../../ai/features';
import {apiUrl} from '../../api/client';
import {useSettings} from '../../api/hooks/useSettings';
import {AIFeatureCard, type AiStreamState} from './AIFeatureCard';

// SHARED_EXPORT_TYPES MUST stay aligned with
// internal/ai/tools/export_redaction_plan.go:SharedExportTypes().
const SHARED_EXPORT_TYPES = [
  'drives',
  'charging',
  'trips',
  'analytics',
  'backup',
  'account',
] as const;

type SharedExportType = (typeof SHARED_EXPORT_TYPES)[number];

interface NativeSelectOption {
  value: SharedExportType;
  label: string;
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

const FEATURE_ID: AiFeatureId = 'pii-redaction-shared-exports';
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
    if (line.startsWith(':')) {
      continue;
    }
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
      const usage = data.usage as {in?: number; out?: number} | undefined;
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

function NativeExportTypeSelect({
  accessibilityLabel,
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  accessibilityLabel: string;
  label: string;
  onChange: (value: SharedExportType | '') => void;
  options: NativeSelectOption[];
  placeholder: string;
  value: SharedExportType | '';
}) {
  const selectedLabel =
    options.find(option => option.value === value)?.label ?? placeholder;

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="radiogroup"
      style={styles.selectRoot}
      testID="ai-feature-pii-redaction-shared-exports-export-type">
      <AppText style={styles.selectLabel} variant="caption" weight="semibold">
        {label}
      </AppText>
      <View style={styles.selectTrigger}>
        <AppText
          style={value === '' ? styles.placeholderText : styles.selectedText}>
          {selectedLabel}
        </AppText>
      </View>
      <View style={styles.optionGrid}>
        <Pressable
          accessibilityLabel={placeholder}
          accessibilityRole="radio"
          accessibilityState={{selected: value === ''}}
          onPress={() => onChange('')}
          style={({pressed}) => [
            styles.optionPill,
            value === '' && styles.optionPillSelected,
            pressed && styles.optionPillPressed,
          ]}>
          <AppText
            style={[
              styles.optionText,
              value === '' && styles.optionTextSelected,
            ]}
            variant="caption"
            weight="semibold">
            {placeholder}
          </AppText>
        </Pressable>
        {options.map(option => {
          const selected = option.value === value;
          return (
            <Pressable
              accessibilityLabel={option.label}
              accessibilityRole="radio"
              accessibilityState={{selected}}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={({pressed}) => [
                styles.optionPill,
                selected && styles.optionPillSelected,
                pressed && styles.optionPillPressed,
              ]}>
              <AppText
                style={[
                  styles.optionText,
                  selected && styles.optionTextSelected,
                ]}
                variant="caption"
                weight="semibold">
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function InnerSection() {
  const t = useNativeTranslationFallback();
  const [exportType, setExportType] = useState<SharedExportType | ''>('');
  const body = useMemo(
    () => ({export_type: exportType}),
    [exportType],
  );
  const stream = useAiStream({
    url: '/ai/exports/redaction/draft',
    body,
    onEvent: () => undefined,
  });
  const haveInputs = exportType !== '';

  const options = useMemo<NativeSelectOption[]>(
    () =>
      SHARED_EXPORT_TYPES.map(typeValue => ({
        value: typeValue,
        label: t(
          `exports.aiRedaction.exportType.${typeValue}`,
          typeValue.charAt(0).toUpperCase() + typeValue.slice(1),
        ),
      })),
    [t],
  );

  return (
    <AIFeatureCard
      badgeLabel={t('exports.aiRedaction.badge', 'Helix')}
      buttonLabel={t('exports.aiRedaction.button', 'Suggest redactions')}
      canStart={haveInputs}
      description={t(
        'exports.aiRedaction.description',
        "Ask Helix to recommend which PII classes to redact from a shared export. The recommendation is catalog-based — Helix never reads the rows of your export; it consults a deterministic per-export-type PII catalog and surfaces the highly-recommended redactions plus the optional ones that depend on your consent. Apply the recommendation by toggling the matching options in your export request.",
      )}
      emptyHint={
        haveInputs
          ? undefined
          : t(
              'exports.aiRedaction.noTypeHint',
              'Pick an export type to enable Helix.',
            )
      }
      inputSlot={
        <NativeExportTypeSelect
          accessibilityLabel={t(
            'exports.aiRedaction.exportTypeLabel',
            'Export type',
          )}
          label={t('exports.aiRedaction.exportTypeLabel', 'Export type')}
          onChange={setExportType}
          options={options}
          placeholder={t(
            'exports.aiRedaction.exportTypePlaceholder',
            'Select an export type…',
          )}
          value={exportType}
        />
      }
      stream={stream}
      title={t(
        'exports.aiRedaction.title',
        'Plan PII redactions before sharing',
      )}
    />
  );
}

(InnerSection as ComponentType<object> & {displayName?: string}).displayName =
  'AIPiiRedactionSharedExportsInner';

export const AIPiiRedactionSharedExports = withAiFeature(
  FEATURE_ID,
  InnerSection,
);
AIPiiRedactionSharedExports.displayName = 'AIPiiRedactionSharedExports';

const styles = StyleSheet.create({
  optionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  optionPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionPillPressed: {
    opacity: 0.82,
  },
  optionPillSelected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  optionText: {
    color: colors.textSecondary,
    lineHeight: 18,
  },
  optionTextSelected: {
    color: colors.textPrimary,
  },
  placeholderText: {
    color: colors.textMuted,
    lineHeight: 20,
  },
  selectLabel: {
    color: colors.textSecondary,
    lineHeight: 18,
    textTransform: 'uppercase',
  },
  selectRoot: {
    gap: spacing.sm,
  },
  selectTrigger: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectedText: {
    color: colors.textPrimary,
    lineHeight: 20,
  },
});

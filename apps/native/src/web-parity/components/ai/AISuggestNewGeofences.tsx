// Native parity port of web/src/components/ai/AISuggestNewGeofences.tsx.
//
// The web component streams POST /api/v1/ai/geofences/draft, captures the
// draft_geofence tool_result envelope, and only copies a validated draft into
// the parent geofence form. This native version preserves that review-only
// write contract with React Native primitives and native TeslaSync tokens.

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

// GeofenceDraft mirrors the typed envelope returned by the draft_geofence tool
// (internal/ai/tools/suggest_new_geofences.go geofenceDraft).
export interface GeofenceDraft {
  location_id: number;
  vehicle_id: number;
  proposed_name: string;
  radius_m: number;
  centroid_lat: number;
  centroid_lon: number;
  status: 'ok' | 'invalid' | string;
  validation_error?: string;
}

export interface AISuggestNewGeofencesProps {
  locationId: number;
  currentName?: string;
  onApplyDraft: (draft: {
    name: string;
    latitude: number;
    longitude: number;
    radius: number;
  }) => void;
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

const FEATURE_ID: AiFeatureId = 'suggest-new-geofences';
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

function ApplyDraftButton({
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
      testID="ai-feature-suggest-new-geofences-apply"
    >
      <AppText style={styles.applyButtonText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

function InnerSection({
  locationId,
  currentName,
  onApplyDraft,
}: AISuggestNewGeofencesProps) {
  const t = useNativeTranslationFallback();
  const [draft, setDraft] = useState<GeofenceDraft | null>(null);

  const body = useMemo<Record<string, unknown>>(
    () => ({ location_id: locationId }),
    [locationId],
  );

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (ev.type === 'tool_result' && ev.name === 'draft_geofence' && ev.ok) {
      const wrapper = ev.data as
        | {
            draft?: {
              location_id?: unknown;
              vehicle_id?: unknown;
              proposed_name?: unknown;
              radius_m?: unknown;
              centroid_lat?: unknown;
              centroid_lon?: unknown;
            };
            status?: unknown;
            validation_error?: unknown;
          }
        | undefined;
      const inner = wrapper?.draft;
      if (
        !inner ||
        typeof inner.location_id !== 'number' ||
        typeof inner.vehicle_id !== 'number' ||
        typeof inner.proposed_name !== 'string' ||
        typeof inner.radius_m !== 'number' ||
        typeof inner.centroid_lat !== 'number' ||
        typeof inner.centroid_lon !== 'number' ||
        typeof wrapper?.status !== 'string'
      ) {
        return;
      }
      setDraft({
        location_id: inner.location_id,
        vehicle_id: inner.vehicle_id,
        proposed_name: inner.proposed_name,
        radius_m: inner.radius_m,
        centroid_lat: inner.centroid_lat,
        centroid_lon: inner.centroid_lon,
        status: wrapper.status as GeofenceDraft['status'],
        validation_error:
          typeof wrapper.validation_error === 'string'
            ? wrapper.validation_error
            : undefined,
      });
    }
  }, []);

  const stream = useAiStream({
    url: '/ai/geofences/draft',
    body,
    onEvent: handleEvent,
  });
  const { cancel: cancelStream, start: startStream, state: streamState } = stream;

  useEffect(() => {
    return () => {
      cancelStream();
      setDraft(null);
    };
  }, [locationId, cancelStream]);

  const isBusy =
    streamState === 'streaming' || streamState === 'paused-confirm';

  const handleSuggest = useCallback(() => {
    if (isBusy) {
      return;
    }
    setDraft(null);
    startStream();
  }, [isBusy, startStream]);

  const handleApply = useCallback(() => {
    if (draft && draft.status === 'ok') {
      onApplyDraft({
        name: draft.proposed_name,
        latitude: draft.centroid_lat,
        longitude: draft.centroid_lon,
        radius: draft.radius_m,
      });
    }
  }, [draft, onApplyDraft]);

  const applyLabel = t('geofences.aiSuggest.applyButton', 'Apply to form');

  return (
    <AIFeatureCard
      badgeLabel={t('geofences.aiSuggest.badge', 'Helix')}
      buttonLabel={t(
        'geofences.aiSuggest.suggestButton',
        'Suggest geofence',
      )}
      buttonPlacement="below"
      buttonTestId="ai-feature-suggest-new-geofences-suggest"
      canStart={locationId > 0 && streamState !== 'paused-confirm'}
      description={t(
        'geofences.aiSuggest.description',
        'Propose a typed geofence draft (centroid, radius, and name) for this visited location based on its visit pattern. Review only - Helix never saves the geofence; you confirm and save via the existing baseline Add Geofence form.',
      )}
      onAction={handleSuggest}
      stream={stream}
      title={t(
        'geofences.aiSuggest.title',
        'Suggest a geofence for this location',
      )}
    >
      {currentName ? (
        <AppText style={styles.currentLabel} variant="caption">
          {t('geofences.aiSuggest.currentLabel', 'Current label')}:{' '}
          <AppText style={styles.currentName} variant="caption">
            {currentName}
          </AppText>
        </AppText>
      ) : null}
      {draft ? (
        <View
          style={styles.draftPanel}
          testID="ai-feature-suggest-new-geofences-draft"
        >
          <View style={styles.draftRow}>
            <View style={styles.draftCopy}>
              <AppText style={styles.proposalLabel} variant="caption">
                {t(
                  'geofences.aiSuggest.proposalLabel',
                  'Proposed geofence',
                )}
              </AppText>
              <AppText style={styles.draftName} weight="semibold">
                {draft.proposed_name}
              </AppText>
              <AppText style={styles.radiusText} variant="caption">
                {t('geofences.aiSuggest.radiusLabel', 'Radius')}:{' '}
                <AppText style={styles.radiusValue} variant="caption">
                  {Math.round(draft.radius_m)} m
                </AppText>
              </AppText>
              {draft.validation_error ? (
                <AppText style={styles.validationText} variant="caption">
                  {draft.validation_error}
                </AppText>
              ) : null}
              {draft.status !== 'ok' ? (
                <AppText style={styles.rejectedText} variant="caption">
                  {t(
                    'geofences.aiSuggest.rejectedLabel',
                    'Proposal rejected by validator',
                  )}
                </AppText>
              ) : null}
            </View>
            <View style={styles.applyColumn}>
              <ApplyDraftButton
                disabled={draft.status !== 'ok'}
                label={applyLabel}
                onPress={handleApply}
              />
            </View>
          </View>
        </View>
      ) : null}
    </AIFeatureCard>
  );
}

(
  InnerSection as ComponentType<AISuggestNewGeofencesProps> & {
    displayName?: string;
  }
).displayName = 'AISuggestNewGeofencesInner';

export const AISuggestNewGeofences = withAiFeature(FEATURE_ID, InnerSection);
AISuggestNewGeofences.displayName = 'AISuggestNewGeofences';

const styles = StyleSheet.create({
  applyButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
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
  applyColumn: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  currentLabel: {
    color: colors.textMuted,
  },
  currentName: {
    color: colors.textSecondary,
  },
  draftCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  draftName: {
    color: colors.textPrimary,
    lineHeight: 20,
  },
  draftPanel: {
    backgroundColor: 'rgba(53, 213, 255, 0.05)',
    borderColor: 'rgba(103, 232, 249, 0.3)',
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  draftRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  proposalLabel: {
    color: colors.accent,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  radiusText: {
    color: colors.textSecondary,
  },
  radiusValue: {
    color: colors.textSecondary,
  },
  rejectedText: {
    color: colors.danger,
  },
  validationText: {
    color: colors.textSecondary,
  },
});

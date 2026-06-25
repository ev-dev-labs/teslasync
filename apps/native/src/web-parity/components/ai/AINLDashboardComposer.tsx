// Native parity port of web/src/components/ai/AINLDashboardComposer.tsx.
// The Draft dashboard button streams from POST /api/v1/ai/power/dashboard/draft.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import {Pressable, StyleSheet, TextInput, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {AI_FEATURES, type AiFeatureId} from '../../ai/features';
import {apiUrl} from '../../api/client';
import {useSettings} from '../../api/hooks/useSettings';
import {AIFeatureCard} from './AIFeatureCard';

export interface DashboardLayoutDraft {
  prompt: string;
  dashboard: DashboardEnvelope;
  rationale: string;
  referenced_panels: string[];
}

export interface DashboardEnvelope {
  title: string;
  slots: DashboardSlot[];
}

export interface DashboardSlot {
  panel_name: string;
  grid_pos: DashboardSlotGrid;
}

export interface DashboardSlotGrid {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AINLDashboardComposerProps {
  onApply: (draft: DashboardLayoutDraft) => void;
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
    options?: {stream?: boolean},
  ): string;
}

type TextDecoderConstructorLike = new (label?: string) => TextDecoderLike;
type NativeTFunction = (key: string, fallback: string) => string;

const FEATURE_ID: AiFeatureId = 'nl-dashboard-composer';
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

function parseDashboardLayoutDraft(data: unknown): DashboardLayoutDraft | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const obj = data as Record<string, unknown>;
  if (obj.status !== 'ok') {
    return null;
  }
  const draft = obj.draft;
  if (!draft || typeof draft !== 'object') {
    return null;
  }
  const d = draft as Record<string, unknown>;
  if (typeof d.prompt !== 'string') {
    return null;
  }
  if (typeof d.rationale !== 'string') {
    return null;
  }
  const dashboard = d.dashboard;
  if (!dashboard || typeof dashboard !== 'object') {
    return null;
  }
  const dash = dashboard as Record<string, unknown>;
  if (typeof dash.title !== 'string') {
    return null;
  }
  const slots = Array.isArray(dash.slots)
    ? dash.slots
        .map(slotValue => {
          if (!slotValue || typeof slotValue !== 'object') {
            return null;
          }
          const sObj = slotValue as Record<string, unknown>;
          if (typeof sObj.panel_name !== 'string') {
            return null;
          }
          const grid = sObj.grid_pos;
          if (!grid || typeof grid !== 'object') {
            return null;
          }
          const g = grid as Record<string, unknown>;
          if (typeof g.x !== 'number' || typeof g.y !== 'number') {
            return null;
          }
          if (typeof g.w !== 'number' || typeof g.h !== 'number') {
            return null;
          }
          const slot: DashboardSlot = {
            panel_name: sObj.panel_name,
            grid_pos: {x: g.x, y: g.y, w: g.w, h: g.h},
          };
          return slot;
        })
        .filter((slot): slot is DashboardSlot => slot !== null)
    : [];
  const panels = Array.isArray(d.referenced_panels)
    ? (d.referenced_panels.filter(
        panel => typeof panel === 'string',
      ) as string[])
    : [];
  return {
    prompt: d.prompt,
    dashboard: {
      title: dash.title,
      slots,
    },
    rationale: d.rationale,
    referenced_panels: panels,
  };
}

function ApplyDashboardButton({
  disabled,
  hint,
  label,
  onPress,
}: {
  disabled: boolean;
  hint: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.applyButton,
        disabled && styles.applyButtonDisabled,
        pressed && !disabled && styles.applyButtonPressed,
      ]}
      testID="ai-feature-nl-dashboard-composer-apply">
      <AppText style={styles.applyButtonText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

function InnerSection(props: AINLDashboardComposerProps) {
  const {onApply} = props;
  const t = useNativeTranslationFallback();

  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<DashboardLayoutDraft | null>(null);

  const trimmed = prompt.trim();
  const hasPrompt = trimmed.length > 0;

  const body = useMemo(() => ({prompt: trimmed}), [trimmed]);

  const onEvent = useCallback((ev: AiStreamEvent) => {
    if (ev.type === 'tool_result' && ev.name === 'draft_dashboard_layout') {
      const parsed = parseDashboardLayoutDraft(ev.data);
      if (parsed) {
        setDraft(parsed);
      }
    }
  }, []);

  const stream = useAiStream({
    url: '/ai/power/dashboard/draft',
    body,
    onEvent,
  });

  const isStreaming = stream.state === 'streaming';
  const canDraft = !isStreaming && hasPrompt;
  const canApply = !!draft && !isStreaming;

  const handleDraft = useCallback(() => {
    if (!canDraft) {
      return;
    }
    setDraft(null);
    stream.start();
  }, [canDraft, stream]);

  const handleApply = useCallback(() => {
    if (!canApply || !draft) {
      return;
    }
    onApply(draft);
  }, [canApply, draft, onApply]);

  const applyLabel = t(
    'powerDashboards.aiDrafter.applyButton',
    'Apply to editor',
  );
  const applyHint = t(
    'powerDashboards.aiDrafter.applyTooltip',
    'Copy the proposed dashboard JSON into the editor above. You can still edit it before clicking Copy to clipboard.',
  );

  return (
    <AIFeatureCard
      badgeLabel={t('powerDashboards.aiDrafter.badge', 'Helix')}
      buttonLabel={t(
        'powerDashboards.aiDrafter.button',
        'Draft dashboard',
      )}
      buttonTestId="ai-feature-nl-dashboard-composer-draft"
      canStart={hasPrompt}
      description={t(
        'powerDashboards.aiDrafter.description',
        'Describe the dashboard you want in plain English (e.g. "give me an overview dashboard with daily drives, current battery, and recent alerts"). Helix proposes a typed dashboard JSON draft built from the in-scope curated panel catalog you can apply to the editor with one click; it never pushes the dashboard to Grafana directly.',
      )}
      inputSlot={
        <TextInput
          accessibilityLabel={t(
            'powerDashboards.aiDrafter.promptLabel',
            'Dashboard request',
          )}
          multiline
          numberOfLines={2}
          onChangeText={setPrompt}
          placeholder={t(
            'powerDashboards.aiDrafter.promptPlaceholder',
            'e.g. give me an overview dashboard with daily drives, current battery, and recent alerts',
          )}
          placeholderTextColor={colors.textMuted}
          style={styles.promptInput}
          testID="ai-feature-nl-dashboard-composer-prompt"
          textAlignVertical="top"
          value={prompt}
        />
      }
      onAction={handleDraft}
      stream={stream}
      title={t(
        'powerDashboards.aiDrafter.title',
        'Helix natural-language dashboard composer',
      )}>
      {draft ? (
        <View style={styles.applyRow}>
          <ApplyDashboardButton
            disabled={!canApply}
            hint={applyHint}
            label={applyLabel}
            onPress={handleApply}
          />
        </View>
      ) : null}
    </AIFeatureCard>
  );
}

(
  InnerSection as ComponentType<AINLDashboardComposerProps> & {
    displayName?: string;
  }
).displayName = 'AINLDashboardComposerInner';

export const AINLDashboardComposer = withAiFeature(FEATURE_ID, InnerSection);
AINLDashboardComposer.displayName = 'AINLDashboardComposer';

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
  applyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  promptInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 70,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});

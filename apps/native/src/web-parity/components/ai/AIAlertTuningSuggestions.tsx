// Native parity port of web/src/components/ai/AIAlertTuningSuggestions.tsx.
//
// The web component composes DOM-only AI card, button, and streaming-output
// primitives. This file keeps the same alert-tuning stream contract while
// rendering with React Native primitives and native TeslaSync design tokens.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../../components/ui/AppText';
import { PremiumCard } from '../../../components/ui/PremiumCard';
import { colors, spacing } from '../../../theme/tokens';
import { AI_FEATURES, type AiFeatureId } from '../../ai/features';
import { apiUrl } from '../../api/client';
import { useSettings } from '../../api/hooks/useSettings';

export interface AlertRuleDraftPatch {
  value_num?: number | null;
  value_min?: number | null;
  value_max?: number | null;
  cooldown_min?: number;
  severity?: string;
  trigger_mode?: string;
  op?: string;
}

export interface AIAlertTuningSuggestionsProps {
  ruleId: number;
  vehicleId?: number | null;
  onApplyDraft: (patch: AlertRuleDraftPatch) => void;
}

export type AiStreamEvent =
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

export type AiStreamState =
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

const FEATURE_ID: AiFeatureId = 'alert-tuning-suggestions';
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

  const Wrapped = (props: P) => {
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
  onAction?: () => void;
  buttonTestId?: string;
  children?: ReactNode;
}

function NativeHelixButton({
  label,
  accessibilityLabel,
  disabled,
  onPress,
  testID,
  variant = 'outline',
}: {
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
  testID?: string;
  variant?: 'outline' | 'primary';
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.outlineButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <AppText
        style={
          variant === 'primary'
            ? styles.primaryButtonText
            : styles.outlineButtonText
        }
        weight="semibold"
      >
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
  onAction,
  buttonTestId,
  children,
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
          accessibilityLabel={`${askHelixLabel} - ${buttonLabel}`}
          disabled={buttonDisabled}
          label={isStreaming ? thinkingLabel : askHelixLabel}
          onPress={onAction ?? stream.start}
          testID={buttonTestId}
        />
      </View>
      {children}
      <AiOutputPanel
        error={stream.error}
        state={stream.state}
        t={t}
        text={stream.text}
      />
    </PremiumCard>
  );
}

interface ProposalRow {
  key: keyof AlertRuleDraftPatch;
  label: string;
  value: string;
}

function proposalRows(proposal: AlertRuleDraftPatch | null): ProposalRow[] {
  if (!proposal) {
    return [];
  }

  const rows: ProposalRow[] = [];
  if (proposal.value_num != null) {
    rows.push({
      key: 'value_num',
      label: 'value_num',
      value: String(proposal.value_num),
    });
  }
  if (proposal.value_min != null) {
    rows.push({
      key: 'value_min',
      label: 'value_min',
      value: String(proposal.value_min),
    });
  }
  if (proposal.value_max != null) {
    rows.push({
      key: 'value_max',
      label: 'value_max',
      value: String(proposal.value_max),
    });
  }
  if (proposal.cooldown_min != null) {
    rows.push({
      key: 'cooldown_min',
      label: 'cooldown_min',
      value: String(proposal.cooldown_min),
    });
  }
  if (proposal.severity) {
    rows.push({ key: 'severity', label: 'severity', value: proposal.severity });
  }
  if (proposal.trigger_mode) {
    rows.push({
      key: 'trigger_mode',
      label: 'trigger_mode',
      value: proposal.trigger_mode,
    });
  }
  if (proposal.op) {
    rows.push({ key: 'op', label: 'op', value: proposal.op });
  }
  return rows;
}

function InnerSection({
  ruleId,
  vehicleId,
  onApplyDraft,
}: AIAlertTuningSuggestionsProps) {
  const t = useNativeTranslationFallback();
  const [proposal, setProposal] = useState<AlertRuleDraftPatch | null>(null);

  const body = useMemo(() => {
    if (vehicleId == null) {
      return {};
    }
    return { vehicle_id: vehicleId };
  }, [vehicleId]);

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (
      ev.type === 'tool_result' &&
      ev.name === 'draft_alert_rule_patch' &&
      ev.ok
    ) {
      const data = ev.data as
        | { proposed?: Record<string, unknown>; status?: string }
        | undefined;
      if (!data || data.status !== 'ok' || !data.proposed) {
        return;
      }
      const proposed = data.proposed;
      const patch: AlertRuleDraftPatch = {};
      if (typeof proposed.value_num === 'number') {
        patch.value_num = proposed.value_num;
      }
      if (typeof proposed.value_min === 'number') {
        patch.value_min = proposed.value_min;
      }
      if (typeof proposed.value_max === 'number') {
        patch.value_max = proposed.value_max;
      }
      if (typeof proposed.cooldown_min === 'number') {
        patch.cooldown_min = proposed.cooldown_min;
      }
      if (typeof proposed.severity === 'string' && proposed.severity !== '') {
        patch.severity = proposed.severity;
      }
      if (
        typeof proposed.trigger_mode === 'string' &&
        proposed.trigger_mode !== ''
      ) {
        patch.trigger_mode = proposed.trigger_mode;
      }
      if (typeof proposed.op === 'string' && proposed.op !== '') {
        patch.op = proposed.op;
      }
      setProposal(patch);
    }
  }, []);

  const stream = useAiStream({
    url: `/ai/alerts/rules/${ruleId}/tune/draft`,
    body,
    onEvent: handleEvent,
  });
  const { cancel: cancelStream } = stream;

  useEffect(() => {
    return () => {
      cancelStream();
      setProposal(null);
    };
  }, [ruleId, cancelStream]);

  const isBusy =
    stream.state === 'streaming' || stream.state === 'paused-confirm';

  const handleSuggest = useCallback(() => {
    if (isBusy) {
      return;
    }
    setProposal(null);
    stream.start();
  }, [isBusy, stream]);

  const handleApply = useCallback(() => {
    if (!proposal) {
      return;
    }
    onApplyDraft(proposal);
  }, [proposal, onApplyDraft]);

  const rows = proposalRows(proposal);

  return (
    <AIFeatureCard
      badgeLabel={t('notifications.alertStudio.aiTuning.badge', 'Helix')}
      buttonLabel={t(
        'notifications.alertStudio.aiTuning.suggestButton',
        'Suggest tuning',
      )}
      buttonTestId="ai-feature-alert-tuning-suggestions-suggest"
      canStart={!!ruleId && stream.state !== 'paused-confirm'}
      description={t(
        'notifications.alertStudio.aiTuning.description',
        'Review recent firings and propose a typed AlertRule patch. Descriptive replay only - review before saving.',
      )}
      onAction={handleSuggest}
      stream={stream}
      title={t(
        'notifications.alertStudio.aiTuning.title',
        'Suggest lower-noise tuning',
      )}
    >
      {proposal ? (
        <View style={styles.proposalArea}>
          <View style={styles.applyRow}>
            <NativeHelixButton
              accessibilityLabel={t(
                'notifications.alertStudio.aiTuning.applyButton',
                'Apply to form',
              )}
              disabled={proposal == null || isBusy}
              label={t(
                'notifications.alertStudio.aiTuning.applyButton',
                'Apply to form',
              )}
              onPress={handleApply}
              testID="ai-feature-alert-tuning-suggestions-apply"
              variant="primary"
            />
          </View>
          <View style={styles.previewBox}>
            <AppText style={styles.previewLabel} weight="semibold">
              {t(
                'notifications.alertStudio.aiTuning.previewLabel',
                'Proposed patch (review before saving):',
              )}
            </AppText>
            <View style={styles.patchList}>
              {rows.map(row => (
                <AppText
                  key={row.key}
                  style={styles.patchRow}
                  variant="caption"
                >
                  {'\u2022'} {row.label}: {row.value}
                </AppText>
              ))}
            </View>
          </View>
        </View>
      ) : null}
    </AIFeatureCard>
  );
}

(
  InnerSection as ComponentType<AIAlertTuningSuggestionsProps> & {
    displayName?: string;
  }
).displayName = 'AIAlertTuningSuggestionsInner';

export const AIAlertTuningSuggestions = withAiFeature(FEATURE_ID, InnerSection);
AIAlertTuningSuggestions.displayName = 'AIAlertTuningSuggestions';

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
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
    flexShrink: 1,
  },
  description: {
    lineHeight: 21,
  },
  badge: {
    alignItems: 'center',
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
  },
  actionRow: {
    alignItems: 'flex-end',
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  outlineButton: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.82,
  },
  outlineButtonText: {
    color: colors.textPrimary,
  },
  primaryButtonText: {
    color: colors.background,
  },
  outputPanel: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.md,
  },
  outputText: {
    color: colors.textPrimary,
    lineHeight: 22,
  },
  errorText: {
    color: colors.danger,
    lineHeight: 22,
  },
  errorLabel: {
    color: colors.danger,
  },
  thinkingBlock: {
    gap: spacing.sm,
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
    backgroundColor: colors.accentSoft,
    borderRadius: 8,
    height: 12,
    width: '100%',
  },
  skeletonLineShort: {
    width: '88%',
  },
  skeletonLineShortest: {
    width: '72%',
  },
  proposalArea: {
    gap: spacing.sm,
  },
  applyRow: {
    alignItems: 'flex-end',
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
  patchList: {
    gap: spacing.xs,
  },
  patchRow: {
    color: colors.textSecondary,
  },
});

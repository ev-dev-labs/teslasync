// Native parity port of web/src/components/ai/AICrossRuleConflictDetection.tsx.
//
// The Detect button streams from POST /api/v1/ai/alerts/rules/conflicts,
// captures detect_rule_conflicts tool_result envelopes, and only calls the
// parent onSelectRule callback when the user chooses a rule to review.

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

export interface RuleConflict {
  kind: 'redundant_duplicate' | 'overlapping_threshold' | string;
  rule_a_id: number;
  rule_b_id: number;
  rule_a_name?: string;
  rule_b_name?: string;
  signal_name?: string;
  reason?: string;
  severity_mismatch?: boolean;
  cooldown_mismatch?: boolean;
  trigger_mode_mismatch?: boolean;
  subsumes?: boolean;
}

export interface AICrossRuleConflictDetectionProps {
  ruleIds: number[];
  vehicleId?: number | null;
  onSelectRule: (ruleId: number) => void;
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

const FEATURE_ID: AiFeatureId = 'cross-rule-conflict-detection';
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

function labelForKind(kind: string, t: NativeTFunction): string {
  if (kind === 'redundant_duplicate') {
    return t(
      'notifications.alertStudio.aiConflicts.kind.redundant_duplicate',
      'Redundant duplicate',
    );
  }
  if (kind === 'overlapping_threshold') {
    return t(
      'notifications.alertStudio.aiConflicts.kind.overlapping_threshold',
      'Overlapping threshold',
    );
  }
  return kind;
}

function conflictSummary(c: RuleConflict): string {
  return [
    `Rule ${c.rule_a_id}${c.rule_a_name ? ` (${c.rule_a_name})` : ''}`,
    `Rule ${c.rule_b_id}${c.rule_b_name ? ` (${c.rule_b_name})` : ''}`,
  ].join(' <-> ') + (c.signal_name ? ` - ${c.signal_name}` : '');
}

function ConflictBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'warning' | 'danger';
}) {
  return (
    <View style={tone === 'warning' ? styles.warningChip : styles.dangerChip}>
      <AppText
        style={
          tone === 'warning' ? styles.warningChipText : styles.dangerChipText
        }
        variant="caption"
        weight="semibold"
      >
        {label.toUpperCase()}
      </AppText>
    </View>
  );
}

function InnerSection({
  ruleIds,
  vehicleId,
  onSelectRule,
}: AICrossRuleConflictDetectionProps) {
  const t = useNativeTranslationFallback();
  const [conflicts, setConflicts] = useState<RuleConflict[] | null>(null);

  const ruleIdsKey = useMemo(() => ruleIds.join(','), [ruleIds]);
  const body = useMemo(() => {
    const out: Record<string, unknown> = { rule_ids: ruleIds };
    if (vehicleId != null) {
      out.vehicle_id = vehicleId;
    }
    return out;
  }, [ruleIds, vehicleId]);

  const handleEvent = useCallback((ev: AiStreamEvent) => {
    if (
      ev.type === 'tool_result' &&
      ev.name === 'detect_rule_conflicts' &&
      ev.ok
    ) {
      const data = ev.data as
        | { conflicts?: unknown; status?: string }
        | undefined;
      if (!data || !Array.isArray(data.conflicts)) {
        return;
      }
      const out: RuleConflict[] = [];
      for (const raw of data.conflicts) {
        if (raw == null || typeof raw !== 'object') {
          continue;
        }
        const r = raw as Record<string, unknown>;
        if (
          typeof r.rule_a_id !== 'number' ||
          typeof r.rule_b_id !== 'number'
        ) {
          continue;
        }
        if (typeof r.kind !== 'string') {
          continue;
        }
        out.push({
          kind: r.kind as RuleConflict['kind'],
          rule_a_id: r.rule_a_id,
          rule_b_id: r.rule_b_id,
          rule_a_name:
            typeof r.rule_a_name === 'string' ? r.rule_a_name : undefined,
          rule_b_name:
            typeof r.rule_b_name === 'string' ? r.rule_b_name : undefined,
          signal_name:
            typeof r.signal_name === 'string' ? r.signal_name : undefined,
          reason: typeof r.reason === 'string' ? r.reason : undefined,
          severity_mismatch: r.severity_mismatch === true,
          cooldown_mismatch: r.cooldown_mismatch === true,
          trigger_mode_mismatch: r.trigger_mode_mismatch === true,
          subsumes: r.subsumes === true,
        });
      }
      setConflicts(out);
    }
  }, []);

  const stream = useAiStream({
    url: '/ai/alerts/rules/conflicts',
    body,
    onEvent: handleEvent,
  });
  const { cancel: cancelStream } = stream;

  useEffect(() => {
    return () => {
      cancelStream();
      setConflicts(null);
    };
  }, [ruleIdsKey, cancelStream]);

  const isBusy =
    stream.state === 'streaming' || stream.state === 'paused-confirm';
  const canStart = ruleIds.length >= 2 && stream.state !== 'paused-confirm';

  const handleDetect = useCallback(() => {
    if (isBusy) {
      return;
    }
    setConflicts(null);
    stream.start();
  }, [isBusy, stream]);

  const handleReview = useCallback(
    (ruleId: number) => {
      onSelectRule(ruleId);
    },
    [onSelectRule],
  );

  const reviewLabel = t(
    'notifications.alertStudio.aiConflicts.reviewButton',
    'Review rule',
  );

  return (
    <AIFeatureCard
      badgeLabel={t('notifications.alertStudio.aiConflicts.badge', 'Helix')}
      buttonLabel={t(
        'notifications.alertStudio.aiConflicts.detectButton',
        'Detect conflicts',
      )}
      buttonTestId="ai-feature-cross-rule-conflict-detection-detect"
      canStart={canStart}
      description={t(
        'notifications.alertStudio.aiConflicts.description',
        'Surface structural overlaps between your alert rule definitions. Review only - Helix never edits, merges, or deletes rules.',
      )}
      onAction={handleDetect}
      stream={stream}
      title={t(
        'notifications.alertStudio.aiConflicts.title',
        'Detect cross-rule conflicts',
      )}
    >
      {conflicts != null && conflicts.length === 0 ? (
        <View style={styles.emptyBox}>
          <AppText style={styles.emptyText}>
            {t(
              'notifications.alertStudio.aiConflicts.emptyMessage',
              'No structural conflicts found in the current rule set.',
            )}
          </AppText>
        </View>
      ) : null}
      {conflicts != null && conflicts.length > 0 ? (
        <View
          style={styles.conflictList}
          testID="ai-feature-cross-rule-conflict-detection-conflicts"
        >
          {conflicts.map(conflict => (
            <View
              key={`${conflict.kind}:${conflict.rule_a_id}:${conflict.rule_b_id}`}
              style={styles.conflictItem}
            >
              <View style={styles.conflictContent}>
                <View style={styles.conflictTextBlock}>
                  <AppText style={styles.conflictKind} weight="semibold">
                    {labelForKind(conflict.kind, t)}
                  </AppText>
                  <AppText style={styles.conflictMeta} variant="caption">
                    {conflictSummary(conflict)}
                  </AppText>
                  {conflict.reason ? (
                    <AppText style={styles.conflictReason} variant="caption">
                      {conflict.reason}
                    </AppText>
                  ) : null}
                  <View style={styles.chipRow}>
                    {conflict.subsumes ? (
                      <ConflictBadge label="subsumes" tone="warning" />
                    ) : null}
                    {conflict.severity_mismatch ? (
                      <ConflictBadge label="severity mismatch" tone="danger" />
                    ) : null}
                    {conflict.cooldown_mismatch ? (
                      <ConflictBadge label="cooldown mismatch" tone="danger" />
                    ) : null}
                    {conflict.trigger_mode_mismatch ? (
                      <ConflictBadge
                        label="trigger mode mismatch"
                        tone="danger"
                      />
                    ) : null}
                  </View>
                </View>
                <View style={styles.reviewButtons}>
                  <NativeHelixButton
                    accessibilityLabel={`${reviewLabel} ${conflict.rule_a_id}`}
                    disabled={false}
                    label={`${reviewLabel} ${conflict.rule_a_id}`}
                    onPress={() => handleReview(conflict.rule_a_id)}
                    testID={`ai-feature-cross-rule-conflict-detection-review-${conflict.rule_a_id}`}
                  />
                  <NativeHelixButton
                    accessibilityLabel={`${reviewLabel} ${conflict.rule_b_id}`}
                    disabled={false}
                    label={`${reviewLabel} ${conflict.rule_b_id}`}
                    onPress={() => handleReview(conflict.rule_b_id)}
                    testID={`ai-feature-cross-rule-conflict-detection-review-${conflict.rule_b_id}`}
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </AIFeatureCard>
  );
}

(
  InnerSection as ComponentType<AICrossRuleConflictDetectionProps> & {
    displayName?: string;
  }
).displayName = 'AICrossRuleConflictDetectionInner';

export const AICrossRuleConflictDetection = withAiFeature(
  FEATURE_ID,
  InnerSection,
);
AICrossRuleConflictDetection.displayName = 'AICrossRuleConflictDetection';

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
  emptyBox: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.md,
  },
  emptyText: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  conflictList: {
    gap: spacing.sm,
  },
  conflictItem: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.md,
  },
  conflictContent: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  conflictTextBlock: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 220,
  },
  conflictKind: {
    color: colors.warning,
  },
  conflictMeta: {
    color: colors.textSecondary,
    lineHeight: 18,
  },
  conflictReason: {
    color: colors.textSecondary,
    lineHeight: 18,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  warningChip: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  dangerChip: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  warningChipText: {
    color: colors.warning,
    fontSize: 10,
    letterSpacing: 0.5,
    lineHeight: 14,
  },
  dangerChipText: {
    color: colors.danger,
    fontSize: 10,
    letterSpacing: 0.5,
    lineHeight: 14,
  },
  reviewButtons: {
    flexShrink: 0,
    gap: spacing.xs,
    minWidth: 150,
  },
});

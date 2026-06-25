// Native parity port of web/src/components/ai/AIVoiceMode.tsx.
//
// React Native does not expose browser SpeechRecognition or speechSynthesis.
// This port preserves the feature gate, transcript draft, stream route, state
// names, and visual card contract while rendering an explicit native-unavailable
// voice I/O state. If a persisted transcript draft is available in a web-backed
// localStorage runtime, the text stream can still POST to /api/v1/ai/voice/chat.

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
import {AIFeatureCard} from './AIFeatureCard';

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

interface TranscriptDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type TextDecoderConstructorLike = new (label?: string) => TextDecoderLike;
type NativeTFunction = (key: string, fallback: string) => string;
type SpeechRecognitionConstructor = null;

const FEATURE_ID: AiFeatureId = 'voice-mode';
const TRANSCRIPT_DRAFT_KEY = 'ai.voiceMode.transcriptDraft';
const AI_STREAM_UNAVAILABLE_REASON =
  'React Native fetch did not expose a readable response body for AI SSE streaming.';
const NATIVE_STT_UNAVAILABLE_REASON =
  'Voice input is not available in this native build. Use the text chatbot for typed questions.';
const NATIVE_TTS_UNAVAILABLE_REASON =
  'Spoken replies are not available in this native build. Helix replies still stream as text.';
const SSE_DELIM_RE = /\r?\n\r?\n/;
const LINE_DELIM_RE = /\r?\n/;
const SENTENCE_BOUNDARY_RE = /([.!?])\s+/;

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

function getTranscriptDraftStorage(): TranscriptDraftStorage | null {
  const candidate = (globalThis as typeof globalThis & {localStorage?: unknown})
    .localStorage;
  if (candidate == null || typeof candidate !== 'object') {
    return null;
  }
  const storage = candidate as Partial<TranscriptDraftStorage>;
  if (
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function' &&
    typeof storage.removeItem === 'function'
  ) {
    return storage as TranscriptDraftStorage;
  }
  return null;
}

function readTranscriptDraft(): string {
  const storage = getTranscriptDraftStorage();
  if (!storage) {
    return '';
  }
  try {
    return storage.getItem(TRANSCRIPT_DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function persistTranscriptDraft(value: string): void {
  const storage = getTranscriptDraftStorage();
  if (!storage) {
    return;
  }
  try {
    if (value === '') {
      storage.removeItem(TRANSCRIPT_DRAFT_KEY);
    } else {
      storage.setItem(TRANSCRIPT_DRAFT_KEY, value);
    }
  } catch {
    // Native/web storage can be unavailable or quota-limited; voice mode still
    // renders without draft persistence.
  }
}

function newVoiceSessionId(): string {
  return `voice_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor {
  return null;
}

function getSpeechSynthesisSupported(): boolean {
  return false;
}

function popCompleteSentences(buffer: string): {
  spoken: string[];
  remainder: string;
} {
  const spoken: string[] = [];
  let working = buffer;
  let match = SENTENCE_BOUNDARY_RE.exec(working);
  while (match) {
    const cutAt = match.index + match[1].length;
    const head = working.slice(0, cutAt).trim();
    if (head) {
      spoken.push(head);
    }
    working = working.slice(cutAt).replace(/^\s+/, '');
    match = SENTENCE_BOUNDARY_RE.exec(working);
  }
  return {spoken, remainder: working};
}

function speakSentence(text: string, lang: string): void {
  void text;
  void lang;
}

function cancelSpeech(): void {
  return;
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
    };

    runStream().catch(err => {
      finalizeError(err instanceof Error ? err.message : String(err));
      runningRef.current = false;
      abortRef.current = null;
    });
  }, [body, url]);

  return {start, cancel, state, text, error, limit};
}

function VoiceControlButton({
  label,
  glyph,
  accessibilityLabel,
  disabled = false,
  selected = false,
  tone = 'neutral',
  onPress,
  testID,
}: {
  label: string;
  glyph: string;
  accessibilityLabel: string;
  disabled?: boolean;
  selected?: boolean;
  tone?: 'accent' | 'danger' | 'neutral';
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{disabled, selected}}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.controlButton,
        tone === 'accent' && styles.controlButtonAccent,
        tone === 'danger' && styles.controlButtonDanger,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <AppText style={styles.controlGlyph} variant="caption" weight="bold">
        {glyph}
      </AppText>
      <AppText style={styles.controlText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

function InnerSection(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const ttsLang = 'en-US';

  const [transcript, setTranscript] = useState<string>(() =>
    readTranscriptDraft(),
  );
  const [listening, setListening] = useState<boolean>(false);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true);
  const [sttError, setSttError] = useState<string | null>(null);
  const [sessionId] = useState<string>(() => newVoiceSessionId());

  const sttCtor = useMemo(() => getSpeechRecognitionCtor(), []);
  const sttSupported = sttCtor !== null;
  const ttsSupported = useMemo(() => getSpeechSynthesisSupported(), []);

  const ttsBufferRef = useRef<string>('');
  const lastSpokenLenRef = useRef<number>(0);

  const handleEvent = useCallback(
    (ev: AiStreamEvent) => {
      if (ev.type === 'delta' && ttsEnabled && ttsSupported) {
        ttsBufferRef.current += ev.text;
        const {spoken, remainder} = popCompleteSentences(ttsBufferRef.current);
        ttsBufferRef.current = remainder;
        for (const sentence of spoken) {
          speakSentence(sentence, ttsLang);
        }
      }
      if (ev.type === 'done') {
        if (ttsEnabled && ttsSupported) {
          const tail = ttsBufferRef.current.trim();
          ttsBufferRef.current = '';
          if (tail) {
            speakSentence(tail, ttsLang);
          }
        } else {
          ttsBufferRef.current = '';
        }
      }
      if (ev.type === 'error') {
        cancelSpeech();
        ttsBufferRef.current = '';
      }
    },
    [ttsEnabled, ttsLang, ttsSupported],
  );

  const body = useMemo(
    () => ({message: transcript.trim(), session_id: sessionId}),
    [transcript, sessionId],
  );

  const stream = useAiStream({
    url: '/ai/voice/chat',
    body,
    onEvent: handleEvent,
  });

  const {cancel: cancelStream, text: streamText} = stream;

  useEffect(() => {
    if (stream.state === 'streaming' || stream.state === 'paused-confirm') {
      return;
    }
    persistTranscriptDraft(transcript);
  }, [transcript, stream.state]);

  useEffect(() => {
    if (stream.state === 'done') {
      persistTranscriptDraft('');
      setTranscript('');
      lastSpokenLenRef.current = 0;
    }
  }, [stream.state]);

  useEffect(() => {
    if (stream.state === 'streaming' && streamText === '') {
      ttsBufferRef.current = '';
      lastSpokenLenRef.current = 0;
    }
  }, [stream.state, streamText]);

  useEffect(() => {
    return () => {
      cancelStream();
      cancelSpeech();
      ttsBufferRef.current = '';
      persistTranscriptDraft('');
    };
  }, [cancelStream]);

  const startListening = useCallback(() => {
    if (!sttSupported) {
      setSttError(
        t('voiceMode.errors.unsupported', NATIVE_STT_UNAVAILABLE_REASON),
      );
      setListening(false);
      return;
    }
    setSttError(null);
    setListening(true);
  }, [sttSupported, t]);

  const stopListening = useCallback(() => {
    setListening(false);
  }, []);

  const handleStopAll = useCallback(() => {
    stopListening();
    cancelStream();
    cancelSpeech();
    ttsBufferRef.current = '';
  }, [stopListening, cancelStream]);

  const toggleTts = useCallback(() => {
    setTtsEnabled(prev => {
      const next = !prev;
      if (!next) {
        cancelSpeech();
        ttsBufferRef.current = '';
      }
      return next;
    });
  }, []);

  const isBusy =
    stream.state === 'streaming' || stream.state === 'paused-confirm';
  const canStart = transcript.trim().length > 0 && !isBusy;
  const transcriptHasText = transcript.trim().length > 0;

  const handleAction = useCallback(() => {
    if (!canStart) {
      return;
    }
    ttsBufferRef.current = '';
    lastSpokenLenRef.current = 0;
    cancelSpeech();
    stream.start();
  }, [canStart, stream]);

  const inputSlot = (
    <View style={styles.inputRoot}>
      <View
        accessibilityLabel={t('voiceMode.transcriptLabel', 'Voice transcript')}
        accessibilityLiveRegion="polite"
        accessible
        style={styles.transcriptBox}
        testID="ai-feature-voice-mode-transcript">
        {transcriptHasText ? (
          <AppText style={styles.transcriptText}>{transcript}</AppText>
        ) : (
          <AppText style={styles.placeholderText} tone="muted">
            {listening
              ? t('voiceMode.listeningHint', 'Listening - speak now...')
              : t(
                  'voiceMode.idleHint',
                  'Tap the mic and ask Helix anything about your Tesla.',
                )}
          </AppText>
        )}
      </View>

      <View style={styles.controlRow}>
        {listening ? (
          <VoiceControlButton
            accessibilityLabel={t(
              'voiceMode.actions.stopListening',
              'Stop listening',
            )}
            glyph="MC-"
            label={t('voiceMode.actions.stopListeningShort', 'Stop mic')}
            onPress={stopListening}
            testID="ai-feature-voice-mode-mic-stop"
            tone="accent"
          />
        ) : (
          <VoiceControlButton
            accessibilityLabel={t(
              'voiceMode.actions.startListening',
              'Start listening',
            )}
            disabled={!sttSupported || isBusy}
            glyph="MIC"
            label={t('voiceMode.actions.startListeningShort', 'Speak')}
            onPress={startListening}
            testID="ai-feature-voice-mode-mic-start"
            tone="accent"
          />
        )}

        <VoiceControlButton
          accessibilityLabel={
            ttsEnabled
              ? t('voiceMode.actions.muteTts', 'Mute spoken replies')
              : t('voiceMode.actions.unmuteTts', 'Unmute spoken replies')
          }
          disabled={!ttsSupported}
          glyph={ttsEnabled ? 'VO' : 'VX'}
          label={
            ttsEnabled
              ? t('voiceMode.actions.muteTtsShort', 'Mute Helix')
              : t('voiceMode.actions.unmuteTtsShort', 'Unmute Helix')
          }
          onPress={toggleTts}
          selected={ttsEnabled}
          testID="ai-feature-voice-mode-tts-toggle"
        />

        {isBusy ? (
          <VoiceControlButton
            accessibilityLabel={t('voiceMode.actions.stopAll', 'Stop Helix')}
            glyph="ST"
            label={t('voiceMode.actions.stopAllShort', 'Stop')}
            onPress={handleStopAll}
            testID="ai-feature-voice-mode-stop"
            tone="danger"
          />
        ) : null}
      </View>

      {sttError ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="text"
          accessible
          testID="ai-feature-voice-mode-stt-error">
          <AppText style={styles.errorText} variant="caption">
            {sttError}
          </AppText>
        </View>
      ) : null}

      {!sttSupported && !sttError ? (
        <AppText style={styles.hintText} tone="muted" variant="caption">
          {t(
            'voiceMode.unsupportedHint',
            'Voice input is not available in this browser. You can still type your question into the chatbot below.',
          )}
        </AppText>
      ) : null}

      {!ttsSupported ? (
        <AppText style={styles.hintText} tone="muted" variant="caption">
          {t('voiceMode.ttsUnsupportedHint', NATIVE_TTS_UNAVAILABLE_REASON)}
        </AppText>
      ) : null}
    </View>
  );

  return (
    <AIFeatureCard
      buttonLabel={t('voiceMode.button', 'Speak to Helix')}
      buttonPlacement="below"
      buttonTestId="ai-feature-voice-mode-send"
      canStart={canStart}
      description={t(
        'voiceMode.description',
        'Speak to Helix and hear the reply out loud. Voice input and playback both stay on this device - only the transcribed text is sent to the assistant, never the raw audio.',
      )}
      emptyHint={
        transcript.trim().length === 0
          ? t('voiceMode.emptyHint', 'Tap the mic and dictate a question first.')
          : undefined
      }
      inputSlot={inputSlot}
      onAction={handleAction}
      stream={stream}
      title={t('voiceMode.title', 'Voice mode')}
    />
  );
}

(
  InnerSection as ComponentType<object> & {
    displayName?: string;
  }
).displayName = 'AIVoiceModeInner';

export const AIVoiceMode = withAiFeature(FEATURE_ID, InnerSection);
AIVoiceMode.displayName = 'AIVoiceMode';

const styles = StyleSheet.create({
  controlButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  controlButtonAccent: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  controlButtonDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  controlGlyph: {
    color: colors.accent,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  controlRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  controlText: {
    color: colors.textPrimary,
    lineHeight: 16,
  },
  disabled: {
    opacity: 0.48,
  },
  errorText: {
    color: colors.danger,
    lineHeight: 18,
  },
  hintText: {
    lineHeight: 18,
  },
  inputRoot: {
    gap: spacing.md,
  },
  placeholderText: {
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.82,
  },
  transcriptBox: {
    backgroundColor: 'rgba(53, 213, 255, 0.05)',
    borderColor: 'rgba(53, 213, 255, 0.2)',
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 56,
    padding: spacing.md,
  },
  transcriptText: {
    color: colors.textSecondary,
    lineHeight: 22,
  },
});

// LiveLogsPage — native parity port of
// web/src/features/admin/pages/LiveLogsPage.tsx.
//
// Operator-facing live log tail. Streams the API server's structured zerolog
// events via the SSE endpoint at GET /admin/logs/stream (see
// internal/api/admin_log_stream_handler.go) and renders them in a virtualized
// FlatList so the UI stays responsive even when the server is gushing thousands
// of lines per minute.
//
// The page intentionally NEVER auto-runs anything destructive — it is a
// read-only window onto the existing log pipeline. Filters are:
//   - level (debug/info/warn/error) — server-side, restarts subscription
//   - grep  (regular expression)    — server-side, restarts subscription
//   - vehicle_id                    — client-side, applied to current buffer
//
// Pause/Resume holds the buffer steady on the client without dropping the
// connection (server keeps fanning out, page just stops appending). Auto-scroll
// follows new events to the bottom; toggling it off pins the list.
//
// Native adaptations vs. the web source (behavior/state/keys/API intent kept):
//   - web `layout` `PageContainer` (title/subtitle header) -> an inline RN
//     PageScaffold ScrollView with the same title + subtitle.
//   - web `layout` `Stack className="gap-4"` -> a gapped RN View.
//   - web `motion` `FadeIn` (framer-motion) -> an inline RN Animated FadeIn
//     (fade + slide-up, reduced-motion aware via AccessibilityInfo).
//   - web `ui` `GlassPanel` -> the canonical native GlassPanel.
//   - web `ui` `Badge` (success/info/warning/danger/neutral) -> an inline RN
//     Badge chip with the same 5 variants.
//   - web `ui` `Select` (level) -> an inline segmented chip row (4 levels).
//   - web `ui` `Input` (grep + vehicle) -> an inline RN TextInput field with
//     label/hint/placeholder/maxLength; Enter -> onSubmitEditing, blur -> apply.
//   - web `ui` `Toggle` (auto-scroll) -> an inline RN track/knob toggle.
//   - web `ui` `Button` (+ lucide icons) -> an inline RN IconButton (glyph +
//     label): ⏸/▶ pause/play, 🗑 clear, ⬇ download, ↻ reconnect, ⚠ error.
//   - web `ui` `DataTable` (virtualized, maxHeight 520, internal scroll) -> a
//     bounded FlatList (maxHeight 520, nested-scroll, virtualized) with the
//     same time/level/message/fields columns reproduced per row.
//   - web `feedback` `EmptyState` -> an inline RN EmptyState.
//   - web `ui/Typography` Caption/MetricLabel/Text -> AppText variants.
//   - web `<mark>` highlight -> nested RN <Text> highlight spans.
//   - web `handleDownload` (Blob + <a download> + URL.createObjectURL — all
//     DOM-only) -> RN Share.share({message}) of the same eventToText body; the
//     filename i18n key + downloadFilename stamp are preserved as the share
//     title. Documented in the sidecar.
//   - web `@/hooks/usePageTitle` (document.title) -> a native-safe no-op hook.
//   - react-i18next `useTranslation` -> a native-safe t(key, fallback, options?)
//     fallback preserving every key, English default (from web i18n en.json),
//     and {{count}}/{{ts}} interpolation.
//   - web `useLogStream` + types imported from the native parity hook; the
//     native AILogTraceSummarization is imported exactly like the web page.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {AILogTraceSummarization} from '../../../components/ai/AILogTraceSummarization';
import {
  LOG_STREAM_MAX_EVENTS,
  useLogStream,
  type LogStreamEvent,
  type LogStreamLevel,
  type UseLogStreamOptions,
} from '../../../api/hooks/useLogStream';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    key in values ? String(values[key]) : `{{${key}}}`,
  );
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
}

// ---- Native-safe usePageTitle (web @/hooks/usePageTitle) --------------------

/**
 * Web `usePageTitle` writes `"{title} — TeslaSync"` to `document.title`. React
 * Native has no browser tab / document title, so this is a no-op that preserves
 * the call site and argument.
 */
function usePageTitle(title: string): void {
  useEffect(() => {
    // React Native has no browser tab / document.title to write; intentionally
    // a no-op. The `title` dependency mirrors the web hook.
  }, [title]);
}

// ---- helpers (ported verbatim from the web source) --------------------------

const LEVEL_OPTIONS: {
  value: LogStreamLevel;
  defaultLabel: string;
  i18nKey: string;
}[] = [
  {value: 'debug', defaultLabel: 'Debug', i18nKey: 'liveLogs.level.debug'},
  {value: 'info', defaultLabel: 'Info', i18nKey: 'liveLogs.level.info'},
  {value: 'warn', defaultLabel: 'Warn', i18nKey: 'liveLogs.level.warn'},
  {value: 'error', defaultLabel: 'Error', i18nKey: 'liveLogs.level.error'},
];

type BadgeVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

function levelBadgeVariant(level: string): BadgeVariant {
  const norm = level.toLowerCase();
  if (norm === 'debug' || norm === 'trace') {
    return 'neutral';
  }
  if (norm === 'info') {
    return 'info';
  }
  if (norm === 'warn' || norm === 'warning') {
    return 'warning';
  }
  if (
    norm === 'error' ||
    norm === 'err' ||
    norm === 'fatal' ||
    norm === 'panic'
  ) {
    return 'danger';
  }
  return 'neutral';
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  // Locale-formatted time + millisecond precision so bursty log streams stay
  // distinguishable.
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const sss = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${sss}`;
}

function extractMessage(
  parsed: Record<string, unknown> | null,
  raw: string,
): string {
  if (!parsed) {
    return raw;
  }
  if (typeof parsed.message === 'string') {
    return parsed.message;
  }
  if (typeof parsed.msg === 'string') {
    return parsed.msg;
  }
  return raw;
}

function extractFields(
  parsed: Record<string, unknown> | null,
): Array<[string, string]> {
  if (!parsed) {
    return [];
  }
  const skip = new Set(['level', 'time', 'message', 'msg']);
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (skip.has(k)) {
      continue;
    }
    if (v === null || v === undefined) {
      continue;
    }
    let str: string;
    if (typeof v === 'string') {
      str = v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      str = String(v);
    } else {
      try {
        str = JSON.stringify(v);
      } catch {
        str = '[unserialisable]';
      }
    }
    out.push([k, str]);
  }
  return out;
}

function extractVehicleId(parsed: Record<string, unknown> | null): string | null {
  if (!parsed) {
    return null;
  }
  const candidates = ['vehicle_id', 'vehicleID', 'vehicleId'];
  for (const k of candidates) {
    const v = parsed[k];
    if (typeof v === 'string' && v.length > 0) {
      return v;
    }
    if (typeof v === 'number') {
      return String(v);
    }
  }
  return null;
}

function downloadFilename(template: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\.\d+Z$/, 'Z');
  return template.replace('{{ts}}', stamp);
}

function eventToText(ev: LogStreamEvent): string {
  return `[${formatTime(ev.receivedAt)}] ${ev.level.toUpperCase()} ${ev.payload}`;
}

// ---- Inline FadeIn (web motion FadeIn — framer-motion) ----------------------

function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}): ReactElement {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(reduce => {
        if (cancelled) {
          return;
        }
        if (reduce) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          duration: 400,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => progress.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [progress]);

  return (
    <Animated.View
      style={[
        styles.fadeIn,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

// ---- Inline Badge (web ui Badge) -------------------------------------------

const BADGE_THEME: Record<
  BadgeVariant,
  {bg: string; border: string; fg: string}
> = {
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    fg: colors.success,
  },
  info: {
    bg: colors.accentSoft,
    border: colors.borderAccent,
    fg: colors.accent,
  },
  warning: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
  },
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    fg: colors.danger,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    fg: colors.textSecondary,
  },
};

function Badge({
  variant,
  label,
  testID,
}: {
  variant: BadgeVariant;
  label: string;
  testID?: string;
}): ReactElement {
  const theme = BADGE_THEME[variant];
  return (
    <View
      style={[styles.badge, {backgroundColor: theme.bg, borderColor: theme.border}]}
      testID={testID}>
      <AppText
        style={[styles.badgeText, {color: theme.fg}]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

// ---- ConnectionBadge (web subcomponent) -------------------------------------

function ConnectionBadge({
  isConnected,
  paused,
  hasError,
  enabled,
  t,
}: {
  isConnected: boolean;
  paused: boolean;
  hasError: boolean;
  enabled: boolean;
  t: NativeTFunction;
}): ReactElement {
  if (hasError) {
    return (
      <Badge
        label={t('liveLogs.status.error', 'Connection error')}
        testID="livelogs-status-badge"
        variant="danger"
      />
    );
  }
  if (!enabled) {
    return (
      <Badge
        label={t('liveLogs.status.disconnected', 'Disconnected')}
        testID="livelogs-status-badge"
        variant="neutral"
      />
    );
  }
  if (!isConnected) {
    return (
      <Badge
        label={t('liveLogs.status.connecting', 'Connecting…')}
        testID="livelogs-status-badge"
        variant="info"
      />
    );
  }
  if (paused) {
    return (
      <Badge
        label={t('liveLogs.status.paused', 'Paused (still receiving)')}
        testID="livelogs-status-badge"
        variant="warning"
      />
    );
  }
  return (
    <Badge
      label={t('liveLogs.status.connected', 'Live')}
      testID="livelogs-status-badge"
      variant="success"
    />
  );
}

// ---- HighlightedText (web subcomponent, <mark> -> nested <Text>) -------------

function HighlightedText({
  text,
  pattern,
}: {
  text: string;
  pattern: RegExp | null;
}): ReactElement {
  if (!pattern || text.length === 0) {
    return <>{text}</>;
  }
  const segments: Array<{text: string; match: boolean}> = [];
  let last = 0;
  let working: RegExp;
  try {
    working = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
  } catch {
    return <>{text}</>;
  }
  let m: RegExpExecArray | null;
  while ((m = working.exec(text)) !== null) {
    if (m.index > last) {
      segments.push({text: text.slice(last, m.index), match: false});
    }
    const matched = m[0] ?? '';
    if (matched.length === 0) {
      // Avoid infinite loops on zero-width matches.
      working.lastIndex += 1;
      continue;
    }
    segments.push({text: matched, match: true});
    last = m.index + matched.length;
  }
  if (last < text.length) {
    segments.push({text: text.slice(last), match: false});
  }
  return (
    <>
      {segments.map((s, i) =>
        s.match ? (
          <Text key={i} style={styles.mark}>
            {s.text}
          </Text>
        ) : (
          <Text key={i}>{s.text}</Text>
        ),
      )}
    </>
  );
}

// ---- Inline IconButton (web ui Button + lucide icon) ------------------------

function IconButton({
  glyph,
  label,
  onPress,
  variant,
  disabled = false,
  testID,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  variant: 'secondary' | 'ghost';
  disabled?: boolean;
  testID?: string;
}): ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.iconButton,
        variant === 'secondary' ? styles.iconButtonSecondary : styles.iconButtonGhost,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}>
      <AppText style={styles.iconButtonGlyph}>{glyph}</AppText>
      <AppText
        style={styles.iconButtonLabel}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ---- Inline Toggle (web ui Toggle) ------------------------------------------

function Toggle({
  label,
  checked,
  onChange,
  testID,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testID?: string;
}): ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{checked}}
      hitSlop={6}
      onPress={() => onChange(!checked)}
      style={styles.toggleRow}
      testID={testID}>
      <View style={[styles.toggleTrack, checked && styles.toggleTrackOn]}>
        <View style={[styles.toggleKnob, checked && styles.toggleKnobOn]} />
      </View>
      <AppText style={styles.toggleLabel} variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}

// ---- Inline LevelSelect (web ui Select) -------------------------------------

function LevelSelect({
  label,
  value,
  options,
  onChange,
  testID,
}: {
  label: string;
  value: LogStreamLevel;
  options: {value: LogStreamLevel; label: string}[];
  onChange: (next: LogStreamLevel) => void;
  testID?: string;
}): ReactElement {
  return (
    <View style={styles.field} testID={testID}>
      <AppText style={styles.fieldLabel} variant="caption" weight="semibold">
        {label}
      </AppText>
      <View style={styles.segmentRow}>
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <Pressable
              accessibilityLabel={opt.label}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={({pressed}) => [
                styles.segment,
                active && styles.segmentActive,
                pressed && styles.pressed,
              ]}>
              <AppText
                style={active ? styles.segmentTextActive : styles.segmentText}
                variant="caption"
                weight="semibold">
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ---- Inline LabeledInput (web ui Input) -------------------------------------

function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  maxLength,
  keyboardType,
  onSubmit,
  onBlur,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  hint?: string;
  maxLength?: number;
  keyboardType?: 'default' | 'numeric';
  onSubmit?: () => void;
  onBlur?: () => void;
  testID?: string;
}): ReactElement {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} variant="caption" weight="semibold">
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType ?? 'default'}
        maxLength={maxLength}
        onBlur={onBlur}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        style={styles.input}
        testID={testID}
        value={value}
      />
      {hint ? (
        <AppText style={styles.fieldHint} tone="muted" variant="caption">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

// ---- Inline EmptyState (web feedback EmptyState) ----------------------------

function EmptyState({
  glyph,
  title,
  message,
  actionLabel,
  onAction,
}: {
  glyph: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): ReactElement {
  return (
    <View style={styles.empty}>
      <AppText style={styles.emptyGlyph}>{glyph}</AppText>
      <AppText style={styles.emptyTitle} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          onPress={onAction}
          style={({pressed}) => [
            styles.emptyAction,
            pressed && styles.pressed,
          ]}>
          <AppText
            style={styles.emptyActionText}
            variant="caption"
            weight="semibold">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---- Log row (web DataTable row: time / level / message / fields) -----------

function LogRow({
  row,
  pattern,
  t,
}: {
  row: LogStreamEvent;
  pattern: RegExp | null;
  t: NativeTFunction;
}): ReactElement {
  const fields = extractFields(row.parsed);
  const extra = fields.length - 6;
  return (
    <View style={styles.logRow}>
      <View style={styles.logRowHead}>
        <AppText style={styles.logTime}>{formatTime(row.receivedAt)}</AppText>
        <Badge
          label={row.level ? row.level.toUpperCase() : t('liveLogs.table.noLevel', '—')}
          variant={levelBadgeVariant(row.level)}
        />
      </View>
      <Text style={styles.logMessage}>
        <HighlightedText
          pattern={pattern}
          text={extractMessage(row.parsed, row.payload)}
        />
      </Text>
      {fields.length > 0 ? (
        <View style={styles.fieldChips}>
          {fields.slice(0, 6).map(([k, v]) => (
            <View key={k} style={styles.fieldChip}>
              <AppText style={styles.fieldChipKey}>{`${k}=`}</AppText>
              <AppText style={styles.fieldChipValue}>
                {v.length > 32 ? `${v.slice(0, 32)}…` : v}
              </AppText>
            </View>
          ))}
          {extra > 0 ? (
            <AppText style={styles.fieldChipMore}>{`+${extra}`}</AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ---- Page scaffold (web layout PageContainer) -------------------------------

function PageScaffold({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}): ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}>
      <View style={styles.pageHeader}>
        <AppText style={styles.pageTitle} variant="display" weight="bold">
          {title}
        </AppText>
        <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
          {subtitle}
        </AppText>
      </View>
      {children}
    </ScrollView>
  );
}

// ---- Page --------------------------------------------------------------------

export interface LiveLogsPageProps {
  /** Test seam — replace fetch in unit tests. */
  fetchImpl?: UseLogStreamOptions['fetchImpl'];
  /** Test seam — point at a stub server. */
  endpoint?: string;
}

export default function LiveLogsPage({
  fetchImpl,
  endpoint,
}: LiveLogsPageProps = {}): ReactElement {
  const t = useNativeTranslationFallback();
  usePageTitle(t('liveLogs.title', 'Live logs'));

  const [level, setLevel] = useState<LogStreamLevel>('info');
  const [grep, setGrep] = useState('');
  const [grepDraft, setGrepDraft] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const [enabled, setEnabled] = useState(true);

  const stream = useLogStream({
    level,
    grep,
    enabled,
    paused,
    fetchImpl,
    endpoint,
  });

  const grepPattern = useMemo<RegExp | null>(() => {
    if (grep.trim().length === 0) {
      return null;
    }
    try {
      return new RegExp(grep, 'i');
    } catch {
      return null;
    }
  }, [grep]);

  const filteredEvents = useMemo(() => {
    if (vehicleFilter.trim().length === 0) {
      return stream.events;
    }
    const needle = vehicleFilter.trim();
    return stream.events.filter(ev => extractVehicleId(ev.parsed) === needle);
  }, [stream.events, vehicleFilter]);

  // Compute the AI summarization window from the current buffer. Newest event
  // time backward by 30 minutes, or the current time minus 30 minutes when the
  // buffer is empty. Both bounds in Unix seconds.
  const {aiFromUnix, aiToUnix} = useMemo(() => {
    const windowSeconds = 30 * 60;
    const newestMs =
      stream.events.length > 0
        ? stream.events[stream.events.length - 1]?.receivedAt ?? Date.now()
        : Date.now();
    const toUnix = Math.floor(newestMs / 1000);
    const fromUnix = toUnix - windowSeconds;
    return {aiFromUnix: fromUnix, aiToUnix: toUnix};
  }, [stream.events]);

  const aiVehicleId = useMemo(() => {
    const trimmed = vehicleFilter.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      return undefined;
    }
    return n;
  }, [vehicleFilter]);

  // Pin the bounded log list to the bottom when autoscroll is on. The web page
  // scrolled the DataTable's internal container; the native FlatList exposes
  // scrollToEnd for the same intent.
  const listRef = useRef<FlatList<LogStreamEvent>>(null);
  useEffect(() => {
    if (!autoscroll || filteredEvents.length === 0) {
      return undefined;
    }
    const handle = setTimeout(() => {
      try {
        listRef.current?.scrollToEnd({animated: false});
      } catch {
        /* noop — list may be unmounted mid-flush */
      }
    }, 0);
    return () => clearTimeout(handle);
  }, [autoscroll, filteredEvents.length]);

  const applyGrep = useCallback(() => {
    setGrep(grepDraft);
  }, [grepDraft]);

  const handleClear = useCallback(() => {
    stream.clear();
  }, [stream]);

  const handleReconnect = useCallback(() => {
    setEnabled(false);
    // Defer to the next microtask so React tears the stream down before we ask
    // for a fresh connection (web used queueMicrotask; fall back to a resolved
    // promise when the host runtime doesn't expose it).
    const microtask = (
      globalThis as typeof globalThis & {
        queueMicrotask?: (cb: () => void) => void;
      }
    ).queueMicrotask;
    const schedule =
      typeof microtask === 'function'
        ? microtask
        : (cb: () => void) => {
            void Promise.resolve().then(cb);
          };
    schedule(() => setEnabled(true));
  }, []);

  const handleDownload = useCallback(() => {
    if (filteredEvents.length === 0) {
      return;
    }
    const filename = downloadFilename(
      t('liveLogs.filename', 'teslasync-logs-{{ts}}.txt', {ts: '{{ts}}'}),
    );
    const body = filteredEvents.map(eventToText).join('\n');
    // Web wrote a Blob + <a download>; React Native has no DOM filesystem, so
    // the visible buffer is exported through the native share sheet instead.
    void Share.share({message: body, title: filename}).catch(() => undefined);
  }, [filteredEvents, t]);

  const levelOptions = useMemo(
    () =>
      LEVEL_OPTIONS.map(o => ({
        value: o.value,
        label: t(o.i18nKey, o.defaultLabel),
      })),
    [t],
  );

  const renderRow = useCallback(
    ({item}: ListRenderItemInfo<LogStreamEvent>) => (
      <LogRow pattern={grepPattern} row={item} t={t} />
    ),
    [grepPattern, t],
  );

  const bufferedLabel = t('liveLogs.stats.buffered', 'Buffered: {{count}}', {
    count: stream.events.length,
  });

  return (
    <PageScaffold
      subtitle={t(
        'liveLogs.subtitle',
        "Stream the API server's structured log events in real time. Filter by severity and an optional regular expression. The connection is dropped when you navigate away.",
      )}
      title={t('liveLogs.title', 'Live logs')}>
      <FadeIn style={styles.body}>
        <AILogTraceSummarization
          fromUnix={aiFromUnix}
          toUnix={aiToUnix}
          vehicleId={aiVehicleId}
        />

        {/* Filters */}
        <GlassPanel style={styles.panel} testID="livelogs-filters">
          <LevelSelect
            label={t('liveLogs.filters.level', 'Minimum level')}
            onChange={next => setLevel(next ?? 'info')}
            options={levelOptions}
            testID="livelogs-level-select"
            value={level}
          />
          <LabeledInput
            hint={t(
              'liveLogs.filters.grepHelp',
              'Server-side filter. Maximum 256 characters. Invalid expressions are rejected before connecting.',
            )}
            label={t('liveLogs.filters.grep', 'Grep (regular expression)')}
            maxLength={256}
            onBlur={applyGrep}
            onChangeText={setGrepDraft}
            onSubmit={applyGrep}
            placeholder={t(
              'liveLogs.filters.grepPlaceholder',
              'e.g. mqtt|signal_log',
            )}
            testID="livelogs-grep-input"
            value={grepDraft}
          />
          <LabeledInput
            keyboardType="numeric"
            label={t('liveLogs.filters.vehicleId', 'Vehicle ID')}
            onChangeText={next => setVehicleFilter(next.trim())}
            placeholder={t(
              'liveLogs.filters.vehicleIdPlaceholder',
              'Numeric — applied client-side',
            )}
            testID="livelogs-vehicle-input"
            value={vehicleFilter}
          />
        </GlassPanel>

        {/* Controls */}
        <GlassPanel style={styles.panel} testID="livelogs-controls">
          <View style={styles.statsRow}>
            <ConnectionBadge
              enabled={enabled}
              hasError={stream.error !== null}
              isConnected={stream.isConnected}
              paused={paused}
              t={t}
            />
            <AppText style={styles.caption} tone="muted" variant="caption">
              {bufferedLabel}
            </AppText>
            <AppText style={styles.caption} tone="muted" variant="caption">
              {t('liveLogs.stats.received', 'Received: {{count}}', {
                count: stream.totalReceived,
              })}
            </AppText>
            {stream.drops > 0 ? (
              <AppText style={styles.captionWarn} variant="caption">
                {t('liveLogs.stats.drops', 'Server drops: {{count}}', {
                  count: stream.drops,
                })}
              </AppText>
            ) : null}
          </View>
          <View style={styles.controlsRow}>
            <Toggle
              checked={autoscroll}
              label={t('liveLogs.controls.autoscroll', 'Auto-scroll')}
              onChange={setAutoscroll}
              testID="livelogs-autoscroll-toggle"
            />
            <IconButton
              glyph={paused ? '▶' : '⏸'}
              label={
                paused
                  ? t('liveLogs.controls.resume', 'Resume')
                  : t('liveLogs.controls.pause', 'Pause')
              }
              onPress={() => setPaused(p => !p)}
              testID="livelogs-pause-button"
              variant="secondary"
            />
            <IconButton
              glyph="🗑"
              label={t('liveLogs.controls.clear', 'Clear buffer')}
              onPress={handleClear}
              testID="livelogs-clear-button"
              variant="ghost"
            />
            <IconButton
              disabled={filteredEvents.length === 0}
              glyph="⬇"
              label={t('liveLogs.controls.download', 'Download visible (.txt)')}
              onPress={handleDownload}
              testID="livelogs-download-button"
              variant="ghost"
            />
            <IconButton
              glyph="↻"
              label={t('liveLogs.controls.reconnect', 'Reconnect')}
              onPress={handleReconnect}
              testID="livelogs-reconnect-button"
              variant="ghost"
            />
          </View>
        </GlassPanel>

        {/* Error */}
        {stream.error ? (
          <GlassPanel style={styles.errorPanel} testID="livelogs-error">
            <AppText style={styles.errorGlyph}>⚠</AppText>
            <View style={styles.errorBody}>
              <AppText
                style={styles.errorTitle}
                variant="caption"
                weight="semibold">
                {t('liveLogs.error.title', 'Could not connect to log stream')}
              </AppText>
              <AppText style={styles.errorHint} tone="secondary" variant="caption">
                {stream.error.message ||
                  t(
                    'liveLogs.error.hint',
                    'Check your network and admin permissions, then click Reconnect.',
                  )}
              </AppText>
            </View>
          </GlassPanel>
        ) : null}

        {/* Table */}
        <GlassPanel style={styles.tablePanel} testID="livelogs-table-panel">
          {filteredEvents.length === 0 ? (
            <EmptyState
              actionLabel={
                !enabled
                  ? t('liveLogs.controls.reconnect', 'Reconnect')
                  : undefined
              }
              glyph="☰"
              message={t(
                'liveLogs.empty.noEvents',
                'No log events yet. Trigger activity (e.g. start a charging session) to see live output.',
              )}
              onAction={!enabled ? handleReconnect : undefined}
              title={t('liveLogs.title', 'Live logs')}
            />
          ) : (
            <FlatList
              data={filteredEvents}
              keyExtractor={row => String(row.seq)}
              nestedScrollEnabled
              ref={listRef}
              renderItem={renderRow}
              style={styles.tableList}
            />
          )}
        </GlassPanel>

        <AppText style={styles.caption} tone="muted" variant="caption">
          {`${bufferedLabel} / max ${LOG_STREAM_MAX_EVENTS}`}
        </AppText>
      </FadeIn>
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    lineHeight: 16,
  },
  body: {
    gap: 16,
  },
  caption: {
    color: colors.textMuted,
  },
  captionWarn: {
    color: colors.warning,
  },
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  disabled: {
    opacity: 0.48,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
  },
  emptyAction: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  emptyActionText: {
    color: colors.accent,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 30,
    lineHeight: 36,
  },
  emptyMessage: {
    maxWidth: 360,
    textAlign: 'center',
  },
  emptyTitle: {
    color: colors.textPrimary,
  },
  errorBody: {
    flex: 1,
    gap: 2,
  },
  errorGlyph: {
    color: colors.danger,
    fontSize: 16,
    lineHeight: 22,
  },
  errorHint: {
    color: colors.textSecondary,
  },
  errorPanel: {
    borderColor: colors.dangerBorder,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  errorTitle: {
    color: colors.textPrimary,
  },
  fadeIn: {
    width: '100%',
  },
  field: {
    gap: spacing.xs,
  },
  fieldChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  fieldChipKey: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
  },
  fieldChipMore: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    paddingHorizontal: 4,
  },
  fieldChipValue: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 10,
  },
  fieldChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  fieldHint: {
    color: colors.textMuted,
  },
  fieldLabel: {
    color: colors.textSecondary,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  iconButtonGhost: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
    borderWidth: 1,
  },
  iconButtonGlyph: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  iconButtonLabel: {
    color: colors.textPrimary,
  },
  iconButtonSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  logMessage: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  logRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  logRowHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  logTime: {
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  mark: {
    backgroundColor: colors.warningSurface,
    color: colors.warning,
  },
  pageHeader: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  pageSubtitle: {
    color: colors.textMuted,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.82,
  },
  scroll: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  segment: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  segmentActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  segmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  segmentText: {
    color: colors.textSecondary,
  },
  segmentTextActive: {
    color: colors.accent,
  },
  statsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tableList: {
    maxHeight: 520,
  },
  tablePanel: {
    padding: spacing.sm,
  },
  toggleKnob: {
    backgroundColor: colors.textPrimary,
    borderRadius: 9,
    height: 18,
    width: 18,
  },
  toggleKnobOn: {
    transform: [{translateX: 18}],
  },
  toggleLabel: {
    color: colors.textSecondary,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleTrack: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 44,
  },
  toggleTrackOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
});

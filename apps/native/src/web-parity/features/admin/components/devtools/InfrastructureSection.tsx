// Native parity port of web/src/features/admin/components/devtools/InfrastructureSection.tsx.
//
// The Infrastructure tab of the admin Dev Tools page: a grid of one-shot backend
// probes (DB stats, migration status, MQTT publish test, env check, runtime
// info). Each tool runs a POST/GET against /dev-tools/{endpoint} and renders the
// JSON result (or error) inline.
//
// The web source composes four sibling devtools files — ToolCard, ResultPanel,
// BackendTool and the apiFetch helper — plus the shared web ui primitives
// (Input / Button / Textarea / Badge / CopyButton). None of those siblings are
// separate native conversion targets (they are not in the file-parity manifest),
// so this port is intentionally SELF-CONTAINED: it reproduces ToolCard,
// ResultPanel, BackendTool, MqttTestTool and apiFetch natively in one file rather
// than importing not-yet-ported web modules. Behaviour, state names (topic,
// message), the /dev-tools/{endpoint} API paths, the endpoint slugs
// (db-stats / migration-status / mqtt-test / env-check / runtime-info), the
// per-tool colors, and the i18n keys are preserved verbatim.
//
// Native-safe adaptations (documented in the sidecar):
//   - lucide-react icons (Database / GitBranch / Radio / Shield / Cpu / Play) have
//     no native SVG analog here, so each tool carries a short colored glyph badge
//     (DB / GB / RA / SH / CP) inside the same web ICON_COLOR_MAP colored ring,
//     and the Play affordance becomes a "\u25B6" glyph on the run buttons.
//   - The shared web ui (GlassPanel / Input / Textarea / Button / Badge /
//     CopyButton) and DOM elements (div / span / pre / input / textarea / button)
//     are replaced by the shared native GlassPanel + RN View / TextInput /
//     Pressable / ScrollView + AppText against the theme tokens.
//   - react-i18next is not wired in native, so useTranslation()'s `t` is replaced
//     by a native fallback that returns the i18n key (web i18next returns the key
//     when a translation is missing) or the supplied English default — preserving
//     every key verbatim.
//   - The web CopyButton's navigator.clipboard.writeText is reproduced with a
//     native-safe writeClipboard that uses navigator.clipboard when present
//     (react-native-web) and degrades to an explicit unavailable state on
//     iOS/Android where no clipboard module is bundled.
//   - The web `grid gap-4 lg:grid-cols-2` collapses to a single-column vertical
//     stack, matching the sub-`lg` (mobile) rendering of the source grid.
//
// No DOM, Recharts, Leaflet, lucide-react, or old web ui components are imported.

import React, {useCallback, useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useMutation} from '@tanstack/react-query';

import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../../theme/tokens';
import {request} from '../../../../api/client';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

type NativeTFunction = (key: string, fallback?: string) => string;

// react-i18next is not wired in native. i18next returns the key itself when a
// translation is missing, so the fallback returns the key (web `t('Db Stats')`)
// or the supplied English default (web `t('common.copyButton.copy', 'Copy')`),
// preserving every i18n key verbatim.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

/* ─── API helper (web-parity of ./helpers apiFetch) ───────────────────── */

async function apiFetch(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<Record<string, unknown>> {
  try {
    return await request<Record<string, unknown>>(`/dev-tools/${endpoint}`, {
      method,
      ...(body ? {body: JSON.stringify(body)} : {}),
    });
  } catch (err) {
    return {error: err instanceof Error ? err.message : 'Request failed'};
  }
}

/* ─── icon color map (web-parity of ./constants ICON_COLOR_MAP) ───────── */

type ToolColor = 'cyan' | 'green' | 'purple' | 'amber' | 'red';

/* ─── clipboard (web-parity of the shared CopyButton) ─────────────────── */

type CopyState = 'idle' | 'copied' | 'unavailable';

// Native-safe clipboard writer. Uses navigator.clipboard.writeText when present
// (react-native-web); on iOS/Android no clipboard module is bundled yet, so the
// copy is reported unavailable rather than crashing. Mirrors the web CopyButton's
// behaviour of not flipping to "Copied" when the write fails.
async function writeClipboard(text: string): Promise<CopyState> {
  const nav = globalThis as {
    navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
  };
  const clipboard = nav.navigator?.clipboard;
  if (clipboard == null || typeof clipboard.writeText !== 'function') {
    return 'unavailable';
  }
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'idle';
  }
}

function CopyControl({text}: {text: string}) {
  const t = useNativeTranslationFallback();
  const [state, setState] = useState<CopyState>('idle');

  const handleCopy = useCallback(async () => {
    const outcome = await writeClipboard(text);
    setState(outcome);
    if (outcome === 'copied') {
      setTimeout(() => setState('idle'), 2000);
    }
  }, [text]);

  const copied = state === 'copied';
  const label = copied
    ? t('common.copyButton.copied', 'Copied')
    : t('common.copyButton.copy', 'Copy');

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={handleCopy}
      style={({pressed}) => [styles.copyButton, pressed && styles.pressed]}>
      <AppText
        accessible={false}
        allowFontScaling={false}
        style={styles.copyGlyph}>
        {copied ? 'OK' : 'CP'}
      </AppText>
      <AppText style={styles.copyLabel} tone="secondary" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── Run button (web-parity of the shared primary Button w/ Play icon) ── */

interface RunButtonProps {
  label: string;
  loading: boolean;
  onPress: () => void;
}

function RunButton({label, loading, onPress}: RunButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: loading}}
      disabled={loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.runButton,
        loading && styles.runButtonDisabled,
        pressed && !loading && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : (
        <AppText
          accessible={false}
          allowFontScaling={false}
          style={styles.runGlyph}>
          {'\u25B6'}
        </AppText>
      )}
      <AppText style={styles.runLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── Status badge (web-parity of the shared Badge success/danger dot) ─── */

function StatusBadge({
  variant,
  label,
}: {
  variant: 'success' | 'danger';
  label: string;
}) {
  return (
    <View style={[styles.badge, badgeContainerStyles[variant]]}>
      <View style={[styles.badgeDot, badgeDotStyles[variant]]} />
      <AppText
        style={[styles.badgeLabel, badgeLabelStyles[variant]]}
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ─── ToolCard (web-parity of ./ToolCard) ─────────────────────────────── */

interface ToolCardProps {
  glyph: string;
  color: ToolColor;
  title: string;
  description: string;
  children: ReactNode;
}

function ToolCard({glyph, color, title, description, children}: ToolCardProps) {
  return (
    <GlassPanel style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.iconBox, iconBoxStyles[color]]}>
          <AppText
            accessible={false}
            allowFontScaling={false}
            style={[styles.iconGlyph, iconGlyphStyles[color]]}
            weight="bold">
            {glyph}
          </AppText>
        </View>
        <View style={styles.cardHeaderText}>
          <AppText style={styles.cardTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.cardDescription} tone="secondary">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

/* ─── ResultPanel (web-parity of ./ResultPanel) ───────────────────────── */

interface ResultPanelProps {
  title: string;
  data?: unknown;
  error?: string;
  idleMessage?: string;
}

function ResultPanel({title, data, error, idleMessage}: ResultPanelProps) {
  const hasData = data != null;
  const stringifiedData = hasData ? JSON.stringify(data, null, 2) : '';
  const surfaceStyle = error
    ? styles.resultError
    : hasData
      ? styles.resultData
      : styles.resultIdle;

  return (
    <View style={[styles.result, surfaceStyle]}>
      <View style={styles.resultHeader}>
        <AppText style={styles.resultTitle} tone="secondary" weight="semibold">
          {title}
        </AppText>
        {hasData ? <CopyControl text={stringifiedData} /> : null}
      </View>
      {error ? (
        <AppText style={styles.resultErrorText}>{error}</AppText>
      ) : hasData ? (
        <ScrollView
          nestedScrollEnabled
          style={styles.resultScroll}
          contentContainerStyle={styles.resultScrollContent}>
          <AppText style={styles.resultPre}>{stringifiedData}</AppText>
        </ScrollView>
      ) : (
        <AppText style={styles.resultIdleText}>
          {idleMessage ?? 'No result yet'}
        </AppText>
      )}
    </View>
  );
}

/* ─── BackendTool (web-parity of ./BackendTool) ───────────────────────── */

interface BackendToolProps {
  glyph: string;
  color: ToolColor;
  title: string;
  description: string;
  endpoint: string;
  method?: 'GET' | 'POST' | 'DELETE';
  bodyBuilder?: () => unknown;
  children?: ReactNode;
}

function BackendTool({
  glyph,
  color,
  title,
  description,
  endpoint,
  method = 'GET',
  bodyBuilder,
  children,
}: BackendToolProps) {
  const t = useNativeTranslationFallback();
  const mutation = useMutation({
    mutationFn: () => apiFetch(endpoint, method, bodyBuilder?.()),
  });
  const data = mutation.data;
  const errorText =
    data && typeof data.error === 'string' ? data.error : undefined;

  return (
    <ToolCard glyph={glyph} color={color} title={title} description={description}>
      {children}
      <View style={styles.actionRow}>
        <RunButton
          label={t('Run')}
          loading={mutation.isPending}
          onPress={() => mutation.mutate()}
        />
        {data ? (
          <StatusBadge
            variant={data.error ? 'danger' : 'success'}
            label={data.error ? t('Failed') : t('Success')}
          />
        ) : null}
      </View>
      {data ? (
        <ResultPanel
          title={title}
          data={data.error ? undefined : data}
          error={errorText}
        />
      ) : null}
    </ToolCard>
  );
}

/* ─── MQTT Test Tool (web-parity of the source MqttTestTool) ──────────── */

function MqttTestTool() {
  const t = useNativeTranslationFallback();
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState('');

  const mutation = useMutation({
    mutationFn: () => apiFetch('mqtt-test', 'POST', {topic, message}),
  });
  const data = mutation.data;
  const errorText =
    data && typeof data.error === 'string' ? data.error : undefined;

  return (
    <ToolCard
      glyph="RA"
      color="amber"
      title={t('Mqtt')}
      description={t('Mqtt Desc')}>
      <View style={styles.fieldStack}>
        <View style={styles.field}>
          <AppText style={styles.fieldLabel} tone="secondary" weight="semibold">
            {t('Topic')}
          </AppText>
          <View style={styles.inputRow}>
            <AppText
              accessible={false}
              allowFontScaling={false}
              style={styles.inputGlyph}
              tone="muted">
              RA
            </AppText>
            <TextInput
              accessibilityLabel={t('Topic')}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setTopic}
              placeholder="test/topic"
              placeholderTextColor={colors.textMuted}
              style={styles.inputInline}
              value={topic}
            />
          </View>
        </View>

        <View style={styles.field}>
          <AppText style={styles.fieldLabel} tone="secondary" weight="semibold">
            {t('Message')}
          </AppText>
          <TextInput
            accessibilityLabel={t('Message')}
            multiline
            numberOfLines={3}
            onChangeText={setMessage}
            placeholder={'{"key": "value"}'}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, styles.textarea]}
            textAlignVertical="top"
            value={message}
          />
        </View>

        <RunButton
          label={t('Send Test')}
          loading={mutation.isPending}
          onPress={() => mutation.mutate()}
        />

        {data ? (
          <ResultPanel
            title={t('Mqtt')}
            data={data.error ? undefined : data}
            error={errorText}
          />
        ) : null}
      </View>
    </ToolCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Infrastructure Section
   ═══════════════════════════════════════════════════════════════════════ */

export interface InfrastructureSectionProps {
  /** Native style applied to the section container (RN equivalent of the web grid wrapper). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function InfrastructureSection({
  style,
  testID,
}: InfrastructureSectionProps = {}) {
  const t = useNativeTranslationFallback();
  return (
    <View
      style={[styles.grid, style]}
      testID={testID ?? 'infrastructure-section'}>
      <BackendTool
        glyph="DB"
        color="cyan"
        title={t('Db Stats')}
        description={t('Db Stats Desc')}
        endpoint="db-stats"
      />
      <BackendTool
        glyph="GB"
        color="green"
        title={t('Migrations')}
        description={t('Migrations Desc')}
        endpoint="migration-status"
      />
      <MqttTestTool />
      <BackendTool
        glyph="SH"
        color="purple"
        title={t('Env Check')}
        description={t('Env Check Desc')}
        endpoint="env-check"
      />
      <BackendTool
        glyph="CP"
        color="amber"
        title={t('Runtime')}
        description={t('Runtime Desc')}
        endpoint="runtime-info"
      />
    </View>
  );
}

InfrastructureSection.displayName = 'InfrastructureSection';

export default InfrastructureSection;

/* ─── styles ──────────────────────────────────────────────────────────── */

const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

const styles = StyleSheet.create({
  // web: grid gap-4 lg:grid-cols-2 -> single-column stack below the lg breakpoint
  grid: {
    gap: 16,
  },
  // web: <GlassPanel className="p-5">
  card: {
    padding: spacing.lg,
  },
  // web: mb-4 flex items-start gap-3
  cardHeader: {
    columnGap: spacing.md,
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  // web: h-10 w-10 shrink-0 rounded-lg flex items-center justify-center
  iconBox: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconGlyph: {
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  cardHeaderText: {
    flex: 1,
  },
  // web: text-sm font-semibold text-white
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  // web: text-xs text-[var(--text-secondary)]
  cardDescription: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  // web: space-y-3 on the MQTT form
  fieldStack: {
    rowGap: spacing.md,
  },
  field: {
    rowGap: spacing.xs,
  },
  // web Input/Textarea label: text-xs font-medium text-[var(--text-secondary)]
  fieldLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  // web Input wrapper w/ left icon: border + left-padded text
  inputRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  inputGlyph: {
    fontSize: 11,
    letterSpacing: 0.4,
    marginRight: spacing.sm,
  },
  inputInline: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
    paddingVertical: spacing.sm,
  },
  // web textarea: standalone bordered surface
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // web: rows={3} resize-y
  textarea: {
    minHeight: 78,
  },
  // web: mt-3 flex items-center gap-2 (Run + status badge)
  actionRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  // web primary Button size=sm
  runButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.accent,
    borderRadius: 10,
    columnGap: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  runButtonDisabled: {
    opacity: 0.6,
  },
  runGlyph: {
    color: colors.background,
    fontSize: 11,
    lineHeight: 14,
  },
  runLabel: {
    color: colors.background,
    fontSize: 12,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.82,
  },
  // web Badge variant success/danger size=sm w/ dot
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    columnGap: spacing.xs,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  badgeLabel: {
    fontSize: 11,
    lineHeight: 15,
  },
  // web ResultPanel: mt-3 rounded-lg p-3
  result: {
    borderRadius: 10,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  resultError: {
    backgroundColor: colors.dangerSurface,
  },
  resultData: {
    backgroundColor: colors.successSurface,
  },
  resultIdle: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  // web: mb-1 flex items-center justify-between
  resultHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  resultTitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  // web CopyButton (ghost/sm)
  copyButton: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  copyGlyph: {
    color: colors.textSecondary,
    fontSize: 10,
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  copyLabel: {
    fontSize: 11,
    lineHeight: 15,
  },
  // web: text-sm text-rose-300
  resultErrorText: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  // web: pre max-h-64 overflow-auto rounded p-2 text-xs
  resultScroll: {
    borderRadius: 8,
    maxHeight: 256,
  },
  resultScrollContent: {
    padding: spacing.sm,
  },
  resultPre: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 17,
  },
  // web: text-sm italic text-[var(--text-muted)]
  resultIdleText: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
  },
});

// web ICON_COLOR_MAP: bg-neon-{color}/10 + text-neon-{color} + ring-neon-{color}/20
const iconBoxStyles = StyleSheet.create<Record<ToolColor, ViewStyle>>({
  cyan: {
    backgroundColor: 'rgba(53, 213, 255, 0.10)',
    borderColor: 'rgba(53, 213, 255, 0.20)',
  },
  green: {
    backgroundColor: 'rgba(52, 211, 153, 0.10)',
    borderColor: 'rgba(52, 211, 153, 0.20)',
  },
  purple: {
    backgroundColor: 'rgba(167, 139, 250, 0.10)',
    borderColor: 'rgba(167, 139, 250, 0.20)',
  },
  amber: {
    backgroundColor: 'rgba(251, 191, 36, 0.10)',
    borderColor: 'rgba(251, 191, 36, 0.20)',
  },
  red: {
    backgroundColor: 'rgba(251, 113, 133, 0.10)',
    borderColor: 'rgba(251, 113, 133, 0.20)',
  },
});

const iconGlyphStyles = StyleSheet.create<Record<ToolColor, TextStyle>>({
  cyan: {color: colors.accent},
  green: {color: colors.success},
  purple: {color: colors.violet},
  amber: {color: colors.warning},
  red: {color: colors.danger},
});

const badgeContainerStyles = StyleSheet.create<Record<'success' | 'danger', ViewStyle>>({
  success: {backgroundColor: colors.successSurface},
  danger: {backgroundColor: colors.dangerSurface},
});

const badgeDotStyles = StyleSheet.create<Record<'success' | 'danger', ViewStyle>>({
  success: {backgroundColor: colors.success},
  danger: {backgroundColor: colors.danger},
});

const badgeLabelStyles = StyleSheet.create<Record<'success' | 'danger', TextStyle>>({
  success: {color: colors.success},
  danger: {color: colors.danger},
});

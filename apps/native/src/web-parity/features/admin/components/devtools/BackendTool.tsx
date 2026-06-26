// Native parity port of web/src/features/admin/components/devtools/BackendTool.tsx.
//
// The web source is a generic dev-tools card that fires a single backend
// request through a TanStack `useMutation`, then surfaces a Run button (with a
// Play icon + loading spinner), a success/failure Badge, and a ResultPanel that
// renders the JSON response or an error string. It composes three sibling web
// modules — `ToolCard` (a GlassPanel with a coloured icon header), `ResultPanel`
// (the JSON/error readout with a copy affordance), and the `apiFetch` helper
// (POST/GET/DELETE against `/dev-tools/{endpoint}`) — plus the shared web
// `Button`/`Badge` and the lucide `Play` glyph.
//
// Those siblings do not yet exist in the native tree, so — mirroring how the
// other native parity ports inline the pieces they need (e.g. AIFeatureCard
// inlines its own AiOutputPanel/Helix marks) — this self-contained port rebuilds
// each dependency with React Native primitives and existing native tokens:
//   * `apiFetch` is reproduced verbatim against the native `request` client,
//     keeping the exact `/dev-tools/{endpoint}` path, method, JSON body policy,
//     and the `{ error }` catch shape.
//   * `ToolCard` becomes a native `GlassPanel` with a tinted icon box rendered
//     via the shared native `Icon` wrapper (the web ICON_COLOR_MAP neon classes
//     map to the matching token colour stops, defaulting to cyan).
//   * The web `Button` (primary/sm/loading + Play icon) becomes a native
//     Pressable with an ActivityIndicator-or-Play-triangle and the same label.
//   * The web `Badge` (danger/success + dot) reuses the native `StatusPill`
//     (offline→Failed, online→Success), which already carries the dot.
//   * `ResultPanel` is inlined with a native JSON/error readout. The web
//     `CopyButton` maps to a clipboard control gated behind a registerable
//     writer — native parity has no clipboard module wired (no
//     `@react-native-clipboard/clipboard` dependency), so the control renders in
//     an explicit unavailable/disabled state until a host registers one, and
//     never claims success without a real write (documented in the sidecar).
//
// react-i18next is replaced by a self-contained fallback that preserves each
// key (`t('Run')`, `t('Failed')`, `t('Success')`). No DOM, no lucide-react, no
// Recharts/Leaflet, and no web UI components are imported.

import React, { useCallback, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useMutation } from '@tanstack/react-query';

import { request } from '../../../../api/client';
import { Icon, type IconComponentType } from '../../../../components/ui/Icon';
import { AppText } from '../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { StatusPill } from '../../../../../components/ui/StatusPill';
import { colors, spacing } from '../../../../../theme/tokens';

type NativeTFunction = (key: string, fallback?: string) => string;

// Native parity has no i18n runtime wired, so this returns the supplied fallback
// or the key itself — preserving the web `t('Run')` / `t('Failed')` /
// `t('Success')` intent where the English string is the key.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key: string, fallback?: string) => fallback ?? key, []);
}

// Native analogue of the web devtools ICON_COLOR_MAP (`bg-neon-{c}/10
// text-neon-{c} ring-1 ring-neon-{c}/20`). Each key maps to the matching token
// stop for the glyph, the soft surface fill, and the hairline ring border.
const ICON_TINTS: Record<
  string,
  { glyph: string; surface: string; border: string }
> = {
  cyan: {
    glyph: colors.accent,
    surface: colors.accentSoft,
    border: colors.borderAccent,
  },
  green: {
    glyph: colors.success,
    surface: colors.successSurface,
    border: colors.successBorder,
  },
  purple: {
    glyph: colors.violet,
    surface: colors.violetSurface,
    border: colors.violetBorder,
  },
  amber: {
    glyph: colors.warning,
    surface: colors.warningSurface,
    border: colors.warningBorder,
  },
  red: {
    glyph: colors.danger,
    surface: colors.dangerSurface,
    border: colors.dangerBorder,
  },
};

// Web-exact low-opacity tints for the ResultPanel container (`bg-neon-red/5`,
// `bg-neon-green/5`, `bg-white/[0.02]`) and the rose-300 error text, recreated
// here the same way the other ports recreate web-exact colours that the shared
// token set does not expose at these precise stops.
const RESULT_ERROR_TINT = 'rgba(251, 113, 133, 0.06)';
const RESULT_DATA_TINT = 'rgba(52, 211, 153, 0.06)';
const RESULT_IDLE_TINT = 'rgba(255, 255, 255, 0.02)';
const RESULT_CODE_BG = 'rgba(0, 0, 0, 0.45)';
const ROSE_300 = '#fda4af';

// Clipboard provider registry — mirrors client.ts's sudo provider pattern. The
// native build ships no clipboard module, so copy stays a no-op (and the control
// renders disabled) until a host registers a real writer. Exposing the setter
// keeps the affordance honest: it only flips to "Copied" after a write resolves.
type ClipboardWriter = (text: string) => Promise<void> | void;
let clipboardWriter: ClipboardWriter | null = null;

export function registerDevtoolsClipboardWriter(
  writer: ClipboardWriter | null,
): () => void {
  clipboardWriter = writer;
  return () => {
    if (clipboardWriter === writer) {
      clipboardWriter = null;
    }
  };
}

// Native parity for the web `apiFetch` helper: same `/dev-tools/{endpoint}`
// path, same method default, same conditional JSON body, and the same
// `{ error }` fallback shape on failure so callers can branch on `data.error`.
async function apiFetch(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<Record<string, unknown>> {
  try {
    return await request<Record<string, unknown>>(`/dev-tools/${endpoint}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Request failed' };
  }
}

// Right-pointing play triangle standing in for the lucide `Play` glyph, built
// with the RN border-triangle technique so no DOM/lucide import is needed.
function PlayGlyph({ color }: { color: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.playTriangle, { borderLeftColor: color }]}
    />
  );
}

// Native parity for the web primary/sm Button: loading swaps the Play glyph for
// a spinner and disables the press, matching `disabled={disabled || loading}`.
function RunButton({
  label,
  loading,
  onPress,
}: {
  label: string;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: loading, disabled: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.runButton,
        loading && styles.runButtonDisabled,
        pressed && !loading && styles.runButtonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : (
        <PlayGlyph color={colors.background} />
      )}
      <AppText style={styles.runButtonText} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// Native parity for the web ResultPanel CopyButton, gated behind the clipboard
// registry. Disabled (with an explicit a11y state) when no writer is wired.
function CopyButton({ text }: { text: string }) {
  const t = useNativeTranslationFallback();
  const [copied, setCopied] = useState(false);
  const available = clipboardWriter != null;

  const onPress = useCallback(() => {
    const writer = clipboardWriter;
    if (writer == null) {
      return;
    }
    void (async () => {
      try {
        await writer(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Swallow copy failures — the readout text remains visible regardless.
      }
    })();
  }, [text]);

  const label = copied ? t('Copied', 'Copied') : t('Copy', 'Copy');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={onPress}
      style={({ pressed }) => [
        styles.copyButton,
        pressed && available && styles.runButtonPressed,
      ]}
    >
      <AppText
        tone={available ? 'secondary' : 'muted'}
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

interface ResultPanelViewProps {
  title: string;
  data?: unknown;
  error?: string;
  idleMessage?: string;
}

// Native parity for web/src/features/admin/components/devtools/ResultPanel.tsx.
function ResultPanelView({
  title,
  data,
  error,
  idleMessage,
}: ResultPanelViewProps) {
  const hasData = data != null;
  const stringifiedData = hasData ? JSON.stringify(data, null, 2) : '';

  const containerTint = error
    ? RESULT_ERROR_TINT
    : hasData
    ? RESULT_DATA_TINT
    : RESULT_IDLE_TINT;

  return (
    <View style={[styles.resultPanel, { backgroundColor: containerTint }]}>
      <View style={styles.resultHeader}>
        <AppText style={styles.resultTitle} tone="secondary" variant="caption">
          {title}
        </AppText>
        {hasData ? <CopyButton text={stringifiedData} /> : null}
      </View>
      {error ? (
        <AppText style={styles.resultError}>{error}</AppText>
      ) : hasData ? (
        <ScrollView nestedScrollEnabled style={styles.resultCodeScroll}>
          <AppText style={styles.resultCode}>{stringifiedData}</AppText>
        </ScrollView>
      ) : (
        <AppText style={styles.resultIdle} tone="muted">
          {idleMessage ?? 'No result yet'}
        </AppText>
      )}
    </View>
  );
}

interface ToolCardViewProps {
  icon: IconComponentType;
  color: string;
  title: string;
  description: string;
  children: ReactNode;
}

// Native parity for web/src/features/admin/components/devtools/ToolCard.tsx.
function ToolCardView({
  icon,
  color,
  title,
  description,
  children,
}: ToolCardViewProps) {
  const tint = ICON_TINTS[color] ?? ICON_TINTS.cyan;

  return (
    <GlassPanel style={styles.card}>
      <View style={styles.header}>
        <View
          style={[
            styles.iconBox,
            { backgroundColor: tint.surface, borderColor: tint.border },
          ]}
        >
          <Icon color={tint.glyph} icon={icon} size="lg" />
        </View>
        <View style={styles.headerText}>
          <AppText style={styles.cardTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.cardDesc} tone="secondary" variant="caption">
            {description}
          </AppText>
        </View>
      </View>
      {children}
    </GlassPanel>
  );
}

export interface BackendToolProps {
  icon: IconComponentType;
  color: string;
  title: string;
  description: string;
  endpoint: string;
  method?: 'GET' | 'POST' | 'DELETE';
  bodyBuilder?: () => unknown;
  children?: ReactNode;
}

export function BackendTool({
  icon,
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

  return (
    <ToolCardView
      color={color}
      description={description}
      icon={icon}
      title={title}
    >
      {children}
      <View style={styles.actionRow}>
        <RunButton
          label={t('Run', 'Run')}
          loading={mutation.isPending}
          onPress={() => mutation.mutate()}
        />
        {mutation.data ? (
          <StatusPill
            label={
              mutation.data.error
                ? t('Failed', 'Failed')
                : t('Success', 'Success')
            }
            state={mutation.data.error ? 'offline' : 'online'}
          />
        ) : null}
      </View>
      {mutation.data ? (
        <ResultPanelView
          data={mutation.data.error ? undefined : mutation.data}
          error={
            typeof mutation.data.error === 'string'
              ? mutation.data.error
              : undefined
          }
          title={title}
        />
      ) : null}
    </ToolCardView>
  );
}

BackendTool.displayName = 'BackendTool';

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    padding: spacing.lg,
  },
  cardDesc: {
    lineHeight: 16,
    marginTop: 2,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  copyButton: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: 16,
  },
  headerText: {
    flex: 1,
    flexShrink: 1,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexShrink: 0,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  playTriangle: {
    borderBottomColor: 'transparent',
    borderBottomWidth: 5,
    borderLeftWidth: 8,
    borderTopColor: 'transparent',
    borderTopWidth: 5,
    height: 0,
    width: 0,
  },
  resultCode: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  resultCodeScroll: {
    backgroundColor: RESULT_CODE_BG,
    borderRadius: 8,
    maxHeight: 256,
    padding: spacing.sm,
  },
  resultError: {
    color: ROSE_300,
    lineHeight: 20,
  },
  resultHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  resultIdle: {
    fontStyle: 'italic',
  },
  resultPanel: {
    borderRadius: 12,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  resultTitle: {
    fontWeight: '600',
  },
  runButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  runButtonDisabled: {
    opacity: 0.5,
  },
  runButtonPressed: {
    opacity: 0.82,
  },
  runButtonText: {
    color: colors.background,
    fontSize: 12,
  },
});

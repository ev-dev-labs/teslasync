/**
 * Native parity port of
 * web/src/features/admin/components/devtools/ResultPanel.tsx.
 *
 * The web file is the DevTools shared "result panel": a tinted container that
 * shows a small title row (plus a CopyButton when there is data) above one of
 * three mutually-exclusive bodies — an error line, a scrollable monospaced JSON
 * dump, or an italic idle placeholder. This native port preserves that contract
 * 1:1 using React Native primitives + the existing native AppText / tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - `@/lib/cn` (web L1): dropped — native styling uses StyleSheet + tokens.
 *     The three conditional Tailwind backgrounds (bg-neon-red/5 on error,
 *     bg-neon-green/5 on data, bg-white/[0.02] idle) become equivalent low-alpha
 *     rgba fills derived from the danger/success token base colours, preserving
 *     the faint error / success / neutral tint intent.
 *   - `@/components/ui` CopyButton (web L2): no native parity port yet (it is a
 *     separate parity-manifest file), so a minimal native-safe copy affordance
 *     is reproduced locally as a Pressable that toggles Copy -> Copied for 2s and
 *     best-effort writes via navigator.clipboard (present on the
 *     web/react-native-web target; a documented no-op where no clipboard module
 *     exists, e.g. a bare native device). Its Copy/Copied labels keep the
 *     original CopyButton i18n keys (common.copyButton.copy / .copied).
 *   - The web `<pre>` (L28-30) overflow-auto monospaced block becomes a vertical
 *     ScrollView (maxHeight 256 == max-h-64) holding monospaced AppText, mirroring
 *     the sibling ai/ConfirmDialog args-block precedent.
 *   - The `idle` prop is accepted but unused, exactly as in the web source.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../../theme/tokens';

/* ── native-safe copy affordance (stand-in for `@/components/ui` CopyButton) ── */

const COPIED_RESET_MS = 2000;

/** text-rose-300 (web L26), the toned-down error colour. */
const ROSE_300 = '#fda4af';

/**
 * Best-effort clipboard write. Resolves true on success, false where no
 * clipboard module is available (a bare native device). Works on the
 * web / react-native-web target via navigator.clipboard.
 */
async function writeTextToClipboard(text: string): Promise<boolean> {
  const clipboard = (
    globalThis as {
      navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
    }
  ).navigator?.clipboard;
  if (typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function ResultCopyButton({text}: {text: string}) {
  // Preserve the CopyButton i18n defaults/keys (common.copyButton.copy/.copied).
  const copyLabel = 'Copy';
  const copiedLabel = 'Copied';
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  const handlePress = useCallback(() => {
    void writeTextToClipboard(text);
    setCopied(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
  }, [text]);

  const label = copied ? copiedLabel : copyLabel;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={handlePress}
      style={({pressed}) => [
        styles.copyButton,
        pressed && styles.copyButtonPressed,
      ]}
      testID="result-panel-copy">
      <AppText style={[styles.copyGlyph, copied && styles.copyGlyphDone]}>
        {copied ? '\u2713' : '\u29C9'}
      </AppText>
      <AppText style={styles.copyLabel} testID="result-panel-copy-label" tone="secondary">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── ResultPanel ── */

export interface ResultPanelProps {
  title: string;
  data?: unknown;
  error?: string;
  idle?: boolean;
  idleMessage?: string;
}

export function ResultPanel({title, data, error, idleMessage}: ResultPanelProps) {
  const hasData = data != null;
  const stringifiedData = hasData ? JSON.stringify(data, null, 2) : '';

  return (
    <View
      style={[
        styles.container,
        error
          ? styles.containerError
          : hasData
          ? styles.containerData
          : styles.containerIdle,
      ]}
      testID="result-panel">
      <View style={styles.header}>
        <AppText style={styles.title} tone="secondary" variant="caption">
          {title}
        </AppText>
        {hasData ? <ResultCopyButton text={stringifiedData} /> : null}
      </View>
      {error ? (
        <AppText style={styles.errorText} testID="result-panel-error">
          {error}
        </AppText>
      ) : hasData ? (
        <ScrollView style={styles.pre} testID="result-panel-data">
          <AppText style={styles.preText}>{stringifiedData}</AppText>
        </ScrollView>
      ) : (
        <AppText style={styles.idleText} testID="result-panel-idle" tone="muted">
          {idleMessage ?? 'No result yet'}
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.md,
    borderRadius: 8,
    padding: spacing.md,
  },
  containerError: {
    backgroundColor: 'rgba(251, 113, 133, 0.05)',
  },
  containerData: {
    backgroundColor: 'rgba(52, 211, 153, 0.05)',
  },
  containerIdle: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  title: {
    fontWeight: '500',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: 6,
  },
  copyButtonPressed: {
    opacity: 0.7,
  },
  copyGlyph: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  copyGlyphDone: {
    color: colors.success,
  },
  copyLabel: {
    fontSize: typography.caption,
  },
  errorText: {
    fontSize: 14,
    color: ROSE_300,
  },
  pre: {
    maxHeight: 256,
    borderRadius: 6,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.sm,
  },
  preText: {
    fontSize: typography.caption,
    color: colors.textPrimary,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  idleText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
});

// Native parity port of web/src/features/system/components/chatbot/CodeBlock.tsx.
//
// `<CodeBlock>` wraps the fenced code blocks rendered by the chatbot's markdown
// renderer. It draws a small header carrying the language tag (when set) plus a
// copy affordance, then renders the raw snippet in a monospace block that can be
// scrolled horizontally for long lines.
//
// Behavioural contract (identical to web):
//   - `language` is a hint from the markdown fence (e.g. "ts", "go", "bash").
//     Empty/whitespace falls back to the literal label "text".
//   - `text` is the raw clipboard payload — the copy control always copies this
//     string verbatim, never the pre-rendered children.
//   - `children` are the already-escaped React children handed over by the
//     markdown renderer; when present they are displayed instead of `text`
//     (`children ?? text`), so the on-screen content matches the renderer while
//     the clipboard still receives the raw source.
//   - No syntax highlighting (the web component deliberately avoids
//     react-syntax-highlighter to stay within the chatbot bundle budget); plain
//     monospace styling is reproduced here too.
//
// Web -> native adaptations (documented in the sidecar):
//   - The web `<div>/<div>/<span>/<pre>/<code>` DOM tree becomes
//     <View>/<View>/<AppText>/<ScrollView horizontal>/<AppText>. `overflow-x-auto`
//     on the `<pre>` maps to a horizontal ScrollView so long lines scroll instead
//     of wrapping, and `<pre>`'s whitespace preservation is inherent to RN <Text>.
//   - `<CopyButton text iconOnly variant="ghost" size="sm" />` has no shared
//     native equivalent yet (mirroring how MaskedValue inlined its copy control),
//     so it is reproduced inline as a small <Pressable accessibilityRole="button">
//     swapping a copy/copied glyph. The web i18n keys (common.copyButton.copy /
//     common.copyButton.copied) are preserved verbatim via a native fallback `t`
//     that returns the English defaultValue, since react-i18next is not wired in
//     native. A native-only common.copyButton.unavailable hint backs the
//     degraded-clipboard state.
//   - `navigator.clipboard.writeText` is browser-only. On react-native-web it is
//     used as-is; on iOS/Android (no bundled clipboard module yet) the control
//     degrades to an explicit "unavailable" state instead of silently succeeding.
//   - The Tailwind/CSS-var classes resolve to a StyleSheet: var(--border-subtle)
//     -> colors.border, var(--surface-overlay) -> colors.surface,
//     var(--text-secondary) -> colors.textSecondary, var(--text-primary) ->
//     colors.textPrimary, my-2 -> marginVertical 8, rounded-lg -> borderRadius 8.
//   - The optional web `className` is accepted-but-ignored for source
//     compatibility and mirrored by a native `style` override on the wrapper.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

export interface CodeBlockProps {
  /** Language hint from the markdown fence (e.g. "ts", "go", "bash"). */
  language?: string;
  /** Raw text content (used as the clipboard payload). */
  text: string;
  /**
   * Pre-rendered children produced by the markdown renderer. Kept separate from
   * `text` because the renderer hands us already-escaped React children, not a
   * raw string.
   */
  children?: ReactNode;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the outer wrapper (RN equivalent of `className`). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type CopyState = 'idle' | 'copied' | 'unavailable';

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * Native i18n fallback: react-i18next is not wired in native, so this returns
 * the English defaultValue — preserving the web i18n keys and copy verbatim.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

const COPY_RESET_MS = 2_000;

// lucide Copy / CheckCircle affordances rendered as text glyphs.
const COPY_GLYPH = '\u29C9'; // ⧉ — two joined squares (copy/duplicate).
const COPIED_GLYPH = '\u2713'; // ✓ — success check (CheckCircle parity).

// Monospace family for the language tag and code (web `font-mono`).
const MONOSPACE = Platform.select({ios: 'Menlo', default: 'monospace'});

/**
 * Native-safe clipboard writer. Uses `navigator.clipboard.writeText` when
 * present (react-native-web), otherwise reports `unavailable` so the control can
 * surface an explicit degraded state rather than silently "succeeding".
 */
async function writeClipboard(text: string): Promise<CopyState> {
  const nav = (globalThis as unknown as {
    navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
  }).navigator;
  const clipboard = nav?.clipboard;
  if (clipboard == null || typeof clipboard.writeText !== 'function') {
    return 'unavailable';
  }
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    // Clipboard exists but the write failed — mirror the web behaviour of not
    // flipping to the "copied" state.
    return 'idle';
  }
}

/**
 * Wrapper around fenced code blocks rendered by the chatbot markdown renderer.
 * Adds a small header with the language tag (when set) and an inline copy
 * control that copies the raw text to the clipboard.
 *
 * No syntax highlighting — plain mono styling keeps things lean and is good
 * enough for the short snippets the assistant emits.
 */
export function CodeBlock({
  language,
  text,
  children,
  className: _className,
  style,
  testID,
}: CodeBlockProps) {
  const t = useNativeTranslationFallback();
  const langLabel = language?.trim() || 'text';
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCopyTimer = useCallback(() => {
    if (copyTimerRef.current != null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, []);

  // Release the reset timer on unmount so a teardown mid-copy does not leak a
  // setTimeout that fires against an unmounted component.
  useEffect(() => clearCopyTimer, [clearCopyTimer]);

  const handleCopy = useCallback(async () => {
    const outcome = await writeClipboard(text);
    setCopyState(outcome);
    clearCopyTimer();
    copyTimerRef.current = setTimeout(() => {
      setCopyState('idle');
      copyTimerRef.current = null;
    }, COPY_RESET_MS);
  }, [text, clearCopyTimer]);

  const copyLabel = t('common.copyButton.copy', 'Copy');
  const copiedLabel = t('common.copyButton.copied', 'Copied');
  const copyUnavailableHint = t(
    'common.copyButton.unavailable',
    'Copy is unavailable on this device',
  );
  const resolvedCopyLabel = copyState === 'copied' ? copiedLabel : copyLabel;

  return (
    <View style={[styles.wrapper, style]} testID={testID ?? 'code-block'}>
      <View style={styles.header}>
        <AppText style={styles.langLabel} testID="code-block-lang">
          {langLabel}
        </AppText>
        <Pressable
          accessibilityHint={
            copyState === 'unavailable' ? copyUnavailableHint : undefined
          }
          accessibilityLabel={resolvedCopyLabel}
          accessibilityLiveRegion="polite"
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleCopy}
          style={({pressed}) => [styles.copyControl, pressed && styles.copyControlPressed]}
          testID="code-block-copy">
          <AppText
            accessible={false}
            allowFontScaling={false}
            style={[
              styles.copyGlyph,
              copyState === 'copied' && styles.copyGlyphCopied,
              copyState === 'unavailable' && styles.copyGlyphUnavailable,
            ]}>
            {copyState === 'copied' ? COPIED_GLYPH : COPY_GLYPH}
          </AppText>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        contentContainerStyle={styles.codeContent}
        showsHorizontalScrollIndicator={false}
        style={styles.codeScroll}>
        <AppText style={styles.code} testID="code-block-text">
          {children ?? text}
        </AppText>
      </ScrollView>
    </View>
  );
}

CodeBlock.displayName = 'CodeBlock';

const styles = StyleSheet.create({
  // relative rounded-lg border border-[var(--border-subtle)]
  // bg-[var(--surface-overlay)] my-2 overflow-hidden
  wrapper: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginVertical: spacing.sm,
    overflow: 'hidden',
  },
  // flex items-center justify-between border-b border-[var(--border-subtle)]
  // px-3 py-1.5
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  // font-mono text-[11px] uppercase tracking-wider text-[var(--text-secondary)]
  langLabel: {
    fontFamily: MONOSPACE,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  // ghost sm icon-only button
  copyControl: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    paddingHorizontal: spacing.xs + 2,
  },
  copyControlPressed: {
    opacity: 0.6,
  },
  copyGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  copyGlyphCopied: {
    color: colors.success,
  },
  copyGlyphUnavailable: {
    color: colors.textMuted,
  },
  // overflow-x-auto
  codeScroll: {
    width: '100%',
  },
  // p-3
  codeContent: {
    padding: spacing.md,
  },
  // text-xs leading-relaxed text-[var(--text-primary)] font-mono
  code: {
    fontFamily: MONOSPACE,
    fontSize: 12,
    lineHeight: 19,
    color: colors.textPrimary,
  },
});

export default CodeBlock;

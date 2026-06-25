// Native parity port of web/src/components/ai/AiOutputPanel.tsx.
//
// Keeps the streamed-output lifecycle visible after the first run while
// replacing DOM/SVG/Tailwind dependencies with React Native primitives.

import React, {useCallback, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

export type AiStreamState =
  | 'idle'
  | 'streaming'
  | 'paused-confirm'
  | 'done'
  | 'error';

type NativeTFunction = (key: string, fallback: string) => string;

export interface AiOutputPanelProps {
  /** Accumulated delta.text payload from useAiStream. */
  text: string;
  /** Current stream lifecycle state. */
  state: AiStreamState;
  /** Terminal error message; only read when state === 'error'. */
  error: string | null;
  /**
   * Optional override of the body shown when the stream is open
   * but no text has arrived yet. Default is the animated
   * AIThinkingIndicator (shimmering skeleton lines + dots).
   * Pass null to omit the placeholder entirely.
   */
  pendingChild?: ReactNode | null;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

function NativeHelixMark({tone = 'accent'}: {tone?: 'accent' | 'danger'}) {
  const toneStyle = tone === 'danger' ? styles.helixDanger : styles.helixAccent;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.helixMark}>
      <View style={[styles.helixStrand, toneStyle, styles.helixStrandForward]} />
      <View
        style={[styles.helixStrand, toneStyle, styles.helixStrandBackward]}
      />
      <View style={[styles.helixRung, toneStyle, styles.helixRungTop]} />
      <View style={[styles.helixRung, toneStyle, styles.helixRungBottom]} />
    </View>
  );
}

function AIThinkingIndicator({label}: {label: string}) {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      style={styles.thinkingBlock}
      testID="ai-thinking-indicator">
      <View style={styles.thinkingRow}>
        <NativeHelixMark />
        <AppText style={styles.thinkingText} weight="semibold">
          {label}
        </AppText>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={styles.dotRow}>
          <View style={styles.thinkingDot} />
          <View style={styles.thinkingDot} />
          <View style={styles.thinkingDot} />
        </View>
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={styles.skeletonGroup}>
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
        <View style={[styles.skeletonLine, styles.skeletonLineShortest]} />
      </View>
    </View>
  );
}

function renderPendingChild(pendingChild: ReactNode): ReactNode {
  if (typeof pendingChild === 'string' || typeof pendingChild === 'number') {
    return <AppText style={styles.outputText}>{pendingChild}</AppText>;
  }

  return pendingChild;
}

export function AiOutputPanel({
  text,
  state,
  error,
  pendingChild,
}: AiOutputPanelProps): React.ReactElement | null {
  const t = useNativeTranslationFallback();
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
        <View
          accessibilityLabel={`${t('helix.errorLabel', 'Helix error:')} ${
            error ?? t('ai.common.errorUnknown', 'unknown')
          }`}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          accessible
          style={styles.errorRow}>
          <NativeHelixMark tone="danger" />
          <AppText style={styles.errorText}>
            <AppText style={styles.errorLabel} weight="semibold">
              {t('helix.errorLabel', 'Helix error:')}{' '}
            </AppText>
            {error ?? t('ai.common.errorUnknown', 'unknown')}
          </AppText>
        </View>
      ) : text.length === 0 && state === 'streaming' ? (
        pendingChild === undefined ? (
          <AIThinkingIndicator label={t('helix.thinking', 'Helix is thinking')} />
        ) : (
          renderPendingChild(pendingChild)
        )
      ) : (
        <AppText style={styles.outputText}>{text}</AppText>
      )}
    </View>
  );
}
AiOutputPanel.displayName = 'AiOutputPanel';

const styles = StyleSheet.create({
  dotRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 3,
  },
  errorLabel: {
    color: colors.danger,
  },
  errorRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    flex: 1,
    lineHeight: 20,
  },
  helixAccent: {
    backgroundColor: colors.accent,
  },
  helixDanger: {
    backgroundColor: colors.danger,
  },
  helixMark: {
    height: 14,
    position: 'relative',
    width: 14,
  },
  helixRung: {
    borderRadius: 999,
    height: 1.5,
    left: 4,
    opacity: 0.86,
    position: 'absolute',
    width: 6,
  },
  helixRungBottom: {
    bottom: 4,
  },
  helixRungTop: {
    top: 4,
  },
  helixStrand: {
    borderRadius: 999,
    height: 15,
    left: 6,
    position: 'absolute',
    top: -0.5,
    width: 1.75,
  },
  helixStrandBackward: {
    transform: [{rotate: '32deg'}],
  },
  helixStrandForward: {
    transform: [{rotate: '-32deg'}],
  },
  outputPanel: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.md,
  },
  outputText: {
    color: colors.textPrimary,
    lineHeight: 22,
  },
  skeletonGroup: {
    gap: spacing.sm,
  },
  skeletonLine: {
    backgroundColor: 'rgba(53, 213, 255, 0.16)',
    borderRadius: 8,
    height: 12,
    width: '100%',
  },
  skeletonLineShort: {
    width: '92%',
  },
  skeletonLineShortest: {
    width: '75%',
  },
  thinkingBlock: {
    gap: spacing.md,
  },
  thinkingDot: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: 4,
    opacity: 0.9,
    width: 4,
  },
  thinkingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  thinkingText: {
    color: colors.accent,
    lineHeight: 20,
  },
});

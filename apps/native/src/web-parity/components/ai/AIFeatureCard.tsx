// Native parity port of web/src/components/ai/AIFeatureCard.tsx.
//
// The web implementation centralises the Helix badge, Ask Helix CTA, optional
// input/children slots, and AiOutputPanel scaffold for AI feature cards. This
// native version preserves that public component contract with React Native
// primitives and native TeslaSync tokens.

import React, {useCallback, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {PremiumCard} from '../../../components/ui/PremiumCard';
import {colors, spacing} from '../../../theme/tokens';

export type AiStreamState =
  | 'idle'
  | 'streaming'
  | 'paused-confirm'
  | 'done'
  | 'error';

type NativeTFunction = (key: string, fallback: string) => string;

// AIFeatureStream is the narrow slice of useAiStream's result shape that
// AIFeatureCard reads. It intentionally omits cancel/limit fields so tests and
// native-only callsites can pass lightweight stream stubs.
export interface AIFeatureStream {
  state: AiStreamState;
  text: string;
  error: string | null;
  start: () => void;
}

export interface AIFeatureCardProps {
  title: string;
  description: string;
  buttonLabel: string;
  badgeLabel?: string;
  emptyHint?: string;
  buttonTitle?: string;
  buttonTestId?: string;
  canStart: boolean;
  stream: AIFeatureStream;
  onAction?: () => void;
  buttonPlacement?: 'inline' | 'below';
  inputSlot?: ReactNode;
  children?: ReactNode;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

function NativeHelixMark({streaming = false}: {streaming?: boolean}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.helixMark, streaming && styles.helixMarkStreaming]}>
      <View style={[styles.helixStrand, styles.helixStrandForward]} />
      <View style={[styles.helixStrand, styles.helixStrandBackward]} />
      <View style={[styles.helixRung, styles.helixRungTop]} />
      <View style={[styles.helixRung, styles.helixRungBottom]} />
    </View>
  );
}

function ThinkingDots({label}: {label: string}) {
  return (
    <View style={styles.thinkingDotsRoot}>
      <AppText style={styles.buttonText} weight="semibold">
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
  );
}

export function AIBadge({label}: {label?: string}) {
  const t = useNativeTranslationFallback();
  const text = label ?? t('helix.badge', 'Helix');

  return (
    <View
      accessible
      accessibilityHint={t(
        'helix.tooltip',
        'Helix is your AI assistant. It generates responses using your redacted fleet context.',
      )}
      accessibilityLabel={t('helix.ariaLabel', 'Helix')}
      style={styles.badge}>
      <NativeHelixMark />
      <AppText style={styles.badgeText} variant="caption" weight="semibold">
        {text}
      </AppText>
    </View>
  );
}
AIBadge.displayName = 'AIBadge';

function NativeHelixButton({
  label,
  accessibilityLabel,
  accessibilityHint,
  disabled,
  streaming,
  onPress,
  testID,
}: {
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  disabled: boolean;
  streaming: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({pressed}) => [
        styles.button,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <NativeHelixMark streaming={streaming} />
      {streaming ? (
        <ThinkingDots label={label} />
      ) : (
        <AppText style={styles.buttonText} weight="semibold">
          {label}
        </AppText>
      )}
    </Pressable>
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
        <NativeHelixMark streaming />
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
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
      <View style={[styles.skeletonLine, styles.skeletonLineShortest]} />
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
        <View style={styles.errorRow}>
          <NativeHelixMark />
          <AppText style={styles.errorText}>
            <AppText style={styles.errorLabel} weight="semibold">
              {t('helix.errorLabel', 'Helix error:')}{' '}
            </AppText>
            {error ?? t('ai.common.errorUnknown', 'unknown')}
          </AppText>
        </View>
      ) : text.length === 0 && state === 'streaming' ? (
        <AIThinkingIndicator label={t('helix.thinking', 'Helix is thinking')} />
      ) : (
        <AppText style={styles.outputText}>{text}</AppText>
      )}
    </View>
  );
}

export function AIFeatureCard({
  title,
  description,
  buttonLabel,
  badgeLabel,
  emptyHint,
  buttonTitle,
  buttonTestId,
  canStart,
  stream,
  onAction,
  buttonPlacement = 'inline',
  inputSlot,
  children,
}: AIFeatureCardProps) {
  const t = useNativeTranslationFallback();
  const isStreaming = stream.state === 'streaming';
  const buttonDisabled = !canStart || isStreaming;
  const effectivePlacement: 'inline' | 'below' = inputSlot
    ? 'below'
    : buttonPlacement;
  const askHelixLabel = t('helix.askHelix', 'Ask Helix');
  const thinkingLabel = t('helix.thinking', 'Helix is thinking...');

  const button = (
    <NativeHelixButton
      accessibilityHint={buttonTitle ?? buttonLabel}
      accessibilityLabel={`${askHelixLabel} - ${buttonLabel}`}
      disabled={buttonDisabled}
      label={isStreaming ? thinkingLabel : askHelixLabel}
      onPress={onAction ?? stream.start}
      streaming={isStreaming}
      testID={buttonTestId}
    />
  );

  return (
    <PremiumCard style={styles.card} tone="accent">
      <View
        style={
          effectivePlacement === 'inline'
            ? styles.headerRowInline
            : styles.headerRowBelow
        }>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <AppText style={styles.title} weight="semibold">
              {title}
            </AppText>
            <AIBadge label={badgeLabel} />
          </View>
          <AppText style={styles.description} tone="secondary">
            {description}
          </AppText>
          {!canStart && emptyHint ? (
            <AppText style={styles.emptyHint} tone="muted" variant="caption">
              {emptyHint}
            </AppText>
          ) : null}
        </View>
        {effectivePlacement === 'inline' ? button : null}
      </View>
      {inputSlot}
      {effectivePlacement === 'below' ? (
        <View style={styles.actionRow}>{button}</View>
      ) : null}
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
AIFeatureCard.displayName = 'AIFeatureCard';

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    color: colors.accent,
    lineHeight: 16,
  },
  button: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(53, 213, 255, 0.08)',
    borderColor: colors.borderAccent,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonText: {
    color: colors.textPrimary,
    lineHeight: 18,
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  description: {
    lineHeight: 20,
  },
  disabled: {
    opacity: 0.48,
  },
  dotRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 3,
  },
  emptyHint: {
    lineHeight: 18,
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
  headerRowBelow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerRowInline: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  helixMark: {
    height: 14,
    position: 'relative',
    width: 14,
  },
  helixMarkStreaming: {
    opacity: 0.78,
  },
  helixRung: {
    backgroundColor: colors.accent,
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
    backgroundColor: colors.accent,
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
  pressed: {
    opacity: 0.82,
  },
  skeletonLine: {
    backgroundColor: 'rgba(53, 213, 255, 0.16)',
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
  thinkingBlock: {
    gap: spacing.sm,
  },
  thinkingDot: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: 4,
    opacity: 0.9,
    width: 4,
  },
  thinkingDotsRoot: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
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
  title: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 22,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});

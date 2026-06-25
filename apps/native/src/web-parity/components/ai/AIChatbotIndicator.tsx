// Native parity port of web/src/components/ai/AIChatbotIndicator.tsx.
// The chatbot stream is owned by the Chatbot page; this badge only marks LLM mode.

import React, {useCallback, type ComponentType} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {AI_FEATURES, type AiFeatureId} from '../../ai/features';
import {useSettings} from '../../api/hooks/useSettings';

type NativeTFunction = (key: string, fallback: string) => string;

const FEATURE_ID: AiFeatureId = 'chatbot-llm';

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

function NativeHelixMark() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.helixMark}>
      <View style={[styles.helixStrand, styles.helixStrandForward]} />
      <View style={[styles.helixStrand, styles.helixStrandBackward]} />
      <View style={[styles.helixRung, styles.helixRungTop]} />
      <View style={[styles.helixRung, styles.helixRungBottom]} />
    </View>
  );
}

function InnerIndicator() {
  const t = useNativeTranslationFallback();
  const tooltip = t(
    'helix.tooltip',
    'Helix is your AI assistant. It generates responses using your redacted fleet context.',
  );
  const label = t('helix.ariaLabel', 'Helix');
  const badge = t('helix.badge', 'Helix');

  return (
    <View
      accessible
      accessibilityHint={tooltip}
      accessibilityLabel={label}
      style={styles.badge}>
      <NativeHelixMark />
      <AppText style={styles.badgeText} variant="caption" weight="semibold">
        {badge}
      </AppText>
    </View>
  );
}

InnerIndicator.displayName = 'InnerIndicator';

export const AIChatbotIndicator = withAiFeature(FEATURE_ID, InnerIndicator);
AIChatbotIndicator.displayName = 'AIChatbotIndicator';

const styles = StyleSheet.create({
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
  helixMark: {
    height: 14,
    position: 'relative',
    width: 14,
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
  helixStrandForward: {
    transform: [{rotate: '-32deg'}],
  },
  helixStrandBackward: {
    transform: [{rotate: '32deg'}],
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
  helixRungTop: {
    top: 4,
  },
  helixRungBottom: {
    bottom: 4,
  },
});

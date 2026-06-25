// Native parity port of web/src/components/ai/withAiFeature.tsx.
//
// React Native cannot carry DOM data-* attributes, so the AI feature marker is
// preserved with testID, nativeID, and an accessibility label.

import React, {type ComponentType} from 'react';
import {View} from 'react-native';

import {AI_FEATURES, type AiFeatureId} from '../../ai/features';
import {useSettings} from '../../api/hooks/useSettings';

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

export function withAiFeature<P extends object>(
  feature: AiFeatureId,
  Inner: ComponentType<P>,
): ComponentType<P> {
  if (!AI_FEATURES[feature]) {
    throw new Error(
      `withAiFeature: unknown AI feature id ${JSON.stringify(feature)}. ` +
        'Add it to internal/ai/features/registry.go and run `make generate`.',
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
        collapsable={false}
        nativeID={`ai-feature-${feature}`}
        testID={meta.uiTestIds[0] ?? `ai-feature-${feature}`}>
        <Inner {...props} />
      </View>
    );
  };

  Wrapped.displayName = `withAiFeature(${feature}, ${innerName})`;
  return Wrapped;
}

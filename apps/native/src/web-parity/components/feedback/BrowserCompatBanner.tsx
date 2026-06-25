// Native parity port of web/src/components/feedback/BrowserCompatBanner.tsx.
//
// The web banner warns when the host BROWSER lacks required web-platform
// features (BroadcastChannel, ResizeObserver, Intl.RelativeTimeFormat,
// CSS :has(), structuredClone). React Native has no browser, so live feature
// detection is not applicable -- the native-safe detector reports nothing
// missing and the banner stays hidden in production, which matches the web
// behavior on supported browsers. The testHookMissing seam, full warning UI,
// `missing`/`dismissed` state, dismissal flow, i18n keys, and copy are all
// preserved so behavioral parity and specs still hold. localStorage is
// unavailable in native; dismissal persists in-process and resets on app
// restart -- the same documented fallback the web helper uses under Safari
// private mode / quota errors.

import React, {useCallback, useEffect, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {PremiumCard} from '../../../components/ui/PremiumCard';
import {colors, spacing} from '../../../theme/tokens';

type NativeTOptions = Record<string, string>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

const RECOMMENDED_BROWSERS_FALLBACK =
  'Use Chrome ≥ 110, Edge ≥ 110, Firefox ≥ 109, or Safari ≥ 16.';

// localStorage is unavailable in React Native; the web helper's versioned
// storage key (`teslasync:compat-warning-dismissed:v1`) has no native
// equivalent, so dismissal is tracked in-process and resets on app restart.
let compatWarningDismissed = false;

// Browser feature detection is not applicable to a native runtime -- the app
// owns its JS engine, so none of the web-platform features the web helper
// probes can be "missing". Returns [] to keep the banner hidden in production
// while the testHookMissing seam still drives the warning UI in specs.
function detectMissingFeatures(): string[] {
  return [];
}

function isCompatWarningDismissed(): boolean {
  return compatWarningDismissed;
}

function dismissCompatWarning(): void {
  compatWarningDismissed = true;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.entries(options).reduce(
        (text, [token, value]) => text.split(`{{${token}}}`).join(value),
        fallback,
      );
    },
    [],
  );
}

export interface BrowserCompatBannerProps {
  /**
   * Test seam -- overrides the live detection result so spec files can
   * exercise the rendered output without monkey-patching globals.
   * Production callers never set this.
   */
  testHookMissing?: string[];
}

export function BrowserCompatBanner({
  testHookMissing,
}: BrowserCompatBannerProps = {}) {
  const t = useNativeTranslationFallback();

  const [missing, setMissing] = useState<string[]>(
    () => testHookMissing ?? detectMissingFeatures(),
  );
  const [dismissed, setDismissed] = useState<boolean>(() =>
    isCompatWarningDismissed(),
  );

  // Re-detect when the test seam changes -- production callers never pass it
  // so this effect is a no-op outside specs.
  useEffect(() => {
    if (testHookMissing) {
      setMissing(testHookMissing);
    }
  }, [testHookMissing]);

  const handleDismiss = useCallback(() => {
    dismissCompatWarning();
    setDismissed(true);
  }, []);

  if (dismissed || missing.length === 0) {
    return null;
  }

  const featureList = missing.join(', ');
  const title = t(
    'compat.banner.title',
    'Your browser is missing required features',
  );
  const body = t(
    'compat.banner.body',
    'TeslaSync needs {{features}} to work correctly. {{recommendation}}',
    {features: featureList, recommendation: RECOMMENDED_BROWSERS_FALLBACK},
  );
  const dismissLabel = t('compat.banner.dismiss', 'Dismiss');

  return (
    <View
      accessibilityHint={`Missing browser features: ${featureList}`}
      accessibilityLiveRegion="polite"
      accessible
      style={styles.container}
      testID="browser-compat-banner">
      <PremiumCard style={styles.card} tone="warning">
        <View style={styles.headerRow}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.iconBadge}>
            <AppText style={styles.iconGlyph} weight="bold">
              !
            </AppText>
          </View>
          <View style={styles.textGroup}>
            <AppText style={styles.title} weight="semibold">
              {title}
            </AppText>
            <AppText
              style={styles.body}
              testID="browser-compat-banner-body"
              tone="secondary">
              {body}
            </AppText>
          </View>
          <Pressable
            accessibilityLabel={dismissLabel}
            accessibilityRole="button"
            onPress={handleDismiss}
            style={({pressed}) => [
              styles.dismissButton,
              pressed && styles.pressed,
            ]}
            testID="browser-compat-banner-dismiss">
            <AppText style={styles.dismissGlyph} weight="bold">
              x
            </AppText>
          </Pressable>
        </View>
      </PremiumCard>
    </View>
  );
}

BrowserCompatBanner.displayName = 'BrowserCompatBanner';

const styles = StyleSheet.create({
  body: {
    lineHeight: 20,
  },
  card: {
    gap: spacing.sm,
  },
  container: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dismissButton: {
    alignItems: 'center',
    borderColor: colors.warningBorder,
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  dismissGlyph: {
    color: colors.warning,
    lineHeight: 18,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  iconBadge: {
    alignItems: 'center',
    borderColor: colors.warningBorder,
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    marginTop: 2,
    width: 28,
  },
  iconGlyph: {
    color: colors.warning,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.82,
  },
  textGroup: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    color: colors.warning,
    lineHeight: 22,
  },
});

export default BrowserCompatBanner;

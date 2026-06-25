// Native parity port of web/src/components/ai/AiLimitBanner.tsx.
//
// Presents terminal AI rate-limit and cost-cap failures while preserving the
// baseline fallback and retry countdown contract from the web banner.

import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {PremiumCard} from '../../../components/ui/PremiumCard';
import {colors, spacing} from '../../../theme/tokens';

type BannerVariant = 'info' | 'warning' | 'danger';
type BannerTone = 'accent' | 'warning' | 'danger';
type BannerLevel = 'warn' | 'critical' | '';

type NativeTOptions = {
  defaultValue?: string;
  seconds?: number;
};

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

export interface AiLimitInfo {
  reason: string;
  retryAfterS: number;
  bannerLevel: BannerLevel;
  baselineAvailable: boolean;
  message: string;
}

export interface AiLimitBannerProps {
  info: AiLimitInfo | null;
  onRetry?: () => void;
  onUseBaseline?: () => void;
  onDismiss?: () => void;
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) =>
      options?.defaultValue ?? fallback,
    [],
  );
}

export function AiLimitBanner({
  info,
  onRetry,
  onUseBaseline,
  onDismiss,
}: AiLimitBannerProps) {
  const t = useNativeTranslationFallback();
  const [secondsLeft, setSecondsLeft] = useState<number>(
    info?.retryAfterS ?? 0,
  );

  useEffect(() => {
    if (!info) {
      return;
    }

    setSecondsLeft(info.retryAfterS);
    if (info.retryAfterS <= 0) {
      return;
    }

    const id = setInterval(() => {
      setSecondsLeft(current => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => clearInterval(id);
  }, [info]);

  if (!info) {
    return null;
  }

  const variant: BannerVariant =
    info.bannerLevel === 'critical'
      ? 'danger'
      : info.bannerLevel === 'warn'
        ? 'warning'
        : 'info';
  const title = titleForReason(t, info.reason);
  const description = descriptionForReason(t, info.reason);
  const retryReady = secondsLeft <= 0;
  const tone = toneForVariant(variant);

  return (
    <PremiumCard
      style={[styles.card, variantStyles[variant]]}
      testID="ai-limit-banner"
      tone={tone}>
      <View
        accessibilityHint={`AI limit reason: ${info.reason}`}
        accessibilityLabel={title}
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        accessible
        style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <AppText style={[styles.title, textStyles[variant]]} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.description} tone="secondary">
            {description}
          </AppText>
        </View>
        {onDismiss ? (
          <Pressable
            accessibilityLabel={t('ai.limit.dismiss', 'Dismiss')}
            accessibilityRole="button"
            onPress={onDismiss}
            style={({pressed}) => [
              styles.dismissButton,
              pressed && styles.pressed,
            ]}
            testID="ai-limit-banner-dismiss">
            <AppText style={styles.dismissText} weight="bold">
              x
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {!retryReady ? (
        <AppText
          accessibilityLiveRegion="polite"
          style={styles.retryText}
          tone="secondary">
          {t('ai.limit.retryIn', `Try again in ${secondsLeft}s`, {
            seconds: secondsLeft,
            defaultValue: `Try again in ${secondsLeft}s`,
          })}
        </AppText>
      ) : null}

      <View style={styles.actionRow}>
        {onUseBaseline && info.baselineAvailable ? (
          <BannerAction
            label={t('ai.limit.useBaseline', 'Use baseline')}
            onPress={onUseBaseline}
            testID="ai-limit-banner-baseline"
            variant="ghost"
          />
        ) : null}
        {onRetry && retryReady ? (
          <BannerAction
            label={t('ai.limit.retry', 'Retry')}
            onPress={onRetry}
            testID="ai-limit-banner-retry"
            variant="primary"
          />
        ) : null}
      </View>
    </PremiumCard>
  );
}

function BannerAction({
  label,
  onPress,
  testID,
  variant,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'ghost' | 'primary';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.actionButton,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      <AppText
        style={
          variant === 'primary' ? styles.primaryButtonText : styles.ghostButtonText
        }
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

function toneForVariant(variant: BannerVariant): BannerTone {
  switch (variant) {
    case 'danger':
      return 'danger';
    case 'warning':
      return 'warning';
    default:
      return 'accent';
  }
}

function titleForReason(t: NativeTFunction, reason: string): string {
  switch (reason) {
    case 'cost_cap':
      return t('ai.limit.title.costCap', 'Daily cost cap reached');
    case 'cost_cap_unavailable':
      return t(
        'ai.limit.title.costCapUnavailable',
        'Cost cap check unavailable',
      );
    case 'settings_unavailable':
      return t(
        'ai.limit.title.settingsUnavailable',
        'Helix settings unavailable',
      );
    case 'burst':
      return t('ai.limit.title.burst', 'Too many Helix requests at once');
    case 'per_minute':
      return t('ai.limit.title.perMinute', 'Helix rate limit hit');
    case 'per_day':
      return t('ai.limit.title.perDay', 'Daily Helix usage limit reached');
    case 'input_tokens':
    case 'output_tokens':
      return t('ai.limit.title.tokens', 'Helix token quota exhausted');
    case 'provider_unavailable':
      return t(
        'ai.limit.title.providerUnavailable',
        'Helix provider unavailable',
      );
    case 'missing_feature_id':
    case 'unknown_feature_id':
      return t(
        'ai.limit.title.featureMisconfigured',
        'Helix feature misconfigured',
      );
    default:
      return t('ai.limit.title.generic', 'Helix temporarily unavailable');
  }
}

function descriptionForReason(t: NativeTFunction, reason: string): string {
  switch (reason) {
    case 'cost_cap':
      return t(
        'ai.limit.desc.costCap',
        'You have reached your daily Helix cost limit. Helix features will resume tomorrow or after you raise the cap in Settings.',
      );
    case 'cost_cap_unavailable':
      return t(
        'ai.limit.desc.costCapUnavailable',
        'Could not read your Helix usage history. Failing closed for safety.',
      );
    case 'settings_unavailable':
      return t(
        'ai.limit.desc.settingsUnavailable',
        'Could not load your Helix settings. Helix is paused until settings are reachable.',
      );
    case 'burst':
      return t(
        'ai.limit.desc.burst',
        'Too many Helix requests are in flight. The limiter is keeping the system responsive.',
      );
    case 'per_minute':
      return t(
        'ai.limit.desc.perMinute',
        'You have sent more Helix requests than allowed per minute. The window resets shortly.',
      );
    case 'per_day':
      return t(
        'ai.limit.desc.perDay',
        'You have used your daily Helix request budget. The budget resets at UTC midnight.',
      );
    case 'input_tokens':
    case 'output_tokens':
      return t(
        'ai.limit.desc.tokens',
        'Your Helix token quota for this minute is exhausted. Try a shorter prompt.',
      );
    case 'provider_unavailable':
      return t(
        'ai.limit.desc.providerUnavailable',
        'The Helix provider is not responding. The system will retry automatically.',
      );
    case 'missing_feature_id':
    case 'unknown_feature_id':
      return t(
        'ai.limit.desc.featureMisconfigured',
        'This page is missing a Helix feature registration. Please report this to your administrator.',
      );
    default:
      return t(
        'ai.limit.desc.generic',
        'Helix features are temporarily unavailable. The non-Helix baseline continues to work.',
      );
  }
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  description: {
    lineHeight: 21,
  },
  dismissButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  dismissText: {
    color: colors.textSecondary,
    lineHeight: 18,
  },
  ghostButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  ghostButtonText: {
    color: colors.textPrimary,
    lineHeight: 18,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderColor: colors.borderAccent,
  },
  primaryButtonText: {
    color: colors.background,
    lineHeight: 18,
  },
  retryText: {
    lineHeight: 20,
  },
  title: {
    lineHeight: 22,
  },
  titleGroup: {
    flex: 1,
    gap: spacing.xs,
  },
});

const variantStyles = StyleSheet.create<Record<BannerVariant, ViewStyle>>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const textStyles = StyleSheet.create<Record<BannerVariant, TextStyle>>({
  danger: {
    color: colors.danger,
  },
  info: {
    color: colors.accent,
  },
  warning: {
    color: colors.warning,
  },
});

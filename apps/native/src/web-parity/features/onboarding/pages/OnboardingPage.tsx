// OnboardingPage — native parity port of
// web/src/features/onboarding/pages/OnboardingPage.tsx.
//
// Dedicated first-run experience shown when any of the three setup anchors are
// missing (web doc comment L15-28). Walks the user through:
//   1. Connecting their Tesla account (Settings -> Tesla account).
//   2. Waiting for vehicles to sync from the Fleet API.
//   3. Waiting for the first telemetry batch to arrive.
// The page is intentionally self-contained — it does NOT pull in the vehicle
// picker context — so it works on a fresh install where no vehicles or signals
// exist yet. Every state name (teslaConnected, vehicleCount, dataFlowing,
// isComplete, steps, skip), the `/onboarding/status` data contract, every i18n
// key + English fallback, the 30s polling copy, and the three-step CTA branching
// (to / onClick-refetch / href-docs) are preserved verbatim from the web source.
//
// Native adaptations vs. the web source (behaviour / state / keys / API kept):
//   - react-i18next useTranslation (web L2) -> a native-safe t(key, fallback)
//     fallback preserving every onboarding.* key + English default (no i18n
//     runtime in this RN layer).
//   - react-router-dom useNavigate + Link (web L3) -> a native navigate(path)
//     that routes through an optional onNavigate navigation-shell callback (RN
//     has no react-router DOM history); the '/tesla-account', '/', '/docs/' and
//     '/docs/fleet-telemetry-setup' targets are preserved. The web <a
//     target="_blank"> docs anchors (which open a new browser tab) also route
//     through onNavigate — RN has no browser tab — preserving path + affordance.
//   - lucide-react Sparkles/RefreshCw/ArrowRight/BookOpen/ExternalLink/
//     SkipForward (web L4) -> SemanticIcon glyphs (sparkles/refresh/forward/
//     fileText/externalLink/skipForward); the spinning RefreshCw (animate-spin
//     while isFetching) becomes a native ActivityIndicator, and the Stepper's
//     spinning Loader2 "current step" indicator becomes an ActivityIndicator.
//   - @/components/layout PageContainer (web L6) -> an inline RN PageContainer
//     (ScrollView header: title + subtitle; `loading` swaps the body for a
//     centered ActivityIndicator exactly as the web Spinner did).
//   - @/components/ui GlassPanel + Button (web L7) -> the canonical native
//     GlassPanel + an inline native Button reproducing the web variant
//     (primary/outline/ghost) + size="sm" + leading/trailing icon + disabled
//     contract.
//   - @/components/motion FadeIn (web L8, framer-motion) -> an inline
//     reduced-motion-aware Animated FadeIn.
//   - @/hooks/usePageTitle (web L9) -> a native-safe no-op (RN has no
//     document.title); the call site + 'onboarding.pageTitle' argument kept.
//   - @/api/hooks/useOnboarding useOnboardingStatus (web L10) -> the native
//     ../../../api/hooks/useOnboarding useOnboardingStatus (same
//     /onboarding/status query + 30s refetchInterval + is_complete gate).
//   - ../components/Stepper + OnboardingStep type (web L12, not yet converted)
//     -> inline-ported in full (stateOf done/current/pending logic, vertical
//     indicator + connector, per-state title/description tones, renderCta
//     render-prop) following the self-contained-page precedent in this repo.
//   - ../hooks/useOnboardingSkip (web L13, not yet converted) -> inline-ported
//     native-safe. The web hook persists the "skip wizard" choice in
//     window.localStorage and syncs it across browser tabs via BroadcastChannel
//     + the storage event; React Native has neither, so the native port keeps an
//     in-process useSyncExternalStore store with the same isSkipped/skip/unskip
//     contract (persistence + cross-tab sync are browser-only and documented).
//     The STORAGE_KEY 'teslasync:onboarding:skipped:v1' is preserved for parity.
//
// No DOM / react-router / react-i18next / lucide / Recharts / Leaflet /
// framer-motion / old web-UI import reaches the native output — only react,
// react-native primitives, @tanstack/react-query (via the native hook), the
// canonical AppText/GlassPanel/SemanticIcon + theme tokens.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useOnboardingStatus} from '../../../api/hooks/useOnboarding';

// ─── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ─── Native-safe usePageTitle (web @/hooks/usePageTitle) ──────────────────────

/**
 * Web `usePageTitle` writes `"{title} — TeslaSync"` to `document.title`. React
 * Native has no browser tab / document title, so this is a no-op that preserves
 * the call site + argument.
 */
function usePageTitle(_title: string): void {
  // Intentional native-safe no-op — see doc comment above.
}

// ─── Native navigate (web react-router-dom useNavigate) ───────────────────────

/**
 * The web page navigates with react-router-dom's `useNavigate()`. React Native
 * has no DOM history, so navigation routes through an optional
 * navigation-shell callback supplied by the screen host; absent a host the
 * navigate call is a documented no-op preserving the target path + affordance.
 */
function useNativeNavigate(
  onNavigate?: (path: string) => void,
): (path: string) => void {
  return useCallback(
    (path: string) => {
      onNavigate?.(path);
    },
    [onNavigate],
  );
}

// ─── Native-safe useOnboardingSkip (web ../hooks/useOnboardingSkip) ───────────

/**
 * Web parity key — preserved for reference. The web hook persists the operator's
 * "skip wizard" choice under this localStorage key and broadcasts changes across
 * browser tabs. React Native has no localStorage and no notion of sibling tabs,
 * so the native port keeps the value in an in-process store with the identical
 * isSkipped/skip/unskip contract (persistence + cross-tab sync are browser-only).
 */
const ONBOARDING_SKIP_STORAGE_KEY = 'teslasync:onboarding:skipped:v1';

const skipListeners = new Set<() => void>();
let skipSnapshot = false;

function notifySkip(): void {
  skipListeners.forEach(cb => {
    try {
      cb();
    } catch {
      // Swallow listener errors — one bad listener must not block the rest.
    }
  });
}

function setSkippedNative(value: boolean): void {
  if (skipSnapshot === value) {
    return;
  }
  skipSnapshot = value;
  notifySkip();
}

function subscribeSkip(cb: () => void): () => void {
  skipListeners.add(cb);
  return () => {
    skipListeners.delete(cb);
  };
}

function getSkipSnapshot(): boolean {
  return skipSnapshot;
}

interface UseOnboardingSkip {
  isSkipped: boolean;
  skip: () => void;
  unskip: () => void;
}

function useOnboardingSkip(): UseOnboardingSkip {
  const isSkipped = useSyncExternalStore(
    subscribeSkip,
    getSkipSnapshot,
    getSkipSnapshot,
  );
  const skip = useCallback(() => {
    setSkippedNative(true);
  }, []);
  const unskip = useCallback(() => {
    setSkippedNative(false);
  }, []);
  return {isSkipped, skip, unskip};
}

// ─── OnboardingStep type + Stepper (web ../components/Stepper) ─────────────────

interface OnboardingStep {
  /** Stable key — used as React key and for screen-reader id. */
  key: string;
  /** Localized title shown next to the indicator. */
  title: string;
  /** Localized supporting copy explaining the step. */
  description: string;
  /** True once the underlying anchor is satisfied. */
  done: boolean;
  /** Optional CTA rendered while the step is in-progress. */
  cta?: {
    label: string;
    onClick?: () => void;
    href?: string;
    to?: string;
    /** Disables the button while a parent action is pending. */
    disabled?: boolean;
  };
  /** Optional icon override; defaults to a numeric circle. */
  icon?: ReactNode;
}

type StepState = 'done' | 'current' | 'pending';

function stateOf(steps: OnboardingStep[], index: number): StepState {
  if (steps[index].done) {
    return 'done';
  }
  // The "current" step is the first not-done step. Subsequent not-done steps
  // stay pending so the user follows the flow.
  const firstPending = steps.findIndex(s => !s.done);
  return firstPending === index ? 'current' : 'pending';
}

const indicatorStateStyles: Record<StepState, ViewStyle> = {
  current: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  done: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  pending: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
};

const titleToneOf: Record<StepState, 'primary' | 'secondary'> = {
  current: 'primary',
  done: 'primary',
  pending: 'secondary',
};

const descriptionToneOf: Record<StepState, 'secondary' | 'muted'> = {
  current: 'secondary',
  done: 'secondary',
  pending: 'muted',
};

function StepIndicator({
  state,
  index,
}: {
  state: StepState;
  index: number;
}): React.ReactElement {
  return (
    <View style={[styles.indicator, indicatorStateStyles[state]]}>
      {state === 'done' ? (
        <AppText style={styles.indicatorDoneGlyph} weight="bold">
          ✓
        </AppText>
      ) : state === 'current' ? (
        <ActivityIndicator color={colors.accent} size="small" />
      ) : (
        <AppText style={styles.indicatorPendingGlyph} weight="semibold">
          {index + 1}
        </AppText>
      )}
    </View>
  );
}

interface StepperProps {
  steps: OnboardingStep[];
  /** Render-prop hook so the page can wrap CTAs in navigation/links. */
  renderCta?: (step: OnboardingStep) => ReactNode;
}

function Stepper({steps, renderCta}: StepperProps): React.ReactElement {
  return (
    <View accessibilityLabel="Onboarding steps" style={styles.stepperList}>
      {steps.map((step, idx) => {
        const state = stateOf(steps, idx);
        const showCta = state === 'current' && step.cta;
        const isLast = idx === steps.length - 1;
        return (
          <View key={step.key} style={styles.stepRow}>
            <View style={styles.stepIndicatorCol}>
              <StepIndicator index={idx} state={state} />
              {!isLast ? (
                <View
                  style={[
                    styles.connector,
                    state === 'done'
                      ? styles.connectorDone
                      : styles.connectorDefault,
                  ]}
                />
              ) : null}
            </View>

            <View style={styles.stepBody}>
              <AppText
                style={styles.stepTitle}
                tone={titleToneOf[state]}
                weight="semibold">
                {step.title}
              </AppText>
              <AppText
                style={styles.stepDescription}
                tone={descriptionToneOf[state]}>
                {step.description}
              </AppText>
              {showCta ? (
                <View style={styles.stepCta}>{renderCta?.(step)}</View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Inline Button (web @/components/ui Button) ───────────────────────────────

type ButtonVariant = 'primary' | 'outline' | 'ghost';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  accessibilityHint?: string;
}

function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  leadingIcon,
  trailingIcon,
  accessibilityHint,
}: ButtonProps): React.ReactElement {
  const labelStyle =
    variant === 'primary' ? styles.buttonLabelPrimary : styles.buttonLabel;
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary'
          ? styles.buttonPrimary
          : variant === 'outline'
          ? styles.buttonOutline
          : styles.buttonGhost,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      <View style={styles.buttonContent}>
        {leadingIcon}
        <AppText style={labelStyle} variant="caption" weight="semibold">
          {label}
        </AppText>
        {trailingIcon}
      </View>
    </Pressable>
  );
}

// ─── Inline FadeIn (web @/components/motion FadeIn — framer-motion) ────────────

function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(reduce => {
        if (cancelled) {
          return;
        }
        if (reduce) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          duration: 320,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => progress.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [progress]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

// ─── Inline PageContainer (web @/components/layout PageContainer) ──────────────

function PageContainer({
  title,
  subtitle,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}>
      <View style={styles.pageHeader}>
        <AppText style={styles.pageTitle} variant="display" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

// ─── Page (web L29-255) ───────────────────────────────────────────────────────

interface OnboardingPageProps {
  /** Navigation-shell callback (web react-router-dom useNavigate / Link). */
  onNavigate?: (path: string) => void;
}

/**
 * OnboardingPage — dedicated first-run experience shown when any of the three
 * setup anchors (tesla_connected / vehicle_count / data_flowing) are missing.
 */
export default function OnboardingPage({
  onNavigate,
}: OnboardingPageProps = {}): React.ReactElement {
  const t = useNativeTranslationFallback();
  usePageTitle(t('onboarding.pageTitle', 'Welcome to TeslaSync'));
  const navigate = useNativeNavigate(onNavigate);
  const {data, isLoading, refetch, isFetching} = useOnboardingStatus();
  const {skip} = useOnboardingSkip();

  const teslaConnected = data?.tesla_connected ?? false;
  const vehicleCount = data?.vehicle_count ?? 0;
  const dataFlowing = data?.data_flowing ?? false;
  const isComplete = data?.is_complete ?? false;

  const steps = useMemo<OnboardingStep[]>(
    () => [
      {
        key: 'tesla',
        title: t('onboarding.tesla.title', 'Connect your Tesla account'),
        description: t(
          'onboarding.tesla.desc',
          'TeslaSync needs Fleet API access to read vehicle data. Sign in with your Tesla account to authorize the connection.',
        ),
        done: teslaConnected,
        cta: {
          label: t('onboarding.tesla.cta', 'Connect Tesla account'),
          to: '/tesla-account',
        },
      },
      {
        key: 'vehicle',
        title: t('onboarding.vehicle.title', 'Wait for vehicles to appear'),
        description: t(
          'onboarding.vehicle.desc',
          'Vehicles linked to your Tesla account will sync automatically. This usually takes less than a minute after connecting.',
        ),
        done: vehicleCount > 0,
        cta: {
          label: isFetching
            ? t('onboarding.vehicle.checking', 'Checking…')
            : t('onboarding.vehicle.cta', 'Refresh'),
          onClick: () => {
            void refetch();
          },
          disabled: isFetching,
        },
      },
      {
        key: 'telemetry',
        title: t('onboarding.telemetry.title', 'Wait for telemetry data'),
        description: t(
          'onboarding.telemetry.desc',
          'Once your vehicle uploads its first signal batch (usually within 5 minutes of driving), live data will appear across the app. See the Fleet Telemetry setup guide if it does not arrive.',
        ),
        done: dataFlowing,
        cta: {
          label: t('onboarding.telemetry.docs', 'Setup guide'),
          href: '/docs/fleet-telemetry-setup',
        },
      },
    ],
    [teslaConnected, vehicleCount, dataFlowing, refetch, isFetching, t],
  );

  return (
    <PageContainer
      loading={isLoading}
      subtitle={t(
        'onboarding.subtitle',
        'Three quick steps before your dashboard is ready.',
      )}
      title={t('onboarding.welcome', 'Welcome to TeslaSync')}>
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.introRow}>
            <SemanticIcon decorative name="sparkles" size="md" />
            <View style={styles.introText}>
              <AppText style={styles.introTitle} weight="semibold">
                {t('onboarding.intro.title', 'Setup checklist')}
              </AppText>
              <AppText style={styles.introDescription} tone="secondary">
                {t(
                  'onboarding.intro.desc',
                  'TeslaSync runs entirely on your hardware. No data leaves your install, and you can revisit this page from Settings any time.',
                )}
              </AppText>
            </View>
          </View>

          <Stepper
            renderCta={step => {
              const cta = step.cta;
              if (!cta) {
                return null;
              }
              if (cta.to) {
                const to = cta.to;
                return (
                  <Button
                    label={cta.label}
                    leadingIcon={
                      <SemanticIcon decorative name="forward" size="sm" />
                    }
                    onPress={() => navigate(to)}
                    variant="primary"
                  />
                );
              }
              if (cta.href) {
                const href = cta.href;
                return (
                  <Button
                    label={cta.label}
                    leadingIcon={
                      <SemanticIcon decorative name="fileText" size="sm" />
                    }
                    onPress={() => navigate(href)}
                    trailingIcon={
                      <SemanticIcon decorative name="externalLink" size="sm" />
                    }
                    variant="outline"
                  />
                );
              }
              return (
                <Button
                  disabled={cta.disabled}
                  label={cta.label}
                  leadingIcon={
                    isFetching ? (
                      <ActivityIndicator color={colors.accent} size="small" />
                    ) : (
                      <SemanticIcon decorative name="refresh" size="sm" />
                    )
                  }
                  onPress={cta.onClick}
                  variant="outline"
                />
              );
            }}
            steps={steps}
          />

          <View style={styles.footer}>
            <AppText style={styles.footerStatus} tone="secondary">
              {isComplete
                ? t(
                    'onboarding.ready',
                    'You are all set — your dashboard is ready.',
                  )
                : t(
                    'onboarding.polling',
                    'This page refreshes automatically every 30 seconds.',
                  )}
            </AppText>
            <View style={styles.footerActions}>
              <Button
                disabled={isFetching}
                label={t('onboarding.checkAgain', 'Check again')}
                leadingIcon={
                  isFetching ? (
                    <ActivityIndicator color={colors.accent} size="small" />
                  ) : (
                    <SemanticIcon decorative name="refresh" size="sm" />
                  )
                }
                onPress={() => {
                  void refetch();
                }}
                variant="ghost"
              />
              {!isComplete ? (
                <Button
                  accessibilityHint={t(
                    'onboarding.skipHint',
                    'Explore the app — you can finish setup later from this page.',
                  )}
                  label={t('onboarding.skip', 'Skip for now')}
                  leadingIcon={
                    <SemanticIcon decorative name="skipForward" size="sm" />
                  }
                  onPress={() => {
                    skip();
                    navigate('/');
                  }}
                  variant="outline"
                />
              ) : null}
              {isComplete ? (
                <Button
                  label={t('onboarding.continue', 'Continue to dashboard')}
                  leadingIcon={
                    <SemanticIcon decorative name="forward" size="sm" />
                  }
                  onPress={() => navigate('/')}
                  variant="primary"
                />
              ) : null}
            </View>
          </View>

          <AppText style={styles.helpText} tone="muted" variant="caption">
            {t('onboarding.footer.help', 'Need help? See the')}{' '}
            <AppText
              onPress={() => navigate('/tesla-account')}
              style={styles.inlineLink}
              variant="caption">
              {t('onboarding.footer.account', 'Tesla account page')}
            </AppText>
            {t('onboarding.footer.or', ' or the ')}
            <AppText
              onPress={() => navigate('/docs/')}
              style={styles.inlineLink}
              variant="caption">
              {t('onboarding.footer.docs', 'documentation')}
            </AppText>
            .
          </AppText>
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

// Re-exported for parity with the web ../components/Stepper module surface so
// downstream native screens can compose the same step list shape.
export type {OnboardingStep};
export {ONBOARDING_SKIP_STORAGE_KEY};

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buttonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonLabel: {
    color: colors.textPrimary,
  },
  buttonLabelPrimary: {
    color: colors.background,
  },
  buttonOutline: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  connector: {
    flex: 1,
    marginTop: spacing.xs,
    minHeight: 28,
    width: 1,
  },
  connectorDefault: {
    backgroundColor: colors.border,
  },
  connectorDone: {
    backgroundColor: colors.successBorder,
  },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
  },
  footerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  footerStatus: {
    maxWidth: 520,
  },
  helpText: {
    marginTop: spacing.lg,
  },
  indicator: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  indicatorDoneGlyph: {
    color: colors.success,
  },
  indicatorPendingGlyph: {
    color: colors.textMuted,
  },
  inlineLink: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  introDescription: {
    marginTop: spacing.xs,
  },
  introRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  introText: {
    flex: 1,
  },
  introTitle: {
    color: colors.textPrimary,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  pageHeader: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  pageSubtitle: {
    maxWidth: 520,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    overflow: 'hidden',
    padding: spacing.xl,
  },
  scroll: {
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  stepBody: {
    flex: 1,
    paddingBottom: spacing.xs,
  },
  stepCta: {
    alignItems: 'flex-start',
    marginTop: spacing.md,
  },
  stepDescription: {
    marginTop: spacing.xs,
  },
  stepIndicatorCol: {
    alignItems: 'center',
  },
  stepRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stepTitle: {
    fontSize: 16,
  },
  stepperList: {
    gap: spacing.lg,
  },
});

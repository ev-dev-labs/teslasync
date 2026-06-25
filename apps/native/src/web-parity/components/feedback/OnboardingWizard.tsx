// Native parity port of web/src/components/feedback/OnboardingWizard.tsx.
//
// A first-run, four-step welcome wizard. On mount it checks a persisted
// "onboarded" flag and, when absent, surfaces a centered modal after a short
// settle delay so the rest of the app paints first and the user can still reach
// navigation. The user steps through Welcome -> Connect -> Configure -> Done
// (or Skip); finishing or closing stamps the flag and tells peer surfaces to
// dismiss their copy of the intro too.
//
// State, constants, the step table, the 1.5s settle delay, and the
// handleClose / handleNext control flow are ported verbatim.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - `localStorage` get/set of ONBOARDED_KEY (web lines 6, 51, 68) becomes the
//     react-native-web `globalThis.localStorage` when present (web target) and
//     an in-process flag otherwise; durable cross-restart persistence on a pure
//     native runtime is intentionally unavailable.
//   - The `@/lib/broadcast` cross-tab bus (web lines 4, 62-64, 70) — subscribe
//     for `{ type: 'onboarded' }` and broadcast the same on close — becomes a
//     module-level listener set (broadcastOnboarded -> subscribeOnboarded);
//     cross-tab / cross-device fan-out is web-only and intentionally
//     unavailable (see nativeOnboardingCapabilities).
//   - lucide-react icons Zap / Car / Settings / CheckCircle / X / ChevronRight
//     (web lines 2, 20/27/35/41, 107, 134, 159) become monochrome BMP glyph
//     markers inside the themed chip and controls.
//   - The fixed full-screen overlay + click-dismiss backdrop and the
//     Escape-to-close key handler (web lines 87-90) become a React Native Modal
//     (transparent fade) with a backdrop Pressable and onRequestClose
//     (hardware back) wired to the same close handler. backdrop-blur-sm and the
//     mobile-header inset (top-12 lg:top-0) have no native analog and are
//     dropped; the CSS gradient Next button becomes a flat translucent accent.

import React, {useEffect, useState} from 'react';
import {Modal, Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../theme/tokens';

const ONBOARDED_KEY = 'teslasync-onboarded';

// Mirrors the web COLOR.CYAN semantic constant used for the step indicators.
const CYAN = '#00f0ff';

interface OnboardingStep {
  title: string;
  description: string;
  glyph: string;
  color: string;
}

const steps: OnboardingStep[] = [
  {
    title: 'Welcome to TeslaSync',
    description:
      'Your all-in-one Tesla fleet management dashboard. Track drives, monitor battery health, analyze energy usage, and control your vehicles — all in one place.',
    glyph: '\u26a1',
    color: '#00f0ff',
  },
  {
    title: 'Connect Your Tesla',
    description:
      'Head to Settings and link your Tesla account via OAuth. TeslaSync will securely poll your vehicle data and keep everything in sync automatically.',
    glyph: '\u26df',
    color: '#10b981',
  },
  {
    title: 'Configure Settings',
    description:
      'Customize your polling interval, distance units, energy cost per kWh, notification preferences, and MQTT integration to match your setup.',
    glyph: '\u2699',
    color: '#f59e0b',
  },
  {
    title: "You're All Set!",
    description:
      'Your dashboard is ready. Explore drives, charging sessions, efficiency analytics, and more. You can always revisit settings to fine-tune your experience.',
    glyph: '\u2713',
    color: '#8b5cf6',
  },
];

// ── Native-safe onboarded-flag persistence ───────────────────────────────────
// react-native-web exposes the real localStorage; a pure native runtime does
// not, so an in-process flag is the fallback transport. The ONBOARDED_KEY is
// preserved verbatim so the web target shares the same persisted flag.

interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let inMemoryOnboarded: string | null = null;

function getWebStorage(): WebStorageLike | undefined {
  const candidate = (
    globalThis as typeof globalThis & {localStorage?: WebStorageLike}
  ).localStorage;
  return candidate && typeof candidate.getItem === 'function'
    ? candidate
    : undefined;
}

function readOnboarded(): string | null {
  const store = getWebStorage();
  if (store) {
    try {
      return store.getItem(ONBOARDED_KEY);
    } catch {
      return inMemoryOnboarded;
    }
  }
  return inMemoryOnboarded;
}

function writeOnboarded(value: string): void {
  inMemoryOnboarded = value;
  const store = getWebStorage();
  if (store) {
    try {
      store.setItem(ONBOARDED_KEY, value);
    } catch {
      // Ignore storage failures; the flag still hides the wizard this session.
    }
  }
}

// ── Native-safe cross-surface "onboarded" bus ────────────────────────────────
// Native replacement for broadcast({ type: 'onboarded' }) / subscribe(...).
// Exported so a host integration (or test) can drive dismissal explicitly.

const onboardedListeners = new Set<() => void>();

/** Native stand-in for `broadcast({ type: 'onboarded' })`. */
export function broadcastOnboarded(): void {
  for (const listener of onboardedListeners) {
    listener();
  }
}

function subscribeOnboarded(listener: () => void): () => void {
  onboardedListeners.add(listener);
  return () => {
    onboardedListeners.delete(listener);
  };
}

/** Explicit capability matrix for the native onboarding surface. */
export const nativeOnboardingCapabilities = {
  durableOnboardedPersistenceAvailable: false,
  crossTabBroadcastAvailable: false,
} as const;

// Web line 54: delay so the app renders first and the user can interact with nav.
const AUTO_SHOW_DELAY_MS = 1500;

export default function OnboardingWizard() {
  const [visible, setVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const onboarded = readOnboarded();
    if (!onboarded) {
      // Delay so the app renders first and the user can interact with nav.
      const timer = setTimeout(() => setVisible(true), AUTO_SHOW_DELAY_MS);
      return () => clearTimeout(timer);
    }
  }, []);

  // When another surface finishes onboarding, dismiss the wizard here too
  // instead of letting two surfaces race the same intro.
  useEffect(() => {
    return subscribeOnboarded(() => setVisible(false));
  }, []);

  const handleClose = () => {
    writeOnboarded('true');
    setVisible(false);
    broadcastOnboarded();
  };

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleClose();
    }
  };

  const step = steps[currentStep];
  const isLastStep = currentStep >= steps.length - 1;

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleClose}
      transparent
      visible={visible}>
      <View
        accessibilityLabel={step.title}
        accessibilityViewIsModal
        style={styles.overlay}>
        {/* Backdrop — tapping outside dismisses, mirroring the web onClick. */}
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={handleClose}
          style={styles.backdrop}
          testID="onboarding-backdrop"
        />

        <View style={styles.dialog} testID="onboarding-wizard">
          {/* Close button */}
          <Pressable
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={8}
            onPress={handleClose}
            style={({pressed}) => [styles.closeButton, pressed && styles.pressed]}
            testID="onboarding-close">
            <AppText style={styles.closeGlyph} tone="muted">
              {'\u00d7'}
            </AppText>
          </Pressable>

          {/* Step indicators */}
          <View style={styles.indicators}>
            {steps.map((indicatorStep, i) => (
              <View
                key={indicatorStep.title}
                style={[
                  styles.indicator,
                  {
                    backgroundColor:
                      i <= currentStep ? CYAN : 'rgba(255, 255, 255, 0.1)',
                    width: i === currentStep ? 24 : 8,
                  },
                ]}
              />
            ))}
          </View>

          {/* Content */}
          <View style={styles.content}>
            <View style={[styles.iconChip, {backgroundColor: `${step.color}15`}]}>
              <AppText
                style={[styles.iconGlyph, {color: step.color}]}
                weight="bold">
                {step.glyph}
              </AppText>
            </View>

            <AppText style={styles.title} weight="bold">
              {step.title}
            </AppText>
            <AppText style={styles.description} tone="muted">
              {step.description}
            </AppText>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Skip"
              accessibilityRole="button"
              onPress={handleClose}
              style={({pressed}) => [
                styles.skipButton,
                pressed && styles.pressed,
              ]}
              testID="onboarding-skip">
              <AppText style={styles.skipText} tone="muted">
                Skip
              </AppText>
            </Pressable>
            <Pressable
              accessibilityLabel={isLastStep ? 'Get Started' : 'Next'}
              accessibilityRole="button"
              onPress={handleNext}
              style={({pressed}) => [
                styles.nextButton,
                pressed && styles.pressed,
              ]}
              testID="onboarding-next">
              <AppText style={styles.nextText} weight="semibold">
                {isLastStep ? 'Get Started' : 'Next'}
              </AppText>
              {isLastStep ? null : (
                <AppText style={styles.nextGlyph} weight="semibold">
                  {'\u203a'}
                </AppText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    width: 32,
    zIndex: 2,
  },
  closeGlyph: {
    fontSize: 20,
    lineHeight: 22,
  },
  content: {
    alignItems: 'center',
  },
  description: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: spacing.xl,
    textAlign: 'center',
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 448,
    padding: spacing.lg,
    width: '100%',
    ...shadows.panel,
  },
  iconChip: {
    alignItems: 'center',
    borderRadius: 16,
    height: 64,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 64,
  },
  iconGlyph: {
    fontSize: 30,
    lineHeight: 34,
  },
  indicator: {
    borderRadius: 999,
    height: 6,
  },
  indicators: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  nextButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 240, 255, 0.12)',
    borderColor: 'rgba(0, 240, 255, 0.2)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
  },
  nextGlyph: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 18,
  },
  nextText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(2, 6, 16, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  skipButton: {
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  skipText: {
    fontSize: 14,
    lineHeight: 18,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
});

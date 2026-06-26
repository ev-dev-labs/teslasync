// Native parity port of
// web/src/features/onboarding/components/Stepper.tsx.
//
// `Stepper` is the compact vertical step list used by the onboarding page. Each
// row is in one of three states derived purely from the steps array:
//   - done     ✓ green check  (`step.done === true`)
//   - current  spinner        (the first not-done step — the actionable one)
//   - pending  muted index    (every later not-done step)
// A step renders its CTA ONLY while `current`, so completed rows stay quiet and
// pending rows below don't tempt a click-ahead. Behaviour is preserved verbatim:
// the `OnboardingStep` / `StepperProps` shapes (key/title/description/done/cta
// {label,onClick,href,to,disabled}/icon and the `renderCta` render-prop), and the
// `stateOf(steps,index)` derivation (`done` first, else `findIndex(!done) ===
// index ? 'current' : 'pending'`) are unchanged. The CTA gate
// `state === 'current' && step.cta` and the `renderCta ? renderCta(step) :
// <default button>` fallback are preserved exactly.
//
// Web modules with no native-parity surface are mapped per the conversion
// contract (rules 4-7); each is recorded in the parity sidecar:
//   - lucide-react `Check` / `Loader2` / `ArrowRight` (L2): there is no
//     `react-native-svg` dependency, so the static icons become text glyphs
//     (`\u2713` check, `\u2192` arrow) and the spinning `Loader2 animate-spin`
//     becomes the RN core `ActivityIndicator` — the idiomatic native in-progress
//     spinner (a real animated indicator, not a frozen glyph). Decorative glyphs
//     are accessibility-hidden; meaning is carried by the row title/state.
//   - `@/lib/cn` (L3): RN has no className, so every `cn(...)` merge is dropped
//     and its static + per-state class buckets (`indicatorClasses` /
//     `titleClasses` / `descriptionClasses`) become StyleSheet style records keyed
//     by the same `'done' | 'current' | 'pending'` union.
//   - `@/components/ui` `Button` (L4, the default CTA): a local `StepCtaButton`
//     Pressable mirroring `variant="primary" size="sm" icon={<ArrowRight/>}`. Web
//     `onClick`/`disabled`/`children` -> `onPress`/`disabled`/label. The web
//     Button renders `{icon}{children}` so the arrow sits BEFORE the label — that
//     order is preserved. The web Button's `primary` is `bg-blue-600`; the native
//     primary-action token is `colors.accent` on `colors.background` text (the
//     same mapping the KioskSettingsModal / TemplateGallery ports use), so the CTA
//     follows the native app's accent language rather than a raw blue literal.
//
// DOM -> native element mapping:
//   - `<ol class="flex flex-col gap-6" aria-label="Onboarding steps">` -> a View
//     column (gap 24) with accessibilityLabel "Onboarding steps" (label preserved
//     verbatim; the source hardcodes it, no i18n is introduced).
//   - `<li class="flex gap-4" id="onboarding-step-{key}">` -> a row View (gap 16)
//     with `nativeID` carrying the same screen-reader id the interface documents.
//   - indicator column `<div class="relative flex flex-col items-center">` -> a
//     centred column holding the circle + connector.
//   - circle `<span class="h-9 w-9 ... rounded-full border ... {indicatorClasses}">`
//     -> a 36x36 bordered circle; done/current use the exact emerald/cyan tint
//     literals (no native semantic token for these palette accents, like the
//     AchievementBadge gold), pending uses surface-2/border-subtle -> the native
//     `colors.surfaceRaised`/`colors.border` tokens.
//   - connector `<span class="mt-1 w-px flex-1 min-h-[28px] {emerald|surface-2}">`
//     -> a 1px flex:1 rule (minHeight 28); done = emerald-400/40 literal, else
//     surface-2 -> `colors.surfaceRaised`.
//   - title `<h3 class="text-base font-semibold {titleClasses}">` -> AppText
//     (16/24, weight 600). done(--text-primary) & current(text-white) both resolve
//     to the single near-white `colors.textPrimary` token (identical in the dark
//     theme); pending(--text-secondary) -> `colors.textSecondary`.
//   - description `<p class="mt-1 text-sm leading-relaxed {descriptionClasses}">`
//     -> AppText (14/23 = leading-relaxed 1.625, marginTop 4). done/current
//     (--text-secondary) -> `colors.textSecondary`; pending(--text-muted) ->
//     `colors.textMuted`.
//   - CTA wrapper `<div class="mt-3">` -> a View (marginTop 12).
// CSS `transition-colors` has no RN analog and is dropped (state changes are
// instant). No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old
// web UI components are imported.

import React, {type ReactNode} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';

export interface OnboardingStep {
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

export interface StepperProps {
  steps: OnboardingStep[];
  /** Render-prop hook so the page can wrap CTAs in <Link>/<a>. */
  renderCta?: (step: OnboardingStep) => ReactNode;
}

type StepState = 'done' | 'current' | 'pending';

function stateOf(steps: OnboardingStep[], index: number): StepState {
  if (steps[index].done) return 'done';
  // The "current" step is the first not-done step. Subsequent
  // not-done steps stay pending so the user follows the flow.
  const firstPending = steps.findIndex((s) => !s.done);
  return firstPending === index ? 'current' : 'pending';
}

// lucide -> glyph / native primitive map.
const CHECK_GLYPH = '\u2713'; // Check
const ARROW_GLYPH = '\u2192'; // ArrowRight
const SPINNER_COLOR = '#67e8f9'; // cyan-300 (Loader2 in-progress)

// indicatorClasses (cn merge dropped — class buckets become StyleSheet records).
const indicatorStateStyle: Record<StepState, ViewStyle> = {
  done: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)', // bg-emerald-500/20
    borderColor: 'rgba(52, 211, 153, 0.5)', // border-emerald-400/50
  },
  current: {
    backgroundColor: 'rgba(6, 182, 212, 0.2)', // bg-cyan-500/20
    borderColor: 'rgba(34, 211, 238, 0.5)', // border-cyan-400/50
  },
  pending: {
    backgroundColor: colors.surfaceRaised, // bg-[var(--surface-2)]
    borderColor: colors.border, // border-[var(--border-subtle)]
  },
};

// Indicator content colour (text-emerald-300 / text-cyan-300 / text-[--text-muted]).
const indicatorTextStateStyle: Record<StepState, TextStyle> = {
  done: {color: '#6ee7b7'}, // text-emerald-300
  current: {color: SPINNER_COLOR}, // text-cyan-300
  pending: {color: colors.textMuted}, // text-[var(--text-muted)]
};

// titleClasses.
const titleStateStyle: Record<StepState, TextStyle> = {
  done: {color: colors.textPrimary}, // text-[var(--text-primary)]
  current: {color: colors.textPrimary}, // text-white (same near-white token on native)
  pending: {color: colors.textSecondary}, // text-[var(--text-secondary)]
};

// descriptionClasses.
const descriptionStateStyle: Record<StepState, TextStyle> = {
  done: {color: colors.textSecondary}, // text-[var(--text-secondary)]
  current: {color: colors.textSecondary}, // text-[var(--text-secondary)]
  pending: {color: colors.textMuted}, // text-[var(--text-muted)]
};

// Default CTA — native mirror of <Button variant="primary" size="sm"
// icon={<ArrowRight/>}>. The web Button renders {icon}{children}, so the arrow
// precedes the label. onClick/disabled/children -> onPress/disabled/label.
function StepCtaButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: !!disabled}}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.ctaButton,
        disabled ? styles.ctaButtonDisabled : null,
        pressed && !disabled ? styles.ctaButtonPressed : null,
      ]}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.ctaArrow}>
        {ARROW_GLYPH}
      </AppText>
      <AppText style={styles.ctaLabel}>{label}</AppText>
    </Pressable>
  );
}

export function Stepper({steps, renderCta}: StepperProps) {
  return (
    <View accessibilityLabel="Onboarding steps" style={styles.list}>
      {steps.map((step, idx) => {
        const state = stateOf(steps, idx);
        const showCta = state === 'current' && step.cta;
        const isLast = idx >= steps.length - 1;
        return (
          <View
            key={step.key}
            nativeID={`onboarding-step-${step.key}`}
            style={styles.item}>
            <View style={styles.indicatorColumn}>
              <View style={[styles.indicator, indicatorStateStyle[state]]}>
                {state === 'done' ? (
                  <AppText
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[styles.checkGlyph, indicatorTextStateStyle.done]}>
                    {CHECK_GLYPH}
                  </AppText>
                ) : state === 'current' ? (
                  <ActivityIndicator color={SPINNER_COLOR} size="small" />
                ) : (
                  <AppText style={[styles.indexText, indicatorTextStateStyle[state]]}>
                    {idx + 1}
                  </AppText>
                )}
              </View>
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

            <View style={styles.body}>
              <AppText style={[styles.title, titleStateStyle[state]]}>
                {step.title}
              </AppText>
              <AppText style={[styles.description, descriptionStateStyle[state]]}>
                {step.description}
              </AppText>
              {showCta ? (
                <View style={styles.ctaWrap}>
                  {renderCta ? (
                    renderCta(step)
                  ) : (
                    <StepCtaButton
                      label={step.cta?.label ?? ''}
                      onPress={step.cta?.onClick}
                      disabled={step.cta?.disabled}
                    />
                  )}
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    flexDirection: 'column', // flex flex-col
    gap: 24, // gap-6
  },
  item: {
    flexDirection: 'row', // flex
    gap: 16, // gap-4
  },
  indicatorColumn: {
    alignItems: 'center', // flex flex-col items-center
  },
  indicator: {
    alignItems: 'center', // items-center
    borderRadius: 18, // rounded-full (h-9 w-9)
    borderWidth: 1, // border
    height: 36, // h-9
    justifyContent: 'center', // justify-center
    width: 36, // w-9
  },
  checkGlyph: {
    fontSize: 16, // Check h-4 w-4
    lineHeight: 16,
  },
  indexText: {
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    lineHeight: 20,
  },
  connector: {
    flex: 1, // flex-1
    marginTop: 4, // mt-1
    minHeight: 28, // min-h-[28px]
    width: 1, // w-px
  },
  connectorDone: {
    backgroundColor: 'rgba(52, 211, 153, 0.4)', // bg-emerald-400/40
  },
  connectorDefault: {
    backgroundColor: colors.surfaceRaised, // bg-[var(--surface-2)]
  },
  body: {
    flex: 1, // flex-1
    paddingBottom: 4, // pb-1
  },
  title: {
    fontSize: 16, // text-base
    fontWeight: '600', // font-semibold
    lineHeight: 24,
  },
  description: {
    fontSize: 14, // text-sm
    lineHeight: 23, // leading-relaxed (1.625 * 14)
    marginTop: 4, // mt-1
  },
  ctaWrap: {
    marginTop: 12, // mt-3
  },
  ctaButton: {
    alignItems: 'center', // items-center
    alignSelf: 'flex-start', // inline-flex (don't stretch full width)
    backgroundColor: colors.accent, // primary -> native accent action
    borderRadius: 6, // rounded-md
    flexDirection: 'row',
    gap: 8, // gap-2
    height: 32, // h-8 (size sm)
    justifyContent: 'center', // justify-center
    paddingHorizontal: 12, // px-3 (size sm)
  },
  ctaButtonDisabled: {
    opacity: 0.5, // disabled:opacity-50
  },
  ctaButtonPressed: {
    opacity: 0.85,
  },
  ctaLabel: {
    color: colors.background, // text-white -> native primary-button text
    fontSize: 12, // text-xs (size sm)
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  ctaArrow: {
    color: colors.background,
    fontSize: 16, // ArrowRight h-4 w-4
    lineHeight: 16,
  },
});

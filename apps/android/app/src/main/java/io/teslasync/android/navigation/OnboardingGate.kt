package io.teslasync.android.navigation

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Seam for the first-run onboarding gate (owned by P3/A4). The navigation shell consults the
 * ambient [OnboardingGate] to decide whether a freshly launched, authenticated session should be
 * routed to the onboarding flow before its requested destination.
 *
 * The foundation provides [NoOpOnboardingGate] (onboarding never required); A4 replaces it with a
 * gate backed by the shared-core onboarding state via [LocalOnboardingGate].
 */
fun interface OnboardingGate {
    /** True when the onboarding flow must be shown before the requested destination. */
    fun isOnboardingRequired(): Boolean
}

/** Default gate: onboarding is never required (A4 overrides this with real state). */
val NoOpOnboardingGate: OnboardingGate = OnboardingGate { false }

/** Ambient onboarding gate consulted by the navigation shell; defaults to [NoOpOnboardingGate]. */
val LocalOnboardingGate = staticCompositionLocalOf { NoOpOnboardingGate }

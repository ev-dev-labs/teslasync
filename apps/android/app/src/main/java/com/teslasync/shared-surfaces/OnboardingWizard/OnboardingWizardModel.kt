// Pure, framework-free model + step taxonomy + navigation + render classifier for the OnboardingWizard shared
// surface — the native analogue of every decision the web component makes
// (web/src/components/feedback/OnboardingWizard.tsx) before it paints its modal. No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a
// thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces):
//   • A self-contained, FIRST-RUN intro modal. It owns only view state: a four-entry `steps` array (each a
//     title + description + leading icon + accent color), a `currentStep` cursor, and a `visible` flag gated on a
//     `localStorage` "onboarded" marker with a short reveal delay and a cross-tab broadcast so two tabs never
//     race the same intro. There is NO hook, NO fetch, and NO data port to bind (no P1/S8 state holder, no
//     Source/ViewModel) — modelling one would invent an async dependency the web spec does not have (honesty
//     covenant: no scope narrowing, no silent drift). The closest sibling precedents are the equally
//     presentational AlertBanner / AiLimitBanner surfaces (composable + model, no Source/ViewModel).
//   • So the surface's REAL, fully-reproduced states are its four ordered steps (welcome → connect → configure →
//     ready), each crossed with the cursor-driven branches the web draws: the per-step progress dots (reached vs
//     upcoming, the active one emphasized — web `i <= currentStep` / `i === currentStep`), and the advance
//     affordance that reads "Next" on every step but the last and "Get Started" on the last
//     (web `currentStep < steps.length - 1 ? … : …`). Each is reduced here in [classifyStep] and asserted in the
//     off-device test, doubling as the per-state snapshot. Skip / close both collapse the modal (web `handleClose`
//     → `visible = false`), reproduced by the view's controlled dismissal.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// fetches nothing — it is a first-run intro whose content is static. There is no query to be loading, to fail, to
// go stale, or to be offline, so inventing those states would be dishonest. The host screen decides whether to
// mount the wizard (the native equivalent of the web `localStorage` gate); once mounted it always renders a full,
// non-blank step — there is no hidden surface, only which step the cursor is on.
//
// i18n: the web source hard-codes its English copy (it predates the i18n facade and makes zero `t()` calls), so
// there are no source keys to mirror 1:1. The surface is "anonymous" per the prompt ("reproduce regions from
// source"), so the view binds each region to the closest existing P1/S10 catalog key (the `tour.*` / `onboarding.*`
// namespaces) via the i18n facade — no English literal ever appears in native code. The exact key→region mapping
// is documented in the surface log for transparency.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/OnboardingWizard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling AlertBanner / AiLimitBanner surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.onboardingwizard

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no step index or copy — only
 * this constant identifier — so a diagnostics line can never leak what the user is reading.
 */
const val ONBOARDING_WIZARD_SLUG: String = "OnboardingWizard"

/** The number of ordered steps in the intro, mirroring the web `steps` array length (welcome → … → ready). */
const val ONBOARDING_WIZARD_STEP_COUNT: Int = 4

/**
 * The semantic accent of a step — the native mirror of the per-step web `color` (`#00f0ff`, `#10b981`, `#f59e0b`,
 * `#8b5cf6`). The view maps each accent onto a shared [IconBox] tone + glyph so the tint stays correct across
 * light / dark / high-contrast themes. Declared in cursor order.
 */
enum class OnboardingStepAccent {
    /** Step 1 — the cyan welcome (web `#00f0ff`, the Zap glyph). */
    Welcome,

    /** Step 2 — the green "connect your Tesla" (web `#10b981`, the Car glyph). */
    Connect,

    /** Step 3 — the amber "configure settings" (web `#f59e0b`, the Settings glyph). */
    Configure,

    /** Step 4 — the brand-accent "you're all set" (web `#8b5cf6`, the CheckCircle glyph). */
    Ready,
}

/** The ordered accents of the intro, mirroring the web `steps` array order. */
val onboardingStepAccents: List<OnboardingStepAccent> =
    listOf(
        OnboardingStepAccent.Welcome,
        OnboardingStepAccent.Connect,
        OnboardingStepAccent.Configure,
        OnboardingStepAccent.Ready,
    )

/**
 * The render-ready classification of the active step — everything the view needs to draw the chrome that does not
 * come from string resources, reduced from the cursor so every branch is exhaustively covered and unit-tested
 * off-device. The web component always renders a full step (the host decides whether to mount it), so there is no
 * hidden surface — only which step the cursor is on and how the advance affordance reads.
 *
 * @property stepIndex the clamped, zero-based cursor (web `currentStep`).
 * @property accent the active step's semantic accent (web per-step `color`).
 * @property stepNumber the one-based step number for the progress counter (web `currentStep + 1`).
 * @property stepTotal the total number of steps (web `steps.length`).
 * @property isLast the cursor is on the final step — the advance affordance reads "Get Started", not "Next"
 *   (web `currentStep < steps.length - 1`).
 */
data class OnboardingWizardRender(
    val stepIndex: Int,
    val accent: OnboardingStepAccent,
    val stepNumber: Int,
    val stepTotal: Int,
    val isLast: Boolean,
)

/**
 * Clamp [index] into the valid `[0, total)` range — the guard the web cursor never needs (its buttons can't run
 * off the ends) but a controlled native cursor must, so a stale saved index can never index out of bounds. A
 * non-positive [total] collapses to `0`.
 */
fun clampStepIndex(
    index: Int,
    total: Int = ONBOARDING_WIZARD_STEP_COUNT,
): Int =
    when {
        total <= 0 -> 0
        index < 0 -> 0
        index >= total -> total - 1
        else -> index
    }

/** Whether [index] is the final step — the web `currentStep === steps.length - 1` advance branch. */
fun isLastStep(
    index: Int,
    total: Int = ONBOARDING_WIZARD_STEP_COUNT,
): Boolean = clampStepIndex(index, total) == total - 1

/**
 * The cursor after advancing from [index] — the web `setCurrentStep(currentStep + 1)`, clamped so the final step
 * stays put (the view routes the final advance to finish instead of stepping past the end).
 */
fun nextStepIndex(
    index: Int,
    total: Int = ONBOARDING_WIZARD_STEP_COUNT,
): Int = clampStepIndex(clampStepIndex(index, total) + 1, total)

/**
 * Reduce the [index] cursor into the render-ready [OnboardingWizardRender]. Pure (no Compose). The index is
 * clamped first so the projection is always in range; the accent is read from [onboardingStepAccents] so the
 * view's tint never drifts from the model's step order.
 */
fun classifyStep(
    index: Int,
    total: Int = ONBOARDING_WIZARD_STEP_COUNT,
): OnboardingWizardRender {
    val clamped = clampStepIndex(index, total)
    return OnboardingWizardRender(
        stepIndex = clamped,
        accent = onboardingStepAccents[clamped.coerceIn(0, onboardingStepAccents.lastIndex)],
        stepNumber = clamped + 1,
        stepTotal = total,
        isLast = isLastStep(clamped, total),
    )
}

/**
 * Build the merged accessibility announcement for a step from its already-localized [title] + [description] (the
 * view resolves both through the i18n facade). Kept pure so TalkBack-label presence is unit-tested without a
 * Compose host. Blank parts are skipped and the rest joined into one sentence so the icon (decorative) plus the
 * title and body read as a single coherent announcement.
 */
fun stepAccessibilityLabel(
    title: String,
    description: String,
): String =
    listOf(title, description)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .joinToString(separator = ". ")

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the step index
 * or copy — so a diagnostics line can never leak what the user is reading.
 */
object OnboardingWizardDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = ONBOARDING_WIZARD_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

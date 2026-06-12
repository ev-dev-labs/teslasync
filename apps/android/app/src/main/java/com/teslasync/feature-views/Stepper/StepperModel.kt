// The pure, framework-free model + projection + diagnostics for the Stepper feature view — the native
// analogue of everything the web component derives from its props before returning JSX
// (web/src/features/onboarding/components/Stepper.tsx). No Compose, no Android, no HTTP: every declaration
// here is exercised off-device by the :app:testReleaseUnitTest gate, so the composable stays a thin render
// layer.
//
// Stepper is a purely presentational surface — the web component takes its `steps` (and an optional
// `renderCta` render-prop) from the OnboardingPage, which owns the `useOnboardingStatus` query and threads
// the resolved steps in. So this surface binds NO data hook of its own and performs NO fetch. The owning
// page genuinely carries loading/error/stale, so — exactly like the sibling TripLegList port — the surface
// renders every lifecycle state the shared cache-then-network [UiState] (P1/S8) can carry, while this file
// owns the value derivation: the per-step state machine, the render-ready rows, and the lifecycle
// projection. A web-parity overload taking the raw `steps` list is provided for hosts that already hold it.
//
// The state machine is the verbatim web `stateOf`: a step is `done` when its anchor is satisfied; the FIRST
// not-done step is `current` (the only one that shows its CTA); every later not-done step stays `pending`
// so the user follows the flow. The web declares an `icon?: ReactNode` override on the step but never reads
// it in the render (the indicator is always Check / spinner / number), so faithfully reproducing the render
// means the override has no effect — it is intentionally not modelled here (no drift).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/Stepper — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.stepper

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.Serializable

/**
 * The optional call-to-action attached to an onboarding step — the native mirror of the web step's `cta`
 * object (web/src/features/onboarding/components/Stepper.tsx). Every field defaults so a partial or
 * still-loading payload decodes without error.
 *
 * The default render reads [label] + [disabled] and routes the click through the host callback; [to] / [href]
 * are carried for web parity so a host's `renderCta` slot can decide in-app navigation vs. an external link
 * (the web page's `renderCta` branches on exactly these two).
 *
 * @property label the localized button label (web `cta.label`).
 * @property disabled disables the button while a parent action is pending (web `cta.disabled`).
 * @property to optional in-app route target (web `cta.to`).
 * @property href optional external link target (web `cta.href`).
 */
@Serializable
data class OnboardingStepCta(
    val label: String = "",
    val disabled: Boolean = false,
    val to: String? = null,
    val href: String? = null,
)

/**
 * One onboarding step — the native mirror of the web `OnboardingStep` interface
 * (web/src/features/onboarding/components/Stepper.tsx). Every field defaults so a partial payload decodes
 * cleanly; the web `icon?: ReactNode` override is intentionally omitted (the web render never consumes it).
 *
 * @property key the stable key (web React key + screen-reader id `onboarding-step-{key}`).
 * @property title the localized title shown next to the indicator.
 * @property description the localized supporting copy explaining the step.
 * @property done whether the underlying anchor is satisfied (web `done`).
 * @property cta the optional CTA rendered only while the step is in-progress.
 */
@Serializable
data class OnboardingStepData(
    val key: String = "",
    val title: String = "",
    val description: String = "",
    val done: Boolean = false,
    val cta: OnboardingStepCta? = null,
)

/**
 * The three mutually-exclusive states a step can be in — the native analogue of the web
 * `'done' | 'current' | 'pending'` union. [Current] is the single first-not-done step (the only one whose
 * CTA shows); every later not-done step is [Pending].
 */
enum class StepState { Done, Current, Pending }

/**
 * One fully resolved step row — the render-ready view of a single web `<li>`. Pure data (no Compose types)
 * so the whole projection is asserted off-device; the composable only paints these values and resolves the
 * per-state accent colors.
 *
 * @property key the step key (web `key` / `onboarding-step-{key}`).
 * @property number the 1-based index shown in a pending indicator (web `idx + 1`).
 * @property title the localized step title.
 * @property description the localized step description.
 * @property state the resolved [StepState] driving the indicator + text colors.
 * @property cta the step's CTA, or null when it has none.
 * @property showCta whether the CTA is rendered (web `state === 'current' && step.cta`).
 * @property showConnector whether the trailing connector line is drawn (web `idx < steps.length - 1`).
 */
data class StepperRow(
    val key: String,
    val number: Int,
    val title: String,
    val description: String,
    val state: StepState,
    val cta: OnboardingStepCta?,
    val showCta: Boolean,
    val showConnector: Boolean,
)

/**
 * The localized chrome strings the composable resolves once (P1/S10) so the rest of the surface carries no
 * English literal. The web Stepper itself extracts no `t()` calls (its titles/descriptions/labels arrive
 * pre-localized as props); these back only the native lifecycle states the owning page's feed can carry —
 * the friendly empty state, the hard-error retry surface, and the stale/offline freshness chip.
 */
data class StepperStrings(
    val empty: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
    val loading: String,
    val offline: String,
)

/**
 * Pure projection from the surface's inputs to its render state — a 1:1 port of the web component's
 * `stateOf` state machine and its per-step `showCta` / connector branches. Stateless and side-effect-free
 * so it is fully covered by the off-device unit gate; the composable only resolves localized strings +
 * accent colors and draws what these return.
 */
object StepperProjection {
    /**
     * The web `stateOf(steps, index)` verbatim: a [StepState.Done] step is done outright; otherwise the
     * first not-done step is [StepState.Current] and every later not-done step is [StepState.Pending].
     * [index] must be a valid index into [steps].
     */
    fun stateOf(
        steps: List<OnboardingStepData>,
        index: Int,
    ): StepState {
        if (steps[index].done) return StepState.Done
        val firstPending = steps.indexOfFirst { !it.done }
        return if (firstPending == index) StepState.Current else StepState.Pending
    }

    /**
     * The render-ready rows in web source order. Each row carries its resolved [StepState], whether to show
     * its CTA (web `state === 'current' && step.cta`), and whether the trailing connector is drawn (web
     * `idx < steps.length - 1`).
     */
    fun rows(steps: List<OnboardingStepData>): List<StepperRow> =
        steps.mapIndexed { idx, step ->
            val state = stateOf(steps, idx)
            StepperRow(
                key = step.key,
                number = idx + 1,
                title = step.title,
                description = step.description,
                state = state,
                cta = step.cta,
                showCta = state == StepState.Current && step.cta != null,
                showConnector = idx < steps.size - 1,
            )
        }

    /**
     * Maps the surface's `(steps, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): a first
     * load wins outright (skeleton chrome), a non-empty list renders [UiPhase.Content], and a null/empty
     * list renders [UiPhase.Empty]. The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        steps: List<OnboardingStepData>?,
        isLoading: Boolean,
    ): UiState<List<OnboardingStepData>> =
        when {
            isLoading -> UiState.loading()
            !steps.isNullOrEmpty() -> UiState(phase = UiPhase.Content, data = steps)
            else -> UiState(phase = UiPhase.Empty, data = steps)
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a step
 * key, title, or done state — so a diagnostics line can never leak a user's onboarding posture.
 */
object StepperDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "Stepper"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

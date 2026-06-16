// Pure, framework-free model + derivations for the OnboardingPage surface — the native analogue of everything
// the web page computes before it returns JSX (web/src/features/onboarding/pages/OnboardingPage.tsx, the
// first-run setup checklist). No Compose, no Android, no HTTP lives here: the gate arrives as the shared,
// already-decoded S8 payload (the KMP `OnboardingStore.status` ▸ `GET /onboarding/status`, a typed
// `OnboardingStatus`), so this file owns only the client-side derivations the web component does inline — the
// verbatim `steps` useMemo (the three first-run anchors → render-ready `OnboardingStepData` rows the shared
// Stepper feature view paints), the `is_complete` footer branch, the navigation targets the CTAs route to, and
// the one PII-safe `view.opened` diagnostic. None of the gate fields is unit-bearing (two booleans, a count, and
// the server-computed `is_complete`), so there is no SI conversion.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory (com/teslasync/onboarding —
// the P3 prompt's allowed-files path) cannot form the package the rest of the app's `io.teslasync.android.*`
// namespace uses, so the package intentionally diverges from the path — exactly as the sibling A7 surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.onboarding

import io.teslasync.android.featureviews.stepper.OnboardingStepCta
import io.teslasync.android.featureviews.stepper.OnboardingStepData
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus

/**
 * Canonical metadata for this surface. The web page is a top-level standalone route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the surface
 * owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires and the diagnostics [SLUG] emitted with the
 * one-shot `view.opened` event (P1/S11).
 */
object OnboardingPageRegistration {
    /** The navigation destination id (Destinations.kt `standalone("onboarding", "/onboarding", …)`). */
    const val ROUTE_ID: String = "onboarding"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/onboarding"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no gate posture. */
    const val SLUG: String = "OnboardingPage"
}

/**
 * The in-app routes and external doc links the page's CTAs and footer links target — the native mirror of the
 * web page's `to` / `href` values (web/src/features/onboarding/pages/OnboardingPage.tsx). In-app paths are
 * resolved to the app deep-link scheme at the render boundary; doc paths open in the browser.
 */
object OnboardingNav {
    /** Web `cta.to = '/tesla-account'` (the Tesla-connect step) + the footer "Tesla account page" link. */
    const val TESLA_ACCOUNT_PATH: String = "/tesla-account"

    /** Web `cta.href = '/docs/fleet-telemetry-setup'` (the telemetry step's "Setup guide"). */
    const val TELEMETRY_DOCS_PATH: String = "/docs/fleet-telemetry-setup"

    /** Web footer `<a href="/docs/">` ("documentation"). */
    const val DOCS_PATH: String = "/docs/"
}

/** The stable step key (web `step.key` + the screen-reader id `onboarding-step-{key}`) — Tesla-connect anchor. */
const val ONBOARDING_STEP_TESLA: String = "tesla"

/** The stable step key — the vehicle-sync anchor. */
const val ONBOARDING_STEP_VEHICLE: String = "vehicle"

/** The stable step key — the first-telemetry anchor. */
const val ONBOARDING_STEP_TELEMETRY: String = "telemetry"

/**
 * The localized step copy resolved once at the render boundary (i18n stays at the Compose edge, ADR-014) and
 * threaded into the pure [onboardingSteps] builder, so the projection itself stays framework-free and fully
 * unit-testable. Mirrors the `t(...)` calls the web `steps` useMemo resolves inline.
 */
data class OnboardingStepLabels(
    val teslaTitle: String,
    val teslaDescription: String,
    val teslaCta: String,
    val vehicleTitle: String,
    val vehicleDescription: String,
    val vehicleCta: String,
    val vehicleChecking: String,
    val telemetryTitle: String,
    val telemetryDescription: String,
    val telemetryDocs: String,
)

/**
 * Builds the three onboarding steps from the gate [status] — a 1:1 port of the web `steps` useMemo. Each anchor
 * maps to one render-ready [OnboardingStepData] the shared Stepper paints:
 *
 *  1. **tesla** — done when [OnboardingStatus.teslaConnected]; its CTA carries `to = /tesla-account` so the page
 *     renders the primary "Connect Tesla account" navigation button.
 *  2. **vehicle** — done when [OnboardingStatus.vehicleCount] > 0; its CTA carries neither `to` nor `href` (so it
 *     renders the "Refresh" action), and while [isFetching] it shows the "Checking…" label + is disabled — the
 *     verbatim web `isFetching ? checking : cta` / `disabled: isFetching`.
 *  3. **telemetry** — done when [OnboardingStatus.dataFlowing]; its CTA carries `href = /docs/fleet-telemetry-setup`
 *     so the page renders the external "Setup guide" link button.
 *
 * The Stepper's own state machine then resolves which single step is "current" (and therefore shows its CTA), so
 * this builder only declares the anchors + their actions, never the per-step done/current/pending presentation.
 */
fun onboardingSteps(
    status: OnboardingStatus,
    isFetching: Boolean,
    labels: OnboardingStepLabels,
): List<OnboardingStepData> =
    listOf(
        OnboardingStepData(
            key = ONBOARDING_STEP_TESLA,
            title = labels.teslaTitle,
            description = labels.teslaDescription,
            done = status.teslaConnected,
            cta = OnboardingStepCta(label = labels.teslaCta, to = OnboardingNav.TESLA_ACCOUNT_PATH),
        ),
        OnboardingStepData(
            key = ONBOARDING_STEP_VEHICLE,
            title = labels.vehicleTitle,
            description = labels.vehicleDescription,
            done = status.vehicleCount > 0,
            cta =
                OnboardingStepCta(
                    label = if (isFetching) labels.vehicleChecking else labels.vehicleCta,
                    disabled = isFetching,
                ),
        ),
        OnboardingStepData(
            key = ONBOARDING_STEP_TELEMETRY,
            title = labels.telemetryTitle,
            description = labels.telemetryDescription,
            done = status.dataFlowing,
            cta = OnboardingStepCta(label = labels.telemetryDocs, href = OnboardingNav.TELEMETRY_DOCS_PATH),
        ),
    )

/**
 * The gate to render from a possibly-null cached payload, applying the web page's pessimistic field defaults
 * (`data?.tesla_connected ?? false`, `data?.vehicle_count ?? 0`, …). A null status (first boot before any read
 * resolves, or a hard failure with no cache) collapses to the "nothing set up yet" gate so the checklist still
 * renders honestly with every step incomplete rather than blanking — the native analogue of the web hook's
 * "assume not complete on failure" intent.
 */
fun OnboardingStatus?.orPessimisticDefaults(): OnboardingStatus = this ?: OnboardingStatus()

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [OnboardingPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no gate anchors — never the connected/vehicle/telemetry posture.
 */
fun recordOnboardingPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to OnboardingPageRegistration.SLUG))
}

// The data seam the AIProviderSection feature view binds to (P1/S8 state-holder layer) — the native
// analogue of the web `useValidateAiProvider` mutation (web/src/api/hooks/useAiSettings.ts). The view never
// performs HTTP itself: the owning Settings → AI page wires this port to the shared
// [io.teslasync.shared.core.presentation.aisettings.AiSettingsStore] (built over the shared resilient
// client + S7 [io.teslasync.shared.core.data.repo.AiSettingsRepository]), so the cross-platform validate
// contract — the 2xx → Success / 422 → Failure / other → Result.failure split — is honoured in exactly one
// place and a test fake stands in for it off-device.
//
// `AiSettingsStore` is the AI-settings S8 holder for the whole app (it carries no StateFlow feeds because
// `useAiSettings.ts` exposes only mutations); rather than widen the page-scoped DataContainer for a single
// imperative action, this surface follows the AddressInput precedent and takes a focused functional-interface
// seam as a required parameter, wired by the owning page. That keeps "no direct HTTP from the view" intact
// end to end while leaving the view depend on a one-method abstraction (real store ↔ test fake).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AIProviderSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "ktlint:standard:filename")

package io.teslasync.android.featureviews.aiprovider

import io.teslasync.shared.core.presentation.aisettings.AiSettingsStore
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderRequest
import io.teslasync.shared.core.presentation.aisettings.ValidateAiProviderResult

/**
 * The single pre-flight-validation operation the surface invokes — the native seam over the web
 * `useValidateAiProvider.mutateAsync(request)`. Non-throwing by contract: a successful HTTP call (including
 * the validator's structured 422 rejection) resolves to a [Result.success] wrapping a
 * [ValidateAiProviderResult] (`Success` or `Failure`), while any other transport/HTTP error surfaces as a
 * [Result.failure] — so the view can tell "the user gave a bad config" apart from "the network is down".
 *
 * A functional interface so the view depends on an abstraction: production wires [fromStore]; tests and
 * previews pass an inline fake.
 */
fun interface AiProviderValidator {
    /** Runs the pre-flight validation for [request] (web `validate.mutateAsync(request)`). */
    suspend fun validate(request: ValidateAiProviderRequest): Result<ValidateAiProviderResult>

    companion object {
        /**
         * Binds the seam to the shared S8 [AiSettingsStore] — the production wiring the owning Settings → AI
         * page supplies (`AiProviderValidator.fromStore(dataContainer.aiSettingsStore)`). Delegates verbatim
         * to [AiSettingsStore.validateAiProvider]; the store owns the repository + non-422/422 split.
         */
        fun fromStore(store: AiSettingsStore): AiProviderValidator = AiProviderValidator { store.validateAiProvider(it) }
    }
}

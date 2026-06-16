// The data seam the SecretRotationPage admin surface binds to, plus its production binding over the shared S8
// OperatorConfidenceStore. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's single TanStack-Query read
// (`useSecretRotation`).
//
// The feed is the typed `GET /admin/observability/secret-rotation` response the shared S8
// OperatorConfidenceStore already exposes (`secretRotation()`), as a cache-then-network [Resource]
// `StateFlow` (ADR-013). A narrow seam so the view-model depends on an abstraction (real store ↔ test fake),
// never on a concrete store or the network; [refresh] re-fetches the shared feed (the web `refetch()`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.secretrotation

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore
import io.teslasync.shared.core.presentation.operatorconfidence.SecretRotationResponse
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [SecretRotationPageViewModel] depends on so it binds to an abstraction (the shared
 * Operator-Confidence holder in production, a fake in tests), never to a concrete store or the network. The
 * feed is the cache-then-network typed `Resource` `StateFlow` (the web read hook); [refresh] is the
 * pull-to-refresh / error-retry seam (the web `refetch()`). No HTTP touches the view.
 */
interface SecretRotationSource {
    /** The typed `GET /admin/observability/secret-rotation` feed (web `useSecretRotation`). */
    fun secretRotation(): StateFlow<Resource<SecretRotationResponse>>

    /** Re-fetch the shared feed (the web `refetchInterval` / error-state retry affordance). */
    fun refresh()
}

/**
 * Binds the surface to the shared **S8** [OperatorConfidenceStore] — the memoized, multi-observer feed every
 * Operator-Confidence surface shares app-wide. The live values flow through unchanged so the view-model
 * renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the
 * view.
 */
fun OperatorConfidenceStore.asSecretRotationSource(): SecretRotationSource {
    val store = this
    return object : SecretRotationSource {
        override fun secretRotation(): StateFlow<Resource<SecretRotationResponse>> = store.secretRotation()

        override fun refresh() = store.refreshSecretRotation()
    }
}

// Pure, framework-free model + projection for the RequiresAuth shared surface — the native analogue of everything
// the web component derives before returning JSX (web/src/components/feedback/RequiresAuth.tsx). No Compose, no
// Android UI, no HTTP: every declaration here is exercised by the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): an auth-gated section
// wrapper. It reads the deployment auth-mode contract (web `useAuthMode`) and resolves to exactly three render
// outcomes:
//   • (web `isLoading || !data`)                       → an auth-gated empty-state notice WITHOUT a provider hint.
//   • (web `mode === 'forward_auth' && capabilities[c]`) → the wrapped children, rendered unchanged.
//   • (web else: open mode / capability disabled)       → the same notice WITH the operator's provider hint.
// The web deliberately renders the notice — not the children, and not a spinner — while the contract is still
// loading, so a half-resolved auth contract never flashes a fully-mounted section and then tears it down (web
// source lines 72-86). This port reproduces that policy faithfully: the loading outcome IS the notice.
//
// Parity-with-honesty (Honesty Covenant #9 — documented, not silent): the bound feed is the shared S8
// AuthModeStore (web `useAuthMode`), a cache-then-network [Resource] (ADR-013). Its full lifecycle —
// loading / success / error / stale / offline — folds onto the web's three outcomes through the single value the
// web reads, `data` (here [UiState.data], the best-known cached contract):
//   • no usable contract yet (first load with no cache, or a hard error with no cache) → [RequiresAuthSurface.Locked]
//     with no hint — verbatim web `isLoading || !data`.
//   • a contract is known (a cached value during a refresh, a fresh success, or a cached value served stale /
//     after a failed refresh) → the gate is resolved from that contract exactly as the web reads the query's
//     retained `data`: forward-auth + capability ⇒ [RequiresAuthSurface.Unlocked], otherwise
//     [RequiresAuthSurface.Locked] with the contract's provider hint.
// So no lifecycle state is hidden or blank — every one renders the children or the notice — and none fabricates
// chrome the web source does not have (the web renders no separate spinner / error / stale / offline surface; the
// contract endpoint is designed never to 4xx/5xx, see internal/api/system_auth_mode_handler.go). The view layer
// still honours the ADR-013 freshness contract behaviourally by auto-refreshing a stale contract (see RequiresAuth.kt).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/RequiresAuth — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path —
// exactly as the sibling ImpersonationBanner / withAiFeature surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.requiresauth

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.AuthModeCapabilities
import io.teslasync.shared.core.data.repo.AuthModeResponse
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.authmode.AuthModeDerivations

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug and the web-parity per-capability test-id builder are pinned here so the native and web
 * surfaces stay in lockstep (web `requiresAuthEmptyTestId`).
 */
object RequiresAuthRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11); the prompt-mandated surface slug. */
    const val SLUG: String = "RequiresAuth"
}

/**
 * PII-safe diagnostics for the surface (P1/S11). [recordViewOpened] emits the `view.opened` event carrying only
 * the surface slug — never the deployment auth mode, the capability gate, or the operator's provider hint — so a
 * diagnostics line can never leak the deployment's auth posture.
 */
object RequiresAuthDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = RequiresAuthRegistration.SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the one-shot `view.opened` diagnostic with the surface slug and nothing else. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/**
 * The capability matrix key the wrapped section needs in order to mount — the native analogue of the web
 * `RequiresAuthCapability = keyof AuthModeCapabilities` (web/src/components/feedback/RequiresAuth.tsx). Each
 * member pins the verbatim wire key the backend uses (`internal/api.AuthModeCapabilities` JSON tags) so the
 * web-parity test id (`requires-auth-empty-<wireKey>`) is byte-identical, and projects onto the matching
 * [AuthModeCapabilities] flag so the gate reads the same bool the web `data.capabilities[capability]` does.
 *
 * @property wireKey the snake_case contract key (web's `keyof` string), used to build the parity test id.
 */
enum class RequiresAuthCapability(
    val wireKey: String,
) {
    StepUpReauth("step_up_reauth"),
    TotpEnrollment("totp_enrollment"),
    SessionList("session_list"),
    Impersonation("impersonation"),
    Rbac("rbac"),
    ;

    /**
     * Whether [caps] grants this capability — the native analogue of the web `data.capabilities[capability]`
     * index. Every flag defaults to `false` (the safe "no auth" reading) when the matrix omits it.
     */
    fun isEnabled(caps: AuthModeCapabilities): Boolean =
        when (this) {
            StepUpReauth -> caps.stepUpReauth
            TotpEnrollment -> caps.totpEnrollment
            SessionList -> caps.sessionList
            Impersonation -> caps.impersonation
            Rbac -> caps.rbac
        }
}

/**
 * The stable per-capability test id stamped on the auth-gated notice — a verbatim port of the web
 * `requiresAuthEmptyTestId(capability)` (`requires-auth-empty-${capability}`), so a feature-page test can assert
 * "this section is gated" without re-deriving the string. Uses the capability's [RequiresAuthCapability.wireKey]
 * so the suffix matches the web `keyof AuthModeCapabilities` literal exactly.
 */
fun requiresAuthEmptyTestId(capability: RequiresAuthCapability): String = "requires-auth-empty-${capability.wireKey}"

/**
 * The render-relevant projection of the shared [AuthModeResponse] (P1/S8) — only the three facts the surface
 * needs: whether the deployment resolved to forward-auth mode, the per-feature gate matrix, and the operator's
 * provider hint. Folding the raw contract here keeps the view free of the auth-mode literal comparison and keeps
 * the gate decision unit-tested off-device.
 *
 * @property isForwardAuth whether the contract resolved to `mode == forward_auth` (shared [AuthModeDerivations]).
 * @property capabilities the per-feature gate matrix the capability flag is read from.
 * @property providerHint the operator-supplied free text rendered verbatim in the gated notice, or `null`.
 */
data class AuthModeView(
    val isForwardAuth: Boolean,
    val capabilities: AuthModeCapabilities,
    val providerHint: String?,
) {
    companion object {
        /** Folds the raw [AuthModeResponse] onto the surface's render view, reusing the shared mode derivation. */
        fun fromResponse(response: AuthModeResponse): AuthModeView =
            AuthModeView(
                isForwardAuth = AuthModeDerivations.isForwardAuth(response),
                capabilities = response.capabilities,
                providerHint = response.providerHint,
            )
    }
}

/**
 * The mutually-exclusive surface the wrapper renders, derived by [RequiresAuthProjection]. A closed set the view
 * switches on, so every branch is exhaustively covered and unit-tested; it maps the web component's three render
 * outcomes onto two render shapes:
 *  - [Unlocked] — forward-auth mode with the capability enabled: render the wrapped children unchanged (web branch
 *    `return <>{children}</>`).
 *  - [Locked]   — the auth-gated empty-state notice (web branches A & C). [providerHint] is `null` while the
 *    contract is unresolved (web `isLoading || !data`, and open mode without an operator hint) and carries the
 *    operator's provider hint once a resolved-but-gated contract supplies one.
 */
sealed interface RequiresAuthSurface {
    /** The capability is available — render the wrapped section (web `forward_auth && capabilities[capability]`). */
    data object Unlocked : RequiresAuthSurface

    /** The section is gated — render the auth notice. [providerHint] mirrors the web `provider_hint` it surfaces. */
    data class Locked(
        val providerHint: String?,
    ) : RequiresAuthSurface
}

/**
 * Pure surface-state projection for the RequiresAuth wrapper — the native port of the web component's three-branch
 * render ladder. Stateless and side-effect-free so it is fully covered by the off-device gate.
 */
object RequiresAuthProjection {
    /**
     * Selects the [RequiresAuthSurface] for the bound contract [state] and the section's required [capability].
     *
     * It reads [UiState.data] — the best-known cached contract — exactly as the web component reads the query's
     * `data`, so the full cache-then-network lifecycle folds faithfully onto the web's three outcomes:
     *  - no usable contract yet (`data == null`: first load / hard error, both with no cache) → [Locked] with no
     *    hint, verbatim web `isLoading || !data`.
     *  - a known contract in forward-auth mode with the capability enabled → [Unlocked] (web content branch).
     *  - any other known contract (open mode, or the capability disabled) → [Locked] carrying the contract's
     *    provider hint (web's gated branch).
     */
    fun project(
        state: UiState<AuthModeView>,
        capability: RequiresAuthCapability,
    ): RequiresAuthSurface {
        val contract = state.data ?: return RequiresAuthSurface.Locked(providerHint = null)
        return if (contract.isForwardAuth && capability.isEnabled(contract.capabilities)) {
            RequiresAuthSurface.Unlocked
        } else {
            RequiresAuthSurface.Locked(providerHint = contract.providerHint)
        }
    }
}

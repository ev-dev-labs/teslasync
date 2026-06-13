package io.teslasync.android.sharedsurfaces.requiresauth

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.AuthModeCapabilities
import io.teslasync.shared.core.data.repo.AuthModeResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the RequiresAuth surface's pure logic — the native analogue of the web component's
 * render derivation (web/src/components/feedback/RequiresAuth.tsx): the per-capability test-id (web
 * `requiresAuthEmptyTestId`), the capability-flag read (web `data.capabilities[capability]`), the contract
 * projection (web `AuthModeView.fromResponse`), and the three-branch surface selection that folds the bound
 * cache-then-network feed onto the web's children-or-notice outcomes. Runs in the :android:testReleaseUnitTest gate.
 */
class RequiresAuthProjectionTest {
    // ── Test-id parity (web requiresAuthEmptyTestId → "requires-auth-empty-<keyof AuthModeCapabilities>") ──────

    @Test
    fun emptyTestIdUsesTheVerbatimWireKeyForEveryCapability() {
        assertEquals("requires-auth-empty-step_up_reauth", requiresAuthEmptyTestId(RequiresAuthCapability.StepUpReauth))
        assertEquals("requires-auth-empty-totp_enrollment", requiresAuthEmptyTestId(RequiresAuthCapability.TotpEnrollment))
        assertEquals("requires-auth-empty-session_list", requiresAuthEmptyTestId(RequiresAuthCapability.SessionList))
        assertEquals("requires-auth-empty-impersonation", requiresAuthEmptyTestId(RequiresAuthCapability.Impersonation))
        assertEquals("requires-auth-empty-rbac", requiresAuthEmptyTestId(RequiresAuthCapability.Rbac))
    }

    // ── Capability flag read (web data.capabilities[capability]) ──────────────────────────────────────────────

    @Test
    fun isEnabledReadsTheMatchingFlagForEachCapability() {
        assertTrue(RequiresAuthCapability.StepUpReauth.isEnabled(AuthModeCapabilities(stepUpReauth = true)))
        assertTrue(RequiresAuthCapability.TotpEnrollment.isEnabled(AuthModeCapabilities(totpEnrollment = true)))
        assertTrue(RequiresAuthCapability.SessionList.isEnabled(AuthModeCapabilities(sessionList = true)))
        assertTrue(RequiresAuthCapability.Impersonation.isEnabled(AuthModeCapabilities(impersonation = true)))
        assertTrue(RequiresAuthCapability.Rbac.isEnabled(AuthModeCapabilities(rbac = true)))
        // Each reads only its own flag — a sibling flag being set does not unlock it.
        assertFalse(RequiresAuthCapability.Rbac.isEnabled(AuthModeCapabilities(sessionList = true)))
        // The default matrix (every flag false) gates every capability — the safe "no auth" reading.
        assertFalse(RequiresAuthCapability.SessionList.isEnabled(AuthModeCapabilities()))
    }

    // ── Contract projection (web AuthModeView from the useAuthMode response) ──────────────────────────────────

    @Test
    fun fromResponseFoldsModeCapabilitiesAndHint() {
        val view =
            AuthModeView.fromResponse(
                AuthModeResponse(
                    mode = "forward_auth",
                    providerHint = "Authentik",
                    capabilities = AuthModeCapabilities(rbac = true),
                ),
            )
        assertTrue(view.isForwardAuth)
        assertTrue(view.capabilities.rbac)
        assertEquals("Authentik", view.providerHint)
    }

    @Test
    fun fromResponseTreatsOpenAndUnknownModesAsNonForwardAuth() {
        assertFalse(AuthModeView.fromResponse(AuthModeResponse(mode = "open")).isForwardAuth)
        assertFalse(AuthModeView.fromResponse(AuthModeResponse(mode = "nonsense")).isForwardAuth)
    }

    // ── Surface selection across every lifecycle state ────────────────────────────────────────────────────────

    @Test
    fun firstLoadWithNoCacheIsLockedWithoutHint() {
        // web: isLoading || !data → notice without a provider hint.
        assertEquals(RequiresAuthSurface.Locked(providerHint = null), project(UiState.loading()))
    }

    @Test
    fun hardErrorWithNoCacheIsLockedWithoutHint() {
        // web: !data (the query errored, retaining nothing) → the same notice the loading branch renders.
        val state = UiState<AuthModeView>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(RequiresAuthSurface.Locked(providerHint = null), project(state))
    }

    @Test
    fun forwardAuthWithTheCapabilityEnabledIsUnlocked() {
        // web branch: mode === 'forward_auth' && capabilities[capability] → render children.
        val state = contentState(isForwardAuth = true, capabilities = AuthModeCapabilities(sessionList = true))
        assertEquals(RequiresAuthSurface.Unlocked, project(state, RequiresAuthCapability.SessionList))
    }

    @Test
    fun openModeIsLockedWithTheProviderHint() {
        // web else branch: open mode → notice with the operator's provider_hint.
        val state = contentState(isForwardAuth = false, providerHint = "oauth2-proxy")
        assertEquals(RequiresAuthSurface.Locked(providerHint = "oauth2-proxy"), project(state))
    }

    @Test
    fun forwardAuthWithTheCapabilityDisabledIsLockedWithHint() {
        // web else branch: a resolved contract whose capability flag is false still renders the notice.
        val state =
            contentState(
                isForwardAuth = true,
                capabilities = AuthModeCapabilities(sessionList = false),
                providerHint = "Keycloak",
            )
        assertEquals(RequiresAuthSurface.Locked(providerHint = "Keycloak"), project(state, RequiresAuthCapability.SessionList))
    }

    @Test
    fun aCachedContractDuringARefreshResolvesTheGateFromTheCachedValue() {
        // web: once `data` exists, a background refetch (isLoading false) keeps gating from the retained contract.
        val state =
            UiState(
                phase = UiPhase.Content,
                data = AuthModeView(isForwardAuth = true, capabilities = AuthModeCapabilities(rbac = true), providerHint = null),
                refreshing = true,
            )
        assertEquals(RequiresAuthSurface.Unlocked, project(state, RequiresAuthCapability.Rbac))
    }

    @Test
    fun aStaleOrOfflineCachedContractStillResolvesTheGateFromTheCachedValue() {
        // web: a stale / offline (error-with-cache) contract still gates from the cached `data` — no blank surface.
        val staleUnlocked =
            UiState(
                phase = UiPhase.Content,
                data = AuthModeView(isForwardAuth = true, capabilities = AuthModeCapabilities(impersonation = true), providerHint = null),
                stale = true,
            )
        assertEquals(RequiresAuthSurface.Unlocked, project(staleUnlocked, RequiresAuthCapability.Impersonation))

        val offlineLocked =
            UiState(
                phase = UiPhase.Content,
                data = AuthModeView(isForwardAuth = false, capabilities = AuthModeCapabilities(), providerHint = "Authelia"),
                stale = true,
                errorKind = ErrorKind.Network,
            )
        assertEquals(RequiresAuthSurface.Locked(providerHint = "Authelia"), project(offlineLocked))
    }

    @Test
    fun aResolvedOpenContractWithoutAnOperatorHintIsLockedWithNullHint() {
        // Open mode where the operator set no TESLASYNC_AUTH_PROVIDER_HINT → the generic (no-hint) notice copy.
        val state = contentState(isForwardAuth = false, providerHint = null)
        val surface = project(state)
        assertTrue(surface is RequiresAuthSurface.Locked)
        assertNull((surface as RequiresAuthSurface.Locked).providerHint)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────

    private fun project(
        state: UiState<AuthModeView>,
        capability: RequiresAuthCapability = RequiresAuthCapability.SessionList,
    ): RequiresAuthSurface = RequiresAuthProjection.project(state, capability)

    private fun contentState(
        isForwardAuth: Boolean,
        capabilities: AuthModeCapabilities = AuthModeCapabilities(),
        providerHint: String? = null,
    ): UiState<AuthModeView> =
        UiState(
            phase = UiPhase.Content,
            data = AuthModeView(isForwardAuth = isForwardAuth, capabilities = capabilities, providerHint = providerHint),
        )
}

package io.teslasync.android.featureviews.onboardinggate

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.Destinations
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the OnboardingGate surface's pure guard logic — the adapter test the prompt
 * requires (the resolved redirect decision) plus the per-branch, allow-list, route-parity and diagnostics
 * pins. Mirrors the web source (web/src/features/onboarding/components/OnboardingGate.tsx): the five
 * short-circuit guard clauses (loading / error / no-data / complete / skipped / allow-listed) and the single
 * `navigate('/onboarding', { replace: true })` redirect, the verbatim `ALLOW_PREFIXES` prefix-match
 * semantics, and the PII-safe `view.opened` diagnostic. Runs in the offline `:android:testReleaseUnitTest`
 * gate; the Compose render + accessibility are covered by the on-device OnboardingGateUiTest.
 */
class OnboardingGateResolverTest {
    private val incomplete =
        OnboardingStatus(teslaConnected = true, vehicleCount = 1, dataFlowing = false, isComplete = false)
    private val complete =
        OnboardingStatus(teslaConnected = true, vehicleCount = 1, dataFlowing = true, isComplete = true)

    // ── decide(): the five guard clauses, in web order ───────────────────────────────

    @Test
    fun loadingPassesEvenWhenTheStatusWouldOtherwiseRedirect() {
        val decision =
            OnboardingGateResolver.decide(
                isLoading = true,
                isError = false,
                status = incomplete,
                isSkipped = false,
                pathname = "/dashboard",
            )
        assertEquals(OnboardingGateDecision.Pass(OnboardingGatePassReason.Loading), decision)
    }

    @Test
    fun errorPassesAndTakesPrecedenceOverARedirectableStatus() {
        // Web `isError` returns before the redirect, even when a (stale) incomplete gate is in hand.
        assertEquals(
            OnboardingGateDecision.Pass(OnboardingGatePassReason.Error),
            OnboardingGateResolver.decide(false, isError = true, status = null, isSkipped = false, pathname = "/dashboard"),
        )
        assertEquals(
            OnboardingGateDecision.Pass(OnboardingGatePassReason.Error),
            OnboardingGateResolver.decide(false, isError = true, status = incomplete, isSkipped = false, pathname = "/dashboard"),
        )
    }

    @Test
    fun resolvedButNullStatusPasses() {
        assertEquals(
            OnboardingGateDecision.Pass(OnboardingGatePassReason.NoData),
            OnboardingGateResolver.decide(false, false, status = null, isSkipped = false, pathname = "/dashboard"),
        )
    }

    @Test
    fun completeInstallPassesAndOutranksSkipAndPath() {
        assertEquals(
            OnboardingGateDecision.Pass(OnboardingGatePassReason.Complete),
            OnboardingGateResolver.decide(false, false, status = complete, isSkipped = true, pathname = "/dashboard"),
        )
    }

    @Test
    fun skippedPassesAndOutranksTheGuardedPath() {
        assertEquals(
            OnboardingGateDecision.Pass(OnboardingGatePassReason.Skipped),
            OnboardingGateResolver.decide(false, false, status = incomplete, isSkipped = true, pathname = "/dashboard"),
        )
    }

    @Test
    fun allowListedPathPasses() {
        assertEquals(
            OnboardingGateDecision.Pass(OnboardingGatePassReason.AllowListed),
            OnboardingGateResolver.decide(false, false, status = incomplete, isSkipped = false, pathname = "/onboarding"),
        )
    }

    @Test
    fun incompleteResolvedNonSkippedGuardedPathRedirectsToOnboarding() {
        val decision =
            OnboardingGateResolver.decide(false, false, status = incomplete, isSkipped = false, pathname = "/dashboard")

        assertTrue(decision is OnboardingGateDecision.Redirect)
        val target = (decision as OnboardingGateDecision.Redirect).target
        assertEquals("onboarding", target.route)
        assertEquals("/onboarding", target.webPath)
        assertEquals("onboarding", target.destinationId)
        assertTrue(target.replace)
    }

    // ── decide(UiState) overload: the exact shape the ViewModel exposes ───────────────

    @Test
    fun uiStateLoadingPasses() {
        assertEquals(
            OnboardingGateDecision.Pass(OnboardingGatePassReason.Loading),
            OnboardingGateResolver.decide(UiState.loading(), isSkipped = false, pathname = "/dashboard"),
        )
    }

    @Test
    fun uiStateContentIncompleteRedirects() {
        val ui = UiState(phase = UiPhase.Content, data = incomplete, fetchedAt = 1L)
        assertTrue(OnboardingGateResolver.decide(ui, isSkipped = false, pathname = "/dashboard") is OnboardingGateDecision.Redirect)
    }

    @Test
    fun uiStateContentCompletePasses() {
        val ui = UiState(phase = UiPhase.Content, data = complete, fetchedAt = 1L)
        assertEquals(
            OnboardingGateDecision.Pass(OnboardingGatePassReason.Complete),
            OnboardingGateResolver.decide(ui, isSkipped = false, pathname = "/dashboard"),
        )
    }

    @Test
    fun uiStateHardErrorPasses() {
        val ui = UiState<OnboardingStatus>(phase = UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(
            OnboardingGateDecision.Pass(OnboardingGatePassReason.Error),
            OnboardingGateResolver.decide(ui, isSkipped = false, pathname = "/dashboard"),
        )
    }

    @Test
    fun uiStateOfflineCachedStatusPasses() {
        // Offline = cached gate served after a failed refresh (web `isError` with last-known data) → no bounce.
        val ui =
            UiState(
                phase = UiPhase.Content,
                data = incomplete,
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            )
        assertEquals(
            OnboardingGateDecision.Pass(OnboardingGatePassReason.Error),
            OnboardingGateResolver.decide(ui, isSkipped = false, pathname = "/dashboard"),
        )
    }

    // ── isAllowed(): verbatim web ALLOW_PREFIXES prefix-match semantics ───────────────

    @Test
    fun allowListMatchesExactPathsAndRootedSubtrees() {
        listOf(
            "/onboarding",
            "/onboarding/step-2",
            "/tesla-account",
            "/tesla-account/keys",
            "/settings",
            "/settings/units",
            "/watch",
            "/watch/face",
            "/login",
            "/login/callback",
        ).forEach { assertTrue("expected allowed: $it", OnboardingGateResolver.isAllowed(it)) }
    }

    @Test
    fun trailingSlashPrefixMatchesOnlyTheRootedSubtree() {
        // `/s/` ends with `/` → raw startsWith: `/s/abc` allowed, bare `/s` is not.
        assertTrue(OnboardingGateResolver.isAllowed("/s/abc123"))
        assertFalse(OnboardingGateResolver.isAllowed("/s"))
    }

    @Test
    fun allowListRejectsSiblingsThatMerelyShareThePrefixString() {
        // `/onboardings` is neither an exact match nor `/onboarding/`-rooted — must NOT bypass the guard.
        assertFalse(OnboardingGateResolver.isAllowed("/onboardings"))
        assertFalse(OnboardingGateResolver.isAllowed("/settings-export"))
    }

    @Test
    fun allowListRejectsGuardedAppPaths() {
        listOf("/", "/dashboard", "/vehicles", "/charging", "/drives").forEach {
            assertFalse("expected guarded: $it", OnboardingGateResolver.isAllowed(it))
        }
    }

    @Test
    fun allowPrefixesMatchTheWebSourceVerbatim() {
        assertEquals(
            listOf("/onboarding", "/tesla-account", "/settings", "/s/", "/watch", "/login"),
            OnboardingGateResolver.ALLOW_PREFIXES,
        )
    }

    // ── Native route parity vs the canonical Destinations registry ───────────────────

    @Test
    fun redirectTargetMatchesTheCanonicalOnboardingDestination() {
        val onboarding = Destinations.require("onboarding")
        assertEquals(onboarding.route, OnboardingGateResolver.ONBOARDING_ROUTE)
        assertEquals(onboarding.webPath, OnboardingGateResolver.ONBOARDING_WEB_PATH)
        assertEquals(onboarding.id, OnboardingGateResolver.ONBOARDING_DESTINATION_ID)
    }

    @Test
    fun defaultTargetCarriesTheCanonicalOnboardingRoute() {
        val target = OnboardingGateTarget()
        assertEquals("onboarding", target.route)
        assertEquals("/onboarding", target.webPath)
        assertEquals("onboarding", target.destinationId)
        assertTrue(target.replace)
    }

    // ── Diagnostics: PII-safe view.opened ────────────────────────────────────────────

    @Test
    fun diagnosticsSlugAndIdAreStable() {
        assertEquals("OnboardingGate", OnboardingGateDiagnostics.SLUG)
        assertEquals("onboarding-gate", OnboardingGateDiagnostics.ID)
    }

    @Test
    fun recordViewOpenedEmitsPiiSafeViewOpenedWithSurfaceSlugOnly() {
        val logger = RecordingLogger()

        OnboardingGateDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "OnboardingGate"), fields)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}

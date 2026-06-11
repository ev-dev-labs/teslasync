package io.teslasync.android.featureviews.userimpersonatebutton

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the UserImpersonateButton's pure logic — the native analogue of the web
 * component's render derivation (web/src/features/admin/components/UserImpersonateButton.tsx): the
 * impersonation-status mode mapping, the lifecycle surface-state selection that folds the host's
 * cache-then-network feed and the in-flight start mutation, and the button's label / enablement /
 * aria-label / test-tag derivation (web `disabled || startMut.isPending`, `Starting…` vs `Impersonate`,
 * `Impersonate {{subject}}`, `user-impersonate-button-${subject}`). Runs in the :android:testReleaseUnitTest
 * gate.
 */
class UserImpersonateButtonProjectionTest {
    private val strings =
        UserImpersonateButtonStrings(
            start = "Impersonate",
            starting = "Starting\u2026",
            confirmTitle = "Start impersonation session?",
            confirmConfirm = "Start impersonation",
            confirmCancel = "Cancel",
            closeLabel = "Close",
            emptyTitle = "No other subjects",
            emptyMessage = "No other subjects have an active session right now.",
            openModeMessage = "Impersonation requires forward-auth mode.",
            errorTitle = "Server error",
            errorMessage = "Something went wrong on our end. Please try again.",
            retry = "Retry",
            loadingLabel = "Loading...",
            offlineLabel = "Offline",
            ariaLabel = { subject -> "Impersonate $subject" },
            confirmMessage = { subject -> "You will see TeslaSync as $subject for up to 15 minutes." },
        )

    private fun content(
        mode: ImpersonationMode = ImpersonationMode.Inactive,
        stale: Boolean = false,
        errorKind: ErrorKind? = null,
        fetchedAt: Long? = null,
    ): UiState<ImpersonationView> =
        UiState(
            phase = UiPhase.Content,
            data = ImpersonationView(mode),
            stale = stale,
            errorKind = errorKind,
            fetchedAt = fetchedAt,
        )

    private fun project(
        subject: String = "alice",
        state: UiState<ImpersonationView> = content(),
        starting: Boolean = false,
        disabled: Boolean = false,
    ) = UserImpersonateButtonProjection.project(subject, state, starting, disabled, strings)

    // ── Mode classification (web useImpersonationStatus union) ───────────────────

    @Test
    fun modeFromRawMapsKnownValuesAndFoldsUnknownToInactive() {
        assertEquals(ImpersonationMode.Active, ImpersonationMode.fromRaw("active"))
        assertEquals(ImpersonationMode.Open, ImpersonationMode.fromRaw("open"))
        assertEquals(ImpersonationMode.Inactive, ImpersonationMode.fromRaw("inactive"))
        assertEquals(ImpersonationMode.Inactive, ImpersonationMode.fromRaw(null))
        assertEquals(ImpersonationMode.Inactive, ImpersonationMode.fromRaw("nonsense"))
    }

    // ── Button derivation (label / aria / test-tag) ──────────────────────────────

    @Test
    fun testTagUsesRawSubjectVerbatim() {
        assertEquals("user-impersonate-button-alice", UserImpersonateButtonProjection.testTagFor("alice"))
        assertEquals("user-impersonate-button-a b", UserImpersonateButtonProjection.testTagFor("a b"))
    }

    @Test
    fun idleContentEnablesTheImpersonateButton() {
        val model = project(subject = "alice")
        assertEquals(ImpersonateButtonSurface.Idle, model.surface)
        assertEquals("Impersonate", model.actionLabel)
        assertEquals("Impersonate alice", model.ariaLabel)
        assertEquals("user-impersonate-button-alice", model.testTag)
        assertTrue(model.enabled)
        assertFalse(model.loading)
    }

    @Test
    fun startingShowsStartingLabelSpinnerAndDisables() {
        val model = project(starting = true)
        assertEquals("Starting\u2026", model.actionLabel)
        assertTrue(model.loading)
        assertFalse(model.enabled)
        // The button stays on the content/idle path while the mutation is in flight (web parity).
        assertEquals(ImpersonateButtonSurface.Idle, model.surface)
    }

    @Test
    fun disabledPropDisablesTheButtonButKeepsIdleSurface() {
        val model = project(disabled = true)
        assertEquals(ImpersonateButtonSurface.Idle, model.surface)
        assertFalse(model.enabled)
        assertFalse(model.loading)
    }

    // ── Surface selection across every lifecycle state ────────────────────────────

    @Test
    fun blankOrWhitespaceSubjectIsEmptyAndDisabled() {
        assertEquals(ImpersonateButtonSurface.Empty, project(subject = "").surface)
        val whitespace = project(subject = "   ")
        assertEquals(ImpersonateButtonSurface.Empty, whitespace.surface)
        assertFalse(whitespace.enabled)
    }

    @Test
    fun firstLoadIsLoadingSurfaceAndDisabled() {
        val model = project(state = UiState.loading())
        assertEquals(ImpersonateButtonSurface.Loading, model.surface)
        assertFalse(model.enabled)
    }

    @Test
    fun hardFailureIsErrorSurfaceAndDisabled() {
        val model = project(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network))
        assertEquals(ImpersonateButtonSurface.Error, model.surface)
        assertFalse(model.enabled)
    }

    @Test
    fun openModeIsOpenModeSurfaceAndDisabled() {
        val model = project(state = content(mode = ImpersonationMode.Open))
        assertEquals(ImpersonateButtonSurface.OpenMode, model.surface)
        assertFalse(model.enabled)
    }

    @Test
    fun replayedEmptyFeedIsEmptySurface() {
        val empty = UiState<ImpersonationView>(UiPhase.Empty)
        assertEquals(ImpersonateButtonSurface.Empty, project(state = empty).surface)
    }

    @Test
    fun staleButOnlineIsStaleSurfaceAndStaysEnabled() {
        val model = project(state = content(stale = true, fetchedAt = 1_700_000_000_000L))
        assertEquals(ImpersonateButtonSurface.Stale, model.surface)
        assertTrue(model.enabled)
    }

    @Test
    fun cachedAfterFailureIsOfflineSurfaceAndDisablesStart() {
        val model =
            project(
                state = content(stale = true, errorKind = ErrorKind.Network, fetchedAt = 1_700_000_000_000L),
            )
        assertEquals(ImpersonateButtonSurface.Offline, model.surface)
        assertFalse(model.enabled)
    }

    @Test
    fun startingTakesPrecedenceOverAStaleFeed() {
        val model = project(state = content(stale = true), starting = true)
        assertEquals(ImpersonateButtonSurface.Idle, model.surface)
        assertTrue(model.loading)
        assertFalse(model.enabled)
    }

    @Test
    fun openModeIsSurfacedEvenWhenSubjectIsBlank() {
        val model = project(subject = "", state = content(mode = ImpersonationMode.Open))
        assertEquals(ImpersonateButtonSurface.OpenMode, model.surface)
    }
}

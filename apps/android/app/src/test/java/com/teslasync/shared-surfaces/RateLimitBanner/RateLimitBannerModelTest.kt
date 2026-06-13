// Off-device unit tests for the RateLimitBanner model + countdown reducer + data-port seam (the
// :android:testReleaseUnitTest gate). These cover the framework-free core the composable renders: the
// signal → state fold (web `onLimited` / `onUpstream`), the ceil-rounding countdown (web
// `Math.ceil((expiresAt - now) / 1000)`), the retry-enable gate (web `disabled={remaining > 0}`), the
// every-branch surface classification (Hidden vs Visible × kind × counting-down/retry-ready), the
// in-memory/adapter source seams (the web document-event stream + `qc.invalidateQueries()`), and the
// PII-safe `view.opened` diagnostic. The composable is a thin render layer over these, so exercising them
// here is the surface's behavioral contract.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ratelimitbanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RateLimitBannerModelTest {
    // ── signal → state fold (web onLimited / onUpstream) ──────────────────────────────────────────────────

    @Test
    fun stateFromSignal_setsDeadlineAndCarriesDetail() {
        val signal = RateLimitSignal(RateLimitKind.RateLimited, retryAfterSeconds = 30, scope = "/vehicles")
        val state = stateFromSignal(signal, nowMillis = NOW)
        assertEquals(RateLimitKind.RateLimited, state.kind)
        assertEquals(NOW + 30_000L, state.expiresAtMillis)
        assertEquals("/vehicles", state.scope)
    }

    @Test
    fun stateFromSignal_carriesUpstreamForBreakerSignal() {
        val signal = RateLimitSignal(RateLimitKind.UpstreamDown, retryAfterSeconds = 12, upstream = "tesla")
        val state = stateFromSignal(signal, nowMillis = NOW)
        assertEquals(RateLimitKind.UpstreamDown, state.kind)
        assertEquals("tesla", state.upstream)
        assertEquals(NOW + 12_000L, state.expiresAtMillis)
    }

    @Test
    fun stateFromSignal_clampsNegativeRetryAfterToNow() {
        val signal = RateLimitSignal(RateLimitKind.RateLimited, retryAfterSeconds = -5)
        val state = stateFromSignal(signal, nowMillis = NOW)
        assertEquals(NOW, state.expiresAtMillis)
    }

    // ── countdown (web Math.max(0, Math.ceil((expiresAt - now) / 1000))) ──────────────────────────────────

    @Test
    fun remainingSeconds_roundsUpAPartialFinalSecond() {
        assertEquals(5, remainingSeconds(expiresAtMillis = NOW + 4_500L, nowMillis = NOW))
        assertEquals(1, remainingSeconds(expiresAtMillis = NOW + 1L, nowMillis = NOW))
    }

    @Test
    fun remainingSeconds_isExactOnWholeSecondBoundaries() {
        assertEquals(5, remainingSeconds(expiresAtMillis = NOW + 5_000L, nowMillis = NOW))
        assertEquals(60, remainingSeconds(expiresAtMillis = NOW + 60_000L, nowMillis = NOW))
    }

    @Test
    fun remainingSeconds_saturatesAtZeroOnceElapsed() {
        assertEquals(0, remainingSeconds(expiresAtMillis = NOW, nowMillis = NOW))
        assertEquals(0, remainingSeconds(expiresAtMillis = NOW - 100L, nowMillis = NOW))
    }

    // ── retry gate (web disabled={remaining > 0}) ─────────────────────────────────────────────────────────

    @Test
    fun isRetryEnabled_onlyOnceCountdownElapsed() {
        assertFalse(isRetryEnabled(3))
        assertFalse(isRetryEnabled(1))
        assertTrue(isRetryEnabled(0))
        assertTrue(isRetryEnabled(-1))
    }

    // ── surface classification (Hidden vs Visible, every branch) ──────────────────────────────────────────

    @Test
    fun classify_nullStateIsHidden() {
        assertTrue(classify(state = null, nowMillis = NOW) is RateLimitSurface.Hidden)
    }

    @Test
    fun classify_countingDownIsVisibleWithDisabledRetry() {
        val state = RateLimitState(RateLimitKind.RateLimited, expiresAtMillis = NOW + 30_000L)
        val surface = classify(state, nowMillis = NOW)
        assertTrue(surface is RateLimitSurface.Visible)
        surface as RateLimitSurface.Visible
        assertEquals(RateLimitKind.RateLimited, surface.kind)
        assertEquals(30, surface.remainingSeconds)
        assertFalse(surface.retryEnabled)
    }

    @Test
    fun classify_elapsedIsVisibleWithEnabledRetry() {
        val state = RateLimitState(RateLimitKind.UpstreamDown, expiresAtMillis = NOW)
        val surface = classify(state, nowMillis = NOW)
        assertTrue(surface is RateLimitSurface.Visible)
        surface as RateLimitSurface.Visible
        assertEquals(RateLimitKind.UpstreamDown, surface.kind)
        assertEquals(0, surface.remainingSeconds)
        assertTrue(surface.retryEnabled)
    }

    // ── data-port seam: in-memory source (the web document-event stream + invalidateQueries) ──────────────

    @Test
    fun inMemorySource_deliversEmittedSignalsToCollectors() =
        runTest {
            val source = InMemoryRateLimitBannerSource()
            val received = mutableListOf<RateLimitSignal>()
            val job = launch { source.signals.collect { received += it } }
            advanceUntilIdle()

            val signal = RateLimitSignal(RateLimitKind.RateLimited, retryAfterSeconds = 30, scope = "/drives")
            source.emit(signal)
            advanceUntilIdle()

            assertEquals(listOf(signal), received)
            job.cancel()
        }

    @Test
    fun inMemorySource_recordsRetryAllInvocations() =
        runTest {
            val source = InMemoryRateLimitBannerSource()
            assertEquals(0, source.retryCalls)
            source.retryAll()
            source.retryAll()
            assertEquals(2, source.retryCalls)
        }

    @Test
    fun adapterSource_forwardsSignalsAndRetry() =
        runTest {
            var retried = 0
            val upstream = MutableSharedFlow<RateLimitSignal>(extraBufferCapacity = 1)
            val source = rateLimitBannerSource(upstream) { retried += 1 }
            val received = mutableListOf<RateLimitSignal>()
            val job = launch { source.signals.collect { received += it } }
            advanceUntilIdle()

            val signal = RateLimitSignal(RateLimitKind.UpstreamDown, retryAfterSeconds = 10, upstream = "tesla")
            upstream.emit(signal)
            advanceUntilIdle()
            source.retryAll()

            assertEquals(listOf(signal), received)
            assertEquals(1, retried)
            job.cancel()
        }

    // ── diagnostics (P1/S11): view.opened carries only the slug ───────────────────────────────────────────

    @Test
    fun recordViewOpened_emitsViewOpenedWithSlugOnly() {
        val logger = RecordingLogger()
        RateLimitBannerDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.first()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "RateLimitBanner"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }

    private companion object {
        const val NOW = 1_700_000_000_000L
    }
}

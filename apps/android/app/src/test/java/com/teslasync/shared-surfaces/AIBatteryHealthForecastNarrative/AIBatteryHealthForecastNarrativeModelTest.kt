// Off-device unit coverage for the AIBatteryHealthForecastNarrative shared surface's pure model (P3 acceptance:
// adapter + per-state + a11y label tests). Exercises the default strings + i18n resource names that mirror the
// web source, the active-vehicle gate (web `haveInputs`), the surface-state classifier the composable switches
// on (per-state coverage: Offline / Error / Thinking / Narrative / Ready), the Narrate button-enabled rule (web
// `disabled = !canStart || isStreaming` plus the connectivity gate), the shared P1/S8 UiState connectivity fold
// (loading / content / empty / error / stale / offline lifecycle coverage), the accessibility output
// announcements (a11y label coverage), the host visibility gate (web `withAiFeature`), the stream snapshot, and
// the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
// Reference values are the strings + behaviour the web component produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aibatteryhealthforecastnarrative

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AIBatteryHealthForecastNarrativeModelTest {
    // ── defaults + i18n keys mirror the web source ──────────────────────────────

    @Test
    fun defaultsMirrorWebSource() {
        assertEquals("Explain the battery health forecast", AIBatteryHealthForecastNarrativeDefaults.TITLE)
        assertEquals("Narrate forecast", AIBatteryHealthForecastNarrativeDefaults.BUTTON_LABEL)
        assertEquals("Helix", AIBatteryHealthForecastNarrativeDefaults.BADGE)
        assertEquals("/ai/battery/health/narrate", AIBatteryHealthForecastNarrativeDefaults.NARRATE_URL)
        // The full privacy-grounded description (em dash = U+2014), reproduced verbatim from the web default.
        assertEquals(
            "Ask Helix to explain which charging habits and risk factors drive your deterministic " +
                "battery-health forecast. The narrator never changes the forecast \u2014 it grounds every " +
                "sentence in the same numbers the chart below renders.",
            AIBatteryHealthForecastNarrativeDefaults.DESCRIPTION,
        )
    }

    @Test
    fun i18nKeysMatchCatalogResourceNames() {
        // Each web `battery.aiNarrative.*` key maps to a `translation_*` resource present in values/, values-ar/,
        // and values-he/ (asserted by name; resource bytes are not read off-device).
        assertEquals("translation_battery_aiNarrative_title", KEY_TITLE)
        assertEquals("translation_battery_aiNarrative_description", KEY_DESCRIPTION)
        assertEquals("translation_battery_aiNarrative_generateButton", KEY_BUTTON_LABEL)
        assertEquals("translation_battery_aiNarrative_badge", KEY_BADGE)
        // The shared lifecycle chrome keys the surface reuses (all present in the catalog).
        assertEquals("translation_common_loading", AIBatteryHealthForecastNarrativeStateKeys.LOADING)
        assertEquals("translation_common_offline", AIBatteryHealthForecastNarrativeStateKeys.OFFLINE)
        assertEquals("translation_error_network_offlineDetail", AIBatteryHealthForecastNarrativeStateKeys.OFFLINE_DETAIL)
        assertEquals("translation_common_retry", AIBatteryHealthForecastNarrativeStateKeys.RETRY)
        assertEquals("translation_error_serverError_title", AIBatteryHealthForecastNarrativeStateKeys.ERROR_TITLE)
        assertEquals("translation_error_serverError_message", AIBatteryHealthForecastNarrativeStateKeys.ERROR_MESSAGE)
    }

    // ── active-vehicle gate (web `haveInputs = numericVehicleId > 0`) ────────────

    @Test
    fun canNarrateRequiresAPositiveVehicleId() {
        assertTrue(canNarrate(1L))
        assertTrue(canNarrate(987654L))
        assertFalse(canNarrate(null))
        assertFalse(canNarrate(0L))
        assertFalse(canNarrate(-1L))
    }

    // ── stream snapshot (web AIFeatureStream { state, text }) ─────────────────────

    @Test
    fun streamSnapshotDerivesHasText() {
        assertFalse(AiNarrativeStreamState().hasText)
        assertFalse(AiNarrativeStreamState(phase = AiStreamPhase.Streaming).hasText)
        assertTrue(AiNarrativeStreamState(phase = AiStreamPhase.Done, text = "ok").hasText)
        // Idle is the default lifecycle, matching useAiStream's initial `state='idle'`.
        assertEquals(AiStreamPhase.Idle, AiNarrativeStreamState().phase)
    }

    // ── surface classifier: per-state coverage (web AiOutputPanel branches + offline) ──

    @Test
    fun surfaceClassifierCoversEveryState() {
        // Offline wins first regardless of the stream phase (connectivity is the most fundamental gate).
        assertEquals(
            AiNarrativeSurface.Offline,
            aiNarrativeSurfaceFor(online = false, phase = AiStreamPhase.Done, hasText = true),
        )
        assertEquals(
            AiNarrativeSurface.Offline,
            aiNarrativeSurfaceFor(online = false, phase = AiStreamPhase.Idle, hasText = false),
        )
        // A hard stream error (online).
        assertEquals(
            AiNarrativeSurface.Error,
            aiNarrativeSurfaceFor(online = true, phase = AiStreamPhase.Error, hasText = false),
        )
        // Open-but-empty → thinking (web `state==='streaming' && text===''`).
        assertEquals(
            AiNarrativeSurface.Thinking,
            aiNarrativeSurfaceFor(online = true, phase = AiStreamPhase.Streaming, hasText = false),
        )
        // Any present text (streaming or done) → narrative.
        assertEquals(
            AiNarrativeSurface.Narrative,
            aiNarrativeSurfaceFor(online = true, phase = AiStreamPhase.Streaming, hasText = true),
        )
        assertEquals(
            AiNarrativeSurface.Narrative,
            aiNarrativeSurfaceFor(online = true, phase = AiStreamPhase.Done, hasText = true),
        )
        // Idle / empty-completion → the ready presentation (web AiOutputPanel returns null).
        assertEquals(
            AiNarrativeSurface.Ready,
            aiNarrativeSurfaceFor(online = true, phase = AiStreamPhase.Idle, hasText = false),
        )
        assertEquals(
            AiNarrativeSurface.Ready,
            aiNarrativeSurfaceFor(online = true, phase = AiStreamPhase.Done, hasText = false),
        )
    }

    // ── Narrate button-enabled rule (web `disabled = !canStart || isStreaming`) ──

    @Test
    fun narrativeButtonEnabledFollowsCanStartStreamingAndConnectivity() {
        // Ready + online + vehicle resolved → enabled.
        assertTrue(narrativeButtonEnabled(online = true, canNarrate = true, phase = AiStreamPhase.Idle))
        // Re-enabled after a finished or failed stream so the user can re-narrate.
        assertTrue(narrativeButtonEnabled(online = true, canNarrate = true, phase = AiStreamPhase.Done))
        assertTrue(narrativeButtonEnabled(online = true, canNarrate = true, phase = AiStreamPhase.Error))
        // Disabled while a stream is in flight (double-submit protection).
        assertFalse(narrativeButtonEnabled(online = true, canNarrate = true, phase = AiStreamPhase.Streaming))
        // Disabled with no resolved vehicle (web `!canStart`).
        assertFalse(narrativeButtonEnabled(online = true, canNarrate = false, phase = AiStreamPhase.Idle))
        // Disabled offline.
        assertFalse(narrativeButtonEnabled(online = false, canNarrate = true, phase = AiStreamPhase.Idle))
    }

    // ── shared P1/S8 UiState connectivity fold (stale / offline lifecycle coverage) ──

    @Test
    fun onlineFromLifecycleBindsSharedUiStateFreshness() {
        // A first load, fresh content, and an empty payload are all online.
        assertTrue(onlineFromLifecycle(UiState.loading<Unit>()))
        assertTrue(onlineFromLifecycle(UiState(UiPhase.Content, data = Unit)))
        assertTrue(onlineFromLifecycle(UiState(UiPhase.Empty, data = Unit)))
        // A hard error with no cache is not "offline" (no cached value shown); the stream's own error drives it.
        assertTrue(onlineFromLifecycle(UiState<Unit>(UiPhase.Error, errorKind = ErrorKind.Network)))
        // Stale/offline cached content after a failed refresh (web "last known") → offline surface.
        val offline = UiState(UiPhase.Content, data = Unit, stale = true, errorKind = ErrorKind.Network)
        assertTrue(offline.isOffline)
        assertFalse(onlineFromLifecycle(offline))
        // That cached-but-offline lifecycle classifies to the Offline surface, preserving the cached narrative.
        assertEquals(
            AiNarrativeSurface.Offline,
            aiNarrativeSurfaceFor(onlineFromLifecycle(offline), AiStreamPhase.Done, hasText = true),
        )
    }

    // ── accessibility output announcements (a11y label coverage) ──────────────────

    @Test
    fun outputAnnouncementFoldsEachStateForTalkBack() {
        val loading = "Loading…"
        val errorTitle = "Server error"
        val errorMessage = "Something went wrong on our end. Please try again."
        val offline = "Offline"
        val offlineDetail = "We'll retry automatically when your connection returns."
        val labels =
            NarrativeOutputLabels(
                loading = loading,
                errorTitle = errorTitle,
                errorMessage = errorMessage,
                offline = offline,
                offlineDetail = offlineDetail,
            )

        fun announce(
            surface: AiNarrativeSurface,
            text: String,
        ): String = narrativeOutputAnnouncement(surface = surface, text = text, labels = labels)

        assertEquals(loading, announce(AiNarrativeSurface.Thinking, ""))
        assertEquals("The battery is healthy.", announce(AiNarrativeSurface.Narrative, "The battery is healthy."))
        assertEquals("$errorTitle. $errorMessage", announce(AiNarrativeSurface.Error, ""))
        // Offline with no cached narrative folds in the detail; with one it reads the chip + cached text.
        assertEquals("$offline. $offlineDetail", announce(AiNarrativeSurface.Offline, ""))
        assertEquals("$offline. cached text", announce(AiNarrativeSurface.Offline, "cached text"))
        // Ready has no output box, so it contributes no announcement.
        assertEquals("", announce(AiNarrativeSurface.Ready, "ignored"))
    }

    // ── host visibility gate (web `withAiFeature`) ───────────────────────────────

    @Test
    fun shouldRenderRequiresNonOffModeAndEnabledFeature() {
        assertTrue(shouldRender(aiModeOff = false, featureEnabled = true))
        // AI off → never shown (the off-mode invariant).
        assertFalse(shouldRender(aiModeOff = true, featureEnabled = true))
        // Per-feature toggle disabled → not shown.
        assertFalse(shouldRender(aiModeOff = false, featureEnabled = false))
    }

    // ── diagnostics: one PII-safe view.opened ────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordAIBatteryHealthForecastNarrativeOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no vehicle id or narrative text can leak through the diagnostic.
        assertEquals(mapOf("surface" to "AIBatteryHealthForecastNarrative"), records[0].fields)
    }

    @Test
    fun registrationIdsAreStable() {
        assertEquals(
            "ai-feature-battery-health-forecast-narrative-root",
            AIBatteryHealthForecastNarrativeRegistration.ID,
        )
        assertEquals("battery-health-forecast-narrative", AIBatteryHealthForecastNarrativeRegistration.FEATURE_ID)
        assertEquals("AIBatteryHealthForecastNarrative", AIBatteryHealthForecastNarrativeRegistration.SLUG)
    }
}

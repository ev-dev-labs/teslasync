// Off-device unit coverage for the PlaybackSpeedMenu surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label + diagnostics tests). Exercises the prompt-mandated registration slug, the verbatim REPLAY_SPEEDS
// table, the wrapping `nextSpeed` (tap) and the clamped `shiftSpeed` (the web `onContextMenu` backward gesture)
// including the unknown-current fall-through, the `{speed}x` visible label, the composed accessibility label, and
// the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in :app:testReleaseUnitTest.
// Reference values are the behaviour the web `PlaybackSpeedMenu` produces.

package io.teslasync.android.sharedsurfaces.playbackspeedmenu

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaybackSpeedMenuModelTest {
    private class RecordingLogger : Logger {
        data class Entry(
            val level: LogLevel,
            val event: String,
            val fields: Map<String, String>,
        )

        val entries = mutableListOf<Entry>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            entries += Entry(level, event, fields)
        }
    }

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationExposesThePromptSurfaceSlugAndId() {
        assertEquals("playbackSpeedMenu", PlaybackSpeedMenuRegistration.ID)
        assertEquals("PlaybackSpeedMenu", PlaybackSpeedMenuRegistration.SLUG)
    }

    @Test
    fun registrationPinsTheSingleWebI18nKey() {
        // The web component's only `t()` call; the key must exist in the shared P1/S10 catalog.
        assertEquals("translation.replay.controls.speed", PlaybackSpeedMenuRegistration.SPEED_LABEL_KEY)
    }

    // ── REPLAY_SPEEDS: verbatim port of the web constant ──────────────────────────────

    @Test
    fun replaySpeedsMatchTheWebTableAndOrder() {
        assertEquals(listOf(1, 10, 25, 50, 100), REPLAY_SPEEDS)
    }

    // ── nextSpeed: tap action, wraps past the fastest back to the slowest ─────────────

    @Test
    fun nextSpeedAdvancesThroughEverySlot() {
        assertEquals(10, nextSpeed(1))
        assertEquals(25, nextSpeed(10))
        assertEquals(50, nextSpeed(25))
        assertEquals(100, nextSpeed(50))
    }

    @Test
    fun nextSpeedWrapsFromFastestToSlowest() {
        // web `REPLAY_SPEEDS[(idx + 1) % length]` — 100 is the last slot, so it wraps to 1.
        assertEquals(1, nextSpeed(100))
    }

    @Test
    fun nextSpeedRoundTripsBackToTheStartInFiveSteps() {
        var speed = 1
        repeat(REPLAY_SPEEDS.size) { speed = nextSpeed(speed) }
        assertEquals(1, speed)
    }

    @Test
    fun nextSpeedFromUnknownCurrentYieldsTheSlowest() {
        // web `indexOf` returns -1, so `(-1 + 1) % length = 0` → the slowest speed.
        assertEquals(1, nextSpeed(7))
        assertEquals(1, nextSpeed(0))
        assertEquals(1, nextSpeed(-5))
    }

    // ── shiftSpeed: the web backward (right-click) gesture, CLAMPED ────────────────────

    @Test
    fun shiftSpeedBackwardStepsOneSlotDown() {
        assertEquals(50, shiftSpeed(100, -1))
        assertEquals(25, shiftSpeed(50, -1))
        assertEquals(10, shiftSpeed(25, -1))
        assertEquals(1, shiftSpeed(10, -1))
    }

    @Test
    fun shiftSpeedBackwardClampsAtTheSlowest() {
        // web `clamp(idx - 1, 0, last)` — a backward step from the slowest stays at the slowest (no wrap).
        assertEquals(1, shiftSpeed(1, -1))
    }

    @Test
    fun shiftSpeedForwardClampsAtTheFastest() {
        assertEquals(100, shiftSpeed(50, 1))
        assertEquals(100, shiftSpeed(100, 1))
    }

    @Test
    fun shiftSpeedClampsLargeDeltasToTheRange() {
        assertEquals(100, shiftSpeed(1, 10))
        assertEquals(1, shiftSpeed(100, -10))
    }

    @Test
    fun shiftSpeedFromUnknownCurrentTreatsItAsTheSlowestSlot() {
        // web `idx === -1 ? 0 : idx` — an unknown current is slot 0, so -1 clamps to slot 0 and +1 reaches slot 1.
        assertEquals(1, shiftSpeed(7, -1))
        assertEquals(10, shiftSpeed(7, 1))
    }

    @Test
    fun cycleFunctionsAlwaysReturnAMemberOfTheTable() {
        for (speed in listOf(-5, 0, 1, 7, 10, 25, 50, 100, 999)) {
            assertTrue("nextSpeed($speed) must be a valid speed", nextSpeed(speed) in REPLAY_SPEEDS)
            assertTrue("shiftSpeed($speed,-1) must be a valid speed", shiftSpeed(speed, -1) in REPLAY_SPEEDS)
            assertTrue("shiftSpeed($speed,1) must be a valid speed", shiftSpeed(speed, 1) in REPLAY_SPEEDS)
        }
    }

    // ── visible label: web `{speed}x` ─────────────────────────────────────────────────

    @Test
    fun speedLabelAppendsTheMultiplierSuffix() {
        assertEquals("1x", PlaybackSpeedMenuProjection.speedLabel(1))
        assertEquals("10x", PlaybackSpeedMenuProjection.speedLabel(10))
        assertEquals("100x", PlaybackSpeedMenuProjection.speedLabel(100))
        assertEquals("x", PlaybackSpeedMenuProjection.MULTIPLIER_SUFFIX)
    }

    // ── a11y label: localized name + live value (the node's content description) ───────

    @Test
    fun accessibleLabelComposesLocalizedNameWithCurrentValue() {
        // The composable sets the button node's contentDescription to this exact string; asserting it off-device
        // is the a11y-label coverage for the surface. The name is the resolved catalog value "Playback speed".
        assertEquals("Playback speed, 10x", PlaybackSpeedMenuProjection.accessibleLabel("Playback speed", 10))
        assertEquals("Playback speed, 1x", PlaybackSpeedMenuProjection.accessibleLabel("Playback speed", 1))
    }

    // ── diagnostics: one PII-safe view.opened ─────────────────────────────────────────

    @Test
    fun diagnosticsSlugMatchesTheSurfaceContract() {
        assertEquals("PlaybackSpeedMenu", PlaybackSpeedMenuDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val logger = RecordingLogger()

        PlaybackSpeedMenuDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.entries.size)
        val entry = logger.entries.single()
        assertEquals(LogLevel.Info, entry.level)
        assertEquals("view.opened", entry.event)
        // Only the surface slug — no speed value can leak through the diagnostic.
        assertEquals(mapOf("surface" to "PlaybackSpeedMenu"), entry.fields)
        assertEquals(setOf("surface"), entry.fields.keys)
        // The slug is a constant identifier — no digit could leak a speed value into it.
        assertTrue(entry.fields.values.none { value -> value.any(Char::isDigit) })
    }
}

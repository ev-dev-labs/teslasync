package io.teslasync.android.featureviews.kioskoverlay

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Locale

/**
 * Off-device verification of the KioskOverlay's pure logic — the native mirror of every conditional the web
 * component evaluates before returning JSX (web/src/features/dashboard/components/KioskOverlay.tsx): the
 * `1 - config.dimLevel` dim opacity gated by `isDimmed`, the `config.showClock` + `config.clockPosition`
 * clock, the `dashboardCount > 1 && config.rotateInterval > 0` dots, and the two `useDateFormat` helpers the
 * clock renders (`formatTime` / `formatDateWithDay`). Because the surface is purely presentational each
 * [KioskOverlayDisplay] is exactly what the thin composable renders, so these assertions double as the
 * per-state "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class KioskOverlayProjectionTest {
    private val lenientJson = Json { ignoreUnknownKeys = true }

    private companion object {
        const val ALPHA_DELTA: Float = 1e-6f

        // 2026-06-11 22:47 in America/Los_Angeles (PDT, UTC-7). A fixed instant so the clock formatting is
        // deterministic; June 11 2026 is a Thursday, and the same instant is June 12 (Friday) in UTC.
        val PACIFIC: ZoneId = ZoneId.of("America/Los_Angeles")
        val FIXED_MILLIS: Long =
            LocalDateTime
                .of(2026, 6, 11, 22, 47)
                .atZone(PACIFIC)
                .toInstant()
                .toEpochMilli()
    }

    private fun config(
        showClock: Boolean = true,
        clockPosition: String = "bottom-right",
        dimLevel: Double = 0.5,
        rotateInterval: Int = 30,
    ) = KioskOverlayConfig(
        showClock = showClock,
        clockPosition = clockPosition,
        dimLevel = dimLevel,
        rotateInterval = rotateInterval,
    )

    /** Thin wrapper over the projection so each call site stays short and reads the props it varies. */
    private fun project(
        config: KioskOverlayConfig = config(),
        isDimmed: Boolean = false,
        isCursorHidden: Boolean = false,
        dashboardCount: Int = 1,
        currentIndex: Int = 0,
    ): KioskOverlayDisplay = KioskOverlayProjection.project(config, isDimmed, isCursorHidden, dashboardCount, currentIndex)

    // ── Dim wash (web `isDimmed && <div style={{ opacity: 1 - config.dimLevel }} />`) ───────────────────

    @Test
    fun dimLayerIsOmittedWhenNotDimmed() {
        // Web `isDimmed && …`: when false the dim layer is never rendered.
        assertNull(project(config(dimLevel = 0.5), isDimmed = false).dimAlpha)
    }

    @Test
    fun dimAlphaIsOneMinusDimLevelWhenDimmed() {
        // Web `opacity: 1 - config.dimLevel`.
        assertEquals(0.5f, alphaFor(dimLevel = 0.5), ALPHA_DELTA)
        assertEquals(1.0f, alphaFor(dimLevel = 0.0), ALPHA_DELTA)
        assertEquals(0.0f, alphaFor(dimLevel = 1.0), ALPHA_DELTA)
        assertEquals(0.75f, alphaFor(dimLevel = 0.25), ALPHA_DELTA)
    }

    @Test
    fun dimAlphaIsClampedToTheZeroToOneRange() {
        // A persisted dimLevel outside 0..1 would yield a CSS opacity outside 0..1; the projection clamps so
        // the native alpha is always valid.
        assertEquals(0.0f, alphaFor(dimLevel = 1.5), ALPHA_DELTA)
        assertEquals(1.0f, alphaFor(dimLevel = -0.5), ALPHA_DELTA)
    }

    private fun alphaFor(dimLevel: Double): Float = project(config(dimLevel = dimLevel), isDimmed = true).dimAlpha!!

    // ── Cursor-hidden branch (web `isCursorHidden`; no visible Android surface) ──────────────────────────

    @Test
    fun cursorHiddenIsCarriedThroughFromTheProp() {
        assertTrue(project(isCursorHidden = true).cursorHidden)
        assertFalse(project(isCursorHidden = false).cursorHidden)
    }

    // ── Clock (web `config.showClock` + `config.clockPosition`) ──────────────────────────────────────────

    @Test
    fun showClockFollowsTheConfigFlag() {
        assertTrue(project(config(showClock = true)).showClock)
        assertFalse(project(config(showClock = false)).showClock)
    }

    @Test
    fun clockPositionParsesEveryWireValue() {
        assertEquals(KioskClockPosition.TopLeft, positionFor("top-left"))
        assertEquals(KioskClockPosition.TopRight, positionFor("top-right"))
        assertEquals(KioskClockPosition.BottomLeft, positionFor("bottom-left"))
        assertEquals(KioskClockPosition.BottomRight, positionFor("bottom-right"))
    }

    @Test
    fun clockPositionFallsBackToTheWebDefaultForUnknownValues() {
        // Web spreads over DEFAULT_KIOSK_CONFIG (clockPosition: 'bottom-right'), so a missing/garbage value
        // backfills to the default rather than dropping the clock.
        assertEquals(KioskClockPosition.BottomRight, KioskClockPosition.DEFAULT)
        assertEquals(KioskClockPosition.BottomRight, positionFor("middle"))
        assertEquals(KioskClockPosition.BottomRight, KioskClockPosition.fromWire(null))
    }

    private fun positionFor(wire: String) = project(config(clockPosition = wire)).clockPosition

    // ── Rotation dots (web `dashboardCount > 1 && config.rotateInterval > 0`) ────────────────────────────

    @Test
    fun dotsShowOnlyWithMultipleDashboardsAndAPositiveInterval() {
        assertTrue(showDots(dashboards = 3, interval = 30))
        // A single dashboard never shows the indicator.
        assertFalse(showDots(dashboards = 1, interval = 30))
        // Rotation disabled (interval 0) hides the indicator even with several dashboards.
        assertFalse(showDots(dashboards = 3, interval = 0))
        assertFalse(showDots(dashboards = 3, interval = -1))
    }

    private fun showDots(
        dashboards: Int,
        interval: Int,
    ): Boolean = project(config(rotateInterval = interval), dashboardCount = dashboards).showDots

    @Test
    fun dotCountMirrorsDashboardCountAndActiveIndexMirrorsCurrentIndex() {
        val display = project(dashboardCount = 5, currentIndex = 2)

        assertEquals(5, display.dotCount)
        assertEquals(2, display.activeDotIndex)
    }

    @Test
    fun dotCountIsNeverNegative() {
        val display = project(dashboardCount = -3)

        assertEquals(0, display.dotCount)
        assertFalse(display.showDots)
    }

    // ── Cached-config decode (the data-adapter path: project straight off the persisted KioskConfig JSON) ─

    @Test
    fun projectsStraightOffThePersistedConfigJsonIgnoringUnknownKeys() {
        // useKioskMode persists the full KioskConfig to localStorage; this surface reads only four fields, so
        // decoding must ignore the rest (dashboardIds, hideCursor, cursorTimeout, dimAfter, widgetOpacity, …).
        val json =
            """
            {
              "rotateInterval": 45,
              "dashboardIds": ["a", "b", "c"],
              "hideCursor": true,
              "cursorTimeout": 5,
              "dimAfter": 0,
              "dimLevel": 0.2,
              "showClock": true,
              "clockPosition": "top-left",
              "widgetOpacity": 1.0,
              "backgroundOpacity": 1.0
            }
            """.trimIndent()
        val decoded = lenientJson.decodeFromString<KioskOverlayConfig>(json)

        val display = project(decoded, isDimmed = true, isCursorHidden = true, dashboardCount = 3, currentIndex = 1)

        assertEquals(0.8f, display.dimAlpha!!, ALPHA_DELTA) // 1 - 0.2
        assertTrue(display.showClock)
        assertEquals(KioskClockPosition.TopLeft, display.clockPosition)
        assertTrue(display.showDots) // 3 dashboards, interval 45 > 0
        assertEquals(3, display.dotCount)
        assertEquals(1, display.activeDotIndex)
    }

    @Test
    fun emptyConfigJsonBackfillsTheWebDefaults() {
        // A partial/empty payload must decode and backfill exactly like the web spread over
        // DEFAULT_KIOSK_CONFIG (showClock: true, clockPosition: 'bottom-right', dimLevel: 0.5, rotateInterval: 30).
        val decoded = lenientJson.decodeFromString<KioskOverlayConfig>("{}")

        assertTrue(decoded.showClock)
        assertEquals("bottom-right", decoded.clockPosition)
        assertEquals(0.5, decoded.dimLevel, 1e-9)
        assertEquals(30, decoded.rotateInterval)
    }

    // ── Clock formatting (web `formatTime(now)` / `formatDateWithDay(now)`) ──────────────────────────────

    @Test
    fun timeRendersLocaleAwareShortTime() {
        // en-US short time is 12-hour with a meridiem (web `{ hour: '2-digit', minute: '2-digit' }`).
        val text = KioskClockFormat.time(FIXED_MILLIS, Locale.US, PACIFIC)

        assertTrue("expected 10:47 in <$text>", text.contains("10:47"))
        assertTrue("expected a PM meridiem in <$text>", text.lowercase(Locale.ROOT).contains("pm"))
    }

    @Test
    fun timeHonoursTheLocaleTwentyFourHourConvention() {
        // A 24-hour locale renders 22:47 with no meridiem, proving the formatter is locale-aware.
        val text = KioskClockFormat.time(FIXED_MILLIS, Locale.GERMANY, PACIFIC)

        assertTrue("expected 22:47 in <$text>", text.contains("22:47"))
    }

    @Test
    fun timeHonoursTheRequestedZone() {
        // 22:47 PDT is 05:47 the next morning in UTC — the clock follows the supplied zone.
        val text = KioskClockFormat.time(FIXED_MILLIS, Locale.US, ZoneOffset.UTC)

        assertTrue("expected 5:47 in <$text>", text.contains("5:47"))
        assertTrue("expected an AM meridiem in <$text>", text.lowercase(Locale.ROOT).contains("am"))
    }

    @Test
    fun dateWithDayRendersShortWeekdayMonthAndDay() {
        // Web `{ weekday: 'short', month: 'short', day: 'numeric' }` → "Thu, Jun 11" for this instant.
        assertEquals("Thu, Jun 11", KioskClockFormat.dateWithDay(FIXED_MILLIS, Locale.US, PACIFIC))
    }

    @Test
    fun dateWithDayHonoursTheRequestedZone() {
        // The same instant is the next calendar day (Friday Jun 12) in UTC.
        assertEquals("Fri, Jun 12", KioskClockFormat.dateWithDay(FIXED_MILLIS, Locale.US, ZoneOffset.UTC))
    }
}

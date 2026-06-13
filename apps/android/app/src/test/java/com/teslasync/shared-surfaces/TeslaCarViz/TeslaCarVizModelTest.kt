// Off-device unit coverage for the TeslaCarViz surface's pure model (P3 acceptance: adapter + per-state + a11y-label
// tests). Exercises the prompt-mandated registration slug, the web `parseModelKey` (match order + aliases + default),
// the battery / boolean colour tiers (web `batteryColor` / `boolColor`), the driving predicate, the per-model aspect
// ratio + battery fill fraction, the ambient-glow precedence, the conditional status-dot set, the screen-reader
// summary the composable exposes as its content description, the per-model SVG geometry presence, and the PII-safe
// `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in :app:testReleaseUnitTest. Reference
// values are the colours + behaviour the web TeslaCarViz produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.teslacarviz

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TeslaCarVizModelTest {
    private val strings =
        CarVizStrings(
            charging = "Charging",
            notCharging = "Not Charging",
            locked = "Locked",
            unlocked = "Unlocked",
            climate = "Climate",
            sentry = "Sentry",
        )

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("teslaCarViz", TeslaCarVizRegistration.ID)
        assertEquals("TeslaCarViz", TeslaCarVizRegistration.SLUG)
    }

    // ── parseModelKey: web match order (cybertruck → X → Y → S → default 3) + aliases ─

    @Test
    fun parseModelKeyDefaultsToModel3ForNullEmptyOrUnknown() {
        assertEquals(TeslaModel.Model3, parseModelKey(null))
        assertEquals(TeslaModel.Model3, parseModelKey(""))
        assertEquals(TeslaModel.Model3, parseModelKey("Roadster"))
        assertEquals(TeslaModel.Model3, parseModelKey("Model 3 Performance"))
    }

    @Test
    fun parseModelKeyResolvesEachModelFromItsDisplayName() {
        assertEquals(TeslaModel.ModelS, parseModelKey("Model S"))
        assertEquals(TeslaModel.ModelY, parseModelKey("Model Y"))
        assertEquals(TeslaModel.ModelX, parseModelKey("Model X"))
        assertEquals(TeslaModel.Cybertruck, parseModelKey("Cybertruck"))
    }

    @Test
    fun parseModelKeyResolvesShortAliases() {
        assertEquals(TeslaModel.Cybertruck, parseModelKey("CT"))
        assertEquals(TeslaModel.ModelX, parseModelKey("MX"))
        assertEquals(TeslaModel.ModelY, parseModelKey("MY"))
        assertEquals(TeslaModel.ModelS, parseModelKey("MS"))
    }

    @Test
    fun modelKeyRoundTripsTheWebKey() {
        assertEquals("model3", TeslaModel.Model3.key)
        assertEquals("models", TeslaModel.ModelS.key)
        assertEquals("modely", TeslaModel.ModelY.key)
        assertEquals("modelx", TeslaModel.ModelX.key)
        assertEquals("cybertruck", TeslaModel.Cybertruck.key)
    }

    // ── battery / boolean colour tiers (web batteryColor / boolColor) ─────────────────

    @Test
    fun batteryColorTiersMatchTheWebThresholds() {
        assertEquals(CarVizColors.GOOD, TeslaCarVizProjection.batteryColorArgb(100))
        assertEquals(CarVizColors.GOOD, TeslaCarVizProjection.batteryColorArgb(61))
        assertEquals(CarVizColors.WARN, TeslaCarVizProjection.batteryColorArgb(60))
        assertEquals(CarVizColors.WARN, TeslaCarVizProjection.batteryColorArgb(26))
        assertEquals(CarVizColors.BAD, TeslaCarVizProjection.batteryColorArgb(25))
        assertEquals(CarVizColors.BAD, TeslaCarVizProjection.batteryColorArgb(0))
    }

    @Test
    fun boolColorFollowsTheWebActiveInactive() {
        assertEquals(CarVizColors.GOOD, TeslaCarVizProjection.boolColorArgb(true))
        assertEquals(CarVizColors.WARN, TeslaCarVizProjection.boolColorArgb(false))
    }

    @Test
    fun semanticColorsAreTheWebHexConstants() {
        assertEquals(0xFF10B981, CarVizColors.GOOD)
        assertEquals(0xFFF59E0B, CarVizColors.WARN)
        assertEquals(0xFFEF4444, CarVizColors.BAD)
        assertEquals(0xFF00F0FF, CarVizColors.CLIMATE)
    }

    // ── driving predicate (web `speed > 0`) ───────────────────────────────────────────

    @Test
    fun drivingIsAnyPositiveSpeed() {
        assertTrue(TeslaCarVizProjection.isDriving(state(speed = 0.1)))
        assertFalse(TeslaCarVizProjection.isDriving(state(speed = 0.0)))
        assertFalse(TeslaCarVizProjection.isDriving(state(speed = -5.0)))
    }

    // ── per-model aspect + battery fraction ───────────────────────────────────────────

    @Test
    fun aspectMatchesTheWebPerModelRatios() {
        assertEquals(0.56f, TeslaCarVizProjection.aspect(TeslaModel.Cybertruck))
        assertEquals(0.55f, TeslaCarVizProjection.aspect(TeslaModel.ModelX))
        assertEquals(0.55f, TeslaCarVizProjection.aspect(TeslaModel.ModelY))
        assertEquals(0.52f, TeslaCarVizProjection.aspect(TeslaModel.Model3))
        assertEquals(0.52f, TeslaCarVizProjection.aspect(TeslaModel.ModelS))
    }

    @Test
    fun batteryFractionIsClampedToUnitInterval() {
        assertEquals(0f, TeslaCarVizProjection.batteryFraction(0), 1e-6f)
        assertEquals(0.5f, TeslaCarVizProjection.batteryFraction(50), 1e-6f)
        assertEquals(1f, TeslaCarVizProjection.batteryFraction(100), 1e-6f)
        assertEquals(1f, TeslaCarVizProjection.batteryFraction(140), 1e-6f)
        assertEquals(0f, TeslaCarVizProjection.batteryFraction(-10), 1e-6f)
    }

    // ── ambient-glow precedence (web sentry > charging > driving > idle) ──────────────

    @Test
    fun ambientPrecedenceIsSentryThenChargingThenDrivingThenIdle() {
        assertEquals(CarAmbient.Sentry, TeslaCarVizProjection.ambientKind(state(sentry = true, charging = true, speed = 9.0)))
        assertEquals(CarAmbient.Charging, TeslaCarVizProjection.ambientKind(state(charging = true, speed = 9.0)))
        assertEquals(CarAmbient.Driving, TeslaCarVizProjection.ambientKind(state(speed = 9.0)))
        assertEquals(CarAmbient.Idle, TeslaCarVizProjection.ambientKind(state()))
    }

    // ── status-dot set: charging + lock always, climate + sentry only when active ─────

    @Test
    fun idleStatusDotsAreChargingAndLockOnly() {
        val dots = TeslaCarVizProjection.statusDots(state(locked = true), strings)
        assertEquals(2, dots.size)
        assertFalse(dots[0].active)
        assertEquals("Not Charging", dots[0].label)
        assertEquals(CarVizColors.CHARGING, dots[0].colorArgb)
        assertTrue(dots[1].active)
        assertEquals("Locked", dots[1].label)
        assertEquals(CarVizColors.GOOD, dots[1].colorArgb)
    }

    @Test
    fun unlockedLockDotUsesTheWarnColorAndUnlockedLabel() {
        val dots = TeslaCarVizProjection.statusDots(state(locked = false), strings)
        assertEquals("Unlocked", dots[1].label)
        assertEquals(CarVizColors.WARN, dots[1].colorArgb)
    }

    @Test
    fun climateAndSentryDotsAppearOnlyWhenActive() {
        val all =
            TeslaCarVizProjection.statusDots(
                state(charging = true, locked = true, climate = true, sentry = true),
                strings,
            )
        assertEquals(4, all.size)
        assertEquals("Charging", all[0].label)
        assertEquals("Climate", all[2].label)
        assertEquals(CarVizColors.CLIMATE, all[2].colorArgb)
        assertEquals("Sentry", all[3].label)
        assertEquals(CarVizColors.SENTRY, all[3].colorArgb)
    }

    // ── a11y summary: the rendered content description the composable exposes ──────────

    @Test
    fun accessibleSummaryListsBatteryChargeAndLockForIdle() {
        val summary =
            TeslaCarVizProjection.accessibleSummary(state(locked = true), strings, "Battery", "Driving")
        assertEquals("Battery 72%, Not Charging, Locked", summary)
    }

    @Test
    fun accessibleSummaryAppendsClimateSentryAndDrivingWhenActive() {
        val summary =
            TeslaCarVizProjection.accessibleSummary(
                state(batteryLevel = 48, charging = true, locked = false, climate = true, sentry = true, speed = 65.0),
                strings,
                "Battery",
                "Driving",
            )
        assertEquals("Battery 48%, Charging, Unlocked, Climate, Sentry, Driving", summary)
    }

    // ── geometry: every model exposes wheel anchors + a non-blank path set ─────────────

    @Test
    fun everyModelHasWheelAnchorsAndPaths() {
        for (model in TeslaModel.values()) {
            val pos = CarVizGeometry.wheelPos(model)
            assertEquals(160f, pos.fx)
            assertEquals(432f, pos.rx)
            assertEquals(210f, pos.wy)
            val body = CarVizGeometry.bodyPaths(model)
            assertTrue(body.body.startsWith("M"))
            assertTrue(body.roof.startsWith("M"))
            assertTrue(body.wind.startsWith("M"))
            assertTrue(CarVizGeometry.miniPath(model).startsWith("M"))
        }
    }

    @Test
    fun renderSizesMatchTheWebPixelWidths() {
        assertEquals(180, TeslaCarVizSize.Sm.widthDp)
        assertEquals(280, TeslaCarVizSize.Md.widthDp)
        assertEquals(380, TeslaCarVizSize.Lg.widthDp)
    }

    // ── diagnostics: one PII-safe view.opened ─────────────────────────────────────────

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
        TeslaCarVizDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        assertEquals(mapOf("surface" to "TeslaCarViz"), records[0].fields)
    }

    @Suppress("LongParameterList")
    private fun state(
        batteryLevel: Int = 72,
        charging: Boolean = false,
        locked: Boolean = false,
        climate: Boolean = false,
        sentry: Boolean = false,
        speed: Double = 0.0,
    ): TeslaCarVizState =
        TeslaCarVizState(
            batteryLevel = batteryLevel,
            isCharging = charging,
            isLocked = locked,
            isClimateOn = climate,
            sentryMode = sentry,
            speed = speed,
        )
}

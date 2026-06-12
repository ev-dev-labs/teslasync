package io.teslasync.android.featureviews.signalcomparecontrols

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

/**
 * Off-device verification of the SignalCompareControls pure logic — the native mirror of everything the web
 * component (web/src/features/telemetry/components/SignalCompareControls.tsx) decides before returning JSX: the
 * eight category regex matchers (web `CATEGORY_PREFIXES`), the five preset window computations (web
 * `DIFF_PRESETS`), the `datetime-local` <-> ISO helpers (web `toLocalDatetimeInput` / `isoOrEmpty`), the
 * never-empty field label, the category toggle (web `category === c.id ? null : c.id`) and the `t(key, default)`
 * resolver. This is the surface's "adapter": props/clock -> render-ready strings, with the owning page owning the
 * cache-then-network feed. Determinism comes from injecting a fixed clock and zone (never the system clock).
 */
class SignalCompareControlsModelTest {
    private val zone = ZoneOffset.UTC
    private val now = Instant.parse("2026-06-12T12:00:00Z").toEpochMilli()

    // ── category prefixes (web CATEGORY_PREFIXES) ─────────────────────────────────────────────────────────

    @Test
    fun categoryOrderMatchesTheExportedWebArray() {
        assertEquals(
            listOf("battery", "drive", "climate", "security", "motor", "tire", "media", "safety"),
            DiffCategory.ALL.map { it.id },
        )
    }

    @Test
    fun categoryMatchersReproduceTheWebRegexes() {
        assertTrue(DiffCategory.Battery.matches("battery_soc"))
        assertTrue(DiffCategory.Battery.matches("charge_state"))
        assertTrue(DiffCategory.Battery.matches("est_range_km"))
        assertTrue(DiffCategory.Drive.matches("vehicle_speed"))
        assertTrue(DiffCategory.Drive.matches("odometer"))
        assertTrue(DiffCategory.Climate.matches("cabin_temp"))
        assertTrue(DiffCategory.Security.matches("sentry_mode"))
        assertTrue(DiffCategory.Security.matches("door_lock_state"))
        assertTrue(DiffCategory.Motor.matches("rear_torque"))
        assertTrue(DiffCategory.Tire.matches("tpms_fl"))
        assertTrue(DiffCategory.Tire.matches("tire_pressure_rr"))
        assertTrue(DiffCategory.Media.matches("media_volume"))
        assertTrue(DiffCategory.Safety.matches("airbag_status"))
        assertTrue(DiffCategory.Safety.matches("fcw_alert"))
    }

    @Test
    fun categoryMatchingIsCaseInsensitiveLikeTheWebRegexFlag() {
        assertTrue(DiffCategory.Battery.matches("BatteryLevel"))
        assertTrue(DiffCategory.Drive.matches("STEERING_ANGLE"))
    }

    @Test
    fun categoryMatchersRejectUnrelatedSignals() {
        assertFalse(DiffCategory.Battery.matches("vehicle_speed"))
        assertFalse(DiffCategory.Drive.matches("battery_soc"))
        assertFalse(DiffCategory.Media.matches("tpms_fl"))
    }

    @Test
    fun categoryFromIdResolvesOrReturnsNull() {
        assertEquals(DiffCategory.Battery, DiffCategory.fromId("battery"))
        assertNull(DiffCategory.fromId(null))
        assertNull(DiffCategory.fromId("not-a-category"))
    }

    // ── quick presets (web DIFF_PRESETS) ──────────────────────────────────────────────────────────────────

    @Test
    fun presetOrderMatchesTheExportedWebArray() {
        assertEquals(
            listOf("now-vs-1h", "now-vs-1d", "before-after-charge", "last-drive", "today-vs-yesterday"),
            DiffPreset.ALL.map { it.id },
        )
    }

    @Test
    fun nowVs1hWindowsAreOneHourApartEndingNow() {
        val window = DiffPreset.NowVs1h.compute(now, zone)
        assertEquals("2026-06-12T11:00", window.atA)
        assertEquals("2026-06-12T12:00", window.atB)
    }

    @Test
    fun nowVs1dWindowsAreOneDayApartEndingNow() {
        val window = DiffPreset.NowVs1d.compute(now, zone)
        assertEquals("2026-06-11T12:00", window.atA)
        assertEquals("2026-06-12T12:00", window.atB)
    }

    @Test
    fun beforeAfterChargeWindowsAreFourHoursApartEndingNow() {
        val window = DiffPreset.BeforeAfterCharge.compute(now, zone)
        assertEquals("2026-06-12T08:00", window.atA)
        assertEquals("2026-06-12T12:00", window.atB)
    }

    @Test
    fun lastDriveWindowsAreNinetyAndFiveMinutesBack() {
        val window = DiffPreset.LastDrive.compute(now, zone)
        assertEquals("2026-06-12T10:30", window.atA)
        assertEquals("2026-06-12T11:55", window.atB)
    }

    @Test
    fun todayVsYesterdayWindowsAreOneDayApart() {
        val window = DiffPreset.TodayVsYesterday.compute(now, zone)
        assertEquals("2026-06-11T12:00", window.atA)
        assertEquals("2026-06-12T12:00", window.atB)
    }

    @Test
    fun presetFromIdResolvesOrReturnsNull() {
        assertEquals(DiffPreset.LastDrive, DiffPreset.fromId("last-drive"))
        assertNull(DiffPreset.fromId("not-a-preset"))
    }

    // ── datetime-local <-> ISO helpers (web toLocalDatetimeInput / isoOrEmpty) ─────────────────────────────

    @Test
    fun toLocalDatetimeInputFormatsTheInstantInTheGivenZone() {
        assertEquals("2026-06-12T12:00", SignalCompareTime.toLocalDatetimeInput(now, zone))
    }

    @Test
    fun parseLocalDatetimeRoundTripsAValidWindowString() {
        val parsed = SignalCompareTime.parseLocalDatetime("2026-06-12T12:00")
        assertEquals(LocalDateTime.of(2026, 6, 12, 12, 0), parsed)
    }

    @Test
    fun parseLocalDatetimeReturnsNullForBlankOrMalformed() {
        assertNull(SignalCompareTime.parseLocalDatetime(""))
        assertNull(SignalCompareTime.parseLocalDatetime("   "))
        assertNull(SignalCompareTime.parseLocalDatetime("not-a-date"))
    }

    @Test
    fun isoOrEmptyConvertsLocalWindowToUtcInstantString() {
        assertEquals("2026-06-12T12:00:00Z", SignalCompareTime.isoOrEmpty("2026-06-12T12:00", zone))
    }

    @Test
    fun isoOrEmptyAppliesTheZoneOffsetBeforeConvertingToUtc() {
        val minus5 = ZoneOffset.ofHours(-5)
        assertEquals("2026-06-12T17:00:00Z", SignalCompareTime.isoOrEmpty("2026-06-12T12:00", minus5))
    }

    @Test
    fun isoOrEmptyReturnsEmptyForBlankOrMalformed() {
        assertEquals("", SignalCompareTime.isoOrEmpty("", zone))
        assertEquals("", SignalCompareTime.isoOrEmpty("not-a-date", zone))
    }

    @Test
    fun displayLabelFormatsAValueAndFallsBackWhenEmpty() {
        assertEquals("2026-06-12 12:00", SignalCompareTime.displayLabel("2026-06-12T12:00", "—"))
        assertEquals("—", SignalCompareTime.displayLabel("", "—"))
        assertEquals("—", SignalCompareTime.displayLabel("garbage", "—"))
    }

    // ── category toggle + i18n fallback resolver ──────────────────────────────────────────────────────────

    @Test
    fun toggleCategorySelectsClearsAndSwitches() {
        assertEquals("battery", toggleCategory(null, "battery"))
        assertNull(toggleCategory("battery", "battery"))
        assertEquals("drive", toggleCategory("battery", "drive"))
    }

    @Test
    fun resolveOptionalPrefersACatalogHitOverTheFallback() {
        val catalog = mapOf(KEY_SNAPSHOT_ARIA to "Catalog aria")
        assertEquals("Catalog aria", resolveOptional({ catalog[it] }, KEY_SNAPSHOT_ARIA, "fallback"))
    }

    @Test
    fun resolveOptionalFallsBackOnMissingOrBlankKey() {
        assertEquals("fallback", resolveOptional({ null }, KEY_DIFF_ARIA, "fallback"))
        assertEquals("fallback", resolveOptional({ "   " }, KEY_DIFF_ARIA, "fallback"))
    }
}

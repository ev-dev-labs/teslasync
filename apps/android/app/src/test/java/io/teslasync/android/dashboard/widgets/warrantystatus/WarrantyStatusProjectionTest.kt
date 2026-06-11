package io.teslasync.android.dashboard.widgets.warrantystatus

import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WarrantyStatusWidget's pure logic — the web `statusVariant`/`statusLabel`
 * heuristics, the `a ?? b ?? c` field probing, the `daysUntil`/`totalDays` math, the SI→display mileage
 * conversion (the deliberate "treat `_mi` value as meters" parity with `convertDistanceFromSI`), the date
 * formatting, the coverage-badge derivation, the `envelope?.data` unwrap + empty gate, and the registry
 * metadata. Mirrors the web spec (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx) against the
 * snake_case wire contract.
 */
class WarrantyStatusProjectionTest {
    private val strings =
        WarrantyStatusStrings(
            title = "Warranty Status",
            expired = "Expired",
            active = "Active",
            expiryDate = "Expiry Date",
            daysRemaining = "Days Remaining",
            mileageLimit = "Mileage Limit",
            currentMileage = "Current Mileage",
            included = "Included",
            covered = "Covered",
            daysLeft = "days left",
            noData = "No warranty data",
            timeRemaining = "Time Remaining",
            daysUnit = "days",
            mileageRemaining = "Mileage Remaining",
            coverageLabels = COVERAGE_TYPES.associate { it.dataKey to it.fallback },
        )

    private fun prefs(distance: DistanceUnitPref = DistanceUnitPref.KM): WarrantyStatusDisplayPrefs =
        WarrantyStatusDisplayPrefs(
            UnitPref(
                distance = distance,
                speed = SpeedUnitPref.KMH,
                temperature = TemperatureUnitPref.CELSIUS,
                pressure = PressureUnitPref.KPA,
                energy = EnergyUnitPref.KWH,
                duration = DurationUnitPref.HOURS,
                power = PowerUnitPref.KW,
            ),
        )

    // ── statusVariant / statusLabel (web heuristics) ───────────────────────────

    @Test
    fun statusVariantDangerWhenNullOrExpired() {
        assertEquals(WarrantyStatusTier.Danger, WarrantyStatusProjection.statusVariant(null))
        assertEquals(WarrantyStatusTier.Danger, WarrantyStatusProjection.statusVariant(0))
        assertEquals(WarrantyStatusTier.Danger, WarrantyStatusProjection.statusVariant(-10))
    }

    @Test
    fun statusVariantWarningThroughNinetyDays() {
        assertEquals(WarrantyStatusTier.Warning, WarrantyStatusProjection.statusVariant(1))
        assertEquals(WarrantyStatusTier.Warning, WarrantyStatusProjection.statusVariant(90))
    }

    @Test
    fun statusVariantSuccessAboveNinetyDays() {
        assertEquals(WarrantyStatusTier.Success, WarrantyStatusProjection.statusVariant(91))
        assertEquals(WarrantyStatusTier.Success, WarrantyStatusProjection.statusVariant(900))
    }

    @Test
    fun statusLabelExpiredOnlyWhenNullOrExpired() {
        assertEquals("Expired", WarrantyStatusProjection.statusLabel(null, strings))
        assertEquals("Expired", WarrantyStatusProjection.statusLabel(0, strings))
        assertEquals("Active", WarrantyStatusProjection.statusLabel(1, strings))
        assertEquals("Active", WarrantyStatusProjection.statusLabel(900, strings))
    }

    // ── project(): full active warranty ────────────────────────────────────────

    @Test
    fun projectFullWarrantyDerivesBarsAndRows() {
        val display = WarrantyStatusProjection.project(fullData(), prefs(), strings, NOW)

        assertTrue(display.hasData)
        // 517 days from 2024-01-01 to 2025-06-01 ⇒ Active / Success.
        assertEquals("517", display.compactDaysText)
        assertEquals(WarrantyStatusTier.Success, display.compactBadge.tier)
        assertEquals("Active", display.compactBadge.text)
        assertTrue(display.compactContentDescription.contains("517 days left"))
        assertTrue(display.compactContentDescription.contains("Active"))

        val time = requireNotNull(display.timeBar)
        // totalDays 2021-06-01 → 2025-06-01 = 1461; used = 1461 - 517 = 944.
        assertEquals(1461.0, time.max, 0.0001)
        assertEquals(944.0, time.value, 0.0001)
        assertEquals(WarrantyStatusTier.Success, time.tier)
        assertEquals("Time Remaining", time.label)
        assertEquals("517 days", time.sublabel)

        val mileage = requireNotNull(display.mileageBar)
        // mileage_limit_mi (80467) is read by the web AND fed to convertDistanceFromSI as if meters ⇒ km.
        assertEquals(80.467, mileage.max, 0.0001)
        assertEquals(32.186, mileage.value, 0.0001)
        // ratio 32186/80467 ≈ 0.4 ⇒ Success.
        assertEquals(WarrantyStatusTier.Success, mileage.tier)
        assertEquals("Mileage Remaining", mileage.label)
        assertEquals("48 km", mileage.sublabel)
    }

    @Test
    fun projectFullWarrantyDetailRowsInWebOrder() {
        val rows = WarrantyStatusProjection.project(fullData(), prefs(), strings, NOW).detailRows
        assertEquals(4, rows.size)

        assertEquals("Expiry Date", rows[0].label)
        assertEquals("Jun 1, 2025", rows[0].value)
        assertEquals("Active", rows[0].badge?.text)
        assertEquals(WarrantyStatusTier.Success, rows[0].badge?.tier)
        assertFalse(rows[0].mono)

        assertEquals("Days Remaining", rows[1].label)
        assertEquals("517", rows[1].value)
        assertNull(rows[1].badge)
        assertTrue(rows[1].mono)

        assertEquals("Mileage Limit", rows[2].label)
        assertEquals("80 km", rows[2].value)
        assertTrue(rows[2].mono)

        assertEquals("Current Mileage", rows[3].label)
        assertEquals("32 km", rows[3].value)
        assertTrue(rows[3].mono)
    }

    @Test
    fun projectHonoursMilePreference() {
        val display = WarrantyStatusProjection.project(fullData(), prefs(DistanceUnitPref.MI), strings, NOW)
        val rows = display.detailRows
        // 80467 / 1609.344 ≈ 50 mi; 32186 / 1609.344 ≈ 20 mi.
        assertEquals("50 mi", rows[2].value)
        assertEquals("20 mi", rows[3].value)
        assertEquals("30 mi", requireNotNull(display.mileageBar).sublabel)
        assertEquals(50.0, requireNotNull(display.mileageBar).max, 0.01)
        assertEquals(20.0, requireNotNull(display.mileageBar).value, 0.01)
    }

    // ── project(): expired / sparse document ───────────────────────────────────

    @Test
    fun projectExpiredWhenNoExpiryDate() {
        val display = WarrantyStatusProjection.project(buildJsonObject {}, prefs(), strings, NOW)

        assertTrue(display.hasData)
        assertEquals(EM_DASH, display.compactDaysText)
        assertEquals("Expired", display.compactBadge.text)
        assertEquals(WarrantyStatusTier.Danger, display.compactBadge.tier)
        assertNull(display.timeBar)
        assertNull(display.mileageBar)

        // Only Expiry Date + Days Remaining rows when nothing else is present (web always shows both).
        assertEquals(2, display.detailRows.size)
        assertEquals(EM_DASH, display.detailRows[0].value)
        assertEquals("Expired", display.detailRows[0].badge?.text)
        assertEquals(WarrantyStatusTier.Danger, display.detailRows[0].badge?.tier)
        assertEquals(EM_DASH, display.detailRows[1].value)
    }

    @Test
    fun projectUsesFallbackExpiryAndMileageKeys() {
        // Only the third-choice keys present ⇒ web `a ?? b ?? c` still resolves them.
        val data =
            buildJsonObject {
                put("basic_expiry_date", "2025-06-01")
                put("basic_mileage_limit_mi", 80467.0)
                put("current_odometer_mi", 32186.0)
                put("in_service_date", "2021-06-01")
            }
        val display = WarrantyStatusProjection.project(data, prefs(), strings, NOW)
        assertEquals("517", display.compactDaysText)
        assertNotNull(display.timeBar)
        assertNotNull(display.mileageBar)
        assertEquals("80 km", display.detailRows[2].value)
    }

    // ── project(): coverage badges ─────────────────────────────────────────────

    @Test
    fun projectCoverageBadgesActiveExpiredAndIncluded() {
        val data =
            buildJsonObject {
                put("warranty_expiry_date", "2025-06-01")
                put("battery_drive_unit", true)
                put("battery_drive_unit_expiry_date", "2029-06-01")
                put("basic", true)
                put("corrosion", true)
                put("corrosion_expiry_date", "2020-01-01")
                put("emissions", false)
            }
        val rows = WarrantyStatusProjection.project(data, prefs(), strings, NOW).detailRows
        // Expiry + Days rows, then coverage rows in COVERAGE_TYPES order (basic, battery, corrosion).
        val coverage = rows.drop(2)
        assertEquals(3, coverage.size)

        val basic = coverage.first { it.label == "Basic" }
        assertEquals("Included", basic.value)
        assertEquals("Covered", basic.badge?.text)
        assertEquals(WarrantyStatusTier.Success, basic.badge?.tier)

        val battery = coverage.first { it.label == "Battery/Drive Unit" }
        assertEquals("Jun 2029", battery.value)
        assertEquals("Covered", battery.badge?.text)

        val corrosion = coverage.first { it.label == "Corrosion" }
        assertEquals("Jan 2020", corrosion.value)
        assertEquals("Expired", corrosion.badge?.text)
        assertEquals(WarrantyStatusTier.Danger, corrosion.badge?.tier)

        // `emissions: false` is filtered out (web `covVal !== false`).
        assertTrue(coverage.none { it.label == "Emissions" })
    }

    // ── project(): empty document ──────────────────────────────────────────────

    @Test
    fun projectNullDocumentHasNoData() {
        val display = WarrantyStatusProjection.project(null, prefs(), strings, NOW)
        assertFalse(display.hasData)
        assertNull(display.timeBar)
        assertNull(display.mileageBar)
        assertTrue(display.detailRows.isEmpty())
        assertEquals("No warranty data", display.compactContentDescription)
    }

    @Test
    fun projectEnvelopeUnwrapsDataDocument() {
        val display = WarrantyStatusProjection.projectEnvelope(envelope(fullData()), prefs(), strings, NOW)
        assertTrue(display.hasData)
        assertEquals("517", display.compactDaysText)
    }

    // ── envelope unwrap + empty gate ───────────────────────────────────────────

    @Test
    fun warrantyDataUnwrapsOnlyAnObjectDocument() {
        assertNotNull(warrantyData(envelope(fullData())))
        assertNull(warrantyData(envelope(null)))
        assertNull(warrantyData(JsonNull))
        assertNull(warrantyData(null))
        assertTrue(hasWarrantyData(envelope(fullData())))
        assertFalse(hasWarrantyData(envelope(null)))
    }

    // ── asString / asNumber (web coercions) ────────────────────────────────────

    @Test
    fun asStringMatchesWebCoercion() {
        assertEquals("hello", asString(jsonString("hello")))
        // A numeric primitive yields its JSON content verbatim (web `String(val)`).
        assertEquals("42", asString(JsonPrimitive(42)))
        assertNull(asString(jsonString("")))
        assertNull(asString(JsonNull))
        assertNull(asString(null))
    }

    @Test
    fun asNumberMatchesWebCoercion() {
        assertEquals(42.0, asNumber(jsonNumber(42.0))!!, 0.0)
        assertEquals(7.5, asNumber(jsonString("7.5"))!!, 0.0)
        assertNull(asNumber(jsonString("abc")))
        assertNull(asNumber(JsonNull))
        assertNull(asNumber(null))
    }

    // ── daysUntil / formatters ─────────────────────────────────────────────────

    @Test
    fun daysUntilHandlesIsoDateAndDateTimeAndNull() {
        assertEquals(517, daysUntil("2025-06-01", NOW))
        assertEquals(517, daysUntil("2025-06-01T00:00:00Z", NOW))
        assertNull(daysUntil(null, NOW))
        assertNull(daysUntil("not-a-date", NOW))
    }

    @Test
    fun formatExpiryDateRendersShortMonthDayYear() {
        assertEquals("Jan 15, 2024", WarrantyStatusProjection.formatExpiryDate("2024-01-15"))
        assertEquals("Jun 1, 2025", WarrantyStatusProjection.formatExpiryDate("2025-06-01T00:00:00Z"))
        assertEquals(EM_DASH, WarrantyStatusProjection.formatExpiryDate(null))
        assertEquals(EM_DASH, WarrantyStatusProjection.formatExpiryDate("2024-13-40"))
    }

    @Test
    fun formatMonthYearRendersShortMonthYear() {
        assertEquals("Jan 2024", WarrantyStatusProjection.formatMonthYear("2024-01-15"))
        assertEquals("Jun 2029", WarrantyStatusProjection.formatMonthYear("2029-06-01"))
        assertEquals(EM_DASH, WarrantyStatusProjection.formatMonthYear(null))
    }

    @Test
    fun formatIntGroupsThousands() {
        assertEquals("0", WarrantyStatusProjection.formatInt(0))
        assertEquals("517", WarrantyStatusProjection.formatInt(517))
        assertEquals("12,000", WarrantyStatusProjection.formatInt(12000))
    }

    // ── Registration metadata (parity with web registry) ───────────────────────

    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("warranty-status", WarrantyStatusRegistration.ID)
        assertEquals("vehicle", WarrantyStatusRegistration.CATEGORY)
        assertEquals("WarrantyStatusWidget", WarrantyStatusRegistration.SLUG)
        assertEquals(WarrantyStatusSize(2, 2), WarrantyStatusRegistration.DEFAULT_SIZE)
        assertEquals(WarrantyStatusSize(1, 2), WarrantyStatusRegistration.MIN_SIZE)
        assertEquals(WarrantyStatusSize(3, 40), WarrantyStatusRegistration.MAX_SIZE)
    }

    @Test
    fun registrationClampsAndDetectsCompact() {
        assertEquals(WarrantyStatusSize(1, 2), WarrantyStatusRegistration.clamp(WarrantyStatusSize(0, 1)))
        assertEquals(WarrantyStatusSize(3, 40), WarrantyStatusRegistration.clamp(WarrantyStatusSize(9, 99)))
        assertTrue(WarrantyStatusRegistration.isWithinBounds(WarrantyStatusSize(2, 10)))
        assertTrue(WarrantyStatusRegistration.MIN_SIZE.isCompact)
        assertFalse(WarrantyStatusRegistration.DEFAULT_SIZE.isCompact)
    }

    private companion object {
        /** Fixed clock — 2024-01-01T00:00:00Z. */
        const val NOW: Long = 1_704_067_200_000L

        fun fullData(): JsonObject =
            buildJsonObject {
                put("warranty_start_date", "2021-06-01")
                put("warranty_expiry_date", "2025-06-01")
                put("mileage_limit_mi", 80_467.0)
                put("current_mileage_mi", 32_186.0)
            }

        fun envelope(data: JsonObject?): JsonElement = buildJsonObject { put("data", data ?: JsonNull) }

        fun jsonString(value: String): JsonElement = JsonPrimitive(value)

        fun jsonNumber(value: Double): JsonElement = JsonPrimitive(value)

        fun assertNotNull(value: Any?) = assertTrue(value != null)
    }
}

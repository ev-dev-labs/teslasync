package io.teslasync.android.featureviews.pedalusage

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the PedalUsage pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/driving/components/driving-dynamics/PedalUsage.tsx): the per-field
 * `typeof === 'number' | 'boolean'` guards, the `hasAny` presence gate, the `value ?? 0` → clamp the web
 * `RadialGauge` applies, the `value != null ? '%' : '—'` unit, the `isInteger ? 0 : precision` decimal count,
 * and the `brakeActive ? danger/Active : success/Inactive` ternary (null → inactive). Because the surface is
 * presentational, each [PedalUsageDisplay] is exactly what the thin composable renders, so these assertions
 * double as the per-state adapter "snapshot".
 */
class PedalUsageProjectionTest {
    private fun project(
        dynamics: DriveDynamicsLive?,
        loading: Boolean = false,
        precision: Int = DEFAULT_DECIMAL_PRECISION,
    ): PedalUsageDisplay = PedalUsageProjection.project(dynamics = dynamics, loading = loading, precision = precision)

    /** Concise [DriveDynamicsLive] builder so the per-state cases read as one short line. */
    private fun dyn(
        pedal: Double? = null,
        brake: Double? = null,
        active: Boolean? = null,
    ): DriveDynamicsLive = DriveDynamicsLive(pedalPosition = pedal, brakePedalPosition = brake, brakePedalActive = active)

    // ── project(): presence gate (web `hasAny`) ──────────────────────────────────

    @Test
    fun projectNullSnapshotSelectsTheEmptyState() {
        val display = project(dynamics = null)

        assertFalse(display.hasData)
        assertFalse(display.loading)
        // The gauge specs are still built (so the projection is fully testable) but read as absent.
        assertFalse(display.throttle.present)
        assertEquals(DASH, display.throttle.unit)
        assertEquals(0.0, display.throttle.value, 0.0)
        assertFalse(display.brake.present)
        assertEquals(DASH, display.brake.unit)
        assertFalse(display.brakeActive)
    }

    @Test
    fun projectPresentButAllNullSnapshotIsStillEmpty() {
        // Web nuance: PedalUsage gates on `hasAny`, NOT on `data != null`, so a present snapshot whose three
        // readings are all null still resolves to the empty state.
        val display = project(dyn(null, null, null))

        assertFalse(display.hasData)
    }

    @Test
    fun projectThreadsLoadingFlagEvenWithoutData() {
        val display = project(dynamics = null, loading = true)

        assertTrue(display.loading)
        assertFalse(display.hasData)
    }

    @Test
    fun projectThrottleOnlyHasData() {
        val display = project(dyn(42.0, null, null))

        assertTrue(display.hasData)
        assertTrue(display.throttle.present)
        assertEquals(PERCENT_UNIT, display.throttle.unit)
        assertEquals(42.0, display.throttle.value, 0.0)
        assertFalse(display.brake.present)
        assertEquals(DASH, display.brake.unit)
    }

    @Test
    fun projectBrakePositionOnlyHasData() {
        val display = project(dyn(null, 65.0, null))

        assertTrue(display.hasData)
        assertTrue(display.brake.present)
        assertEquals(65.0, display.brake.value, 0.0)
        assertFalse(display.throttle.present)
    }

    @Test
    fun projectBrakeActiveOnlyHasData() {
        // Only the boolean is present — `hasAny` is still true, and the gauges read as absent.
        val display = project(dyn(null, null, true))

        assertTrue(display.hasData)
        assertTrue(display.brakeActive)
        assertEquals(DASH, display.throttle.unit)
        assertEquals(DASH, display.brake.unit)
    }

    // ── project(): brakeActive ternary (null is falsy) ───────────────────────────

    @Test
    fun projectBrakeActiveTrueIsActive() {
        val display = project(dyn(1.0, null, true))

        assertTrue(display.brakeActive)
    }

    @Test
    fun projectBrakeActiveFalseIsInactive() {
        val display = project(dyn(1.0, null, false))

        assertFalse(display.brakeActive)
    }

    @Test
    fun projectBrakeActiveNullIsInactive() {
        val display = project(dyn(1.0, null, null))

        assertFalse(display.brakeActive)
    }

    // ── project(): clamp + scale + accent ────────────────────────────────────────

    @Test
    fun projectClampsReadingsToTheGaugeScale() {
        // Web `Math.max(0, Math.min(value, max))` — an out-of-range reading is clamped to 0..100.
        val display = project(dyn(150.0, -20.0, null))

        assertEquals(100.0, display.throttle.value, 0.0)
        assertEquals(0.0, display.brake.value, 0.0)
        // Both readings are still "present" (non-null), so they keep the percent unit.
        assertEquals(PERCENT_UNIT, display.throttle.unit)
        assertEquals(PERCENT_UNIT, display.brake.unit)
    }

    @Test
    fun projectAppliesTheWebGaugeAccentsAndScale() {
        val display = project(dyn(10.0, 20.0, false))

        assertEquals(PedalGaugeKey.Throttle, display.throttle.key)
        assertEquals(PedalAccent.Cyan, display.throttle.accent)
        assertEquals(PedalGaugeKey.Brake, display.brake.key)
        assertEquals(PedalAccent.Red, display.brake.accent)
        assertEquals(PEDAL_MAX, display.throttle.max, 0.0)
        assertEquals(PEDAL_MAX, display.brake.max, 0.0)
    }

    // ── gaugeDecimals(): web `decimals ?? (isInteger ? 0 : globalPrecision)` ──────

    @Test
    fun gaugeDecimalsIsZeroForAnIntegerReading() {
        assertEquals(0, PedalUsageProjection.gaugeDecimals(42.0, 2))
        assertEquals(0, PedalUsageProjection.gaugeDecimals(0.0, 2))
        assertEquals(0, PedalUsageProjection.gaugeDecimals(100.0, 3))
    }

    @Test
    fun gaugeDecimalsIsTheGlobalPrecisionForAFractionalReading() {
        assertEquals(2, PedalUsageProjection.gaugeDecimals(42.5, 2))
        assertEquals(3, PedalUsageProjection.gaugeDecimals(12.34, 3))
    }

    @Test
    fun gaugeDecimalsNeverGoesNegative() {
        assertEquals(0, PedalUsageProjection.gaugeDecimals(42.5, -1))
    }

    @Test
    fun projectThreadsPrecisionIntoAFractionalGauge() {
        val display = project(dyn(42.5, 30.0, null))

        assertEquals(2, display.throttle.decimals)
        // The brake reading is an integer, so it ignores precision and renders zero decimals.
        assertEquals(0, display.brake.decimals)
    }

    @Test
    fun projectCoercesNegativePrecisionToZero() {
        val display =
            PedalUsageProjection.project(
                dyn(42.5, null, null),
                loading = false,
                precision = -3,
            )

        assertEquals(0, display.throttle.decimals)
    }

    // ── DriveDynamicsLive.fromJson(): cache-then-network parse ───────────────────

    @Test
    fun fromJsonDecodesTheSnakeCaseWireContract() {
        val element =
            buildJsonObject {
                put("pedal_position", 42.0)
                put("brake_pedal_position", 10.5)
                put("brake_pedal_active", true)
            }

        val dynamics = DriveDynamicsLive.fromJson(element)

        assertEquals(42.0, dynamics?.pedalPosition)
        assertEquals(10.5, dynamics?.brakePedalPosition)
        assertEquals(true, dynamics?.brakePedalActive)
    }

    @Test
    fun fromJsonDecodesAFalseBrakeActiveAsNonNull() {
        val dynamics = DriveDynamicsLive.fromJson(buildJsonObject { put("brake_pedal_active", false) })

        assertEquals(false, dynamics?.brakePedalActive)
    }

    @Test
    fun fromJsonReturnsNullForAbsentOrNonObjectBodies() {
        assertNull(DriveDynamicsLive.fromJson(null))
        assertNull(DriveDynamicsLive.fromJson(JsonNull))
        assertNull(DriveDynamicsLive.fromJson(JsonPrimitive("not-an-object")))
    }

    @Test
    fun fromJsonDecodesAnEmptyObjectToAnAllNullSnapshot() {
        val dynamics = DriveDynamicsLive.fromJson(buildJsonObject {})

        assertNull(dynamics?.pedalPosition)
        assertNull(dynamics?.brakePedalPosition)
        assertNull(dynamics?.brakePedalActive)
        // A present-but-empty object is still a non-null snapshot; the `hasAny` gate then selects the empty state.
        assertTrue(dynamics != null)
        assertFalse(project(dynamics).hasData)
    }

    @Test
    fun fromJsonIgnoresStringTypedReadings() {
        // Web `typeof === 'number' | 'boolean'` guards reject a quoted value, so a string-typed field is null.
        val element =
            buildJsonObject {
                put("pedal_position", "42")
                put("brake_pedal_active", "true")
            }

        val dynamics = DriveDynamicsLive.fromJson(element)

        assertNull(dynamics?.pedalPosition)
        assertNull(dynamics?.brakePedalActive)
    }

    // ── resolveDisplayPrecision(): web `getGlobalPrecision()` default ────────────

    @Test
    fun resolveDisplayPrecisionFallsBackToTwoForNull() {
        assertEquals(DEFAULT_DECIMAL_PRECISION, resolveDisplayPrecision(null))
    }

    @Test
    fun resolveDisplayPrecisionHonorsAConfiguredValueAndClampsNegative() {
        assertEquals(3, resolveDisplayPrecision(3))
        assertEquals(0, resolveDisplayPrecision(-1))
    }
}

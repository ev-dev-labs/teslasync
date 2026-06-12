package io.teslasync.android.featureviews.livestateindicators

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.units.formatSpeed
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LiveStateIndicators pure projection — the native port of the web component's
 * `state`-prop render contract (web/src/features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx): the
 * `(state) -> UiState` adapter (present -> content, absent -> empty), the five per-badge variant + label
 * derivations, the `state.speed > 0` tint test, and the single `formatSpeed(state.speed, { precision: 0 })`
 * conversion threaded through the shared SI formatter for both metric and imperial users. Because the surface is
 * purely presentational, each projected [LiveIndicator] is exactly what the thin composable renders, so the
 * per-state assertions double as the "snapshot". Runs in the :android:testReleaseUnitTest gate; no Compose, no device.
 */
class LiveStateIndicatorsProjectionTest {
    // A controlled `/settings` document so every formatted value is deterministic regardless of the host locale.
    private val metricPrefs =
        LiveStateDisplayPrefs.from(buildJsonObject { put("locale", "en-US") })

    private val imperialPrefs =
        LiveStateDisplayPrefs.from(
            buildJsonObject {
                put("locale", "en-US")
                put("unit_of_length", "mi")
            },
        )

    private val strings =
        LiveStateStrings(
            speed = "Speed",
            locked = "Locked",
            unlocked = "Unlocked",
            sentry = "Sentry",
            active = "Active",
            off = "Off",
            climate = "Climate",
            on = "On",
            charging = "Charging",
            notCharging = "Not Charging",
            noData = "No data available",
        )

    private val driving =
        VehicleStateLive(
            speedMps = 27.0,
            isLocked = true,
            sentryMode = true,
            isClimateOn = true,
            isCharging = false,
        )

    private val parked =
        VehicleStateLive(
            speedMps = 0.0,
            isLocked = false,
            sentryMode = false,
            isClimateOn = false,
            isCharging = true,
        )

    // ── (state) -> UiState adapter (web present -> content, absent -> empty) ──────────────────────────

    @Test
    fun projectUiStateOfNullIsEmptyWithNoData() {
        val state = LiveStateIndicatorsProjection.projectUiState(null)

        assertEquals(UiPhase.Empty, state.phase)
        assertFalse(state.hasData)
    }

    @Test
    fun projectUiStateOfPresentSnapshotIsContentCarryingIt() {
        val state = LiveStateIndicatorsProjection.projectUiState(driving)

        assertEquals(UiPhase.Content, state.phase)
        assertSame(driving, state.data)
    }

    // ── speedActive (web `state.speed > 0`) ──────────────────────────────────────────────────────────

    @Test
    fun speedActiveIsTrueOnlyWhenMoving() {
        assertTrue(LiveStateIndicatorsProjection.speedActive(27.0))
        assertTrue(LiveStateIndicatorsProjection.speedActive(0.1))
    }

    @Test
    fun speedActiveIsFalseWhenStoppedNullOrNegative() {
        assertFalse(LiveStateIndicatorsProjection.speedActive(0.0))
        assertFalse(LiveStateIndicatorsProjection.speedActive(null))
        assertFalse(LiveStateIndicatorsProjection.speedActive(-5.0))
    }

    // ── Speed badge (variant + `formatSpeed(speed, { precision: 0 })` in metric and imperial) ─────────

    @Test
    fun speedBadgeMovingIsSuccessWithWholeKmh() {
        val indicator = LiveStateIndicatorsProjection.speedIndicator(driving, metricPrefs, strings)

        // 27 m/s -> 97.2 km/h -> precision-0 -> "97 km/h".
        assertEquals("Speed: 97 km/h", indicator.text)
        assertEquals(LiveIndicatorTone.Success, indicator.tone)
    }

    @Test
    fun speedBadgeMovingIsSuccessWithWholeMph() {
        val indicator = LiveStateIndicatorsProjection.speedIndicator(driving, imperialPrefs, strings)

        // 27 m/s -> 60.4 mph -> precision-0 -> "60 mph".
        assertEquals("Speed: 60 mph", indicator.text)
        assertEquals(LiveIndicatorTone.Success, indicator.tone)
    }

    @Test
    fun speedBadgeStoppedIsNeutralWithZero() {
        val indicator = LiveStateIndicatorsProjection.speedIndicator(parked, metricPrefs, strings)

        assertEquals("Speed: 0 km/h", indicator.text)
        assertEquals(LiveIndicatorTone.Neutral, indicator.tone)
    }

    @Test
    fun speedBadgeWiresRawSpeedThroughSharedFormatterAtPrecisionZero() {
        // Pins the contract: label + ": " + formatSpeed(rawMps, units, 0) — the same args the web passes.
        val expected = "Speed: " + formatSpeed(27.0, metricPrefs.units, 0)

        assertEquals(expected, LiveStateIndicatorsProjection.speedIndicator(driving, metricPrefs, strings).text)
    }

    @Test
    fun speedBadgeNullSpeedRendersEmptyDashAndStaysNeutral() {
        val snapshot = driving.copy(speedMps = null)

        val indicator = LiveStateIndicatorsProjection.speedIndicator(snapshot, metricPrefs, strings)

        assertEquals("Speed: \u2014", indicator.text)
        assertEquals(LiveIndicatorTone.Neutral, indicator.tone)
    }

    // ── Lock badge (web `is_locked ? success/Locked : danger/Unlocked`) ──────────────────────────────

    @Test
    fun lockBadgeReflectsLockState() {
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Lock, "Locked", LiveIndicatorTone.Success),
            LiveStateIndicatorsProjection.lockIndicator(driving.copy(isLocked = true), strings),
        )
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Lock, "Unlocked", LiveIndicatorTone.Danger),
            LiveStateIndicatorsProjection.lockIndicator(driving.copy(isLocked = false), strings),
        )
    }

    @Test
    fun lockBadgeNullReadsAsUnlockedDanger() {
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Lock, "Unlocked", LiveIndicatorTone.Danger),
            LiveStateIndicatorsProjection.lockIndicator(driving.copy(isLocked = null), strings),
        )
    }

    // ── Sentry badge (web `sentry_mode ? warning/Active : neutral/Off`) ──────────────────────────────

    @Test
    fun sentryBadgeReflectsSentryMode() {
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Sentry, "Sentry: Active", LiveIndicatorTone.Warning),
            LiveStateIndicatorsProjection.sentryIndicator(driving.copy(sentryMode = true), strings),
        )
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Sentry, "Sentry: Off", LiveIndicatorTone.Neutral),
            LiveStateIndicatorsProjection.sentryIndicator(driving.copy(sentryMode = false), strings),
        )
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Sentry, "Sentry: Off", LiveIndicatorTone.Neutral),
            LiveStateIndicatorsProjection.sentryIndicator(driving.copy(sentryMode = null), strings),
        )
    }

    // ── Climate badge (web `is_climate_on ? info/On : neutral/Off`) ──────────────────────────────────

    @Test
    fun climateBadgeReflectsClimateState() {
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Climate, "Climate: On", LiveIndicatorTone.Info),
            LiveStateIndicatorsProjection.climateIndicator(driving.copy(isClimateOn = true), strings),
        )
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Climate, "Climate: Off", LiveIndicatorTone.Neutral),
            LiveStateIndicatorsProjection.climateIndicator(driving.copy(isClimateOn = false), strings),
        )
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Climate, "Climate: Off", LiveIndicatorTone.Neutral),
            LiveStateIndicatorsProjection.climateIndicator(driving.copy(isClimateOn = null), strings),
        )
    }

    // ── Charging badge (web `is_charging ? warning/Charging : neutral/Not Charging`) ─────────────────

    @Test
    fun chargingBadgeReflectsChargingState() {
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Charging, "Charging", LiveIndicatorTone.Warning),
            LiveStateIndicatorsProjection.chargingIndicator(parked.copy(isCharging = true), strings),
        )
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Charging, "Not Charging", LiveIndicatorTone.Neutral),
            LiveStateIndicatorsProjection.chargingIndicator(parked.copy(isCharging = false), strings),
        )
        assertEquals(
            LiveIndicator(LiveIndicatorKind.Charging, "Not Charging", LiveIndicatorTone.Neutral),
            LiveStateIndicatorsProjection.chargingIndicator(parked.copy(isCharging = null), strings),
        )
    }

    // ── Full badge list (order + every cell, the surface's "snapshot") ───────────────────────────────

    @Test
    fun indicatorsEmitFiveBadgesInWebSourceOrder() {
        val kinds = LiveStateIndicatorsProjection.indicators(driving, metricPrefs, strings).map { it.kind }

        assertEquals(
            listOf(
                LiveIndicatorKind.Speed,
                LiveIndicatorKind.Lock,
                LiveIndicatorKind.Sentry,
                LiveIndicatorKind.Climate,
                LiveIndicatorKind.Charging,
            ),
            kinds,
        )
    }

    @Test
    fun indicatorsForDrivingSnapshotRenderEveryCell() {
        val indicators = LiveStateIndicatorsProjection.indicators(driving, metricPrefs, strings)

        assertEquals(
            listOf(
                LiveIndicator(LiveIndicatorKind.Speed, "Speed: 97 km/h", LiveIndicatorTone.Success),
                LiveIndicator(LiveIndicatorKind.Lock, "Locked", LiveIndicatorTone.Success),
                LiveIndicator(LiveIndicatorKind.Sentry, "Sentry: Active", LiveIndicatorTone.Warning),
                LiveIndicator(LiveIndicatorKind.Climate, "Climate: On", LiveIndicatorTone.Info),
                LiveIndicator(LiveIndicatorKind.Charging, "Not Charging", LiveIndicatorTone.Neutral),
            ),
            indicators,
        )
    }

    @Test
    fun indicatorsForParkedSnapshotRenderEveryCell() {
        val indicators = LiveStateIndicatorsProjection.indicators(parked, metricPrefs, strings)

        assertEquals(
            listOf(
                LiveIndicator(LiveIndicatorKind.Speed, "Speed: 0 km/h", LiveIndicatorTone.Neutral),
                LiveIndicator(LiveIndicatorKind.Lock, "Unlocked", LiveIndicatorTone.Danger),
                LiveIndicator(LiveIndicatorKind.Sentry, "Sentry: Off", LiveIndicatorTone.Neutral),
                LiveIndicator(LiveIndicatorKind.Climate, "Climate: Off", LiveIndicatorTone.Neutral),
                LiveIndicator(LiveIndicatorKind.Charging, "Charging", LiveIndicatorTone.Warning),
            ),
            indicators,
        )
    }
}

package io.teslasync.android.featureviews.securitysection

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage of the pure SecuritySection model — the [SecuritySectionProjection] field reads,
 * `windowOpenCount` JS-`Number` coercion, the non-empty `door_state` guard, the per-tile green/cyan accents,
 * the `'{{count}} open'` interpolation, [SecuritySnapshot.hasEvent] / [SecuritySectionProjection.isEmptySnapshot],
 * and the security-primary [mergeSecuritySection] feed fold. Run by the offline `:android:testReleaseUnitTest`
 * gate.
 */
class SecuritySectionProjectionTest {
    private val strings =
        SecuritySectionStrings(
            title = "Security",
            locked = "Locked",
            yes = "Yes",
            no = "No",
            sentry = "Sentry",
            active = "Active",
            off = "Off",
            doors = "Doors",
            closed = "Closed",
            windows = "Windows",
            windowsOpenTemplate = "%1\$s open",
            noData = "No security data available",
        )

    // ── windowOpenCount: JS Number(v) > 0 coercion ────────────────────────────────
    @Test
    fun windowOpenCountCountsNumericAndBooleanOpenCorners() {
        val security =
            buildJsonObject {
                put("fd_window", true) // Number(true) = 1 → open
                put("fp_window", 25) // a percent-open number → open
                put("rd_window", "3") // numeric string → open
                put("rp_window", false) // Number(false) = 0 → closed
            }
        assertEquals(3, SecuritySectionProjection.windowOpenCount(security))
    }

    @Test
    fun windowOpenCountTreatsNonNumericStringsAndZeroAndAbsentAsClosed() {
        val security =
            buildJsonObject {
                put("fd_window", "open") // Number('open') = NaN → not counted
                put("fp_window", "closed") // Number('closed') = NaN → not counted
                put("rd_window", 0) // not > 0
                put("rp_window", JsonNull) // skipped like the web `v == null`
            }
        assertEquals(0, SecuritySectionProjection.windowOpenCount(security))
    }

    @Test
    fun windowOpenCountSkipsNegativeAndEmptyStringCorners() {
        val security =
            buildJsonObject {
                put("fd_window", -1) // not > 0
                put("fp_window", "") // Number('') = 0 → not > 0
            }
        assertEquals(0, SecuritySectionProjection.windowOpenCount(security))
    }

    // ── door_state guard ──────────────────────────────────────────────────────────
    @Test
    fun doorsValueRendersNonEmptyStateAndFallsBackToClosed() {
        val open = SecuritySectionProjection.project(snapshot(security = buildJsonObject { put("door_state", "df_open") }), strings)
        assertEquals("df_open", open.doorsValue)
        assertEquals(CardAccent.Neutral, open.doorsAccent)

        val closed = SecuritySectionProjection.project(snapshot(security = buildJsonObject { put("door_state", "") }), strings)
        assertEquals("Closed", closed.doorsValue)
        assertEquals(CardAccent.Engaged, closed.doorsAccent)

        val absent = SecuritySectionProjection.project(snapshot(security = buildJsonObject {}), strings)
        assertEquals("Closed", absent.doorsValue)
    }

    // ── project: locked / sentry tiles from the live state ────────────────────────
    @Test
    fun lockedAndSentryReadTheLiveStateWithGreenWhenEngaged() {
        val display =
            SecuritySectionProjection.project(
                snapshot(security = buildJsonObject {}, state = vehicleState(locked = true, sentry = true)),
                strings,
            )
        assertTrue(display.locked)
        assertEquals("Yes", display.lockedValue)
        assertEquals(CardAccent.Engaged, display.lockedAccent)
        assertEquals("Active", display.sentryValue)
        assertEquals(CardAccent.Engaged, display.sentryAccent)
    }

    @Test
    fun unlockedAndSentryOffRenderCyan() {
        val display =
            SecuritySectionProjection.project(
                snapshot(security = buildJsonObject {}, state = vehicleState(locked = false, sentry = false)),
                strings,
            )
        assertFalse(display.locked)
        assertEquals("No", display.lockedValue)
        assertEquals(CardAccent.Neutral, display.lockedAccent)
        assertEquals("Off", display.sentryValue)
        assertEquals(CardAccent.Neutral, display.sentryAccent)
    }

    @Test
    fun absentStateFallsBackToTheSharedNormalizeDefaults() {
        val display = SecuritySectionProjection.project(snapshot(security = buildJsonObject {}, state = null), strings)
        assertEquals("Yes", display.lockedValue) // normalize default is_locked ?? true
        assertEquals("Off", display.sentryValue) // sentry_mode ?? false
    }

    // ── project: windows tile ─────────────────────────────────────────────────────
    @Test
    fun windowsTileInterpolatesTheOpenCountElseClosed() {
        val open =
            SecuritySectionProjection.project(
                snapshot(
                    security =
                        buildJsonObject {
                            put("fd_window", true)
                            put("rd_window", "2")
                        },
                ),
                strings,
            )
        assertEquals("2 open", open.windowsValue)
        assertEquals(CardAccent.Neutral, open.windowsAccent)

        val closed = SecuritySectionProjection.project(snapshot(security = buildJsonObject {}), strings)
        assertEquals("Closed", closed.windowsValue)
        assertEquals(CardAccent.Engaged, closed.windowsAccent)
    }

    // ── empty / content boundary ──────────────────────────────────────────────────
    @Test
    fun noSecurityEventProjectsTheEmptyState() {
        val display = SecuritySectionProjection.project(SecuritySnapshot(security = JsonNull, state = null), strings)
        assertFalse(display.hasEvent)
        assertEquals(EM_DASH, display.lockedValue)
    }

    @Test
    fun isEmptySnapshotIsTrueOnlyWhenNoSecurityEvent() {
        assertTrue(SecuritySectionProjection.isEmptySnapshot(null))
        assertTrue(SecuritySectionProjection.isEmptySnapshot(SecuritySnapshot(security = null, state = null)))
        assertTrue(SecuritySectionProjection.isEmptySnapshot(SecuritySnapshot(security = JsonNull, state = null)))
        assertFalse(SecuritySectionProjection.isEmptySnapshot(snapshot(security = buildJsonObject {})))
    }

    @Test
    fun snapshotHasEventReflectsADecodedSecurityObject() {
        assertTrue(SecuritySnapshot(security = buildJsonObject {}, state = null).hasEvent)
        assertFalse(SecuritySnapshot(security = JsonNull, state = null).hasEvent)
        assertFalse(SecuritySnapshot.EMPTY.hasEvent)
    }

    // ── mergeSecuritySection: security-primary fold ───────────────────────────────
    @Test
    fun mergeSuccessFoldsSecurityEventAndLiveState() {
        val result =
            mergeSecuritySection(
                security = Resource.Success(buildJsonObject { put("door_state", "df_closed") }, fetchedAt = 100L, stale = false),
                state = Resource.Success(env(locked = false), fetchedAt = 100L, stale = false),
            )
        assertTrue(result is Resource.Success)
        val snapshot = result.cached!!
        assertTrue(snapshot.hasEvent)
        assertEquals(false, snapshot.state!!.isLocked)
    }

    @Test
    fun mergeStaysLoadingUntilBothFeedsFirstResolve() {
        val securityLoadingResult =
            mergeSecuritySection(
                security = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                state = Resource.Success(env(locked = true), fetchedAt = 100L, stale = false),
            )
        assertTrue(securityLoadingResult is Resource.Loading)
        assertNull(securityLoadingResult.cached)

        val stateLoadingResult =
            mergeSecuritySection(
                security = Resource.Success(buildJsonObject {}, fetchedAt = 100L, stale = false),
                state = Resource.Loading(cached = null, fetchedAt = null, stale = false),
            )
        assertTrue(stateLoadingResult is Resource.Loading)
    }

    @Test
    fun mergeHardErrorsWhenSecurityFailsWithNoCache() {
        val result =
            mergeSecuritySection(
                security = Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                state = Resource.Success(env(locked = true), fetchedAt = 100L, stale = false),
            )
        assertTrue(result is Resource.Error)
        assertNull(result.cached)
    }

    @Test
    fun mergeKeepsCachedEventAsOfflineWhenSecurityFails() {
        val result =
            mergeSecuritySection(
                security =
                    Resource.Error(
                        cached = buildJsonObject { put("door_state", "df_closed") },
                        fetchedAt = 100L,
                        stale = true,
                        error = ApiError.Network(),
                    ),
                state = Resource.Success(env(locked = true), fetchedAt = 100L, stale = false),
            )
        assertTrue(result is Resource.Error)
        assertTrue(result.cached!!.hasEvent)
        assertTrue(result.stale)
    }

    @Test
    fun mergeSecuritySuccessWithoutEventIsAnEmptySnapshot() {
        val result =
            mergeSecuritySection(
                security = Resource.Success(JsonNull, fetchedAt = 100L, stale = false),
                state = Resource.Success(env(locked = true), fetchedAt = 100L, stale = false),
            )
        assertTrue(result is Resource.Success)
        assertTrue(SecuritySectionProjection.isEmptySnapshot(result.cached))
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────
    private fun snapshot(
        security: JsonObject,
        state: VehicleState? = vehicleState(locked = true, sentry = false),
    ): SecuritySnapshot = SecuritySnapshot(security = security, state = state)

    private fun env(locked: Boolean): VehicleStateEnvelope =
        VehicleStateEnvelope(state = vehicleState(locked = locked, sentry = false), live = false)

    private fun vehicleState(
        locked: Boolean,
        sentry: Boolean,
    ): VehicleState =
        VehicleState(
            batteryLevel = 80,
            chargeRate = 0.0,
            chargerPower = 0.0,
            idealRange = 0.0,
            insideTemp = 21.0,
            isCharging = false,
            isClimateOn = false,
            isLocked = locked,
            latitude = 0.0,
            longitude = 0.0,
            odometer = 0.0,
            outsideTemp = 15.0,
            power = 0.0,
            ratedRange = 0.0,
            sentryMode = sentry,
            softwareVersion = "2025.0",
            speed = 0.0,
            state = "online",
            timeToFullCharge = 0.0,
            vehicleId = 1L,
        )
}

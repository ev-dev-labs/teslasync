package io.teslasync.shared.core.presentation.vehicles

import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.VEHICLES_FAMILY
import io.teslasync.shared.core.data.repo.chargingTelemetryLatestKey
import io.teslasync.shared.core.data.repo.climateLatestKey
import io.teslasync.shared.core.data.repo.driveDynamicsLatestKey
import io.teslasync.shared.core.data.repo.locationSnapshotLatestKey
import io.teslasync.shared.core.data.repo.mediaLatestKey
import io.teslasync.shared.core.data.repo.mobileEnabledKey
import io.teslasync.shared.core.data.repo.motorHistoryKey
import io.teslasync.shared.core.data.repo.motorHistoryQuery
import io.teslasync.shared.core.data.repo.motorLatestKey
import io.teslasync.shared.core.data.repo.normalizeVehicleStateResponse
import io.teslasync.shared.core.data.repo.securityLatestKey
import io.teslasync.shared.core.data.repo.tirePressureLatestKey
import io.teslasync.shared.core.data.repo.userPreferenceLatestKey
import io.teslasync.shared.core.data.repo.vehicleConfigLatestKey
import io.teslasync.shared.core.data.repo.vehicleDetailKey
import io.teslasync.shared.core.data.repo.vehicleIdQuery
import io.teslasync.shared.core.data.repo.vehicleOptionsKey
import io.teslasync.shared.core.data.repo.vehiclePositionsKey
import io.teslasync.shared.core.data.repo.vehiclePositionsQuery
import io.teslasync.shared.core.data.repo.vehicleSpecsKey
import io.teslasync.shared.core.data.repo.vehicleStateKey
import io.teslasync.shared.core.data.repo.vehicleStateQuery
import io.teslasync.shared.core.data.repo.vehicleSubscriptionsKey
import io.teslasync.shared.core.data.repo.vehicleUpgradesKey
import io.teslasync.shared.core.data.repo.vehiclesKey
import io.teslasync.shared.core.data.repo.vehiclesKeyInFamily
import io.teslasync.shared.core.data.repo.warrantyDetailsKey
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Golden vectors locking the client-side derivations ported from the web `useVehicles` domain:
 *
 *  1. [normalizeVehicleStateResponse] — the `useVehicleState` normalisation that folds the
 *     already-normalised `{ state, live }`, the legacy `{ vehicle, position, … }`, and the
 *     neither-present shapes into one typed [VehicleStateEnvelope] with the web's exact
 *     `?? 0 / ?? false / ?? 'offline' / ?? true` defaults and the `rated_range ?? ideal_range`
 *     fallback.
 *  2. The snake_case query builders (the unconditional `vehicle_id`, the positions/motor-history
 *     limit, and the `as_of` truthy guard).
 *  3. The cache/feed key builders mirroring the web TanStack query keys, and [vehiclesKeyInFamily] —
 *     the TanStack prefix-invalidation semantics, including the `['vehicles']` list-vs-detail
 *     coverage and the cousin boundary that keeps it from touching the `vehicle-state`/
 *     `vehicle-options` heads.
 *
 * The vectors are language-neutral (raw JSON in / fixed expectations out) so the Windows C# port and
 * the KMP core load the identical set and cannot drift (ADR-004). The fixtures are inlined to stay
 * within this slice's allowed file scope; the C# port mirrors these exact rows.
 */
class VehiclesGoldenTest {
    private val json = Json { ignoreUnknownKeys = true }

    private fun normalize(
        raw: String,
        vehicleId: Long,
    ): VehicleStateEnvelope = normalizeVehicleStateResponse(json.parseToJsonElement(raw), vehicleId)

    // ---- useVehicleState normalisation --------------------------------------------

    @Test
    fun alreadyNormalisedStateIsPassedThroughVerbatim() {
        val envelope = normalize(ALREADY_NORMALISED, vehicleId = 1)
        assertTrue(envelope.live)
        assertEquals(
            VehicleState(
                vehicleId = 7,
                state = "online",
                latitude = 37.5,
                longitude = -122.3,
                speed = 10.0,
                power = 5.0,
                batteryLevel = 80L,
                ratedRange = 400.0,
                idealRange = 420.0,
                odometer = 12345.6,
                insideTemp = 21.0,
                outsideTemp = 15.0,
                isClimateOn = true,
                isCharging = false,
                chargerPower = 0.0,
                chargeRate = 0.0,
                timeToFullCharge = 0.0,
                isLocked = true,
                sentryMode = false,
                softwareVersion = "2026.4.1",
            ),
            envelope.state,
        )
    }

    @Test
    fun legacyVehiclePositionShapeIsFoldedWithWebDefaults() {
        val envelope = normalize(LEGACY_SHAPE, vehicleId = 9)
        assertTrue(envelope.live)
        assertEquals(
            VehicleState(
                vehicleId = 9,
                state = "asleep",
                latitude = 1.0,
                longitude = 2.0,
                speed = 3.0,
                power = 4.0,
                batteryLevel = 55L,
                // rated_range absent ⇒ falls back to ideal_range.
                ratedRange = 300.0,
                idealRange = 300.0,
                odometer = 999.0,
                insideTemp = 20.0,
                outsideTemp = 10.0,
                isClimateOn = true,
                isCharging = true,
                chargerPower = 11.0,
                chargeRate = 30.0,
                timeToFullCharge = 1.5,
                // root is_locked absent ⇒ falls back to vehicle.is_locked (false).
                isLocked = false,
                sentryMode = true,
                // root software_version absent ⇒ falls back to vehicle.software_version.
                softwareVersion = "2025.1",
            ),
            envelope.state,
        )
    }

    @Test
    fun neitherVehicleNorPositionYieldsNullState() {
        val envelope = normalize("""{"live":false}""", vehicleId = 3)
        assertNull(envelope.state)
        assertFalse(envelope.live)
    }

    @Test
    fun nonObjectRootYieldsEmptyEnvelope() {
        val envelope = normalize("[]", vehicleId = 3)
        assertNull(envelope.state)
        assertFalse(envelope.live)
    }

    @Test
    fun missingFieldsCollapseToWebDefaults() {
        val envelope = normalize("""{"vehicle":{},"position":{}}""", vehicleId = 42)
        assertEquals(
            VehicleState(
                vehicleId = 42,
                state = "offline",
                latitude = 0.0,
                longitude = 0.0,
                speed = 0.0,
                power = 0.0,
                batteryLevel = 0L,
                ratedRange = 0.0,
                idealRange = 0.0,
                odometer = 0.0,
                insideTemp = 0.0,
                outsideTemp = 0.0,
                isClimateOn = false,
                isCharging = false,
                chargerPower = 0.0,
                chargeRate = 0.0,
                timeToFullCharge = 0.0,
                isLocked = true,
                sentryMode = false,
                softwareVersion = "",
            ),
            envelope.state,
        )
        assertFalse(envelope.live)
    }

    // ---- Query builders -----------------------------------------------------------

    @Test
    fun queryBuildersMatchTheWebParams() {
        assertEquals(mapOf("vehicle_id" to "7"), vehicleIdQuery(7))
        assertEquals(mapOf("limit" to "100"), vehiclePositionsQuery(100))
        assertEquals(mapOf("vehicle_id" to "7", "limit" to "200"), motorHistoryQuery(7, 200))
        // as_of truthy guard: sent only when present AND non-blank.
        assertEquals(emptyMap(), vehicleStateQuery(null))
        assertEquals(emptyMap(), vehicleStateQuery(""))
        assertEquals(mapOf("as_of" to "2026-01-01T00:00:00Z"), vehicleStateQuery("2026-01-01T00:00:00Z"))
    }

    // ---- Cache/feed keys ----------------------------------------------------------

    @Test
    fun cacheKeysMirrorTheWebQueryKeys() {
        assertEquals("vehicles", vehiclesKey())
        assertEquals("vehicles|7", vehicleDetailKey("7"))
        assertEquals("vehicle-state|7", vehicleStateKey(7))
        assertEquals("vehicle-state|7|2026-01-01", vehicleStateKey(7, "2026-01-01"))
        assertEquals("vehicle-positions|7", vehiclePositionsKey(7))
        assertEquals("motor-latest|7", motorLatestKey(7))
        assertEquals("motor-history|7|200", motorHistoryKey(7, 200))
        assertEquals("drive-dynamics-latest|7", driveDynamicsLatestKey(7))
        assertEquals("climate-latest|7", climateLatestKey(7))
        assertEquals("security-latest|7", securityLatestKey(7))
        assertEquals("tire-latest|7", tirePressureLatestKey(7))
        assertEquals("charging-telemetry-latest|7", chargingTelemetryLatestKey(7))
        assertEquals("media-latest|7", mediaLatestKey(7))
        assertEquals("location-latest|7", locationSnapshotLatestKey(7))
        assertEquals("vehicle-config-latest|7", vehicleConfigLatestKey(7))
        assertEquals("user-pref-latest|7", userPreferenceLatestKey(7))
        assertEquals("vehicle-mobile-enabled|7", mobileEnabledKey("7"))
        assertEquals("vehicle-options|7", vehicleOptionsKey("7"))
        assertEquals("vehicle-specs|7", vehicleSpecsKey("7"))
        assertEquals("vehicle-subscriptions|7", vehicleSubscriptionsKey("7"))
        assertEquals("vehicle-upgrades|7", vehicleUpgradesKey("7"))
        assertEquals("warranty-details", warrantyDetailsKey())
    }

    // ---- Family (prefix) invalidation semantics -----------------------------------

    @Test
    fun vehiclesFamilyMatchesListAndDetailButNotCousins() {
        // ['vehicles'] prefix matches the list head AND the per-vehicle detail …
        assertTrue(vehiclesKeyInFamily(vehiclesKey(), VEHICLES_FAMILY))
        assertTrue(vehiclesKeyInFamily(vehicleDetailKey("7"), VEHICLES_FAMILY))
        // … but NOT the vehicle-state / vehicle-options / … cousins (the '|' separator boundary keeps
        // 'vehicles' from matching 'vehicle-…').
        assertFalse(vehiclesKeyInFamily(vehicleStateKey(7), VEHICLES_FAMILY))
        assertFalse(vehiclesKeyInFamily(vehicleOptionsKey("7"), VEHICLES_FAMILY))
        assertFalse(vehiclesKeyInFamily(vehiclePositionsKey(7), VEHICLES_FAMILY))
    }

    @Test
    fun infoEnvelopeFamiliesAreExactSingleFeeds() {
        // The per-envelope refreshes invalidate exactly their own key (no descendants).
        assertTrue(vehiclesKeyInFamily(vehicleOptionsKey("7"), vehicleOptionsKey("7")))
        assertTrue(vehiclesKeyInFamily(warrantyDetailsKey(), warrantyDetailsKey()))
        assertFalse(vehiclesKeyInFamily(vehicleSpecsKey("7"), vehicleOptionsKey("7")))
        assertFalse(vehiclesKeyInFamily(vehicleOptionsKey("8"), vehicleOptionsKey("7")))
    }

    private companion object {
        val ALREADY_NORMALISED =
            """
            {
              "live": true,
              "state": {
                "vehicle_id": 7, "state": "online", "latitude": 37.5, "longitude": -122.3,
                "speed": 10.0, "power": 5.0, "battery_level": 80, "rated_range": 400.0,
                "ideal_range": 420.0, "odometer": 12345.6, "inside_temp": 21.0, "outside_temp": 15.0,
                "is_climate_on": true, "is_charging": false, "charger_power": 0.0, "charge_rate": 0.0,
                "time_to_full_charge": 0.0, "is_locked": true, "sentry_mode": false,
                "software_version": "2026.4.1"
              }
            }
            """.trimIndent()

        val LEGACY_SHAPE =
            """
            {
              "live": true,
              "vehicle": { "id": 9, "state": "asleep", "is_locked": false, "software_version": "2025.1" },
              "position": {
                "latitude": 1.0, "longitude": 2.0, "speed": 3.0, "power": 4.0, "battery_level": 55,
                "ideal_range": 300.0, "odometer": 999.0, "inside_temp": 20.0, "outside_temp": 10.0,
                "is_climate_on": true
              },
              "is_charging": true, "charger_power": 11.0, "charge_rate": 30.0,
              "time_to_full_charge": 1.5, "sentry_mode": true
            }
            """.trimIndent()
    }
}

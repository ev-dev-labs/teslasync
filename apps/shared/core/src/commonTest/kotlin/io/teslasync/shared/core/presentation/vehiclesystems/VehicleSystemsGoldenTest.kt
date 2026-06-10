package io.teslasync.shared.core.presentation.vehiclesystems

import io.teslasync.shared.core.data.repo.VEHICLE_SYSTEMS_STATIC_TTL_MILLIS
import io.teslasync.shared.core.data.repo.climateHistoryKey
import io.teslasync.shared.core.data.repo.climateKey
import io.teslasync.shared.core.data.repo.maintenanceKey
import io.teslasync.shared.core.data.repo.mediaHistoryKey
import io.teslasync.shared.core.data.repo.mediaKey
import io.teslasync.shared.core.data.repo.safetyHistoryKey
import io.teslasync.shared.core.data.repo.safetyKey
import io.teslasync.shared.core.data.repo.serviceRecordsKey
import io.teslasync.shared.core.data.repo.softwareUpdatesKey
import io.teslasync.shared.core.data.repo.tirePressureHistoryKey
import io.teslasync.shared.core.data.repo.tirePressureKey
import io.teslasync.shared.core.data.repo.vehicleSystemsVehicleIdQuery
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Golden vectors locking the client-side derivations ported from the web `useVehicleSystems` domain:
 *
 *  1. The snake_case `vehicle_id` query builder (the web `?vehicle_id=${vehicleId}` template, which
 *     appends the key unconditionally — the `enabled: !!vehicleId` truthiness check is a render-layer
 *     gate, not part of the URL). The `useSoftwareUpdates` read is the deliberate exception: it sends
 *     NO query, so it never uses this builder.
 *  2. The cache/feed key builders mirroring the web `vehicleSystemsKeys` tuples — the per-vehicle
 *     `latest` keys, the three-segment `…|history|…` keys, the global single-segment `maintenance` /
 *     `service-records` keys, and the per-vehicle `software-updates` key (cached per vehicle even
 *     though its request carries no `vehicle_id`).
 *  3. The STATIC TTL sentinel the global maintenance/service-record catalogs use (web
 *     `STALE_TIMES.STATIC` → never stale).
 *
 * The vectors are language-neutral (fixed expectations) so the Windows C# port and the KMP core load
 * the identical set and cannot drift (ADR-004). The C# port mirrors these exact rows.
 */
class VehicleSystemsGoldenTest {
    // ---- vehicle_id query (unconditional) -----------------------------------------

    @Test
    fun vehicleIdQueryIsUnconditional() {
        assertEquals(mapOf("vehicle_id" to "7"), vehicleSystemsVehicleIdQuery("7"))
        assertEquals(mapOf("vehicle_id" to "42"), vehicleSystemsVehicleIdQuery("42"))
        // Even a blank id is forwarded verbatim — the web template literal does not guard it (the
        // hook-level enabled gate, which we do not reproduce, is what suppresses a blank-id fetch).
        assertEquals(mapOf("vehicle_id" to ""), vehicleSystemsVehicleIdQuery(""))
    }

    // ---- Cache/feed keys ----------------------------------------------------------

    @Test
    fun cacheKeysMirrorTheWebQueryKeys() {
        assertEquals("climate|7", climateKey("7"))
        assertEquals("climate|history|7", climateHistoryKey("7"))
        assertEquals("tire-pressure|7", tirePressureKey("7"))
        assertEquals("tire-pressure|history|7", tirePressureHistoryKey("7"))
        assertEquals("maintenance", maintenanceKey())
        assertEquals("service-records", serviceRecordsKey())
        assertEquals("software-updates|7", softwareUpdatesKey("7"))
        assertEquals("safety|7", safetyKey("7"))
        assertEquals("safety|history|7", safetyHistoryKey("7"))
        assertEquals("media|7", mediaKey("7"))
        assertEquals("media|history|7", mediaHistoryKey("7"))
    }

    @Test
    fun perVehicleKeysPartitionByVehicle() {
        assertEquals("climate|8", climateKey("8"))
        assertEquals("software-updates|9", softwareUpdatesKey("9"))
        // The global catalogs are vehicle-agnostic — a single shared key, never per-vehicle.
        assertEquals(maintenanceKey(), maintenanceKey())
        assertEquals(serviceRecordsKey(), serviceRecordsKey())
    }

    // ---- STATIC TTL sentinel ------------------------------------------------------

    @Test
    fun staticTtlNeverGoesStale() {
        assertEquals(Long.MAX_VALUE, VEHICLE_SYSTEMS_STATIC_TTL_MILLIS)
    }
}

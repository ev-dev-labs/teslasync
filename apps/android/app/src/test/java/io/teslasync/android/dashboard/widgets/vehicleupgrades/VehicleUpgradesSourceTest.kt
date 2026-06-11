package io.teslasync.android.dashboard.widgets.vehicleupgrades

import io.teslasync.android.data.vehicles.vehicle
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.sharing.ShareToken
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Off-device verification of the VehicleUpgrades composition + merge adapters ([vehicleUpgradesResource],
 * [mergeUpgrades], [firstVehicleId], [recentDriveId]) — the upgrades-primary, share-links-secondary contract
 * the web hook composition implements (`useVehicleUpgrades` drives the surface; `useDrives` → `useShareLinks`
 * only enriches it). Pure flows, so it runs under the host `testReleaseUnitTest` gate without a device.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleUpgradesSourceTest {
    @Test
    fun firstVehicleIdTakesThePositiveLeadingId() {
        assertEquals(5L, firstVehicleId(listOf(vehicle(5), vehicle(6))))
        assertNull(firstVehicleId(emptyList()))
        assertNull(firstVehicleId(null))
        assertNull(firstVehicleId(listOf(vehicle(0))))
    }

    @Test
    fun recentDriveIdIsTheNewestDriveOrNull() {
        assertEquals("10", recentDriveId(listOf(drive(10), drive(9))))
        assertNull(recentDriveId(emptyList()))
        assertNull(recentDriveId(null))
    }

    // ── mergeUpgrades precedence ─────────────────────────────────────────────────────

    @Test
    fun mergeFirstLoadWithNoCacheIsBareLoading() {
        val merged = mergeUpgrades(loadingJson(), emptyShares())
        assertTrue(merged is Resource.Loading)
        assertNull(merged.cached)
    }

    @Test
    fun mergeSuccessProjectsTheSnapshot() {
        val merged = mergeUpgrades(Resource.Success(envelope(1), 100L, false), shares("99"))
        assertTrue(merged is Resource.Success)
        assertEquals(100L, (merged as Resource.Success).fetchedAt)
        assertEquals(1, parseUpgrades(merged.data.upgradesData).size)
        assertEquals(1, merged.data.shareLinks.size)
    }

    @Test
    fun mergeErrorWithCacheIsOfflineSnapshot() {
        val cached = envelope(2)
        val merged = mergeUpgrades(Resource.Error(cached, 100L, true, ApiError.Timeout()), emptyShares())
        assertTrue(merged is Resource.Error)
        assertTrue(merged.stale)
        assertEquals(2, parseUpgrades(merged.cached?.upgradesData).size)
    }

    @Test
    fun mergeErrorWithNoCacheIsHardError() {
        val merged = mergeUpgrades(Resource.Error(null, null, false, ApiError.Network()), emptyShares())
        assertTrue(merged is Resource.Error)
        assertNull(merged.cached)
    }

    @Test
    fun mergeKeepsCachedShareLinksWhileUpgradesReload() {
        // Upgrades reloading (cached present) while share links resolved: the snapshot keeps both.
        val merged = mergeUpgrades(Resource.Loading(envelope(1), 100L, false), shares("99"))
        assertTrue(merged is Resource.Loading)
        assertEquals(1, merged.cached?.shareLinks?.size)
    }

    // ── vehicleUpgradesResource composition ──────────────────────────────────────────

    @Test
    fun preferredVehicleShortCircuitsAndChainsSharesFromRecentDrive() =
        runTest {
            val snapshot =
                vehicleUpgradesResource(
                    vehicles = flowOf(Resource.Error(null, null, false, ApiError.Network())),
                    preferredVehicleId = 7L,
                    upgradesFor = { id -> flowOf(Resource.Success(envelope(2), 100L, false)).takeForVehicle(id, "7") },
                    drivesFor = { flowOf(Resource.Success(listOf(drive(10)), 80L, false)) },
                    shareLinksFor = { driveId -> flowOf(sharesFor(driveId)) },
                ).toList().last()

            assertTrue(snapshot is Resource.Success)
            assertEquals(2, parseUpgrades((snapshot as Resource.Success).data.upgradesData).size)
            // The recent drive (id 10) drove the share-links query.
            assertEquals(1, snapshot.data.shareLinks.size)
            assertEquals(
                10L,
                snapshot.data.shareLinks
                    .single()
                    .driveId,
            )
        }

    @Test
    fun firstEnrolledVehicleDrivesTheFeedsWhenNoPreferredId() =
        runTest {
            val snapshot =
                vehicleUpgradesResource(
                    vehicles = flowOf(Resource.Success(listOf(vehicle(2)), 50L, false)),
                    preferredVehicleId = null,
                    upgradesFor = { flowOf(Resource.Success(envelope(1), 100L, false)) },
                    drivesFor = { flowOf(Resource.Success(emptyList(), 80L, false)) },
                    shareLinksFor = { flowOf(emptyShares()) },
                ).toList().last()

            assertTrue(snapshot is Resource.Success)
            assertEquals(1, parseUpgrades((snapshot as Resource.Success).data.upgradesData).size)
            // No drive ⇒ the share-links query is never issued ⇒ empty list.
            assertTrue(snapshot.data.shareLinks.isEmpty())
        }

    @Test
    fun noVehicleFoldsOntoAnEmptySuccessSnapshot() =
        runTest {
            val snapshot =
                vehicleUpgradesResource(
                    vehicles = flowOf(Resource.Success(emptyList(), 100L, false)),
                    preferredVehicleId = null,
                    upgradesFor = { flowOf(loadingJson()) },
                    drivesFor = { flowOf(Resource.Success(emptyList(), 0L, false)) },
                    shareLinksFor = { flowOf(emptyShares()) },
                ).toList().last()

            assertTrue(snapshot is Resource.Success)
            assertTrue((snapshot as Resource.Success).data.hasNoContent())
        }

    @Test
    fun noVehicleErrorDoesNotRaiseHardError() =
        runTest {
            val snapshot =
                vehicleUpgradesResource(
                    vehicles = flowOf(Resource.Error(null, null, false, ApiError.Network())),
                    preferredVehicleId = null,
                    upgradesFor = { flowOf(loadingJson()) },
                    drivesFor = { flowOf(Resource.Success(emptyList(), 0L, false)) },
                    shareLinksFor = { flowOf(emptyShares()) },
                ).toList().last()

            // A disabled upgrades query (no vehicle) degrades to a cached empty, never the hard error surface.
            assertTrue(snapshot is Resource.Error)
            assertTrue((snapshot as Resource.Error).cached?.hasNoContent() == true)
        }

    private companion object {
        fun loadingJson(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun emptyShares(): Resource<List<ShareToken>> = Resource.Success(emptyList(), 0L, false)

        fun shares(driveId: String): Resource<List<ShareToken>> = Resource.Success(listOf(shareToken(1, driveId)), 0L, false)

        fun sharesFor(driveId: String): Resource<List<ShareToken>> = Resource.Success(listOf(shareToken(1, driveId)), 0L, false)

        /** Identity helper that asserts the resolved [id] matches the [expected] vehicle id during composition. */
        fun Flow<Resource<JsonElement>>.takeForVehicle(
            id: String,
            expected: String,
        ): Flow<Resource<JsonElement>> {
            check(id == expected) { "expected upgrades query for vehicle $expected but saw $id" }
            return this
        }

        fun envelope(upgradeCount: Int): JsonElement =
            buildJsonObject {
                put(
                    "data",
                    buildJsonObject {
                        put(
                            "upgrades",
                            buildJsonArray {
                                repeat(upgradeCount) { index -> add(buildJsonObject { put("name", "Upgrade $index") }) }
                            },
                        )
                    },
                )
            }

        fun drive(id: Long): Drive =
            Drive(
                createdAt = Instant.fromEpochMilliseconds(0),
                distanceM = 1_000.0,
                durationS = 600L,
                id = id,
                startTs = Instant.fromEpochMilliseconds(id * 1_000L),
                updatedAt = Instant.fromEpochMilliseconds(0),
                vehicleId = 1L,
            )

        fun shareToken(
            id: Long,
            driveId: String,
        ): ShareToken =
            ShareToken(
                id = id,
                token = "tok$id",
                driveId = driveId.toLong(),
                includeMap = true,
                includeTelemetry = false,
                includeSpeed = true,
                views = 0,
                expiresAt = null,
                createdAt = "2024-01-01T00:00:00Z",
            )
    }
}

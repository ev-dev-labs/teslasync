package io.teslasync.android.dashboard.widgets.locationfavorites

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of [mergeLocationFavorites] — the pure fold of the two upstream cache-then-
 * network feeds (web `useLocations` + `useLocationSnapshotLatest`) into one [Resource], reproducing the
 * web component's combined freshness (`isLoading = locLoading || snapLoading`, `error = locError ??
 * snapError`, ORed stale/refresh, `updatedAt = max(...)`) and the `WidgetShell` loading→error→content
 * precedence.
 */
class LocationFavoritesSourceTest {
    private fun loc(
        id: Long,
        name: String,
        visits: Long,
    ): VisitedLocation =
        VisitedLocation(
            id = id,
            vehicleId = 1L,
            addressName = name,
            visitCount = visits,
            createdAt = "2026-01-01T00:00:00Z",
        )

    private val rows = listOf(loc(1, "Garage", 5))
    private val snapJson: JsonElement = Json.parseToJsonElement("""{"located_at_home":true,"destination_name":"HQ"}""")

    @Test
    fun firstLoadOverEitherFeedYieldsHardLoading() {
        val merged = mergeLocationFavorites(Resource.Loading(null, null, false), Resource.Loading(null, null, false))
        assertTrue(merged is Resource.Loading)
        assertNull(merged.cached)
    }

    @Test
    fun loadingSnapshotWhileLocationsResolvedStillShowsSkeleton() {
        // Web parity: isLoading = locLoading || snapLoading — a still-loading snapshot keeps the skeleton.
        val merged =
            mergeLocationFavorites(
                Resource.Success(rows, fetchedAt = 100L, stale = false),
                Resource.Loading(cached = null, fetchedAt = null, stale = false),
            )
        assertTrue(merged is Resource.Loading)
        assertNull(merged.cached)
    }

    @Test
    fun bothSuccessProducesMergedContentWithLatestStamp() {
        val merged =
            mergeLocationFavorites(
                Resource.Success(rows, fetchedAt = 100L, stale = false),
                Resource.Success(snapJson, fetchedAt = 250L, stale = false),
            )
        val success = merged as Resource.Success
        assertEquals(rows, success.data.locations)
        assertTrue(success.data.snapshot?.locatedAtHome == true)
        assertEquals("HQ", success.data.snapshot?.destinationName)
        assertEquals(250L, success.fetchedAt)
    }

    @Test
    fun nullSnapshotPayloadParsesToNoBadgeData() {
        val merged =
            mergeLocationFavorites(
                Resource.Success(rows, fetchedAt = 100L, stale = false),
                Resource.Success(JsonNull, fetchedAt = 100L, stale = false),
            )
        val success = merged as Resource.Success
        assertEquals(rows, success.data.locations)
        assertNull(success.data.snapshot)
    }

    @Test
    fun hardErrorWhenNeitherFeedHasCache() {
        val merged =
            mergeLocationFavorites(
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
            )
        val error = merged as Resource.Error
        assertNull(error.cached)
        assertTrue(error.error is ApiError.Network)
    }

    @Test
    fun errorWithCachedDataKeepsContentStaleAndPrefersLocationsError() {
        val merged =
            mergeLocationFavorites(
                Resource.Error(cached = rows, fetchedAt = 100L, stale = true, error = ApiError.Timeout()),
                Resource.Success(snapJson, fetchedAt = 100L, stale = false),
            )
        val error = merged as Resource.Error
        assertEquals(rows, error.cached?.locations)
        assertTrue(error.cached?.snapshot?.locatedAtHome == true)
        assertTrue(error.stale)
        // web `locError ?? snapError` prefers the locations failure.
        assertTrue(error.error is ApiError.Timeout)
    }

    @Test
    fun refreshOverCachedDataStaysAsLoadingContent() {
        val merged =
            mergeLocationFavorites(
                Resource.Loading(cached = rows, fetchedAt = 100L, stale = false),
                Resource.Success(snapJson, fetchedAt = 100L, stale = false),
            )
        val loading = merged as Resource.Loading
        assertEquals(rows, loading.cached?.locations)
    }

    @Test
    fun staleFlagsAreOredAcrossFeeds() {
        val merged =
            mergeLocationFavorites(
                Resource.Success(rows, fetchedAt = 100L, stale = false),
                Resource.Success(snapJson, fetchedAt = 100L, stale = true),
            )
        assertTrue(merged.stale)
    }
}

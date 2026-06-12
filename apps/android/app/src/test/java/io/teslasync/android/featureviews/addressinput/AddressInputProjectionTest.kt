package io.teslasync.android.featureviews.addressinput

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of AddressInput's pure logic — the native mirror of how the web component
 * consumes `useGeocodeSearch` (web/src/features/driving/components/AddressInput.tsx): the
 * `enabled: query.length >= 3` idle gate, the `select: safeArray` row guard, and the `results ?? []` /
 * `isLoading` reads, layered onto the shared cache-then-network [io.teslasync.android.data.toUiState]
 * lifecycle (loading / content / empty / error / stale / offline). Because the surface is purely
 * presentational, each [AddressSuggestions] is exactly what the thin composable renders, so these
 * assertions double as the per-state "snapshot".
 */
class AddressInputProjectionTest {
    // ── parse: the `safeArray`-equivalent row guard ─────────────────────────────────

    @Test
    fun parseReadsWellFormedRows() {
        val parsed = AddressInputProjection.parse(geocodeArray(TESLA_HQ, GIGA_TEXAS))

        assertEquals(2, parsed.size)
        assertEquals(
            AddressSuggestion("1 Tesla Road, Austin, TX 78725, USA", 30.2241, -97.6186),
            parsed.first(),
        )
    }

    @Test
    fun parseTreatsANonArrayAsNoRows() {
        assertTrue(AddressInputProjection.parse(JsonNull).isEmpty())
        assertTrue(AddressInputProjection.parse(null).isEmpty())
    }

    @Test
    fun parseSkipsMalformedRowsWithoutThrowing() {
        // safeArray guard: a non-object element, a blank/absent display_name, a non-numeric or absent
        // coordinate are each dropped — but a valid row in the same array still survives.
        val mixed =
            buildJsonArray {
                add(JsonNull) // not an object
                addJsonObject {
                    put("lat", 1.0)
                    put("lng", 2.0)
                } // missing display_name
                addJsonObject {
                    put("display_name", "")
                    put("lat", 1.0)
                    put("lng", 2.0)
                } // blank display_name
                addJsonObject {
                    put("display_name", "No coords")
                } // missing lat/lng
                addJsonObject {
                    put("display_name", "Bad lat")
                    put("lat", "north")
                    put("lng", 2.0)
                } // non-numeric lat
                addJsonObject {
                    put("display_name", "Valid Place")
                    put("lat", 12.5)
                    put("lng", -34.25)
                }
            }

        val parsed = AddressInputProjection.parse(mixed)

        assertEquals(listOf(AddressSuggestion("Valid Place", 12.5, -34.25)), parsed)
    }

    // ── project: the idle gate + lifecycle mapping ──────────────────────────────────

    @Test
    fun shortQueryIsIdleRegardlessOfFeed() {
        // Web `enabled: query.length >= 3` — below the threshold the geocoder is never queried.
        val display = AddressInputProjection.project("ab", success(geocodeArray(TESLA_HQ)))

        assertEquals(AddressInputStatus.Idle, display.status)
        assertTrue(display.suggestions.isEmpty())
    }

    @Test
    fun nullFeedForAnActiveQueryIsIdle() {
        val display = AddressInputProjection.project("austin", resource = null)

        assertEquals(AddressInputStatus.Idle, display.status)
    }

    @Test
    fun firstLoadWithNoCacheIsLoading() {
        val display = AddressInputProjection.project("austin", Resource.Loading(cached = null, fetchedAt = null, stale = false))

        assertEquals(AddressInputStatus.Loading, display.status)
        assertTrue(display.suggestions.isEmpty())
        assertFalse(display.refreshing)
        assertFalse(display.canRetry)
    }

    @Test
    fun freshNonEmptyResultsAreResults() {
        val display = AddressInputProjection.project("tesla", success(geocodeArray(TESLA_HQ, GIGA_TEXAS)))

        assertEquals(AddressInputStatus.Results, display.status)
        assertEquals(2, display.suggestions.size)
        assertFalse(display.stale)
        assertFalse(display.offline)
        assertFalse(display.refreshing)
        assertFalse(display.canRetry)
    }

    @Test
    fun resolvedZeroMatchesIsEmpty() {
        val display = AddressInputProjection.project("zzzzz", success(buildJsonArray { }))

        assertEquals(AddressInputStatus.Empty, display.status)
        assertTrue(display.suggestions.isEmpty())
    }

    @Test
    fun refreshOverCachedRowsKeepsResultsAndFlagsRefreshing() {
        // Resource.Loading carrying a cached value → keep showing it while the refresh runs.
        val display =
            AddressInputProjection.project(
                "tesla",
                Resource.Loading(cached = geocodeArray(TESLA_HQ), fetchedAt = 100L, stale = false),
            )

        assertEquals(AddressInputStatus.Results, display.status)
        assertEquals(1, display.suggestions.size)
        assertTrue(display.refreshing)
        assertFalse(display.offline)
    }

    @Test
    fun hardErrorWithNoCacheIsErrorWithRetry() {
        val display =
            AddressInputProjection.project(
                "tesla",
                Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")),
            )

        assertEquals(AddressInputStatus.Error, display.status)
        assertTrue(display.suggestions.isEmpty())
        assertTrue(display.canRetry)
        assertFalse(display.offline)
    }

    @Test
    fun errorWithCachedRowsStaysOfflineLastKnownWithRetry() {
        // Honest freshness: a failed refresh keeps the cached rows visible, flagged stale/offline + retry.
        val display =
            AddressInputProjection.project(
                "tesla",
                Resource.Error(
                    cached = geocodeArray(TESLA_HQ, GIGA_TEXAS),
                    fetchedAt = 100L,
                    stale = true,
                    error = RuntimeException("offline"),
                ),
            )

        assertEquals(AddressInputStatus.Results, display.status)
        assertEquals(2, display.suggestions.size)
        assertTrue(display.stale)
        assertTrue(display.offline)
        assertTrue(display.canRetry)
    }

    private fun success(array: JsonArray): Resource<JsonElement> = Resource.Success(data = array, fetchedAt = 1L, stale = false)

    private fun geocodeArray(vararg rows: AddressSuggestion): JsonArray =
        buildJsonArray {
            rows.forEach { row ->
                addJsonObject {
                    put("display_name", row.displayName)
                    put("lat", row.lat)
                    put("lng", row.lng)
                }
            }
        }

    private companion object {
        val TESLA_HQ = AddressSuggestion("1 Tesla Road, Austin, TX 78725, USA", 30.2241, -97.6186)
        val GIGA_TEXAS = AddressSuggestion("Giga Texas, Austin, TX, USA", 30.2210, -97.6170)
    }
}

package io.teslasync.android.featureviews.signalcatalogpanel

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.VehicleLiveSignalsResponse
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SignalCatalogPanel pure projection — the native port of the web component's
 * `rowFromEntry`/`String(value)` field reads, the `staleness`/`category`/`getCatalogStalenessStyle`
 * derivation, the `activeCount`/`staleCount`/`neverCount` reductions, the search filter, the staleness/alpha/
 * category sort, the `formatStaleness` "time since" buckets, the `QueryError` classification, and the
 * PII-safe `view.opened` diagnostic. Mirrors the web spec
 * (web/src/features/telemetry/components/SignalCatalogPanel.tsx).
 */
class SignalCatalogPanelProjectionTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    // ── renderValue (web String(value)) ───────────────────────────────────────────────────────────────────

    @Test
    fun renderValueAbsentIsEmDash() {
        assertEquals(EM_DASH, SignalCatalogProjection.renderValue(null))
    }

    @Test
    fun renderValueJsonNullIsNullLiteral() {
        assertEquals("null", SignalCatalogProjection.renderValue(JsonNull))
    }

    @Test
    fun renderValueScalarsAreLiterals() {
        assertEquals("Drive", SignalCatalogProjection.renderValue(JsonPrimitive("Drive")))
        assertEquals("42", SignalCatalogProjection.renderValue(JsonPrimitive(42)))
        assertEquals("true", SignalCatalogProjection.renderValue(JsonPrimitive(true)))
    }

    @Test
    fun renderValueCompoundIsCompactJson() {
        val obj =
            buildJsonObject {
                put("lat", 1.5)
                put("lon", 2.0)
            }
        assertEquals("{\"lat\":1.5,\"lon\":2.0}", SignalCatalogProjection.renderValue(obj))
        val arr =
            buildJsonArray {
                add(JsonPrimitive(1))
                add(JsonPrimitive(2))
            }
        assertEquals("[1,2]", SignalCatalogProjection.renderValue(arr))
    }

    // ── rowFromEntry / projectRows (web Object.entries(liveData).map) ──────────────────────────────────────

    @Test
    fun rowFromEntryUnwrapsEnvelope() {
        val raw =
            buildJsonObject {
                put("value", 64)
                put("timestamp", "2026-06-11T12:00:00Z")
            }
        val row = SignalCatalogProjection.rowFromEntry("VehicleSpeed", raw)
        assertEquals("VehicleSpeed", row.name)
        assertEquals("64", row.value)
        assertEquals(SignalCatalogProjection.parseTimestampMillis("2026-06-11T12:00:00Z"), row.timestampMillis)
    }

    @Test
    fun rowFromEntryBareScalarHasNoTimestamp() {
        val row = SignalCatalogProjection.rowFromEntry("Gear", JsonPrimitive("D"))
        assertEquals("D", row.value)
        assertNull(row.timestampMillis)
    }

    @Test
    fun rowFromEntryObjectWithoutValueKeyIsStringified() {
        val raw =
            buildJsonObject {
                put("lat", 1.0)
                put("lon", 2.0)
            }
        val row = SignalCatalogProjection.rowFromEntry("Location", raw)
        assertEquals("{\"lat\":1.0,\"lon\":2.0}", row.value)
        assertNull(row.timestampMillis)
    }

    @Test
    fun projectRowsMapsEverySignalInOrder() {
        val response =
            VehicleLiveSignalsResponse(
                vehicleId = 1L,
                signals =
                    linkedMapOf(
                        "Beta" to JsonPrimitive("b"),
                        "Alpha" to JsonPrimitive("a"),
                    ),
            )
        assertEquals(listOf("Beta", "Alpha"), SignalCatalogProjection.projectRows(response).map { it.name })
    }

    @Test
    fun projectRowsNullResponseIsEmpty() {
        assertTrue(SignalCatalogProjection.projectRows(null).isEmpty())
    }

    // ── parseTimestampMillis (web new Date(ts).getTime()) ─────────────────────────────────────────────────

    @Test
    fun parseTimestampMillisValidIsoAndBlank() {
        assertEquals(1_000L, SignalCatalogProjection.parseTimestampMillis("1970-01-01T00:00:01Z"))
        assertNull(SignalCatalogProjection.parseTimestampMillis(null))
        assertNull(SignalCatalogProjection.parseTimestampMillis("   "))
        assertNull(SignalCatalogProjection.parseTimestampMillis("not-a-date"))
    }

    // ── stalenessSeconds (web (now - ts) / 1000) ──────────────────────────────────────────────────────────

    @Test
    fun stalenessSecondsInfiniteWhenNoTimestamp() {
        assertEquals(Double.POSITIVE_INFINITY, SignalCatalogProjection.stalenessSeconds(null, NOW), 0.0)
    }

    @Test
    fun stalenessSecondsFlooredAtZeroForFutureTimestamp() {
        assertEquals(0.0, SignalCatalogProjection.stalenessSeconds(NOW + 5_000L, NOW), 0.0)
    }

    @Test
    fun stalenessSecondsComputesAge() {
        assertEquals(10.0, SignalCatalogProjection.stalenessSeconds(NOW - 10_000L, NOW), 0.0)
    }

    // ── categoryOf (web !ts ? never : staleness > 300 ? stale : active) ───────────────────────────────────

    @Test
    fun categoryNeverWhenNoTimestamp() {
        assertEquals(SignalCategory.Never, SignalCatalogProjection.categoryOf(null, NOW))
    }

    @Test
    fun categoryActiveAtAndBelowFiveMinutes() {
        assertEquals(SignalCategory.Active, SignalCatalogProjection.categoryOf(NOW - 300_000L, NOW))
    }

    @Test
    fun categoryStaleBeyondFiveMinutes() {
        assertEquals(SignalCategory.Stale, SignalCatalogProjection.categoryOf(NOW - 301_000L, NOW))
    }

    // ── stalenessBucketOf (web getCatalogStalenessStyle) ──────────────────────────────────────────────────

    @Test
    fun stalenessBucketSpansAllFourTiers() {
        assertEquals(StalenessBucket.NeverReceived, SignalCatalogProjection.stalenessBucketOf(null, NOW))
        assertEquals(StalenessBucket.Active, SignalCatalogProjection.stalenessBucketOf(NOW - 29_000L, NOW))
        assertEquals(StalenessBucket.Aging, SignalCatalogProjection.stalenessBucketOf(NOW - 30_000L, NOW))
        assertEquals(StalenessBucket.Aging, SignalCatalogProjection.stalenessBucketOf(NOW - 299_000L, NOW))
        assertEquals(StalenessBucket.Stale, SignalCatalogProjection.stalenessBucketOf(NOW - 300_000L, NOW))
    }

    // ── summarize (web activeCount / staleCount / neverCount) ─────────────────────────────────────────────

    @Test
    fun summarizeCountsEachCategory() {
        val rows =
            listOf(
                row("Active1", ageSeconds = 5),
                row("Aging1", ageSeconds = 120),
                row("Stale1", ageSeconds = 900),
                row("Never1", ageSeconds = null),
                row("Never2", ageSeconds = null),
            )
        val summary = SignalCatalogProjection.summarize(rows, NOW)
        assertEquals(5, summary.total)
        // Aging (120s) folds into "active" per SignalRow.category (web staleness <= 300 ⇒ active).
        assertEquals(2, summary.active)
        assertEquals(1, summary.stale)
        assertEquals(2, summary.never)
    }

    // ── filterByQuery (web rows.filter(name.toLowerCase().includes(q))) ───────────────────────────────────

    @Test
    fun filterBlankReturnsEveryRow() {
        val rows = listOf(row("Speed"), row("Gear"))
        assertEquals(rows, SignalCatalogProjection.filterByQuery(rows, "   "))
    }

    @Test
    fun filterIsCaseInsensitiveSubstring() {
        val rows = listOf(row("VehicleSpeed"), row("Gear"), row("BatteryLevel"))
        assertEquals(listOf("VehicleSpeed"), SignalCatalogProjection.filterByQuery(rows, "speed").map { it.name })
        assertTrue(SignalCatalogProjection.filterByQuery(rows, "zzz").isEmpty())
    }

    // ── visibleRows (web filtered memo: search + filter pill + sort pill) ─────────────────────────────────

    @Test
    fun visibleRowsFilterModeStaleKeepsStaleAndNever() {
        val rows =
            listOf(
                row("ActiveSig", ageSeconds = 5),
                row("StaleSig", ageSeconds = 900),
                row("NeverSig", ageSeconds = null),
            )
        val result =
            SignalCatalogProjection.visibleRows(rows, "", CatalogFilterMode.Stale, CatalogSortMode.Alpha, NOW)
        assertEquals(listOf("NeverSig", "StaleSig"), result.map { it.name })
    }

    @Test
    fun visibleRowsFilterModeActiveKeepsOnlyActive() {
        val rows =
            listOf(
                row("ActiveSig", ageSeconds = 5),
                row("StaleSig", ageSeconds = 900),
                row("NeverSig", ageSeconds = null),
            )
        val result =
            SignalCatalogProjection.visibleRows(rows, "", CatalogFilterMode.Active, CatalogSortMode.Alpha, NOW)
        assertEquals(listOf("ActiveSig"), result.map { it.name })
    }

    @Test
    fun visibleRowsSortStalenessPutsNeverAndOldestFirst() {
        val rows =
            listOf(
                row("Fresh", ageSeconds = 10),
                row("Old", ageSeconds = 900),
                row("Never", ageSeconds = null),
            )
        val result =
            SignalCatalogProjection.visibleRows(rows, "", CatalogFilterMode.All, CatalogSortMode.Staleness, NOW)
        assertEquals(listOf("Never", "Old", "Fresh"), result.map { it.name })
    }

    @Test
    fun visibleRowsSortAlphaIsCaseInsensitive() {
        val rows = listOf(row("charlie"), row("Alpha"), row("Bravo"))
        val result =
            SignalCatalogProjection.visibleRows(rows, "", CatalogFilterMode.All, CatalogSortMode.Alpha, NOW)
        assertEquals(listOf("Alpha", "Bravo", "charlie"), result.map { it.name })
    }

    @Test
    fun visibleRowsSortCategoryOrdersNeverStaleActive() {
        val rows =
            listOf(
                row("ActiveSig", ageSeconds = 5),
                row("NeverSig", ageSeconds = null),
                row("StaleSig", ageSeconds = 900),
            )
        val result =
            SignalCatalogProjection.visibleRows(rows, "", CatalogFilterMode.All, CatalogSortMode.Category, NOW)
        assertEquals(listOf("NeverSig", "StaleSig", "ActiveSig"), result.map { it.name })
    }

    @Test
    fun visibleRowsAppliesSearchBeforeFilterAndSort() {
        val rows =
            listOf(
                row("DriveSpeed", ageSeconds = 5),
                row("DriveGear", ageSeconds = 900),
                row("BatteryLevel", ageSeconds = null),
            )
        val result =
            SignalCatalogProjection.visibleRows(rows, "drive", CatalogFilterMode.All, CatalogSortMode.Alpha, NOW)
        assertEquals(listOf("DriveGear", "DriveSpeed"), result.map { it.name })
    }

    // ── stalenessAge (web formatStaleness buckets) ────────────────────────────────────────────────────────

    @Test
    fun stalenessAgeNullWhenNeverReceived() {
        assertNull(SignalCatalogProjection.stalenessAge(null, NOW))
    }

    @Test
    fun stalenessAgeBucketsSecondsMinutesHours() {
        assertEquals(FreshnessAge.Seconds(45L), SignalCatalogProjection.stalenessAge(NOW - 45_000L, NOW))
        assertEquals(FreshnessAge.Minutes(2L), SignalCatalogProjection.stalenessAge(NOW - 120_000L, NOW))
        assertEquals(FreshnessAge.Hours(2L), SignalCatalogProjection.stalenessAge(NOW - 7_200_000L, NOW))
    }

    // ── lastRefreshedAge (web TimeStamp relative) ─────────────────────────────────────────────────────────

    @Test
    fun lastRefreshedAgeBucketsRelativeTime() {
        assertEquals(FreshnessAge.JustNow, SignalCatalogProjection.lastRefreshedAge(NOW - 5_000L, NOW))
        assertEquals(FreshnessAge.Minutes(3L), SignalCatalogProjection.lastRefreshedAge(NOW - 180_000L, NOW))
    }

    // ── badgeLabel ────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun badgeLabelMapsCategoryToLocalizedString() {
        val strings = previewStrings()
        assertEquals("ACTIVE", SignalCatalogProjection.badgeLabel(SignalCategory.Active, strings))
        assertEquals("STALE", SignalCatalogProjection.badgeLabel(SignalCategory.Stale, strings))
        assertEquals("NEVER", SignalCatalogProjection.badgeLabel(SignalCategory.Never, strings))
    }

    // ── queryErrorKindOf (web classifyQueryError) ─────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindFromHttpStatus() {
        assertEquals(QueryErrorKind.NotFound, SignalCatalogProjection.queryErrorKindOf(ApiError.Http(404)))
        assertEquals(QueryErrorKind.Unauthorized, SignalCatalogProjection.queryErrorKindOf(ApiError.Http(401)))
        assertEquals(QueryErrorKind.Unauthorized, SignalCatalogProjection.queryErrorKindOf(ApiError.Http(403)))
        assertEquals(QueryErrorKind.ServerError, SignalCatalogProjection.queryErrorKindOf(ApiError.Http(503)))
        assertEquals(QueryErrorKind.Network, SignalCatalogProjection.queryErrorKindOf(ApiError.Http(400)))
    }

    @Test
    fun queryErrorKindFromTransport() {
        assertEquals(QueryErrorKind.Network, SignalCatalogProjection.queryErrorKindOf(ApiError.Network()))
        assertEquals(QueryErrorKind.Network, SignalCatalogProjection.queryErrorKindOf(ApiError.Timeout()))
        assertEquals(QueryErrorKind.Waiting, SignalCatalogProjection.queryErrorKindOf(ApiError.CircuitOpen()))
        assertEquals(QueryErrorKind.Network, SignalCatalogProjection.queryErrorKindOf(null))
    }

    // ── Diagnostics (P1/S11 view.opened) ──────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSurfaceSlug() {
        val logger = RecordingLogger()
        recordSignalCatalogPanelOpened(logger)
        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "SignalCatalogPanel"), opened.single().second)
    }

    private fun row(
        name: String,
        ageSeconds: Long? = 0L,
    ): SignalCatalogRow =
        SignalCatalogRow(
            name = name,
            value = "v",
            timestampMillis = ageSeconds?.let { NOW - it * 1_000L },
        )

    private fun previewStrings(): SignalCatalogStrings =
        SignalCatalogStrings(
            statTotal = "Total",
            statActive = "Active (<30s)",
            statStale = "Stale (>5min)",
            statNever = "Never Received",
            colStatus = "Status",
            colSignal = "Signal",
            colValue = "Last Value",
            colLastUpdated = "Last Updated",
            colTimeSince = "Time Since",
            filterHint = "Filter",
            filterAria = "Filter signals",
            filterAll = "All",
            filterStaleOnly = "Stale Only",
            filterActiveOnly = "Active Only",
            sortMostStale = "Most Stale",
            sortAlpha = "A-Z",
            sortCategory = "Category",
            refreshInterval = "Refreshes every 5s",
            lastRefreshed = "Last refreshed",
            noData = "No signal data available",
            noMatch = "No signals match current filters",
            badgeActive = "ACTIVE",
            badgeStale = "STALE",
            badgeNever = "NEVER",
            resourceName = "Signal Gaps",
        )

    private companion object {
        const val NOW = 1_900_000_000_000L
    }
}

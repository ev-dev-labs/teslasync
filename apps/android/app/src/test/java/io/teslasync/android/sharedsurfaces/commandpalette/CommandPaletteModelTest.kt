// Off-device unit tests for the pure CommandPalette model — the scope-prefix parse (web `parsePrefix`), the fuzzy
// scorer (web `scoreCommand`), the scope filter + rank fold (web `filtered`), the frecency math (web
// `commandFrecency`), the "Most Used" ranking, the section grouping, the recent-age bucketing, the fleet + search
// projections (covering every loading / content / empty / error / stale / offline branch), the catalogs, the i18n
// key inventory, and the PII-safe `view.opened` diagnostic. Run by the offline :android:testReleaseUnitTest gate —
// no Compose, no Android.

package io.teslasync.android.sharedsurfaces.commandpalette

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.search.SearchHit
import io.teslasync.shared.core.presentation.search.SearchHitType
import io.teslasync.shared.core.presentation.search.SearchResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

class CommandPaletteModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private fun vehicle(
        id: Long,
        name: String = "Car $id",
        vin: String = "VIN$id",
    ): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = name,
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = vin,
        )

    private fun item(
        id: String,
        type: PaletteItemType,
        label: String,
        section: String = "S",
        keywords: List<String> = emptyList(),
    ): PaletteItem = PaletteItem(id = id, type = type, label = label, section = section, keywords = keywords)

    // ── Scope-prefix parse (web parsePrefix) ────────────────────────────────────────────────────────────────────
    @Test
    fun parsePrefixRecognizesEveryScopeAndConsumesOneSpace() {
        assertEquals(ParsedPrefix(PaletteScope.Commands, "wake"), parsePalettePrefix(">wake"))
        assertEquals(ParsedPrefix(PaletteScope.Commands, "wake"), parsePalettePrefix("> wake"))
        assertEquals(ParsedPrefix(PaletteScope.Pages, "drives"), parsePalettePrefix("/drives"))
        assertEquals(ParsedPrefix(PaletteScope.Vehicles, "y"), parsePalettePrefix("@ y"))
        assertEquals(ParsedPrefix(PaletteScope.Settings, "theme"), parsePalettePrefix(":theme"))
    }

    @Test
    fun parsePrefixTreatsUnknownLeadAndEmptyAsPlainText() {
        assertEquals(ParsedPrefix(null, "wake"), parsePalettePrefix("wake"))
        assertEquals(ParsedPrefix(null, ""), parsePalettePrefix(""))
    }

    @Test
    fun itemMatchesScopeRespectsTheScopeTypeSet() {
        assertTrue(itemMatchesScope(PaletteItemType.VehicleCommand, PaletteScope.Commands))
        assertFalse(itemMatchesScope(PaletteItemType.Navigate, PaletteScope.Commands))
        assertTrue(itemMatchesScope(PaletteItemType.Navigate, null))
    }

    // ── Fuzzy scorer (web scoreCommand) ─────────────────────────────────────────────────────────────────────────
    @Test
    fun scoreCommandRanksLabelTiersAboveKeywordTiers() {
        val exact = scoreCommand("lock", "Lock", listOf("lock"))
        val prefix = scoreCommand("loc", "Lock", emptyList())
        val keyword = scoreCommand("secure", "Lock", listOf("secure"))
        assertTrue(exact > prefix)
        assertTrue(prefix > keyword)
        assertTrue(keyword > 0)
    }

    @Test
    fun scoreCommandMatchesSubsequenceForAbbreviations() {
        assertTrue(scoreCommand("btr", "Battery Health", emptyList()) > 0)
        assertEquals(0, scoreCommand("zzz", "Battery Health", emptyList()))
    }

    @Test
    fun scoreItemPinsSearchHitsHighAndFallsBackToSublabelThenSection() {
        val hit = PaletteItem("h", PaletteItemType.SearchHit, "Red Rocket", "Vehicles")
        assertEquals(SEARCH_HIT_SCORE, scoreItem(hit, "anything"))
        val sub = PaletteItem("a", PaletteItemType.Navigate, "Drives", "Pages", sublabel = "recent trips")
        assertTrue(scoreItem(sub, "trips") in 1..SEARCH_HIT_SCORE)
    }

    // ── Filter + rank fold (web filtered) ───────────────────────────────────────────────────────────────────────
    @Test
    fun rankReturnsEveryScopedItemForAnEmptyTerm() {
        val items =
            listOf(
                item("a", PaletteItemType.Navigate, "Drives"),
                item("b", PaletteItemType.VehicleCommand, "Lock"),
            )
        val all = rankItems(items, ParsedPrefix(null, ""), emptyMap())
        assertEquals(2, all.size)
        val scoped = rankItems(items, ParsedPrefix(PaletteScope.Commands, ""), emptyMap())
        assertEquals(listOf("b"), scoped.map { it.id })
    }

    @Test
    fun rankSortsByScoreThenFrecencyAndDropsNonMatches() {
        val items =
            listOf(
                item("a", PaletteItemType.Navigate, "Battery"),
                item("b", PaletteItemType.Navigate, "Battery"),
                item("c", PaletteItemType.Navigate, "Charging"),
            )
        val ranked = rankItems(items, ParsedPrefix(null, "battery"), mapOf("b" to 99.0))
        assertEquals(listOf("b", "a"), ranked.map { it.id })
    }

    // ── Frecency math (web commandFrecency) ─────────────────────────────────────────────────────────────────────
    @Test
    fun frecencyScoreFavoursRecentAndFrequentUse() {
        val now = 10_000_000_000L
        val recent = frecencyScore(FrecencyEntry(count = 1, lastUsedMillis = now - 60_000L), now)
        val old = frecencyScore(FrecencyEntry(count = 1, lastUsedMillis = now - 40L * 86_400_000L), now)
        assertTrue(recent > old)
        assertTrue(frecencyScore(FrecencyEntry(3, now), now) > frecencyScore(FrecencyEntry(1, now), now))
    }

    @Test
    fun recordFrecencyUseIncrementsCount() {
        val once = recordFrecencyUse(emptyMap(), "cmd-lock", 100L)
        val twice = recordFrecencyUse(once, "cmd-lock", 200L)
        assertEquals(1, once.getValue("cmd-lock").count)
        assertEquals(2, twice.getValue("cmd-lock").count)
        assertEquals(200L, twice.getValue("cmd-lock").lastUsedMillis)
    }

    @Test
    fun frecencyLookupIdStripsTheMostUsedPrefix() {
        assertEquals("cmd-lock", frecencyLookupId("most-used-cmd-lock"))
        assertEquals("cmd-lock", frecencyLookupId("cmd-lock"))
    }

    // ── Most Used (web mostUsedItems) ───────────────────────────────────────────────────────────────────────────
    @Test
    fun mostUsedRanksByFrecencyAndReKeysAndReSections() {
        val candidates =
            listOf(
                item("cmd-lock", PaletteItemType.VehicleCommand, "Lock"),
                item("cmd-honk_horn", PaletteItemType.VehicleCommand, "Horn"),
                item("/drives", PaletteItemType.Navigate, "Drives"),
            )
        val ranked = mostUsedItems(candidates, mapOf("cmd-lock" to 50.0, "/drives" to 10.0), "Most Used", limit = 5)
        assertEquals(listOf("most-used-cmd-lock", "most-used-/drives"), ranked.map { it.id })
        assertTrue(ranked.all { it.section == "Most Used" })
    }

    // ── Section grouping (web grouped render) ───────────────────────────────────────────────────────────────────
    @Test
    fun groupItemsPreservesFirstAppearanceOrder() {
        val items =
            listOf(
                item("a", PaletteItemType.Navigate, "A", section = "Pages"),
                item("b", PaletteItemType.VehicleCommand, "B", section = "Commands"),
                item("c", PaletteItemType.Navigate, "C", section = "Pages"),
            )
        val groups = groupItems(items)
        assertEquals(listOf("Pages", "Commands"), groups.map { it.section })
        assertEquals(listOf("a", "c"), groups.first().items.map { it.id })
    }

    // ── Recent-age bucketing (web formatRecentVisitedAgo) ───────────────────────────────────────────────────────
    @Test
    fun recentAgeBucketsByMinuteHourDay() {
        val now = 100L * 86_400_000L
        assertEquals(RecentAge.JustNow, recentAge(now - 30_000L, now))
        assertEquals(RecentAge.Minutes(5), recentAge(now - 5L * 60_000L, now))
        assertEquals(RecentAge.Hours(2), recentAge(now - 2L * 3_600_000L, now))
        assertEquals(RecentAge.Days(3), recentAge(now - 3L * 86_400_000L, now))
    }

    // ── Vehicle + selection projection ──────────────────────────────────────────────────────────────────────────
    @Test
    fun paletteVehicleLabelPrefersDisplayNameThenVin() {
        assertEquals("Red Rocket", paletteVehicleLabel(vehicle(1, "Red Rocket")))
        assertEquals("VIN9", paletteVehicleLabel(vehicle(9, name = "")))
    }

    @Test
    fun effectiveSelectionKeepsValidElseFirstElseNull() {
        assertEquals(2L, effectivePaletteSelection(2L, listOf(1, 2, 3)))
        assertEquals(1L, effectivePaletteSelection(99L, listOf(1, 2)))
        assertNull(effectivePaletteSelection(1L, emptyList()))
    }

    @Test
    fun fleetProjectionFlagsEmptyAndMultiAndSwitchTargets() {
        val fleet = projectFleet(listOf(vehicle(1), vehicle(2), vehicle(3)), 2L)
        assertFalse(fleet.isEmpty)
        assertTrue(fleet.needsVehicleChoice)
        assertNull(fleet.soleVehicleId)
        assertEquals(listOf(1L, 3L), fleet.switchTargets.map { it.id })
        assertEquals(1L, projectFleet(listOf(vehicle(1)), null).soleVehicleId)
    }

    @Test
    fun fleetResourcePreservesTheCacheThenNetworkEnvelope() {
        val loading = projectFleetResource(Resource.Loading(cached = listOf(vehicle(1)), fetchedAt = 5L, stale = true), null)
        assertTrue(loading is Resource.Loading && loading.cached?.vehicles?.size == 1)
        val offline =
            projectFleetResource(
                Resource.Error(cached = listOf(vehicle(1)), fetchedAt = 5L, stale = true, error = ApiError.Network()),
                null,
            )
        assertTrue(offline is Resource.Error && offline.stale && offline.cached != null)
    }

    // ── Search projection ───────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun searchProjectionMapsHitsAndIconsAndPreservesEnvelope() {
        val hit = SearchHit(type = SearchHitType.Drive, id = 7, title = "Morning commute", url = "/drives/7", score = 1.0)
        val projected = projectSearchResource(Resource.Success(SearchResponse(listOf(hit)), fetchedAt = 1L, stale = false))
        assertTrue(projected is Resource.Success)
        val rows = (projected as Resource.Success).data
        assertEquals(PaletteIconKind.Drive, rows.single().icon)
        assertEquals("/drives/7", rows.single().url)
    }

    @Test
    fun searchHitIconKindCoversEveryType() {
        assertEquals(PaletteIconKind.Vehicle, searchHitIconKind(SearchHitType.Vehicle))
        assertEquals(PaletteIconKind.Geofence, searchHitIconKind(SearchHitType.Geofence))
        SearchHitType.entries.forEach { searchHitSectionSuffix(it) }
    }

    @Test
    fun showViewAllRequiresHitsAndTwoCharTerm() {
        assertTrue(showViewAllResults(hitCount = 3, term = "dr"))
        assertFalse(showViewAllResults(hitCount = 0, term = "drives"))
        assertFalse(showViewAllResults(hitCount = 3, term = "d"))
    }

    // ── Catalogs ────────────────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun commandCatalogsAreNonEmptyWithUniqueIds() {
        assertTrue(VEHICLE_COMMAND_CONFIGS.isNotEmpty())
        assertTrue(REGISTRY_COMMANDS.isNotEmpty())
        assertEquals(VEHICLE_COMMAND_CONFIGS.size, VEHICLE_COMMAND_CONFIGS.map { it.id }.toSet().size)
        assertEquals(REGISTRY_COMMANDS.size, REGISTRY_COMMANDS.map { it.id }.toSet().size)
    }

    // ── i18n inventory (P1/S10) ─────────────────────────────────────────────────────────────────────────────────
    @Test
    fun keyInventoryIsCompleteUniqueAndCatalogPrefixed() {
        assertTrue(CommandPaletteKeys.ALL.isNotEmpty())
        assertEquals(CommandPaletteKeys.ALL.size, CommandPaletteKeys.ALL.toSet().size)
        assertTrue(CommandPaletteKeys.ALL.all { it.startsWith("translation_") })
    }

    // ── Telemetry (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun slugCarriesNoPiiAndDiagnosticEmitsItOnly() {
        assertEquals("CommandPalette", CommandPaletteRegistration.SLUG)
        val logger = RecordingLogger()
        recordCommandPaletteViewOpened(logger)
        val opened = logger.records.single { it.event == "view.opened" }
        assertEquals(mapOf("surface" to "CommandPalette"), opened.fields)
    }

    private companion object {
        const val SEARCH_HIT_SCORE = 9999
    }
}

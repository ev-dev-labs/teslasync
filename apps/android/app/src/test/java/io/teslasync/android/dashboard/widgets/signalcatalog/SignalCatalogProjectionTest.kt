package io.teslasync.android.dashboard.widgets.signalcatalog

import io.teslasync.shared.core.presentation.telemetry.SignalCatalogEntry
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SignalCatalogWidget's pure logic — the `observationCounts` tally, the
 * `filtered` search (name / description / source-module, case-insensitive), the `grouped`
 * source-module-keyed alphabetical grouping with the "Uncategorized" fallback, the per-row unit chip +
 * observation-count formatting, the compact total, the registry metadata and the footprint branches.
 * Mirrors the web spec (web/src/features/dashboard/widgets/SignalCatalogWidget.tsx). Runs in the
 * `:android:testReleaseUnitTest` gate.
 */
class SignalCatalogProjectionTest {
    private val uncategorized = "Uncategorized"

    // ── buildObservationCounts (web `observationCounts` memo) ───────────────────────

    @Test
    fun observationCountsTallyPerSignal() {
        val counts =
            SignalCatalogProjection.buildObservationCounts(
                listOf(
                    observation("BatteryLevel"),
                    observation("BatteryLevel"),
                    observation("VehicleSpeed"),
                ),
            )
        assertEquals(2, counts["BatteryLevel"])
        assertEquals(1, counts["VehicleSpeed"])
    }

    @Test
    fun observationCountsAreEmptyForNoObservations() {
        assertTrue(SignalCatalogProjection.buildObservationCounts(emptyList()).isEmpty())
    }

    // ── filterEntries (web `filtered` memo) ─────────────────────────────────────────

    @Test
    fun blankQueryReturnsAllEntries() {
        val entries = listOf(entry("BatteryLevel"), entry("VehicleSpeed"))
        assertEquals(entries, SignalCatalogProjection.filterEntries(entries, "   "))
    }

    @Test
    fun queryMatchesNameCaseInsensitively() {
        val entries = listOf(entry("BatteryLevel", module = "battery"), entry("VehicleSpeed", module = "drive"))
        val filtered = SignalCatalogProjection.filterEntries(entries, "battery")
        assertEquals(listOf("BatteryLevel"), filtered.map { it.name })
    }

    @Test
    fun queryMatchesDescriptionAndSourceModule() {
        val entries =
            listOf(
                entry("A", module = "battery", description = "state of charge"),
                entry("B", module = "drive", description = "wheel torque"),
            )
        assertEquals(listOf("A"), SignalCatalogProjection.filterEntries(entries, "charge").map { it.name })
        assertEquals(listOf("B"), SignalCatalogProjection.filterEntries(entries, "DRIVE").map { it.name })
    }

    @Test
    fun nonMatchingQueryReturnsEmpty() {
        val entries = listOf(entry("BatteryLevel"))
        assertTrue(SignalCatalogProjection.filterEntries(entries, "zzz").isEmpty())
    }

    // ── group (web `grouped` memo) ──────────────────────────────────────────────────

    @Test
    fun groupsBySourceModuleSortedAlphabetically() {
        val entries =
            listOf(
                entry("VehicleSpeed", module = "drive"),
                entry("BatteryLevel", module = "battery"),
                entry("OutsideTemp", module = "climate"),
            )
        val groups = SignalCatalogProjection.group(entries, emptyMap(), uncategorized, Locale.US)
        assertEquals(listOf("battery", "climate", "drive"), groups.map { it.category })
    }

    @Test
    fun blankSourceModuleFallsBackToUncategorized() {
        val groups = SignalCatalogProjection.group(listOf(entry("Lonely", module = "")), emptyMap(), uncategorized, Locale.US)
        assertEquals(listOf(uncategorized), groups.map { it.category })
    }

    @Test
    fun rowsPreserveCatalogOrderWithinCategory() {
        val entries =
            listOf(
                entry("Second", module = "battery"),
                entry("First", module = "battery"),
            )
        val rows = SignalCatalogProjection.group(entries, emptyMap(), uncategorized, Locale.US).single().rows
        assertEquals(listOf("Second", "First"), rows.map { it.name })
    }

    @Test
    fun rowReadsObservationCountAndFormatsIt() {
        val groups =
            SignalCatalogProjection.group(
                listOf(entry("BatteryLevel", module = "battery")),
                mapOf("BatteryLevel" to 1280),
                uncategorized,
                Locale.US,
            )
        val row = groups.single().rows.single()
        assertEquals(1280, row.observationCount)
        assertEquals("1,280", row.observationCountLabel)
    }

    @Test
    fun rowWithoutObservationsCountsZero() {
        val row =
            SignalCatalogProjection
                .group(listOf(entry("Quiet", module = "battery")), emptyMap(), uncategorized, Locale.US)
                .single()
                .rows
                .single()
        assertEquals(0, row.observationCount)
        assertEquals("0", row.observationCountLabel)
    }

    @Test
    fun blankUnitYieldsNoChip() {
        val rows =
            SignalCatalogProjection.group(
                listOf(entry("WithUnit", module = "m", unit = "V"), entry("NoUnit", module = "m", unit = "")),
                emptyMap(),
                uncategorized,
                Locale.US,
            )
        val byName = rows.single().rows.associateBy { it.name }
        assertEquals("V", byName.getValue("WithUnit").unit)
        assertNull(byName.getValue("NoUnit").unit)
    }

    @Test
    fun groupSizeReflectsRowCount() {
        val groups =
            SignalCatalogProjection.group(
                listOf(entry("A", module = "battery"), entry("B", module = "battery")),
                emptyMap(),
                uncategorized,
                Locale.US,
            )
        assertEquals(2, groups.single().size)
    }

    // ── project ─────────────────────────────────────────────────────────────────────

    @Test
    fun projectStandardComputesGroupsAndFlags() {
        val snapshot =
            SignalCatalogSnapshot(
                entries = listOf(entry("BatteryLevel", module = "battery"), entry("VehicleSpeed", module = "drive")),
                observationCounts = mapOf("BatteryLevel" to 5),
            )
        val display =
            SignalCatalogProjection.project(
                snapshot,
                SignalCatalogSize(2, 4),
                query = "",
                uncategorizedLabel = uncategorized,
                locale = Locale.US,
            )
        assertFalse(display.isCompact)
        assertTrue(display.hasEntries)
        assertTrue(display.hasResults)
        assertEquals(2, display.signalCount)
        assertEquals("2", display.signalCountLabel)
        assertEquals(listOf("battery", "drive"), display.groups.map { it.category })
    }

    @Test
    fun projectFilteredToNothingHasNoResultsButStillHasEntries() {
        val snapshot = SignalCatalogSnapshot(listOf(entry("BatteryLevel", module = "battery")), emptyMap())
        val display =
            SignalCatalogProjection.project(
                snapshot,
                SignalCatalogSize(2, 4),
                query = "zzz",
                uncategorizedLabel = uncategorized,
                locale = Locale.US,
            )
        assertTrue(display.hasEntries)
        assertFalse(display.hasResults)
        assertTrue(display.groups.isEmpty())
    }

    @Test
    fun projectEmptyCatalogHasNoEntries() {
        val display =
            SignalCatalogProjection.project(
                SignalCatalogSnapshot.EMPTY,
                SignalCatalogSize(2, 4),
                query = "",
                uncategorizedLabel = uncategorized,
                locale = Locale.US,
            )
        assertFalse(display.hasEntries)
        assertEquals(0, display.signalCount)
    }

    @Test
    fun projectCompactFootprintSetsCompactAndTotal() {
        val snapshot = SignalCatalogSnapshot(List(1280) { entry("S$it", module = "m") }, emptyMap())
        val display =
            SignalCatalogProjection.project(
                snapshot,
                SignalCatalogSize(cols = 1, rows = 4),
                query = "",
                uncategorizedLabel = uncategorized,
                locale = Locale.US,
            )
        assertTrue(display.isCompact)
        assertEquals(1280, display.signalCount)
        assertEquals("1,280", display.signalCountLabel)
    }

    // ── registry metadata + footprint (web registry/telemetry.ts parity) ────────────

    @Test
    fun registryMetadataMatchesWeb() {
        assertEquals("signal-catalog", SignalCatalogRegistration.ID)
        assertEquals("telemetry", SignalCatalogRegistration.CATEGORY)
        assertEquals("SignalCatalogWidget", SignalCatalogRegistration.SLUG)
        assertEquals("Signal Catalog", SignalCatalogRegistration.NAME)
    }

    @Test
    fun footprintConstraintsMatchWeb() {
        assertEquals(SignalCatalogSize(2, 4), SignalCatalogRegistration.defaultSize)
        assertEquals(SignalCatalogSize(2, 4), SignalCatalogRegistration.minSize)
        assertEquals(SignalCatalogSize(4, 40), SignalCatalogRegistration.maxSize)
    }

    @Test
    fun withinBoundsAndClampHonourTheFootprint() {
        assertTrue(SignalCatalogRegistration.withinBounds(SignalCatalogSize(3, 10)))
        assertFalse(SignalCatalogRegistration.withinBounds(SignalCatalogSize(1, 1)))
        assertFalse(SignalCatalogRegistration.withinBounds(SignalCatalogSize(5, 41)))
        assertEquals(SignalCatalogSize(2, 4), SignalCatalogRegistration.clamp(SignalCatalogSize(1, 1)))
        assertEquals(SignalCatalogSize(4, 40), SignalCatalogRegistration.clamp(SignalCatalogSize(9, 99)))
    }

    @Test
    fun isCompactOnlyAtSingleColumn() {
        assertTrue(SignalCatalogSize(cols = 1, rows = 4).isCompact)
        assertFalse(SignalCatalogSize(cols = 2, rows = 4).isCompact)
    }

    // ── builders ──────────────────────────────────────────────────────────────────

    private fun entry(
        name: String,
        module: String = "battery",
        unit: String? = null,
        description: String? = null,
    ): SignalCatalogEntry =
        SignalCatalogEntry(
            name = name,
            valueType = "numeric",
            sourceModule = module,
            unit = unit,
            description = description,
            firstSeenAt = "",
            lastSeenAt = "",
        )

    private fun observation(signalName: String): SignalObservation =
        SignalObservation(
            vehicleId = 1L,
            ts = "2024-01-15T10:00:00Z",
            signalName = signalName,
            valueNumeric = 1.0,
            valueText = null,
            valueBool = null,
            source = "fleet_telemetry",
        )
}

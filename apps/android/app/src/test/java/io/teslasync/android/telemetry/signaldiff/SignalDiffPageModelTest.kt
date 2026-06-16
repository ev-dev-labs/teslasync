package io.teslasync.android.telemetry.signaldiff

import io.teslasync.android.data.vehicles.vehicle
import io.teslasync.android.featureviews.signalcomparecontrols.SignalCompareTime
import io.teslasync.android.featureviews.signaldifftable.SignalDiffDelta
import io.teslasync.android.featureviews.signaldifftable.SignalDiffRowVm
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset

/**
 * JVM unit tests for the framework-free SignalDiffPage model — the page's pinned-name projection, filtered-row
 * derivation, window-span math, CSV/alert/share payloads, default window, and vehicle resolution (web parity of
 * web/src/features/telemetry/pages/SignalDiffPage.tsx). No Android / Compose / HTTP — pure off-device logic.
 */
class SignalDiffPageModelTest {
    private val utc = ZoneOffset.UTC

    private fun row(
        name: String,
        valueA: String = "1",
        valueB: String = "2",
        sourceA: String? = "L1",
        sourceB: String? = "L2",
    ): SignalDiffRowVm =
        SignalDiffRowVm(
            name = name,
            valueA = valueA,
            valueB = valueB,
            delta = SignalDiffDelta.None,
            sourceA = sourceA,
            sourceB = sourceB,
            ageMsA = null,
            ageMsB = null,
        )

    private fun pin(itemId: String): PinnedItem =
        PinnedItem(id = 1, itemType = PinnedItemType.Widget, itemId = itemId, position = 0, pinnedAt = "")

    @Test
    fun pinHelpersMirrorTheWebConvention() {
        assertEquals("signal-diff:vehicle:7", SignalDiffPageRegistration.pinContext(7))
        assertEquals("signal:vehicle_speed", SignalDiffPageRegistration.pinItemId("vehicle_speed"))
    }

    @Test
    fun pinnedSignalNamesKeepsOnlySignalPrefixedRows() {
        val items = listOf(pin("signal:battery_level"), pin("widget:some-card"), pin("signal:vehicle_speed"))
        assertEquals(setOf("battery_level", "vehicle_speed"), pinnedSignalNames(items))
    }

    @Test
    fun visibleRowsAppliesNameFilter() {
        val rows = listOf(row("battery_level"), row("vehicle_speed"), row("battery_range"))
        val filtered = visibleRows(rows, filter = "battery", category = null)
        assertEquals(listOf("battery_level", "battery_range"), filtered.map { it.name })
    }

    @Test
    fun visibleRowsAppliesCategoryMatcher() {
        val rows = listOf(row("battery_level"), row("vehicle_speed"), row("cabin_temp"))
        val filtered = visibleRows(rows, filter = "", category = "drive")
        assertEquals(listOf("vehicle_speed"), filtered.map { it.name })
    }

    @Test
    fun visibleRowsWithNoFilterReturnsEverything() {
        val rows = listOf(row("a"), row("b"))
        assertEquals(rows, visibleRows(rows, filter = "  ", category = null))
    }

    @Test
    fun filterActiveReflectsFilterOrCategory() {
        assertFalse(filterActive(filter = "", category = null))
        assertFalse(filterActive(filter = "   ", category = null))
        assertTrue(filterActive(filter = "soc", category = null))
        assertTrue(filterActive(filter = "", category = "battery"))
    }

    @Test
    fun windowSpanSecondsComputesAbsoluteDelta() {
        val span = windowSpanSeconds("2024-01-01T00:00:00Z", "2024-01-01T01:00:00Z")
        assertEquals(3600.0, span)
        // The order does not matter (web Math.abs).
        assertEquals(3600.0, windowSpanSeconds("2024-01-01T01:00:00Z", "2024-01-01T00:00:00Z"))
    }

    @Test
    fun windowSpanSecondsIsNullForBlankOrInvalid() {
        assertNull(windowSpanSeconds("", "2024-01-01T00:00:00Z"))
        assertNull(windowSpanSeconds("2024-01-01T00:00:00Z", "not-a-date"))
    }

    @Test
    fun formatWindowSpanRendersWholeSecondsOrDash() {
        assertEquals("\u2014", formatWindowSpan(null))
        assertEquals("3600 s", formatWindowSpan(3600.0))
        assertEquals("3599.5 s", formatWindowSpan(3599.5))
    }

    @Test
    fun defaultInteractionIsAOneHourWindowEndingNow() {
        val now = 1_700_000_000_000L
        val interaction = defaultInteraction(now, utc)
        val span =
            windowSpanSeconds(
                SignalCompareTime.isoOrEmpty(interaction.atA, utc),
                SignalCompareTime.isoOrEmpty(interaction.atB, utc),
            )
        assertEquals(3600.0, span)
    }

    @Test
    fun resolveVehicleIdPrefersSelectionThenFirstThenZero() {
        val fleet = listOf(vehicle(11), vehicle(22))
        assertEquals(22L, resolveVehicleId(selected = 22L, vehicles = fleet))
        assertEquals(11L, resolveVehicleId(selected = null, vehicles = fleet))
        assertEquals(0L, resolveVehicleId(selected = null, vehicles = emptyList()))
        assertEquals(0L, resolveVehicleId(selected = null, vehicles = null))
    }

    @Test
    fun buildDiffCsvEmitsHeaderAndQuotedRows() {
        val rows = listOf(row("battery_level", valueA = "10", valueB = "20"), row("note", valueA = "a,b", valueB = "c"))
        val csv = buildDiffCsv(rows)
        val lines = csv.split("\n")
        assertEquals("signal,window_a,window_b,source_a,source_b", lines[0])
        assertEquals("battery_level,10,20,L1,L2", lines[1])
        // A value containing a comma is RFC-4180 quoted so it can never split the row.
        assertEquals("note,\"a,b\",c,L1,L2", lines[2])
    }

    @Test
    fun alertSignalsPayloadJoinsNamesWithCommas() {
        assertEquals("soc,speed,range", alertSignalsPayload(listOf("soc", "speed", "range")))
    }

    @Test
    fun buildShareLinkEncodesTheCurrentView() {
        val interaction =
            SignalDiffInteraction(atA = "2024-01-01T00:00", atB = "2024-01-01T01:00", filter = "speed", category = "drive")
        val link = buildShareLink(vehicleId = 5, interaction = interaction)
        assertTrue(link.startsWith("teslasync://app/signal-diff?"))
        assertTrue(link.contains("vehicle=5"))
        assertTrue(link.contains("q=speed"))
        assertTrue(link.contains("cat=drive"))
        // The datetime-local colon is percent-encoded so the link is a valid URI.
        assertTrue(link.contains("a=2024-01-01T00%3A00"))
    }

    @Test
    fun buildShareLinkWithNoParamsIsTheBareBase() {
        val link = buildShareLink(vehicleId = 0, interaction = SignalDiffInteraction())
        assertEquals("teslasync://app/signal-diff", link)
    }
}

package io.teslasync.android.featureviews.signalcategorytree

import io.teslasync.shared.core.presentation.signals.SignalDescriptor
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalUnitKind
import io.teslasync.shared.core.presentation.signals.SignalValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit test for [SignalCategoryTreeProjection] — the pure native port of the web
 * `SignalCategoryTree` `groups` memo + `SignalSparklinePreview` numeric extraction. Covers grouping,
 * category ordering + label fallback, leaf sort, the search filter, the tri-state selection helpers, the
 * expansion toggle, and the sparkline numeric projection. Runs in the `:app:testReleaseUnitTest` gate.
 */
class SignalCategoryTreeProjectionTest {
    private fun descriptor(
        name: String,
        category: String,
        kind: SignalKind = SignalKind.Float,
    ): SignalDescriptor =
        SignalDescriptor(
            name = name,
            category = category,
            valueKind = kind,
            unitKind = SignalUnitKind.None,
            isCompound = false,
            isSettingUnit = false,
        )

    @Test
    fun buildCatalog_ordersGroupsByCategoryRankAndSortsLeavesByName() {
        val catalog =
            SignalCategoryTreeProjection.buildCatalog(
                listOf(
                    descriptor("OutsideTemp", "climate"),
                    descriptor("ChargeState", "charging"),
                    descriptor("BatteryLevel", "charging"),
                    descriptor("VehicleSpeed", "driving"),
                ),
            )

        // charging (rank 0) before driving (rank 1) before climate (rank 3).
        assertEquals(listOf("charging", "driving", "climate"), catalog.groups.map { it.categoryId })
        // Leaves alphabetised within the charging group.
        assertEquals(listOf("BatteryLevel", "ChargeState"), catalog.groups[0].leaves.map { it.name })
        assertEquals(4, catalog.totalSignals)
        assertFalse(catalog.isEmpty)
    }

    @Test
    fun buildCatalog_unknownCategoriesSortLastByIdTieBreak() {
        val catalog =
            SignalCategoryTreeProjection.buildCatalog(
                listOf(
                    descriptor("Z", "zeta"),
                    descriptor("A", "alpha"),
                    descriptor("C", "charging"),
                ),
            )
        // Known charging first; unknowns ("alpha", "zeta") sort last, tie-broken by raw id.
        assertEquals(listOf("charging", "alpha", "zeta"), catalog.groups.map { it.categoryId })
    }

    @Test
    fun buildCatalog_emptyInputIsEmptyCatalog() {
        assertTrue(SignalCategoryTreeProjection.buildCatalog(emptyList()).isEmpty)
    }

    @Test
    fun filterGroups_blankQueryReturnsAllAndNonBlankDropsEmptyGroups() {
        val catalog =
            SignalCategoryTreeProjection.buildCatalog(
                listOf(
                    descriptor("BatteryLevel", "charging"),
                    descriptor("VehicleSpeed", "driving"),
                ),
            )
        val groups = catalog.groups

        assertEquals(2, SignalCategoryTreeProjection.filterGroups(groups, "  ").size)

        val filtered = SignalCategoryTreeProjection.filterGroups(groups, "speed")
        assertEquals(1, filtered.size)
        assertEquals("driving", filtered.first().categoryId)
        assertEquals(listOf("VehicleSpeed"), filtered.first().leaves.map { it.name })
    }

    @Test
    fun friendlyCategoryLabel_prefersKeyedThenFallbackThenRawId() {
        val keyed = mapOf("charging" to "Charging")
        assertEquals("Charging", SignalCategoryTreeProjection.friendlyCategoryLabel("charging", keyed))
        // Unkeyed-but-known category resolves through the faithful web-port fallback map.
        assertEquals("Safety & Security", SignalCategoryTreeProjection.friendlyCategoryLabel("safety_security", keyed))
        assertEquals("Setting Units", SignalCategoryTreeProjection.friendlyCategoryLabel("setting_unit", keyed))
        // Truly-unknown id passes through verbatim (web `?? id`).
        assertEquals("mystery", SignalCategoryTreeProjection.friendlyCategoryLabel("mystery", keyed))
    }

    @Test
    fun selectionHelpers_modelTheTriStateGroupCheckbox() {
        val group =
            SignalCategoryGroup(
                categoryId = "charging",
                leaves = listOf(SignalLeaf("A", SignalKind.Float), SignalLeaf("B", SignalKind.Float)),
            )
        assertFalse(SignalCategoryTreeProjection.isGroupFullySelected(group, emptySet()))
        assertTrue(SignalCategoryTreeProjection.isGroupPartiallySelected(group, setOf("A")))
        assertTrue(SignalCategoryTreeProjection.isGroupFullySelected(group, setOf("A", "B")))

        val all = SignalCategoryTreeProjection.toggleGroupSelection(emptySet(), group)
        assertEquals(setOf("A", "B"), all)
        // Toggling a fully-selected group clears it.
        assertEquals(emptySet<String>(), SignalCategoryTreeProjection.toggleGroupSelection(all, group))

        assertEquals(setOf("A"), SignalCategoryTreeProjection.toggleSignal(emptySet(), "A"))
        assertEquals(emptySet<String>(), SignalCategoryTreeProjection.toggleSignal(setOf("A"), "A"))
    }

    @Test
    fun toggleExpanded_addsAndRemoves() {
        assertEquals(setOf("charging"), SignalCategoryTreeProjection.toggleExpanded(emptySet(), "charging"))
        assertEquals(emptySet<String>(), SignalCategoryTreeProjection.toggleExpanded(setOf("charging"), "charging"))
    }

    @Test
    fun isNumericKind_matchesWebNonNumericSet() {
        assertTrue(SignalCategoryTreeProjection.isNumericKind(SignalKind.Float))
        assertTrue(SignalCategoryTreeProjection.isNumericKind(SignalKind.Int))
        assertTrue(SignalCategoryTreeProjection.isNumericKind(SignalKind.Bool))
        assertFalse(SignalCategoryTreeProjection.isNumericKind(SignalKind.String))
        assertFalse(SignalCategoryTreeProjection.isNumericKind(SignalKind.Time))
        assertFalse(SignalCategoryTreeProjection.isNumericKind(SignalKind.Unknown))
        assertEquals("unknown", SignalCategoryTreeProjection.kindToken(SignalKind.Unknown))
    }

    @Test
    fun historyToPoints_extractsNumbersAndBooleansAndDropsTheRest() {
        val history =
            SignalHistoryResponse(
                vehicleId = 1L,
                signal = "BatteryLevel",
                expectedKind = "ValueKindFloat",
                from = "",
                to = "",
                count = 4,
                data =
                    listOf(
                        SignalEnvelope(SignalKind.Float, SignalValue.Num(72.0), ""),
                        SignalEnvelope(SignalKind.Bool, SignalValue.Bool(true), ""),
                        SignalEnvelope(SignalKind.String, SignalValue.Text("n/a"), ""),
                        SignalEnvelope(SignalKind.Float, SignalValue.Null, ""),
                    ),
            )
        val points = SignalCategoryTreeProjection.historyToPoints(history)
        assertEquals(listOf(72.0, 1.0), points)
        // Two finite samples are enough to draw a line; one is not (web `numericSeries.length < 2`).
        assertTrue(SignalCategoryTreeProjection.hasSparkline(points))
        assertFalse(SignalCategoryTreeProjection.hasSparkline(listOf(1.0)))
        assertTrue(SignalCategoryTreeProjection.historyToPoints(null).isEmpty())
    }
}

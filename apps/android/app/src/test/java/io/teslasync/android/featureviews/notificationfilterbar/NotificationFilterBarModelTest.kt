package io.teslasync.android.featureviews.notificationfilterbar

import io.teslasync.shared.core.data.repo.NotificationFilters
import io.teslasync.shared.core.presentation.notifications.AlertRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * Pure-logic coverage of the NotificationFilterBar model — the native parity contract for everything the web
 * `NotificationFilterBar.tsx` derives outside JSX (severity toggle, the vehicle/rule/query/date mutators
 * with their truthy guards, the select-option + active-chip builders in web order, and the ISO-date <->
 * epoch-day bridge). No Android or Compose, so it runs in the :android:testReleaseUnitTest gate.
 */
class NotificationFilterBarModelTest {
    private fun rule(
        id: Long,
        name: String,
    ): AlertRule = AlertRule(id = id, name = name)

    private val vehicles = listOf(VehicleChoice(1, "Model 3"), VehicleChoice(2, "Model Y"))
    private val rules = listOf(rule(7, "Low Battery"), rule(9, "Sentry Triggered"))

    @Test
    fun toggleSeverityAddsRemovesAndClears() {
        assertEquals(listOf("info"), toggleSeverity(null, "info"))
        assertEquals(listOf("info", "warn"), toggleSeverity(listOf("info"), "warn"))
        // Removing the last selected severity drops the param entirely (web `next.length ? next : undefined`).
        assertNull(toggleSeverity(listOf("info"), "info"))
        assertEquals(listOf("warn"), toggleSeverity(listOf("info", "warn"), "info"))
    }

    @Test
    fun withVehicleAppliesTruthyGuard() {
        assertEquals(listOf(5L), withVehicle(NotificationFilters(), "5").vehicleId)
        assertNull(withVehicle(NotificationFilters(), "").vehicleId)
        // Number("0") is falsy in the web guard, and a non-numeric value yields NaN (also falsy).
        assertNull(withVehicle(NotificationFilters(), "0").vehicleId)
        assertNull(withVehicle(NotificationFilters(), "abc").vehicleId)
    }

    @Test
    fun withRuleAppliesTruthyGuard() {
        assertEquals(listOf(9L), withRule(NotificationFilters(), "9").ruleId)
        assertNull(withRule(NotificationFilters(), "").ruleId)
        assertNull(withRule(NotificationFilters(), "0").ruleId)
    }

    @Test
    fun withQueryKeepsRawTextButClearsOnBlank() {
        assertEquals("bolt", withQuery(NotificationFilters(), "bolt").q)
        // Non-blank once trimmed keeps the RAW (untrimmed) value, exactly like the web `q.trim() ? q : …`.
        assertEquals("  bolt  ", withQuery(NotificationFilters(), "  bolt  ").q)
        assertNull(withQuery(NotificationFilters(), "   ").q)
        assertNull(withQuery(NotificationFilters(), "").q)
    }

    @Test
    fun withDateRangeRendersIsoOrClears() {
        val start = LocalDate.of(2024, 1, 15).toEpochDay()
        val end = LocalDate.of(2024, 2, 1).toEpochDay()
        val applied = withDateRange(NotificationFilters(), start, end)
        assertEquals("2024-01-15", applied.from)
        assertEquals("2024-02-01", applied.to)

        val cleared = withDateRange(NotificationFilters(from = "x", to = "y"), null, null)
        assertNull(cleared.from)
        assertNull(cleared.to)
    }

    @Test
    fun clearFilterRemovesOnlyTheNamedKey() {
        val all = NotificationFilters(severity = listOf("info"), vehicleId = listOf(1), ruleId = listOf(7), q = "x", from = "a", to = "b")
        assertNull(clearFilter(all, "severity").severity)
        assertEquals(listOf(1L), clearFilter(all, "severity").vehicleId)
        assertNull(clearFilter(all, "vehicle_id").vehicleId)
        assertNull(clearFilter(all, "rule_id").ruleId)
        assertNull(clearFilter(all, "q").q)
        assertNull(clearFilter(all, "from").from)
        assertNull(clearFilter(all, "to").to)
        // An unknown key is a no-op.
        assertEquals(all, clearFilter(all, "nope"))
    }

    @Test
    fun clearAllResetsBarFiltersButPreservesUnrelatedFields() {
        val filters =
            NotificationFilters(
                severity = listOf("warn"),
                vehicleId = listOf(1),
                ruleId = listOf(7),
                q = "x",
                from = "a",
                to = "b",
                read = false,
                archived = true,
                limit = 50,
                offset = 100,
            )
        val cleared = clearAll(filters)
        assertNull(cleared.severity)
        assertNull(cleared.vehicleId)
        assertNull(cleared.ruleId)
        assertNull(cleared.q)
        assertNull(cleared.from)
        assertNull(cleared.to)
        // Unrelated inbox-query fields survive a "Clear all".
        assertEquals(false, cleared.read)
        assertEquals(true, cleared.archived)
        assertEquals(50, cleared.limit)
        assertEquals(100, cleared.offset)
    }

    @Test
    fun selectValuesReflectSelection() {
        assertEquals(setOf("info", "critical"), selectedSeverities(NotificationFilters(severity = listOf("info", "critical"))))
        assertEquals("", vehicleSelectValue(NotificationFilters()))
        assertEquals("2", vehicleSelectValue(NotificationFilters(vehicleId = listOf(2))))
        assertEquals("", ruleSelectValue(NotificationFilters()))
        assertEquals("9", ruleSelectValue(NotificationFilters(ruleId = listOf(9))))
    }

    @Test
    fun vehicleOptionsLeadWithSentinelThenLabelOrFallback() {
        val options = vehicleOptions("All vehicles", listOf(VehicleChoice(1, "Model 3"), VehicleChoice(2, "")))
        assertEquals(3, options.size)
        assertEquals("" to "All vehicles", options[0].value to options[0].label)
        assertEquals("1" to "Model 3", options[1].value to options[1].label)
        // An unnamed vehicle falls back to `#id` (web `v.display_name || #${v.id}`).
        assertEquals("2" to "#2", options[2].value to options[2].label)
    }

    @Test
    fun ruleOptionsLeadWithSentinel() {
        val options = ruleOptions("All rules", rules)
        assertEquals(3, options.size)
        assertEquals("" to "All rules", options[0].value to options[0].label)
        assertEquals("7" to "Low Battery", options[1].value to options[1].label)
    }

    @Test
    fun activeFiltersAreBuiltInWebOrderWithResolvedLabels() {
        val filters =
            NotificationFilters(
                severity = listOf("info", "critical"),
                vehicleId = listOf(2),
                ruleId = listOf(7),
                q = "bolt",
                from = "2024-01-15T08:00:00Z",
                to = "2024-02-01",
            )
        val chips = activeFilters(filters, chipLabels(), vehicles, rules)
        assertEquals(listOf("severity", "vehicle_id", "rule_id", "q", "from", "to"), chips.map { it.key })
        assertEquals("Info, Critical", chips[0].value)
        assertEquals("Model Y", chips[1].value)
        assertEquals("Low Battery", chips[2].value)
        assertEquals("bolt", chips[3].value)
        // Date chips keep only the yyyy-MM-dd prefix (web `.slice(0, 10)`).
        assertEquals("2024-01-15", chips[4].value)
        assertEquals("2024-02-01", chips[5].value)
    }

    @Test
    fun activeFiltersFallBackToHashIdWhenUnresolved() {
        val chips = activeFilters(NotificationFilters(vehicleId = listOf(99), ruleId = listOf(88)), chipLabels(), vehicles, rules)
        assertEquals("#99", chips.first { it.key == "vehicle_id" }.value)
        assertEquals("#88", chips.first { it.key == "rule_id" }.value)
    }

    @Test
    fun noActiveFiltersWhenNothingSelected() {
        assertTrue(activeFilters(NotificationFilters(), chipLabels(), vehicles, rules).isEmpty())
    }

    @Test
    fun isoDateEpochDayRoundTrips() {
        val day = LocalDate.of(2024, 6, 12).toEpochDay()
        assertEquals(day, isoDateToEpochDay("2024-06-12"))
        // A full ISO datetime is truncated to its date prefix before parsing.
        assertEquals(day, isoDateToEpochDay("2024-06-12T05:23:24Z"))
        assertEquals("2024-06-12", epochDayToIsoDate(day))
        assertNull(isoDateToEpochDay(null))
        assertNull(isoDateToEpochDay(""))
        assertNull(isoDateToEpochDay("not-a-date"))
        assertEquals("", epochDayToIsoDate(null))
    }

    private fun chipLabels(): NotificationFilterChipLabels =
        NotificationFilterChipLabels(
            severity = "Severity",
            vehicle = "Vehicle",
            rule = "Rule",
            search = "Search",
            from = "From",
            to = "To",
            severityValues = mapOf("info" to "Info", "warn" to "Warn", "critical" to "Critical"),
        )
}

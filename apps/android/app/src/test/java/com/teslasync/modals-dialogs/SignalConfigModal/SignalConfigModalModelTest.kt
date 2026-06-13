// Off-device unit coverage for the SignalConfigModal surface's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the working-list seed (web `useState` initializer), the case-insensitive name search
// (web `filtered`), the first-seen-order grouping (web `grouped`), the per-signal / per-category / master mutations
// (web `updateSignal` / `toggleCategory` / `setCategoryInterval` / `toggleAll` / `setMasterIntervalAll`), the eight
// preset transforms (web `PRESETS`), the selected/total/at-interval counts (web footer), the submit payload assembly
// (web `handleSubmit`), the interval ladder, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP —
// runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.signalconfigmodal

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SignalConfigModalModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // ---- Interval ladder (web INTERVAL_OPTIONS) ----------------------------------

    @Test
    fun intervalLadderMatchesTheWebOptionSet() {
        assertEquals(10, SignalIntervals.OPTIONS.size)
        assertEquals(0, SignalIntervals.REALTIME_VALUE)
        assertEquals(10, SignalIntervals.DEFAULT_VALUE)
        assertEquals(listOf(0, 1, 5, 10, 30, 60, 300, 900, 3600, 86400), SignalIntervals.OPTIONS.map { it.value })
        assertEquals("500ms", SignalIntervals.labelFor(0))
        assertEquals("10s", SignalIntervals.labelFor(10))
        assertEquals("24h", SignalIntervals.labelFor(86400))
        // An unknown cadence falls back to the default option's token (web `INTERVAL_OPTIONS[3]`).
        assertEquals("10s", SignalIntervals.labelFor(7))
    }

    // ---- Seed (web useState initializer) -----------------------------------------

    @Test
    fun seedFlattensCategoriesMarksSelectionAndAppliesInterval() {
        val signals = SignalConfigProjection.seed(sampleCategories(), listOf("VehicleSpeed"), 10)
        assertEquals(4, signals.size)
        assertEquals(listOf("VehicleSpeed", "Gear", "ChargeState", "CarType"), signals.map { it.name })
        assertTrue(signals.row("VehicleSpeed").selected)
        assertFalse(signals.row("Gear").selected)
        assertTrue(signals.all { it.interval == 10 })
        assertEquals("Charging", signals.row("ChargeState").category)
    }

    // ---- Search (web filtered) ---------------------------------------------------

    @Test
    fun filterIsCaseInsensitiveSubstringAndEmptyKeepsEverything() {
        val signals = seedAll()
        assertEquals(listOf("ChargeState"), SignalConfigProjection.filter(signals, "charge").map { it.name })
        assertEquals(listOf("Gear"), SignalConfigProjection.filter(signals, "GEAR").map { it.name })
        assertEquals(signals.size, SignalConfigProjection.filter(signals, "").size)
        assertEquals(signals.size, SignalConfigProjection.filter(signals, "   ").size)
        assertTrue(SignalConfigProjection.filter(signals, "nomatch").isEmpty())
    }

    // ---- Grouping (web grouped) --------------------------------------------------

    @Test
    fun groupPreservesFirstSeenCategoryOrder() {
        val groups = SignalConfigProjection.group(seedAll())
        assertEquals(listOf("Driving", "Charging", "Vehicle Config"), groups.map { it.category })
        assertEquals(listOf("VehicleSpeed", "Gear"), groups.first().signals.map { it.name })
    }

    @Test
    fun groupRollUpsDriveTheHeaderTriStateAndCount() {
        val signals = SignalConfigProjection.seed(sampleCategories(), listOf("VehicleSpeed"), 10)
        val driving = SignalConfigProjection.group(signals).first { it.category == "Driving" }
        assertFalse(driving.allSelected)
        assertTrue(driving.someSelected)
        assertEquals(1, driving.selectedCount)

        val charging = SignalConfigProjection.group(signals).first { it.category == "Charging" }
        assertFalse(charging.someSelected)
        assertEquals(0, charging.selectedCount)
    }

    // ---- Counts (web selectedCount / footer) -------------------------------------

    @Test
    fun selectedAndAtIntervalCountsTrackSelection() {
        val signals = SignalConfigProjection.seed(sampleCategories(), listOf("VehicleSpeed", "ChargeState"), 10)
        assertEquals(2, SignalConfigProjection.selectedCount(signals))
        assertFalse(SignalConfigProjection.allSelected(signals))
        assertEquals(2, SignalConfigProjection.countAtInterval(signals, 10))
        assertEquals(0, SignalConfigProjection.countAtInterval(signals, 0))
        assertTrue(SignalConfigProjection.allSelected(SignalConfigProjection.setAllSelected(signals, true)))
        // allSelected is false for an empty list so "Select all" stays offered (web `selectedCount === totalCount`).
        assertFalse(SignalConfigProjection.allSelected(emptyList()))
    }

    // ---- Mutations (web updateSignal / toggleAll / setMasterIntervalAll) ----------

    @Test
    fun updateSignalRewritesOnlyTheNamedRow() {
        val signals = seedAll()
        val updated = SignalConfigProjection.updateSignal(signals, "Gear") { it.copy(selected = true, interval = 5) }
        assertTrue(updated.row("Gear").selected)
        assertEquals(5, updated.row("Gear").interval)
        assertEquals(signals.row("VehicleSpeed"), updated.row("VehicleSpeed"))
    }

    @Test
    fun setAllSelectedAndSetAllIntervalRewriteEveryRow() {
        val signals = seedAll()
        assertTrue(SignalConfigProjection.setAllSelected(signals, true).all { it.selected })
        assertTrue(SignalConfigProjection.setAllSelected(signals, false).none { it.selected })
        assertTrue(SignalConfigProjection.setAllInterval(signals, 60).all { it.interval == 60 })
    }

    // ---- Category mutations (web toggleCategory / setCategoryInterval) -------------

    @Test
    fun toggleCategorySelectsAllThenDeselectsAll() {
        val signals = SignalConfigProjection.seed(sampleCategories(), listOf("VehicleSpeed"), 10)
        // Driving has one selected (VehicleSpeed) + one not (Gear): the first toggle selects the whole category.
        val selectedAll = SignalConfigProjection.toggleCategory(signals, "Driving")
        assertTrue(selectedAll.filter { it.category == "Driving" }.all { it.selected })
        // Charging untouched.
        assertFalse(selectedAll.row("ChargeState").selected)
        // A second toggle (now fully selected) deselects the whole category.
        val deselected = SignalConfigProjection.toggleCategory(selectedAll, "Driving")
        assertTrue(deselected.filter { it.category == "Driving" }.none { it.selected })
    }

    @Test
    fun setCategoryIntervalRetunesOnlyThatCategory() {
        val signals = SignalConfigProjection.setCategoryInterval(seedAll(), "Charging", 5)
        assertEquals(5, signals.row("ChargeState").interval)
        assertEquals(10, signals.row("VehicleSpeed").interval)
    }

    // ---- Submit payload (web handleSubmit) ---------------------------------------

    @Test
    fun buildSubmissionEmitsOnlySelectedNameIntervalPairs() {
        val signals = SignalConfigProjection.seed(sampleCategories(), listOf("VehicleSpeed", "ChargeState"), 30)
        val payload = SignalConfigProjection.buildSubmission(signals)
        assertEquals(
            listOf(SubscribedSignal("VehicleSpeed", 30), SubscribedSignal("ChargeState", 30)),
            payload,
        )
        assertTrue(SignalConfigProjection.buildSubmission(SignalConfigProjection.setAllSelected(signals, false)).isEmpty())
    }

    // ---- Presets (web PRESETS apply, per branch) ---------------------------------

    @Test
    fun balancedAndLowPowerSelectEverythingAtTheirCadence() {
        val balanced = SignalPreset.Balanced.apply(seedAll())
        assertTrue(balanced.all { it.selected })
        assertTrue(balanced.all { it.interval == 10 })

        val lowPower = SignalPreset.LowPower.apply(seedAll())
        assertTrue(lowPower.all { it.selected })
        assertTrue(lowPower.all { it.interval == 60 })
    }

    @Test
    fun realtimeDrivingTunesByCategory() {
        val signals = SignalPreset.RealtimeDriving.apply(seedAll())
        assertTrue(signals.all { it.selected })
        assertEquals(1, signals.row("VehicleSpeed").interval) // Driving -> 1s
        assertEquals(10, signals.row("ChargeState").interval) // Charging -> 10s
        assertEquals(86400, signals.row("CarType").interval) // Vehicle Config -> 24h
    }

    @Test
    fun costSaverSelectsEssentialsOnlyAtFiveToFifteenMinutes() {
        val signals = SignalPreset.CostSaver.apply(seedAll())
        assertTrue(signals.row("ChargeState").selected) // Charging is essential
        assertEquals(300, signals.row("ChargeState").interval)
        assertFalse(signals.row("VehicleSpeed").selected) // Driving is not essential
        assertFalse(signals.row("CarType").selected) // Vehicle Config is not essential
    }

    @Test
    fun diagnosticsAndTripLoggerMatchTheirWebTransforms() {
        val diagnostics = SignalPreset.Diagnostics.apply(seedAll())
        assertTrue(diagnostics.all { it.selected })
        assertEquals(10, diagnostics.row("VehicleSpeed").interval) // Driving -> 10s
        assertEquals(3600, diagnostics.row("CarType").interval) // Vehicle Config -> 1h

        val trip = SignalPreset.TripLogger.apply(seedAll())
        assertEquals(5, trip.row("VehicleSpeed").interval) // Driving -> 5s
        assertTrue(trip.row("VehicleSpeed").selected)
        assertEquals(30, trip.row("ChargeState").interval) // Charging -> 30s
        assertFalse(trip.row("CarType").selected) // Vehicle Config is excluded
    }

    @Test
    fun presetIdentifiersAreStableAndResolvable() {
        assertEquals(8, SignalPreset.ORDERED.size)
        val uniqueIds = SignalPreset.ORDERED.map { it.id }.toSet()
        assertEquals(SignalPreset.entries.size, uniqueIds.size)
        assertEquals(SignalPreset.Balanced, SignalPreset.fromId("balanced"))
        assertEquals(SignalPreset.TripLogger, SignalPreset.fromId("tripLogger"))
        assertEquals(SignalPreset.Balanced, SignalPreset.fromId("nonsense"))
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("signal-config-modal", SignalConfigModalRegistration.ID)
        assertEquals("SignalConfigModal", SignalConfigModalRegistration.SLUG)
    }

    @Test
    fun recordViewOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        SignalConfigModalDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "SignalConfigModal"), fields)
    }

    private companion object {
        fun sampleCategories(): List<SignalCategoryDef> =
            listOf(
                SignalCategoryDef("Driving", listOf("VehicleSpeed", "Gear")),
                SignalCategoryDef("Charging", listOf("ChargeState")),
                SignalCategoryDef("Vehicle Config", listOf("CarType")),
            )

        fun seedAll(): List<SignalConfig> = SignalConfigProjection.seed(sampleCategories(), emptyList(), 10)

        fun List<SignalConfig>.row(name: String): SignalConfig = first { it.name == name }
    }
}

package io.teslasync.android.featureviews.layoutswitcher

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the LayoutSwitcher's pure logic — the native analogue of the web component's
 * render derivation (web/src/features/dashboard/components/LayoutSwitcher.tsx): active-layout resolution
 * (`dashboards.find(id) ?? dashboards[0]`), the per-vehicle visible filter (`visible`), the pinned-label
 * fallback chain, the pin-toggle enablement/direction (`disabled` guard + `handlePinToggle`), the save-as
 * suggestion, and the empty guard (`visible.length === 0`). Runs in the :android:testReleaseUnitTest gate.
 */
class LayoutSwitcherProjectionTest {
    private val strings =
        LayoutSwitcherStrings(
            label = "Layout",
            switcherLabel = "Switch dashboard layout",
            untitled = "Untitled",
            modified = "modified",
            menuLabel = "Saved layouts",
            noneVisible = "No layouts available for this vehicle.",
            defaultBadge = "default",
            newFromCurrent = "New layout from current",
            pin = "Pin to current vehicle",
            unpin = "Unpin from vehicle",
            reset = "Reset to default",
            menuFooter = "Manage layouts in the tab strip below",
            editEnter = "Edit",
            editExit = "Done",
            editTitle = "Edit dashboard (E)",
            saveAs = "Save as new layout",
            saveAsShort = "Save as",
            saveAsPrompt = "Name for the new layout:",
            newLayoutDefault = "New Layout",
            resetTitle = "Reset dashboard to default?",
            resetMessage = "This removes all customizations.",
            resetConfirm = "Reset",
            cancel = "Cancel",
            close = "Close",
            loadingLabel = "Loading...",
            offlineLabel = "Offline",
            retry = "Retry",
        )

    private val global = SavedDashboardSummary(id = "default", name = "Overview", isDefault = true)
    private val trips = SavedDashboardSummary(id = "trips", name = "Trips")
    private val pinnedToOne = SavedDashboardSummary(id = "garage", name = "Garage", vehicleId = 1L)
    private val pinnedToTwo = SavedDashboardSummary(id = "track", name = "Track", vehicleId = 2L)
    private val dashboards = listOf(global, trips, pinnedToOne, pinnedToTwo)

    private fun project(
        activeId: String,
        context: SelectedVehicleContext,
    ): LayoutSwitcherModel = LayoutSwitcherProjection.project(dashboards, activeId, context, strings)

    // ── activeLayout (web `dashboards.find(id) ?? dashboards[0]`) ─────────────────

    @Test
    fun activeLayoutMatchesByIdThenFallsBackToFirstThenNull() {
        assertEquals(trips, LayoutSwitcherProjection.activeLayout(dashboards, "trips"))
        assertEquals(global, LayoutSwitcherProjection.activeLayout(dashboards, "missing"))
        assertNull(LayoutSwitcherProjection.activeLayout(emptyList(), "anything"))
    }

    // ── visibleLayouts (web `visible` filter) ─────────────────────────────────────

    @Test
    fun visibleHidesPinnedLayoutsWhenNoVehicleSelected() {
        val visible = LayoutSwitcherProjection.visibleLayouts(dashboards, selectedVehicleId = null)
        assertEquals(listOf(global, trips), visible)
    }

    @Test
    fun visibleShowsOnlyTheSelectedVehiclesPinnedLayoutsPlusGlobals() {
        val visible = LayoutSwitcherProjection.visibleLayouts(dashboards, selectedVehicleId = 1L)
        assertEquals(listOf(global, trips, pinnedToOne), visible)
        assertFalse(visible.contains(pinnedToTwo))
    }

    // ── project: active name + items ─────────────────────────────────────────────

    @Test
    fun projectResolvesActiveNameAndMarksTheActiveItem() {
        val model = project(activeId = "trips", context = SelectedVehicleContext(1L, "Model 3"))
        assertEquals("Trips", model.activeName)
        assertEquals("trips", model.activeId)
        val active = model.items.single { it.isActive }
        assertEquals("trips", active.id)
        assertTrue(model.items.first { it.id == "default" }.isDefault)
        assertTrue(model.items.first { it.id == "garage" }.isPinned)
    }

    @Test
    fun emptyDashboardsYieldUntitledAndEmptyAndDefaultSuggestion() {
        val model = LayoutSwitcherProjection.project(emptyList(), "x", SelectedVehicleContext.NONE, strings)
        assertEquals("Untitled", model.activeName)
        assertNull(model.activeId)
        assertTrue(model.isEmpty)
        assertEquals("New Layout", model.saveAsSuggestion)
        assertNull(model.pinnedLabel)
        assertFalse(model.canPinToggle)
    }

    @Test
    fun emptyWhenNoLayoutVisibleForVehicle() {
        // Only a layout pinned to another vehicle, no globals → nothing visible for vehicle 1.
        val model =
            LayoutSwitcherProjection.project(
                listOf(pinnedToTwo),
                activeId = "track",
                context = SelectedVehicleContext(1L, "Model 3"),
                strings,
            )
        assertTrue(model.isEmpty)
        assertTrue(model.items.isEmpty())
    }

    // ── project: pinned label (web `pinnedLabel`) ─────────────────────────────────

    @Test
    fun pinnedLabelShowsSelectedVehicleLabelWhenActiveIsPinned() {
        val model = project(activeId = "garage", context = SelectedVehicleContext(1L, "Model 3"))
        assertEquals("Model 3", model.pinnedLabel)
    }

    @Test
    fun pinnedLabelFallsBackToHashIdWhenLabelUnknown() {
        val model = project(activeId = "garage", context = SelectedVehicleContext(1L, label = null))
        assertEquals("#1", model.pinnedLabel)
    }

    @Test
    fun pinnedLabelNullWhenActiveNotPinnedOrNoVehicle() {
        assertNull(project(activeId = "default", context = SelectedVehicleContext(1L, "Model 3")).pinnedLabel)
        assertNull(project(activeId = "garage", context = SelectedVehicleContext.NONE).pinnedLabel)
    }

    // ── project: pin-toggle gating (web disabled guard + direction) ───────────────

    @Test
    fun pinToggleDisabledOnlyWhenActiveUnpinnedAndNoVehicle() {
        // Unpinned active + no vehicle → disabled (web `active.vehicleId == null && vehicleId == null`).
        assertFalse(project(activeId = "default", context = SelectedVehicleContext.NONE).canPinToggle)
        // A selected vehicle enables "pin to current".
        val canPin = project(activeId = "default", context = SelectedVehicleContext(1L, "Model 3"))
        assertTrue(canPin.canPinToggle)
        assertFalse(canPin.pinToggleIsUnpin)
    }

    @Test
    fun pinToggleEnablesUnpinWhenActiveIsPinnedEvenWithoutSelection() {
        val model = project(activeId = "garage", context = SelectedVehicleContext.NONE)
        assertTrue(model.canPinToggle)
        assertTrue(model.pinToggleIsUnpin)
        assertEquals(1L, model.activeVehicleId)
    }

    // ── project: save-as suggestion (web `suggestion`) ────────────────────────────

    @Test
    fun saveAsSuggestionUsesActiveNameWhenPresent() {
        assertEquals("Trips", project(activeId = "trips", context = SelectedVehicleContext.NONE).saveAsSuggestion)
    }
}

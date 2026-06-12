package io.teslasync.android.featureviews.layoutswitcher

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [LayoutSwitcherContent] across every state the surface
 * renders — the always-visible trigger, the dirty + pinned badges, the loading/offline scope chrome, the open
 * dropdown (layouts list, the empty branch, the save-as / pin / reset / footer items), and the web contract
 * flows: switching a layout fires `onSwitch`; "New layout from current" opens the name dialog and Create fires
 * `onCreate`/`onDuplicate`; reset opens the confirmation dialog and confirming fires `onReset`; the pin toggle
 * fires `onPinToVehicle`. Asserts the rendered i18n strings, the TalkBack content descriptions, and the
 * web-parity test tags. Runs under `connectedAndroidTest`. Mirrors the web spec
 * (web/src/features/dashboard/components/LayoutSwitcher.tsx).
 */
class LayoutSwitcherUiTest {
    @get:Rule
    val compose = createComposeRule()

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

    private val dashboards =
        listOf(
            SavedDashboardSummary(id = "default", name = "Overview", isDefault = true),
            SavedDashboardSummary(id = "trips", name = "Trips"),
            SavedDashboardSummary(id = "garage", name = "Garage", vehicleId = 1L),
        )

    private fun content(
        vehicleId: Long? = 1L,
        label: String? = "Model 3",
        phase: UiPhase = UiPhase.Content,
        stale: Boolean = false,
        errorKind: ErrorKind? = null,
    ): UiState<SelectedVehicleContext> =
        UiState(
            phase = phase,
            data = if (phase == UiPhase.Error) null else SelectedVehicleContext(vehicleId, label),
            stale = stale,
            errorKind = errorKind,
            fetchedAt = 1_700_000_000_000L,
        )

    private fun setContent(
        activeId: String = "default",
        dirty: Boolean = false,
        editMode: Boolean = false,
        vehicleState: UiState<SelectedVehicleContext> = content(),
        onSwitch: (String) -> Unit = {},
        onCreate: (String) -> Unit = {},
        onDuplicate: ((String) -> Unit)? = null,
        onReset: () -> Unit = {},
        onToggleEdit: (() -> Unit)? = {},
        onPinToVehicle: ((String, Long?) -> Unit)? = { _, _ -> },
        onRetryVehicles: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LayoutSwitcherContent(
                    dashboards = dashboards,
                    activeId = activeId,
                    dirty = dirty,
                    editMode = editMode,
                    vehicleState = vehicleState,
                    strings = strings,
                    onSwitch = onSwitch,
                    onCreate = onCreate,
                    onDuplicate = onDuplicate,
                    onReset = onReset,
                    onToggleEdit = onToggleEdit,
                    onPinToVehicle = onPinToVehicle,
                    onRetryVehicles = onRetryVehicles,
                )
            }
        }
    }

    // ── trigger + always-visible chrome ──────────────────────────────────────────

    @Test
    fun triggerIsAlwaysVisibleWithAccessibleSwitcherLabel() {
        setContent()
        compose.onNodeWithTag("layout-switcher-trigger").assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithContentDescription("Switch dashboard layout", substring = true).assertIsDisplayed()
    }

    @Test
    fun triggerAnnouncesTheActiveLayoutName() {
        setContent(activeId = "trips")
        compose.onNodeWithContentDescription("Trips", substring = true).assertIsDisplayed()
    }

    @Test
    fun dirtyShowsModifiedBadge() {
        setContent(dirty = true)
        compose.onNodeWithContentDescription("modified", substring = true).assertIsDisplayed()
    }

    @Test
    fun pinnedActiveLayoutShowsTheVehicleLabel() {
        setContent(activeId = "garage", vehicleState = content(vehicleId = 1L, label = "Model 3"))
        compose.onNodeWithContentDescription("Model 3", substring = true).assertIsDisplayed()
    }

    @Test
    fun inlineActionsExposeAccessibleLabels() {
        setContent(editMode = false)
        compose.onNodeWithContentDescription("Edit").assertIsDisplayed()
        compose.onNodeWithContentDescription("Save as new layout").assertIsDisplayed()
        compose.onNodeWithContentDescription("Reset to default").assertIsDisplayed()
    }

    @Test
    fun editToggleReflectsActiveStateLabel() {
        setContent(editMode = true)
        compose.onNodeWithContentDescription("Done").assertIsDisplayed()
    }

    // ── dropdown menu ─────────────────────────────────────────────────────────────

    @Test
    fun openingMenuListsTheVisibleLayoutsAndFooter() {
        setContent(vehicleState = content(vehicleId = 1L, label = "Model 3"))
        compose.onNodeWithTag("layout-switcher-trigger").performClick()
        // Query layout rows by their stable tags: the active layout name also appears in the trigger's
        // (merged) accessible text, so a by-text query would be ambiguous while the menu is open.
        compose.onNodeWithTag("layout-item-default").assertIsDisplayed()
        compose.onNodeWithTag("layout-item-trips").assertIsDisplayed()
        compose.onNodeWithTag("layout-item-garage").assertIsDisplayed()
        compose.onNodeWithText("Manage layouts in the tab strip below").assertIsDisplayed()
    }

    @Test
    fun pinnedLayoutHiddenWhenADifferentVehicleIsSelected() {
        setContent(vehicleState = content(vehicleId = 2L, label = "Model Y"))
        compose.onNodeWithTag("layout-switcher-trigger").performClick()
        compose.onNodeWithTag("layout-item-default").assertIsDisplayed()
        // "Garage" is pinned to vehicle 1, so it is not visible for vehicle 2.
        compose.onNodeWithTag("layout-item-garage").assertDoesNotExist()
    }

    @Test
    fun emptyVisibleListShowsTheFriendlyMessage() {
        val onlyPinnedElsewhere = listOf(SavedDashboardSummary(id = "track", name = "Track", vehicleId = 9L))
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LayoutSwitcherContent(
                    dashboards = onlyPinnedElsewhere,
                    activeId = "track",
                    dirty = false,
                    editMode = false,
                    vehicleState = content(vehicleId = 1L, label = "Model 3"),
                    strings = strings,
                    onSwitch = {},
                    onCreate = {},
                    onDuplicate = null,
                    onReset = {},
                    onToggleEdit = {},
                    onPinToVehicle = { _, _ -> },
                    onRetryVehicles = {},
                )
            }
        }
        compose.onNodeWithTag("layout-switcher-trigger").performClick()
        compose.onNodeWithText("No layouts available for this vehicle.").assertIsDisplayed()
    }

    @Test
    fun selectingALayoutFiresOnSwitchAndClosesMenu() {
        var switched: String? = null
        setContent(onSwitch = { switched = it })
        compose.onNodeWithTag("layout-switcher-trigger").performClick()
        compose.onNodeWithTag("layout-item-trips").performClick()
        assertEquals("trips", switched)
        compose.onNodeWithText("Manage layouts in the tab strip below").assertDoesNotExist()
    }

    // ── save-as flow (web window.prompt → dialog) ─────────────────────────────────

    @Test
    fun newLayoutFromCurrentOpensNameDialogAndCreateFiresOnCreate() {
        var created: String? = null
        setContent(activeId = "trips", onCreate = { created = it }, onDuplicate = null)
        compose.onNodeWithTag("layout-switcher-trigger").performClick()
        compose.onNodeWithText("New layout from current").performClick()
        compose.onNodeWithText("Save as new layout").assertIsDisplayed()
        // Pre-filled with the active layout name; confirm without editing.
        compose.onNodeWithText("Save as").performClick()
        assertEquals("Trips", created)
    }

    @Test
    fun saveAsWithDuplicateHandlerFiresOnDuplicateWithActiveId() {
        var duplicated: String? = null
        var created: String? = null
        setContent(activeId = "trips", onCreate = { created = it }, onDuplicate = { duplicated = it })
        compose.onNodeWithContentDescription("Save as new layout").performClick()
        compose.onNodeWithText("Save as").performClick()
        assertEquals("trips", duplicated)
        assertNull(created)
    }

    // ── reset flow (web useConfirm) ───────────────────────────────────────────────

    @Test
    fun resetOpensConfirmationAndConfirmingFiresOnReset() {
        var reset = false
        setContent(onReset = { reset = true })
        compose.onNodeWithContentDescription("Reset to default").performClick()
        compose.onNodeWithText("Reset dashboard to default?").assertIsDisplayed()
        compose.onNodeWithText("Reset").performClick()
        assertEquals(true, reset)
    }

    @Test
    fun resetCancelDoesNotFireOnReset() {
        var reset = false
        setContent(onReset = { reset = true })
        compose.onNodeWithContentDescription("Reset to default").performClick()
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(false, reset)
    }

    // ── pin / unpin toggle ────────────────────────────────────────────────────────

    @Test
    fun unpinFiresOnPinToVehicleWithNull() {
        var pinnedId: String? = null
        var pinnedTo: Long? = -1L
        setContent(
            activeId = "garage",
            vehicleState = content(vehicleId = 1L, label = "Model 3"),
            onPinToVehicle = { id, vid ->
                pinnedId = id
                pinnedTo = vid
            },
        )
        compose.onNodeWithTag("layout-switcher-trigger").performClick()
        compose.onNodeWithText("Unpin from vehicle").performClick()
        assertEquals("garage", pinnedId)
        assertNull(pinnedTo)
    }

    @Test
    fun pinFiresOnPinToVehicleWithSelectedVehicle() {
        var pinnedTo: Long? = null
        setContent(
            activeId = "default",
            vehicleState = content(vehicleId = 1L, label = "Model 3"),
            onPinToVehicle = { _, vid -> pinnedTo = vid },
        )
        compose.onNodeWithTag("layout-switcher-trigger").performClick()
        compose.onNodeWithText("Pin to current vehicle").performClick()
        assertEquals(1L, pinnedTo)
    }

    // ── lifecycle states ──────────────────────────────────────────────────────────

    @Test
    fun offlineScopeShowsTheFreshnessChip() {
        setContent(vehicleState = content(stale = true, errorKind = ErrorKind.Network))
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun errorScopeOffersInlineRetryInTheMenu() {
        var retried = false
        setContent(
            vehicleState = content(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetryVehicles = { retried = true },
        )
        compose.onNodeWithTag("layout-switcher-trigger").performClick()
        compose.onNodeWithText("Retry").performClick()
        assertEquals(true, retried)
    }

    @Test
    fun loadingScopeStillRendersTheTrigger() {
        setContent(vehicleState = UiState.loading())
        compose.onNodeWithTag("layout-switcher-trigger").assertIsDisplayed()
    }

    @Test
    fun staleScopeAutoRefreshes() {
        var refreshed = false
        setContent(vehicleState = content(stale = true), onRetryVehicles = { refreshed = true })
        compose.waitForIdle()
        assertEquals(true, refreshed)
    }
}

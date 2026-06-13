// Instrumented Compose UI + accessibility verification of [TreeSelectContent] across the states the web
// TreeSelect renders: the loading skeleton chrome, the resolved tree (group headers + leaves), the
// empty-catalog row (the localized `translation_common_noData` label), the search "no results" row (the
// `translation_combobox_noResults` label), the hard-error `QueryError`, and the accessible labels TalkBack
// reads on the surface, the select-all control, and a disabled leaf (its reason folded into the row
// description). Runs under `connectedAndroidTest` (a device/emulator); the offline gate's
// `testReleaseUnitTest` covers the pure model + the view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.treeselect

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.forms.TreeGroup
import io.teslasync.android.components.forms.TreeLeaf
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class TreeSelectUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun contentStateRendersGroupsAndExpandedLeaves() {
        setContent(model(content(), selected = setOf("speed"), expanded = setOf("powertrain")))
        compose.onNodeWithTag(TREE_SELECT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(POWERTRAIN, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(SPEED, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun loadingStateRendersSurfaceChrome() {
        setContent(model(UiState.loading()))
        compose.onNodeWithTag(TREE_SELECT_TEST_TAG).assertIsDisplayed()
    }

    @Test
    fun emptyCatalogShowsFriendlyRow() {
        setContent(model(UiState(UiPhase.Empty, emptyList())))
        compose.onNodeWithText(NO_DATA, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun searchWithNoMatchesShowsNoResultsRow() {
        setContent(model(content(), search = "zzz"))
        compose.onNodeWithText(NO_RESULTS, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsQueryError() {
        setContent(model(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = SERVER_ERROR)))
        compose.onNodeWithText(SERVER_ERROR_TITLE, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun accessibilityLabelsArePresentOnInteractiveElements() {
        setContent(
            model(
                content(),
                expanded = setOf("powertrain"),
                disabled = setOf("torque"),
                reasons = mapOf("torque" to DISABLED_REASON),
            ),
        )
        // The surface carries its accessible name (web `ariaLabel`).
        compose.onNodeWithContentDescription(LABEL, useUnmergedTree = true).assertIsDisplayed()
        // The select-all control is labeled.
        compose.onNodeWithText(SELECT_ALL, useUnmergedTree = true).assertIsDisplayed()
        // The group checkbox is named for TalkBack.
        compose.onNodeWithContentDescription(POWERTRAIN, useUnmergedTree = true).assertIsDisplayed()
        // The disabled leaf folds its reason into the spoken description.
        compose.onNodeWithContentDescription(DISABLED_DESCRIPTION, useUnmergedTree = true).assertIsDisplayed()
    }

    @Composable
    private fun setContent(uiModel: TreeSelectUiModel) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) {
                    TreeSelectContent(model = uiModel, label = LABEL)
                }
            }
        }
    }

    private fun content(): UiState<List<TreeGroup>> = UiState(UiPhase.Content, catalog(), fetchedAt = STAMP)

    private fun model(
        state: UiState<List<TreeGroup>>,
        selected: Set<String> = emptySet(),
        search: String = "",
        expanded: Set<String> = emptySet(),
        disabled: Set<String> = emptySet(),
        reasons: Map<String, String> = emptyMap(),
    ): TreeSelectUiModel =
        TreeSelectProjection.project(
            state = state,
            interaction =
                TreeSelectInteraction(
                    selectedIds = selected,
                    searchQuery = search,
                    expandedIds = expanded,
                    disabledIds = disabled,
                    disabledReasons = reasons,
                ),
        )

    private fun catalog(): List<TreeGroup> =
        listOf(
            TreeGroup(
                id = "powertrain",
                label = POWERTRAIN,
                leaves = listOf(TreeLeaf("speed", SPEED), TreeLeaf("torque", "Drive torque")),
            ),
            TreeGroup("battery", "Battery", listOf(TreeLeaf("soc", "State of charge"))),
        )

    private companion object {
        const val LABEL = "Signals"
        const val POWERTRAIN = "Powertrain"
        const val SPEED = "Vehicle speed"
        const val DISABLED_REASON = "Not streamed by this vehicle"
        const val DISABLED_DESCRIPTION = "Drive torque, Not streamed by this vehicle"
        const val STAMP = 1_700_000_000_000L
        const val SERVER_ERROR = 503

        // en catalog / shared-component values resolved on-device.
        const val NO_DATA = "No data available"
        const val NO_RESULTS = "No results"
        const val SELECT_ALL = "Select all"
        const val SERVER_ERROR_TITLE = "Server error"

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 640.dp
    }
}

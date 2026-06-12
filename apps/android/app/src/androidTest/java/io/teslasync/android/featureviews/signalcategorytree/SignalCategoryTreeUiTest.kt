// Instrumented Compose UI + accessibility verification of [SignalCategoryTreeContent] across every branch
// the web component renders (search field always present, category tree with expanded leaves, empty,
// no-results) plus the lifecycle chrome the host's feed implies (loading skeleton / hard error with retry).
// Verifies the always-present search field, the per-group label + expanded leaves, the non-numeric kind
// chip, the group expand control + selection checkbox accessible labels, and the loading skeleton's TalkBack
// label. Runs under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest`
// covers the pure projection + lifecycle classifier.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalcategorytree

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.signals.SignalKind
import kotlinx.coroutines.flow.emptyFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class SignalCategoryTreeUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        SignalCategoryTreeStrings(
            searchHint = "Search signals\u2026",
            searchClear = "Clear",
            catalogLabel = "Signal Catalog",
            emptyMessage = "No signals in catalog",
            noResults = "No matching signals",
            loadingLabel = "Loading",
            categoryLabels = mapOf("charging" to "Charging", "driving" to "Driving"),
        )

    private fun catalog(): SignalCatalog =
        SignalCatalog(
            groups =
                listOf(
                    SignalCategoryGroup(
                        categoryId = "charging",
                        leaves =
                            listOf(
                                SignalLeaf("ChargeState", SignalKind.String),
                                SignalLeaf("ChargerPower", SignalKind.Float),
                            ),
                    ),
                    SignalCategoryGroup(
                        categoryId = "driving",
                        leaves = listOf(SignalLeaf("VehicleSpeed", SignalKind.Float)),
                    ),
                ),
        )

    private fun setContent(
        state: UiState<SignalCatalog>,
        search: String = "",
        selected: Set<String> = emptySet(),
        expanded: Set<String> = emptySet(),
        showSparklines: Boolean = false,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    SignalCategoryTreeContent(
                        state = state,
                        strings = strings,
                        search = search,
                        onSearchChange = {},
                        selected = selected,
                        onToggleLeaf = {},
                        onToggleGroup = {},
                        expanded = expanded,
                        onToggleExpand = {},
                        showSparklines = showSparklines,
                        sparklineFeed = { _ -> emptyFlow() },
                        onRetry = onRetry,
                    )
                }
            }
        }
    }

    @Test
    fun searchFieldIsAlwaysVisible() {
        setContent(UiState(UiPhase.Content, data = catalog(), fetchedAt = 1L))
        compose.onNodeWithText(strings.searchHint).assertIsDisplayed()
    }

    @Test
    fun contentShowsCategoryHeaderAndExpandedLeaves() {
        setContent(UiState(UiPhase.Content, data = catalog(), fetchedAt = 1L), expanded = setOf("driving"))
        compose.onNodeWithText("Driving").assertIsDisplayed()
        compose.onNodeWithText("VehicleSpeed").assertIsDisplayed()
    }

    @Test
    fun groupExpandControlExposesAccessibleLabel() {
        setContent(UiState(UiPhase.Content, data = catalog(), fetchedAt = 1L))
        // The chevron expand control carries the category label as its TalkBack description.
        compose.onNodeWithContentDescription("Charging").assertIsDisplayed()
    }

    @Test
    fun leafCheckboxIsAnAccessibleToggle() {
        setContent(UiState(UiPhase.Content, data = catalog(), fetchedAt = 1L), expanded = setOf("driving"))
        compose.onNodeWithText("VehicleSpeed").assertHasClickAction()
    }

    @Test
    fun nonNumericLeafShowsKindChip() {
        setContent(
            UiState(UiPhase.Content, data = catalog(), fetchedAt = 1L),
            expanded = setOf("charging"),
            showSparklines = true,
        )
        // ChargeState is a string-kind signal → the compact "(kind)" chip, not a sparkline.
        compose.onNodeWithText("string").assertIsDisplayed()
    }

    @Test
    fun emptyCatalogShowsEmptyState() {
        setContent(UiState(UiPhase.Empty, data = SignalCatalog.EMPTY, fetchedAt = 1L))
        compose.onNodeWithText(strings.emptyMessage).assertIsDisplayed()
    }

    @Test
    fun searchWithNoMatchesShowsNoResults() {
        setContent(UiState(UiPhase.Content, data = catalog(), fetchedAt = 1L), search = "zzzznomatch")
        compose.onNodeWithText(strings.noResults).assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeleton() {
        setContent(UiState.loading())
        compose.onNodeWithContentDescription(strings.loadingLabel).assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsRetryAffordance() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Retry").assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
    }
}

package io.teslasync.android.dashboard.widgets

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the Vehicle Specs surface — every state from the web source rendered
 * on a device (connectedAndroidTest): loading skeleton, outer empty, hard error + retry, standard
 * content (title + detail rows + option chip + refresh), the compact Model/Trim branch, and the
 * stale/offline content path. The pure projection/state-machine logic is covered no-device by
 * [VehicleSpecsWidgetTest]; these assert the surfaces render their copy and expose accessible names.
 * Strings resolve from the real i18n catalog.
 */
class VehicleSpecsWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun fullData(): VehicleSpecsData =
        VehicleSpecsData(
            specs =
                buildJsonObject {
                    put("car_type", "Model 3")
                    put("trim_badging", "Long Range")
                    put("exterior_color", "Pearl White")
                    put("wheel_type", "Aero 18")
                    put("interior", "Black")
                    put("aux_battery_type", "Li-ion")
                },
            options = buildJsonObject { put("\$MTY07", "Mid Range Battery") },
            config = buildJsonObject { put("version", "2024.8.9") },
        )

    private fun compactData(): VehicleSpecsData =
        VehicleSpecsData(
            specs =
                buildJsonObject {
                    put("car_type", "Model 3")
                    put("trim_badging", "Plaid")
                },
            options = null,
            config = null,
        )

    private fun render(
        state: UiState<VehicleSpecsData>,
        size: VehicleSpecsSize = VehicleSpecsSize(2, 4),
        onRetry: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme {
                Host {
                    VehicleSpecsWidgetContent(state = state, size = size, onRetry = onRetry)
                }
            }
        }
    }

    @Test
    fun loadingStateExposesAccessibleSurfaceLabel() {
        render(UiState(UiPhase.Loading))
        rule.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsNoSpecsMessage() {
        render(UiState(UiPhase.Empty, data = VehicleSpecsData.EMPTY, fetchedAt = 0L))
        rule.onNodeWithText("No specs available").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresIt() {
        var retried = false
        render(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        rule.onNodeWithText("Can't reach server").assertIsDisplayed()
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun contentStateShowsTitleEntriesAndRefresh() {
        render(UiState(UiPhase.Content, data = fullData(), fetchedAt = NOW))
        rule.onNodeWithText("Vehicle Specs").assertIsDisplayed()
        rule.onNodeWithText("Model").assertIsDisplayed()
        rule.onNodeWithText("Model 3").assertIsDisplayed()
        rule.onNodeWithText("Car Version").assertIsDisplayed()
        // The only interactive element carries a screen-reader name.
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun contentStateShowsDecodedOptionChip() {
        render(UiState(UiPhase.Content, data = fullData(), fetchedAt = NOW))
        rule.onNodeWithText("Mid Range Battery").assertIsDisplayed()
        rule.onNodeWithText("Option").assertIsDisplayed()
    }

    @Test
    fun compactStateShowsModelWithoutTitle() {
        render(UiState(UiPhase.Content, data = compactData(), fetchedAt = NOW), size = VehicleSpecsSize(1, 2))
        rule.onNodeWithText("Model 3").assertIsDisplayed()
        rule.onNodeWithText("Trim: Plaid").assertIsDisplayed()
        rule.onNodeWithText("Vehicle Specs").assertDoesNotExist()
    }

    @Test
    fun staleOfflineStateStillRendersContent() {
        render(
            UiState(
                phase = UiPhase.Content,
                data = fullData(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        rule.onNodeWithText("Model").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_700_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 720.dp
    }
}

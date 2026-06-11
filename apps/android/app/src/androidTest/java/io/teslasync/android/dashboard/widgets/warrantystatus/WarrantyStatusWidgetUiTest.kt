package io.teslasync.android.dashboard.widgets.warrantystatus

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [WarrantyStatusWidgetContent] across every state the
 * web component renders (loading skeleton, hard error + retry, standard bars + detail rows, compact
 * days-remaining hero, no-data empty, stale/offline cached). Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the projection/fold logic, this covers the render + a11y.
 */
class WarrantyStatusWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val default = WarrantyStatusRegistration.DEFAULT_SIZE
    private val compact = WarrantyStatusSize(cols = 1, rows = 2)
    private val prefs = WarrantyStatusDisplayPrefs.METRIC_DEFAULT

    @Test
    fun loadingShowsSkeletonNotContent() {
        setContent(UiState.loading())
        rule.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
        rule.onNodeWithText("No warranty data").assertDoesNotExist()
        rule.onNodeWithText("Warranty Status").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoWarrantyData() {
        setContent(UiState(phase = UiPhase.Empty, data = envelope(null), fetchedAt = NOW))
        rule.onNodeWithText("No warranty data").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsTitleBarsAndRows() {
        setContent(UiState(phase = UiPhase.Content, data = envelope(fullDoc()), fetchedAt = NOW))
        rule.onNodeWithText("Warranty Status").assertIsDisplayed()
        // Each detail row folds its label + value + badge into one TalkBack phrase.
        rule.onNodeWithContentDescription("Expiry Date", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Active", substring = true).assertIsDisplayed()
        // The two progress bars expose their localized labels.
        rule.onNodeWithText("Time Remaining").assertIsDisplayed()
        rule.onNodeWithText("Mileage Remaining").assertIsDisplayed()
    }

    @Test
    fun compactShowsDaysHeroWithoutTitle() {
        setContent(UiState(phase = UiPhase.Content, data = envelope(fullDoc()), fetchedAt = NOW), size = compact)
        rule.onNodeWithText("Warranty Status").assertDoesNotExist()
        rule.onNodeWithContentDescription("days left", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = envelope(fullDoc()),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        rule.onNodeWithContentDescription("Expiry Date", substring = true).assertIsDisplayed()
    }

    @Test
    fun refreshControlExposesAccessibilityLabel() {
        setContent(UiState(phase = UiPhase.Content, data = envelope(fullDoc()), fetchedAt = NOW))
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    private fun setContent(
        state: UiState<JsonElement>,
        size: WarrantyStatusSize = default,
        onRefresh: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WarrantyStatusWidgetContent(
                    state = state,
                    prefs = prefs,
                    size = size,
                    onRefresh = onRefresh,
                    nowMillis = NOW,
                )
            }
        }
    }

    private fun fullDoc(): JsonObject =
        buildJsonObject {
            put("warranty_start_date", "2021-06-01")
            put("warranty_expiry_date", "2025-06-01")
            put("mileage_limit_mi", 80_467.0)
            put("current_mileage_mi", 32_186.0)
        }

    private fun envelope(data: JsonObject?): JsonElement = buildJsonObject { put("data", data ?: JsonNull) }

    private companion object {
        /** Fixed clock — 2024-01-01T00:00:00Z (517 days before the sample expiry ⇒ Active). */
        const val NOW: Long = 1_704_067_200_000L
    }
}

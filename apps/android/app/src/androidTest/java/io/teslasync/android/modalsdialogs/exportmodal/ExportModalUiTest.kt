// Instrumented Compose UI + accessibility verification of the ExportModal surface across the branches the web
// component renders (web/src/features/dashboard/components/ExportModal.tsx): the dashboard summary (mini-grid +
// name + count/size chips + "Updated …" line), the three stacked export actions (Download / Copy to clipboard /
// Copy shareable URL), the empty-layout branch (web `dashboard.widgets.length === 0`), the download hand-off
// (web `handleDownload` -> onDownload + onClose), and the share-URL-too-long branch (web `shareUrlTooLong` — the
// share action disables and the `export.urlTooLong` warning banner appears). Every asserted label is the
// localized copy the surface exposes to TalkBack. Runs under `connectedAndroidTest`; the offline
// `testReleaseUnitTest` gate covers the pure projection.
package io.teslasync.android.modalsdialogs.exportmodal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ExportModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        miniGrid: MiniGrid = POPULATED_GRID,
        widgetCountLabel: String = WIDGET_COUNT,
        shareUrlTooLong: Boolean = false,
        shareErrorMessage: String? = null,
        onDownload: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ExportModalContent(
                        dashboardName = DASHBOARD_NAME,
                        widgetCountLabel = widgetCountLabel,
                        jsonSizeLabel = JSON_SIZE,
                        updatedLabel = UPDATED,
                        miniGrid = miniGrid,
                        downloadLabel = DOWNLOAD,
                        copyClipboardLabel = COPY_CLIPBOARD,
                        copiedLabel = COPIED,
                        copyShareUrlLabel = COPY_SHARE_URL,
                        urlCopiedLabel = URL_COPIED,
                        dashboardJson = "{}",
                        shareUrl = SHARE_URL,
                        shareUrlTooLong = shareUrlTooLong,
                        shareErrorMessage = shareErrorMessage,
                        onDownload = onDownload,
                    )
                }
            }
        }
    }

    @Test
    fun summaryAndActionsRenderWithAccessibleNames() {
        setContent()
        compose.onNodeWithTag(ExportModalTestTags.SUMMARY).assertIsDisplayed()
        compose.onNodeWithTag(ExportModalTestTags.MINI_GRID).assertIsDisplayed()
        compose.onNodeWithText(DASHBOARD_NAME).assertIsDisplayed()
        compose.onNodeWithText(WIDGET_COUNT).assertIsDisplayed()
        compose.onNodeWithText(JSON_SIZE).assertIsDisplayed()
        compose.onNodeWithText(UPDATED).assertIsDisplayed()
        compose.onNodeWithText(DOWNLOAD).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(COPY_CLIPBOARD).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(COPY_SHARE_URL).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun emptyLayoutStillRendersSummaryWithZeroWidgets() {
        setContent(miniGrid = EMPTY_GRID, widgetCountLabel = ZERO_WIDGETS)
        compose.onNodeWithTag(ExportModalTestTags.MINI_GRID).assertIsDisplayed()
        compose.onNodeWithText(ZERO_WIDGETS).assertIsDisplayed()
        compose.onNodeWithText(DOWNLOAD).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun downloadInvokesTheDownloadHandler() {
        var downloaded = false
        setContent(onDownload = { downloaded = true })
        compose.onNodeWithText(DOWNLOAD).performClick()
        assertTrue("tapping Download must invoke the download hand-off", downloaded)
    }

    @Test
    fun shareUrlActionIsEnabledWhenWithinTheCeiling() {
        setContent(shareUrlTooLong = false)
        compose.onNodeWithText(COPY_SHARE_URL).assertIsEnabled()
        compose.onNodeWithTag(ExportModalTestTags.SHARE_WARNING).assertDoesNotExist()
    }

    @Test
    fun shareUrlTooLongDisablesTheActionAndShowsTheWarning() {
        setContent(shareUrlTooLong = true, shareErrorMessage = WARNING)
        compose.onNodeWithText(COPY_SHARE_URL).assertIsNotEnabled()
        compose.onNodeWithTag(ExportModalTestTags.SHARE_WARNING).assertIsDisplayed()
        compose.onNodeWithText(WARNING).assertIsDisplayed()
        // The clipboard + download actions stay available even when URL sharing is blocked.
        compose.onNodeWithText(DOWNLOAD).assertIsEnabled()
        compose.onNodeWithText(COPY_CLIPBOARD).assertIsEnabled()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val DASHBOARD_NAME = "Daily Driver Overview"
        const val WIDGET_COUNT = "4 widgets"
        const val ZERO_WIDGETS = "0 widgets"
        const val JSON_SIZE = "1.2 KB"
        const val UPDATED = "Updated Jun 12, 2026"
        const val DOWNLOAD = "Download JSON File"
        const val COPY_CLIPBOARD = "Copy to Clipboard"
        const val COPIED = "Copied!"
        const val COPY_SHARE_URL = "Copy Shareable URL"
        const val URL_COPIED = "URL Copied!"
        const val SHARE_URL = "https://app.teslasync.io/dashboard#import=eyJ9"
        const val WARNING = "Layout too large for URL sharing (2480 chars). Use clipboard or file export instead."

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp

        val POPULATED_GRID: MiniGrid =
            ExportModalProjection.miniGrid(
                SavedDashboard(
                    id = "dash-1",
                    name = DASHBOARD_NAME,
                    widgets =
                        listOf(
                            WidgetInstance("w-1", "battery-health"),
                            WidgetInstance("w-2", "range-estimate"),
                        ),
                    layouts =
                        mapOf(
                            "lg" to
                                listOf(
                                    LayoutItem("w-1", x = 0, y = 0, w = 2, h = 2),
                                    LayoutItem("w-2", x = 2, y = 0, w = 2, h = 2),
                                ),
                        ),
                ),
            )

        val EMPTY_GRID: MiniGrid = ExportModalProjection.miniGrid(SavedDashboard(id = "empty", name = "Empty"))
    }
}

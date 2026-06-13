// Instrumented Compose UI + accessibility verification of [ImportPreviewModalBody] across the branches the web
// component renders: the three-tab input form (every tab + the drop-zone's accessible label, the blank-input submit
// guards), the parse-error banner, the validation preview (dashboard summary, the per-widget availability list, and
// the Back/Import actions), and the "cannot preview" empty state (Import hidden). Runs under `connectedAndroidTest`
// (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.importpreviewmodal

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ImportPreviewModalUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val noopLogger =
        object : Logger {
            override fun log(
                level: LogLevel,
                event: String,
                fields: Map<String, String>,
            ) = Unit
        }

    private val strings =
        ImportPreviewStrings(
            title = "Import Dashboard",
            preview = "Import Preview",
            fromFile = "From File",
            fromClipboard = "Paste JSON",
            fromUrl = "From URL",
            dropFile = "Drop a .json file here or click to browse",
            browse = "Browse Files",
            fileInput = "Dashboard JSON file",
            validate = "Validate & Preview",
            loadUrl = "Load from URL",
            widgets = "Widgets",
            notAvailable = "Not available",
            cannotPreview = "Cannot preview this layout",
            back = "Back",
            confirm = "Import Dashboard",
            close = "Close",
            emptyInput = "No data to validate",
            readError = "Failed to read file",
            invalidFileType = "Please drop a .json file",
            noImportParam = "URL does not contain an import parameter",
            invalidUrl = "Invalid URL format",
            availableCount = { count -> "$count widgets" },
            missingCount = { count -> "$count skipped" },
        )

    private val validDashboard =
        SavedDashboardImport(
            id = "import-1",
            name = "Road-Trip Dashboard",
            widgets = listOf(ImportWidgetInstance(id = "w-1", widgetId = "battery-gauge")),
            layouts = mapOf("lg" to listOf(RglLayoutItem(i = "w-1", x = 0, y = 0, w = 2, h = 1))),
            createdAt = "2026-01-15T00:00:00Z",
            updatedAt = "2026-01-15T00:00:00Z",
        )

    private val validResult =
        ImportValidation(
            isValid = true,
            errors = emptyList(),
            warnings = listOf("1 widget(s) not available and will be skipped"),
            dashboard = validDashboard,
            missingWidgets = listOf("legacy-map"),
            availableWidgets = listOf("battery-gauge"),
        )

    private val unrebuildableResult =
        ImportValidation(
            isValid = false,
            errors = listOf("No compatible widgets found in this layout"),
            warnings = emptyList(),
            dashboard = null,
            missingWidgets = listOf("legacy-map"),
            availableWidgets = emptyList(),
        )

    private fun setBody(
        validation: ImportValidation? = null,
        parseError: String? = null,
        onValidate: (String) -> Unit = {},
        onLoadUrl: (String) -> Unit = {},
        onBrowse: () -> Unit = {},
        onConfirm: (SavedDashboardImport) -> Unit = {},
        onBack: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ImportPreviewModalBody(
                        strings = strings,
                        validation = validation,
                        parseError = parseError,
                        onValidate = onValidate,
                        onLoadUrl = onLoadUrl,
                        onBrowse = onBrowse,
                        onConfirm = onConfirm,
                        onBack = onBack,
                        nameForWidget = { id -> id },
                        logger = noopLogger,
                    )
                }
            }
        }
    }

    @Test
    fun inputForm_showsEveryTabAndTheDropZone() {
        setBody()
        compose.onNodeWithText(strings.fromFile).assertIsDisplayed()
        compose.onNodeWithText(strings.fromClipboard).assertIsDisplayed()
        compose.onNodeWithText(strings.fromUrl).assertIsDisplayed()
        compose.onNodeWithText(strings.dropFile).assertIsDisplayed()
        compose.onNodeWithText(strings.browse).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun fileTab_dropZoneExposesItsAccessibleLabel() {
        setBody()
        compose.onNodeWithContentDescription(strings.fileInput).assertIsDisplayed()
    }

    @Test
    fun pasteTab_validateGuardsBlankThenHandsBackTypedJson() {
        var validated: String? = null
        setBody(onValidate = { validated = it })

        compose.onNodeWithText(strings.fromClipboard).performClick()
        compose.onNodeWithText(strings.validate).assertIsNotEnabled()

        compose.onNodeWithTag(ImportPreviewModalTestTags.PASTE_INPUT).performTextInput("{\"name\":\"D\"}")
        compose.onNodeWithText(strings.validate).assertIsEnabled().performClick()

        assertEquals("{\"name\":\"D\"}", validated)
    }

    @Test
    fun urlTab_loadGuardsBlankThenHandsBackTypedUrl() {
        var loaded: String? = null
        setBody(onLoadUrl = { loaded = it })

        compose.onNodeWithText(strings.fromUrl).performClick()
        compose.onNodeWithText(strings.loadUrl).assertIsNotEnabled()

        compose.onNodeWithTag(ImportPreviewModalTestTags.URL_INPUT).performTextInput("https://x.io/d#import=abc")
        compose.onNodeWithText(strings.loadUrl).assertIsEnabled().performClick()

        assertEquals("https://x.io/d#import=abc", loaded)
    }

    @Test
    fun parseError_isShownInABanner() {
        setBody(parseError = strings.invalidUrl)
        compose.onNodeWithText(strings.invalidUrl).assertIsDisplayed()
    }

    @Test
    fun preview_showsSummaryWidgetsAndImportAction() {
        var confirmed: SavedDashboardImport? = null
        setBody(validation = validResult, onConfirm = { confirmed = it })

        compose.onNodeWithText(validDashboard.name).assertIsDisplayed()
        compose.onNodeWithText(strings.availableCount(1)).assertIsDisplayed()
        compose.onNodeWithText("battery-gauge").assertIsDisplayed()
        compose.onNodeWithText(strings.notAvailable).assertIsDisplayed()
        compose.onNodeWithText(strings.back).assertIsDisplayed()

        compose.onNodeWithText(strings.confirm).assertIsDisplayed().performClick()
        assertEquals(validDashboard.id, confirmed?.id)
    }

    @Test
    fun preview_cannotRebuild_showsEmptyStateAndHidesImport() {
        setBody(validation = unrebuildableResult)
        compose.onNodeWithText(strings.cannotPreview).assertIsDisplayed()
        compose.onNodeWithText(strings.back).assertIsDisplayed()
        compose.onAllNodesWithText(strings.confirm).assertCountEquals(0)
    }

    @Test
    fun preview_backInvokesCallback() {
        var backed = false
        setBody(validation = validResult, onBack = { backed = true })
        compose.onNodeWithText(strings.back).performClick()
        assertTrue(backed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 460.dp
        val HOST_HEIGHT = 1000.dp
    }
}

package io.teslasync.android.sharedsurfaces.listexportmenu

import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the ListExportMenu shared surface across every render
 * branch the web component shows (web/src/components/forms/ListExportMenu.tsx): the ready trigger and its
 * "Export list" accessibility label, the disabled trigger and its "No data to export" label, the open menu
 * without a scope chooser (no selection — only the CSV / JSON rows), the open menu with the scope chooser (a
 * selection — "Visible (N)" / "Selected (M)" radios), and the export dispatch carrying the chosen scope. Asserts
 * the rendered i18n strings and the TalkBack content descriptions on the interactive elements. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure reducers, this covers the render.
 */
class ListExportMenuUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    @Test
    fun readyTriggerExposesTheExportListLabelAndIsClickable() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ListExportMenu(onExportCsv = {}, onExportJson = {}, visibleCount = 40, logger = NoopLogger)
            }
        }

        compose
            .onNodeWithContentDescription("Export list")
            .assertIsDisplayed()
            .assertHasClickAction()
    }

    @Test
    fun disabledTriggerExposesTheNoDataLabelAndIsDisabled() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ListExportMenu(onExportCsv = {}, onExportJson = {}, disabled = true, logger = NoopLogger)
            }
        }

        compose
            .onNodeWithContentDescription("No data to export")
            .assertIsDisplayed()
            .assertIsNotEnabled()
    }

    @Test
    fun openingWithoutSelectionShowsBothFormatsAndHidesTheScopeChooser() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ListExportMenu(onExportCsv = {}, onExportJson = {}, visibleCount = 128, logger = NoopLogger)
            }
        }

        compose.onNodeWithContentDescription("Export list").performClick()

        compose.onNodeWithText("Download as CSV").assertIsDisplayed()
        compose.onNodeWithText("Download as JSON").assertIsDisplayed()
        // No selection ⇒ the web omits the <fieldset>; the scope chooser must not render.
        compose.onNodeWithText("Export scope").assertDoesNotExist()
    }

    @Test
    fun openingWithSelectionShowsTheScopeChooserWithCounts() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ListExportMenu(
                    onExportCsv = {},
                    onExportJson = {},
                    selectedCount = 12,
                    visibleCount = 128,
                    logger = NoopLogger,
                )
            }
        }

        compose.onNodeWithContentDescription("Export list").performClick()

        compose.onNodeWithText("Export scope").assertIsDisplayed()
        compose.onNodeWithText("Visible (128)").assertIsDisplayed()
        compose.onNodeWithText("Selected (12)").assertIsDisplayed()
    }

    @Test
    fun selectingCsvExportsTheChosenScope() {
        var csvScope: ExportScope? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ListExportMenu(
                    onExportCsv = { csvScope = it },
                    onExportJson = {},
                    selectedCount = 12,
                    visibleCount = 128,
                    logger = NoopLogger,
                )
            }
        }

        compose.onNodeWithContentDescription("Export list").performClick()
        // A non-empty selection defaults the scope to "Selected"; exporting CSV must carry it.
        compose.onNodeWithText("Download as CSV").performClick()

        compose.runOnIdle { assertEquals(ExportScope.Selected, csvScope) }
    }
}

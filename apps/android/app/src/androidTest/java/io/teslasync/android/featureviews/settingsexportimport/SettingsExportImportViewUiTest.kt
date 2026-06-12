package io.teslasync.android.featureviews.settingsexportimport

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportResult
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportSectionResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the SettingsExportImport surface across every state it
 * renders: the idle panel (header + export + drop zone), the exporting/parsing busy affordances, the inline
 * intake error, the dry-run preview (per-section diff + Apply/Cancel/Change-file), the "nothing to apply"
 * disabled apply, and the applied result. Every interactive element is asserted via its accessible text label.
 * The gate's `testReleaseUnitTest` covers the pure logic + view-model; this covers render + a11y. Mirrors the
 * web spec (web/src/features/settings/components/SettingsExportImport.tsx).
 */
class SettingsExportImportViewUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun preview(
        added: Int = 2,
        updated: Int = 3,
        skipped: Int = 4,
    ): SettingsImportResult =
        SettingsImportResult(
            dryRun = true,
            sections =
                mapOf(
                    "settings" to SettingsImportSectionResult(added = added, updated = updated, skipped = skipped),
                    "alert_rules" to SettingsImportSectionResult(added = 1, updated = 0, skipped = 0),
                ),
        )

    private fun setContent(
        state: SettingsExportImportUiState,
        onExport: () -> Unit = {},
        onChooseFile: () -> Unit = {},
        onApply: () -> Unit = {},
        onReset: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SettingsExportImportContent(
                    state = state,
                    onExport = onExport,
                    onChooseFile = onChooseFile,
                    onApply = onApply,
                    onReset = onReset,
                )
            }
        }
    }

    @Test
    fun idleShowsHeaderExportRowAndDropZoneNotABlankPanel() {
        setContent(SettingsExportImportUiState())
        compose.onNodeWithText("Backup & Restore").assertIsDisplayed()
        compose.onNodeWithText("Export settings").assertIsDisplayed()
        compose.onNodeWithText("Export JSON").assertIsDisplayed()
        compose.onNodeWithText("Import settings").assertIsDisplayed()
        compose.onNodeWithText("Drag a JSON bundle here, or").assertIsDisplayed()
        compose.onNodeWithText("Choose a file").assertIsDisplayed()
    }

    @Test
    fun exportingDisablesTheExportButtonWithBusyLabel() {
        setContent(SettingsExportImportUiState(exporting = true))
        compose.onNodeWithText("Exporting", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Exporting", substring = true).assertIsNotEnabled()
    }

    @Test
    fun parsingShowsReadingAffordance() {
        setContent(SettingsExportImportUiState(stage = ImportStage.Parsing))
        compose.onNodeWithText("Reading", substring = true).assertIsDisplayed()
    }

    @Test
    fun intakeErrorRendersInline() {
        setContent(SettingsExportImportUiState(error = ImportError.TooLarge))
        compose.onNodeWithText("File is too large (max 1 MB).").assertIsDisplayed()
    }

    @Test
    fun exportTapInvokesCallback() {
        var exported = false
        setContent(SettingsExportImportUiState(), onExport = { exported = true })
        compose.onNodeWithText("Export JSON").performClick()
        assertTrue(exported)
    }

    @Test
    fun chooseFileTapInvokesCallback() {
        var chose = false
        setContent(SettingsExportImportUiState(), onChooseFile = { chose = true })
        compose.onNodeWithText("Choose a file").performClick()
        assertTrue(chose)
    }

    @Test
    fun previewRendersDiffSummaryAndAllSectionLabelsWithApplyEnabled() {
        setContent(
            SettingsExportImportUiState(
                stage = ImportStage.Preview,
                pending = PendingImport("teslasync-settings-20260612.json", 2_048L),
                preview = preview(),
            ),
        )
        compose.onNodeWithText("Previewing", substring = true).assertIsDisplayed()
        compose.onNodeWithText("teslasync-settings-20260612.json", substring = true).assertIsDisplayed()
        // Every section key always renders (web SectionDiffList never collapses).
        compose.onNodeWithText("General settings").assertIsDisplayed()
        compose.onNodeWithText("Alert rules").assertIsDisplayed()
        compose.onNodeWithText("Geofences").assertIsDisplayed()
        compose.onNodeWithText("Quiet hours").assertIsDisplayed()
        // added(2+1) + updated(3) = 6 changes.
        compose.onNodeWithText("Apply 6 change", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Cancel").assertIsDisplayed()
        compose.onNodeWithText("Change file").assertIsDisplayed()
    }

    @Test
    fun previewWithNoChangesDisablesApply() {
        setContent(
            SettingsExportImportUiState(
                stage = ImportStage.Preview,
                pending = PendingImport("empty.json", 32L),
                preview =
                    SettingsImportResult(
                        dryRun = true,
                        sections = mapOf("settings" to SettingsImportSectionResult(added = 0, updated = 0, skipped = 9)),
                    ),
            ),
        )
        compose.onNodeWithText("Nothing to apply").assertIsDisplayed()
        compose.onNodeWithText("Nothing to apply").assertIsNotEnabled()
    }

    @Test
    fun applyTapInvokesCallback() {
        var applied = false
        setContent(
            SettingsExportImportUiState(
                stage = ImportStage.Preview,
                pending = PendingImport("bundle.json", 64L),
                preview = preview(),
            ),
            onApply = { applied = true },
        )
        compose.onNodeWithText("Apply 6 change", substring = true).performClick()
        assertTrue(applied)
    }

    @Test
    fun appliedShowsCompletionAndDoneInvokesReset() {
        var reset = false
        setContent(
            SettingsExportImportUiState(stage = ImportStage.Applied, applied = preview()),
            onReset = { reset = true },
        )
        compose.onNodeWithText("Import complete").assertIsDisplayed()
        compose.onNodeWithText("Done").performClick()
        assertTrue(reset)
    }

    @Test
    fun cancelInPreviewInvokesReset() {
        var reset = false
        setContent(
            SettingsExportImportUiState(
                stage = ImportStage.Preview,
                pending = PendingImport("bundle.json", 64L),
                preview = preview(),
            ),
            onReset = { reset = true },
        )
        compose.onNodeWithText("Cancel").performClick()
        assertEquals(true, reset)
    }
}

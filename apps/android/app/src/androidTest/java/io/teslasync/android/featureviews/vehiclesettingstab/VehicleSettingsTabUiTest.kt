package io.teslasync.android.featureviews.vehiclesettingstab

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.vehiclesettings.EffectiveSettingSource
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of VehicleSettingsTab across every branch the prompt's
 * state matrix mandates (web/src/features/vehicles/components/VehicleSettingsTab.tsx): the loading skeleton's
 * accessible name, the hard error with Retry, the editable rows (the section title + a field label + the
 * source pill + the Save / Reset actions), and the offline freshness chip over the cached rows. Every
 * asserted string resolves from the app's i18n resources so the test follows the device locale rather than
 * hard-coding English (the a11y-label coverage). The clock auto-advance is disabled so the fade/skeleton
 * animations cannot stall `waitForIdle`. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest`
 * gate covers the pure model + view-model.
 */
class VehicleSettingsTabUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    @Test
    fun loadingShowsTheLocalizedLoadingLabel() {
        setContent(display(VehicleSettingsTabStatus.Loading, rows = emptyList()))

        compose.onNodeWithContentDescription(string(R.string.translation_a11y_loading)).assertIsDisplayed()
    }

    @Test
    fun errorShowsTheResolverFailureAndRetry() {
        setContent(display(VehicleSettingsTabStatus.Error, rows = emptyList(), errorKind = ErrorKind.Network))

        compose.onNodeWithText(string(R.string.translation_error_serverError_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_vehicleSettings_error)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_retry)).assertIsDisplayed()
    }

    @Test
    fun readyShowsTheHeaderRowLabelSourcePillAndActions() {
        setContent(display(VehicleSettingsTabStatus.Ready))

        compose.onNodeWithText(string(R.string.translation_vehicleSettings_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_vehicleSettings_keys_nickname_label)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_vehicleSettings_source_override)).assertIsDisplayed()
        compose.onAllNodesWithText(string(R.string.translation_vehicleSettings_actions_save)).onFirst().assertIsDisplayed()
        compose.onAllNodesWithText(string(R.string.translation_vehicleSettings_actions_reset)).onFirst().assertIsDisplayed()
    }

    @Test
    fun offlineShowsTheOfflineChipOverTheRows() {
        setContent(display(VehicleSettingsTabStatus.Ready, stale = true, offline = true))

        compose.onNodeWithText(string(R.string.translation_common_offline)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_vehicleSettings_keys_nickname_label)).assertIsDisplayed()
    }

    private fun setContent(display: VehicleSettingsTabDisplay) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    VehicleSettingsTabContent(
                        display = display,
                        onEdit = { _, _ -> },
                        onSave = {},
                        onReset = {},
                        onRetry = {},
                        onRefresh = {},
                        toasts = emptyList(),
                        onToastDismiss = {},
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    private fun display(
        status: VehicleSettingsTabStatus,
        rows: List<VehicleSettingRowDisplay> = sampleRows(),
        stale: Boolean = false,
        offline: Boolean = false,
        errorKind: ErrorKind? = null,
    ): VehicleSettingsTabDisplay =
        VehicleSettingsTabDisplay(
            status = status,
            rows = rows,
            stale = stale,
            refreshing = false,
            offline = offline,
            canRetry = offline,
            fetchedAtMillis = if (rows.isEmpty()) null else NOW,
            errorKind = errorKind,
        )

    private fun row(
        descriptor: VehicleSettingDescriptor,
        source: EffectiveSettingSource,
        draft: String,
    ): VehicleSettingRowDisplay =
        VehicleSettingRowDisplay(
            key = descriptor.key,
            kind = descriptor.kind,
            options = descriptor.options,
            maxLength = descriptor.maxLength,
            source = source,
            draft = draft,
            isDirty = false,
            validation = null,
            saving = false,
            resetting = false,
        )

    private fun sampleRows(): List<VehicleSettingRowDisplay> =
        listOf(
            row(VEHICLE_SETTING_DESCRIPTORS[0], EffectiveSettingSource.OVERRIDE, "Snowball"),
            row(VEHICLE_SETTING_DESCRIPTORS[1], EffectiveSettingSource.DEFAULT, ""),
            row(VEHICLE_SETTING_DESCRIPTORS[2], EffectiveSettingSource.DEFAULT, ""),
            row(VEHICLE_SETTING_DESCRIPTORS[3], EffectiveSettingSource.USER, "mi"),
            row(VEHICLE_SETTING_DESCRIPTORS[4], EffectiveSettingSource.USER, "F"),
            row(VEHICLE_SETTING_DESCRIPTORS[5], EffectiveSettingSource.DEFAULT, "kWh"),
        )

    private companion object {
        const val SETTLE_MS = 2_000L
        const val NOW = 1_780_000_000_000L
    }
}

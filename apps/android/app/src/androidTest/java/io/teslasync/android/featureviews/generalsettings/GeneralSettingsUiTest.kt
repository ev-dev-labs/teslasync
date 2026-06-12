package io.teslasync.android.featureviews.generalsettings

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.settings.CarPreferences
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of GeneralSettings across every branch the prompt's
 * state matrix mandates (web/src/features/settings/components/GeneralSettings.tsx): the loading skeleton's
 * accessible name, the hard error with Retry, the editable form (header + field labels + the conditional
 * Sync-from-Car and car-clock panels), the offline chip over a cached form, the unsaved-changes hint, and
 * the post-save confirmation. Every asserted string resolves from the app's i18n resources so the test
 * follows the device locale rather than hard-coding English (the a11y-label coverage). The clock
 * auto-advance is disabled so the skeleton/fade animations cannot stall `waitForIdle`. Runs under
 * `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection + view-model.
 */
class GeneralSettingsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    @Test
    fun loadingShowsTheLocalizedLoadingLabel() {
        setContent(display(GeneralSettingsStatus.Loading))

        compose.onNodeWithContentDescription(string(R.string.translation_a11y_loading)).assertIsDisplayed()
    }

    @Test
    fun errorShowsTheServerFailureAndRetry() {
        setContent(display(GeneralSettingsStatus.Error))

        compose.onNodeWithText(string(R.string.translation_error_serverError_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_error_serverError_message)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_common_retry)).assertIsDisplayed()
    }

    @Test
    fun readyShowsTheHeaderAndEditableFields() {
        setContent(display(GeneralSettingsStatus.Ready))

        compose.onNodeWithText(string(R.string.translation_app_title)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_app_distanceUnit)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_app_save)).assertIsDisplayed()
    }

    @Test
    fun readyWithCarPreferencesShowsBothPanels() {
        setContent(display(GeneralSettingsStatus.Ready, car = CAR))

        compose.onNodeWithText(string(R.string.translation_app_syncFromCar)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_app_carClockFormat) + ":").assertIsDisplayed()
    }

    @Test
    fun offlineShowsTheOfflineChipOverTheForm() {
        setContent(display(GeneralSettingsStatus.Ready, stale = true, offline = true))

        compose.onNodeWithText(string(R.string.translation_common_offline)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_app_distanceUnit)).assertIsDisplayed()
    }

    @Test
    fun dirtyFormShowsTheUnsavedHint() {
        setContent(display(GeneralSettingsStatus.Ready, isDirty = true))

        compose.onNodeWithText(string(R.string.translation_forms_unsavedSettings)).assertIsDisplayed()
    }

    @Test
    fun savedFeedbackShowsTheConfirmation() {
        setContent(display(GeneralSettingsStatus.Ready, feedback = GeneralSettingsFeedback.Saved))

        compose.onNodeWithText(string(R.string.translation_app_settingsSaved)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_toast_savedDesc)).assertIsDisplayed()
    }

    private fun setContent(display: GeneralSettingsDisplay) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    GeneralSettingsContent(
                        display = display,
                        onEdit = {},
                        onSave = {},
                        onSyncFromCar = {},
                        onRetry = {},
                        onRefresh = {},
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    private fun display(
        status: GeneralSettingsStatus,
        car: CarPreferences? = null,
        feedback: GeneralSettingsFeedback? = null,
        isDirty: Boolean = false,
        stale: Boolean = false,
        offline: Boolean = false,
    ): GeneralSettingsDisplay =
        GeneralSettingsDisplay(
            status = status,
            form = GeneralSettingsForm.DEFAULT,
            carPreferences = car,
            isDirty = isDirty,
            saving = false,
            feedback = feedback,
            stale = stale,
            refreshing = false,
            offline = offline,
            canRetry = offline,
            fetchedAtMillis = NOW,
            errorKind = null,
        )

    private companion object {
        const val SETTLE_MS = 2_000L
        const val NOW = 1_780_000_000_000L
        val CAR =
            CarPreferences(
                distanceUnit = "DistanceUnitMiles",
                temperatureUnit = "TemperatureUnitFahrenheit",
                tirePressureUnit = "PressureUnitPsi",
                use24HourTime = true,
            )
    }
}

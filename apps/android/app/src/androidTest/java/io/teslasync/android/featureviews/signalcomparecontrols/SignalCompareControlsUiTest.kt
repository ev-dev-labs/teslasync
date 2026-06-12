package io.teslasync.android.featureviews.signalcomparecontrols

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import java.time.Instant
import java.time.ZoneOffset

/**
 * Instrumented Compose UI + accessibility verification of [SignalCompareControlsContent] across the branches the
 * web component renders (web/src/features/telemetry/components/SignalCompareControls.tsx): the two help-labelled
 * windows (empty tap-to-pick vs. populated), the five quick presets and the window strings they emit, the signal
 * filter, the eight category chips with their single-select toggle, the category-clear branch shown only while a
 * category is active, and the optional top slot. Every asserted string is resolved from the app's i18n resources
 * so the test follows the device locale rather than hard-coding English, and each interactive control is reached
 * through its on-screen label / TalkBack content description (the a11y label test). The clock and zone are
 * injected so the preset assertions are deterministic. Runs under `connectedAndroidTest`; the offline
 * `testReleaseUnitTest` gate covers the pure adapter.
 */
class SignalCompareControlsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    private val windowA get() = string(R.string.translation_signalDiff_windowA)
    private val windowB get() = string(R.string.translation_signalDiff_windowB)
    private val presetNowVs1h get() = string(R.string.translation_signalDiff_preset_nowVs1h)
    private val presetLastDrive get() = string(R.string.translation_signalDiff_preset_lastDrive)
    private val filterHint get() = string(R.string.translation_signalDiff_filterPlaceholder)
    private val catBattery get() = string(R.string.translation_signalDiff_cat_battery)
    private val catDrive get() = string(R.string.translation_signalDiff_cat_drive)
    private val catSafety get() = string(R.string.translation_signalDiff_cat_safety)
    private val clearCategory get() = string(R.string.translation_signalDiff_clearCategory)
    private val helpSnapshotAria get() = SignalCompareDefaults.SNAPSHOT_ARIA
    private val helpDiffAria get() = SignalCompareDefaults.DIFF_ARIA

    private fun setContent(
        atA: String = "",
        atB: String = "",
        search: String = "",
        category: String? = null,
        onChangeA: (String) -> Unit = {},
        onChangeB: (String) -> Unit = {},
        onSearchChange: (String) -> Unit = {},
        onCategoryChange: (String?) -> Unit = {},
        topSlot: (@Composable () -> Unit)? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                    SignalCompareControlsContent(
                        atA = atA,
                        atB = atB,
                        onChangeA = onChangeA,
                        onChangeB = onChangeB,
                        search = search,
                        onSearchChange = onSearchChange,
                        category = category,
                        onCategoryChange = onCategoryChange,
                        zone = ZoneOffset.UTC,
                        nowMillis = { FIXED_NOW_MILLIS },
                        topSlot = topSlot,
                    )
                }
            }
        }
    }

    @Test
    fun rendersBothWindowsPresetsFilterAndChips() {
        setContent()

        compose.onNodeWithText(windowA).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(windowB).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(presetNowVs1h).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(filterHint).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(catBattery).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(catSafety).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun emptyWindowShowsTheTapToPickLabelAndAnAccessibleField() {
        setContent(atA = "", atB = "")

        val fieldDescription = "$windowA: ${SignalCompareDefaults.PICK_WINDOW}"
        compose.onNodeWithContentDescription(fieldDescription).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun populatedWindowShowsTheFormattedValue() {
        setContent(atA = "2026-06-12T12:00", atB = "2026-06-12T13:00")

        compose.onNodeWithText("2026-06-12 12:00").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("2026-06-12 13:00").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun helpTriggersExposeAccessibleNames() {
        setContent()

        compose.onNodeWithContentDescription(helpSnapshotAria).performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription(helpDiffAria).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun tappingAPresetEmitsBothWindowStrings() {
        var emittedA: String? = null
        var emittedB: String? = null
        setContent(onChangeA = { emittedA = it }, onChangeB = { emittedB = it })

        compose.onNodeWithText(presetNowVs1h).performScrollTo().performClick()

        assertEquals("2026-06-12T11:00", emittedA)
        assertEquals("2026-06-12T12:00", emittedB)
    }

    @Test
    fun tappingLastDrivePresetEmitsTheNinetyAndFiveMinuteWindows() {
        var emittedA: String? = null
        var emittedB: String? = null
        setContent(onChangeA = { emittedA = it }, onChangeB = { emittedB = it })

        compose.onNodeWithText(presetLastDrive).performScrollTo().performClick()

        assertEquals("2026-06-12T10:30", emittedA)
        assertEquals("2026-06-12T11:55", emittedB)
    }

    @Test
    fun selectingACategoryEmitsItsId() {
        var emitted: String? = "unset"
        setContent(category = null, onCategoryChange = { emitted = it })

        compose.onNodeWithText(catDrive).performScrollTo().performClick()

        assertEquals("drive", emitted)
    }

    @Test
    fun tappingTheActiveCategoryClearsIt() {
        var emitted: String? = "unset"
        setContent(category = "battery", onCategoryChange = { emitted = it })

        compose.onNodeWithText(catBattery).performScrollTo().performClick()

        assertNull(emitted)
    }

    @Test
    fun clearButtonOnlyShowsWhileACategoryIsActiveAndClearsOnTap() {
        var emitted: String? = "unset"
        setContent(search = "", category = "battery", onCategoryChange = { emitted = it })

        compose.onNodeWithText(clearCategory).performScrollTo().performClick()

        assertNull(emitted)
    }

    @Test
    fun clearButtonIsAbsentWhenNoCategoryIsActive() {
        setContent(search = "", category = null)

        compose.onNodeWithText(clearCategory).assertDoesNotExist()
    }

    @Test
    fun topSlotRendersWhenProvided() {
        setContent(topSlot = { Text(TOP_SLOT_MARKER) })

        compose.onNodeWithText(TOP_SLOT_MARKER).performScrollTo().assertIsDisplayed()
    }

    private companion object {
        val FIXED_NOW_MILLIS = Instant.parse("2026-06-12T12:00:00Z").toEpochMilli()
        const val TOP_SLOT_MARKER = "TopSlotProbe"
    }
}

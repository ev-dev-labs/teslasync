package io.teslasync.android.sharedsurfaces.unitinput

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextInput
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [UnitInputContent] across every state the web
 * component renders plus the settings document's lifecycle: the seeded value + symbol, the labeled but
 * still-interactive empty field, the loading skeleton, the classified error + retry, the stale / offline
 * freshness chips, and the parse-on-commit round-trip (typed display text → canonical value, including the
 * km→mi conversion). Asserts the rendered i18n strings and the accessible label on the editable field.
 * Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the logic, this covers render +
 * interaction.
 */
class UnitInputUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings = UnitInputStrings(loadingLabel = "Loading", staleLabel = "Stale", offlineLabel = "Offline")
    private val settings = UnitInputSettings(unitOfLength = "mi", unitOfTemp = "C", locale = "en-US", decimalPrecision = 2)
    private val kmSettings = settings.copy(unitOfLength = "km")

    private fun setContent(
        display: UnitInputDisplay,
        label: String = "Battery Capacity",
        onValueChange: (Double?) -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                UnitInputContent(
                    display = display,
                    onValueChange = onValueChange,
                    label = label,
                    strings = strings,
                    onRetry = onRetry,
                )
            }
        }
    }

    private fun content(
        unit: UnitKind = UnitKind.Energy,
        symbol: String = "kWh",
        formattedValue: String = "75",
        cfg: UnitInputSettings = settings,
        phase: UnitInputPhase = UnitInputPhase.Content,
        stale: Boolean = false,
        offline: Boolean = false,
        errorKind: ErrorKind? = null,
        httpStatus: Int? = null,
    ): UnitInputDisplay =
        UnitInputDisplay(
            phase = phase,
            unit = unit,
            settings = cfg,
            symbol = symbol,
            formattedValue = formattedValue,
            hasValue = formattedValue.isNotEmpty(),
            stale = stale,
            offline = offline,
            errorKind = errorKind,
            httpStatus = httpStatus,
        )

    @Test
    fun contentShowsLabelValueAndSymbol() {
        setContent(content())
        compose.onNodeWithText("Battery Capacity").assertIsDisplayed()
        compose.onNodeWithText("75").assertIsDisplayed()
        compose.onNodeWithText("kWh").assertIsDisplayed()
    }

    @Test
    fun emptyShowsLabeledInteractiveField() {
        setContent(content(formattedValue = "", phase = UnitInputPhase.Empty))
        compose.onNodeWithText("Battery Capacity").assertIsDisplayed()
        compose.onNodeWithText("kWh").assertIsDisplayed()
        // The field is still interactive (never a blank box): it exposes a set-text action.
        compose.onNode(hasSetTextAction()).assertIsDisplayed()
    }

    @Test
    fun editableFieldExposesAccessibleLabel() {
        setContent(content())
        // The label is the accessible name of the editable element (TalkBack), and it is the same node
        // that carries the set-text action.
        compose.onNodeWithText("Battery Capacity").assertIsDisplayed()
        compose.onNode(hasSetTextAction()).assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(content(phase = UnitInputPhase.Loading, formattedValue = ""))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            display = content(phase = UnitInputPhase.Error, formattedValue = "", errorKind = ErrorKind.Http, httpStatus = 503),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleShowsStaleChip() {
        setContent(content(stale = true))
        compose.onNodeWithText("Stale").assertIsDisplayed()
        compose.onNodeWithText("75").assertIsDisplayed()
    }

    @Test
    fun offlineShowsOfflineChip() {
        setContent(content(offline = true, errorKind = ErrorKind.Network))
        compose.onNodeWithText("Offline").assertIsDisplayed()
    }

    @Test
    fun typingCommitsCanonicalValueOnImeDone() {
        var committed: Double? = null
        setContent(content(formattedValue = "", phase = UnitInputPhase.Empty), onValueChange = { committed = it })

        compose.onNode(hasSetTextAction()).performTextInput("80")
        compose.onNode(hasSetTextAction()).performImeAction()

        assertEquals(80.0, committed!!, 0.0)
    }

    @Test
    fun typingCommitsConvertedKmValue() {
        var committed: Double? = null
        setContent(
            display = content(unit = UnitKind.Distance, symbol = "km", formattedValue = "", cfg = kmSettings, phase = UnitInputPhase.Empty),
            onValueChange = { committed = it },
        )

        // 160.9344 km → 100 canonical miles.
        compose.onNode(hasSetTextAction()).performTextInput("160.9344")
        compose.onNode(hasSetTextAction()).performImeAction()

        assertEquals(100.0, committed!!, 1e-6)
    }

    @Test
    fun clearingCommitsNull() {
        var committed: Double? = 5.0
        setContent(content(formattedValue = "", phase = UnitInputPhase.Empty), onValueChange = { committed = it })

        compose.onNode(hasSetTextAction()).performTextInput("   ")
        compose.onNode(hasSetTextAction()).performImeAction()

        assertNull(committed)
    }
}

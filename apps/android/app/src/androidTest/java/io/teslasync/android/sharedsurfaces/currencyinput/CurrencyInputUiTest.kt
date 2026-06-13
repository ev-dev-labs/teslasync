package io.teslasync.android.sharedsurfaces.currencyinput

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [CurrencyInputContent] across every state the surface
 * renders: the editable value, the empty field, the loading skeleton, the stale / offline freshness chip, and
 * the hard error with retry. Asserts the field's accessible label (the web `ariaLabel`), the formatted value,
 * the freshness labels, and the error copy. The offline gate's `testReleaseUnitTest` covers the pure logic +
 * formatting; this covers render + a11y. Mirrors the web spec (web/src/components/forms/CurrencyInput.tsx).
 */
class CurrencyInputUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        CurrencyInputStrings(label = "Electricity Cost (per kWh)", loading = "Loading", stale = "Stale", offline = "Offline")

    private fun editable(
        stale: Boolean = false,
        offline: Boolean = false,
        errorKind: ErrorKind? = null,
    ): CurrencyInputDisplay =
        CurrencyInputDisplay(
            phase = CurrencyInputPhase.Editable,
            currency = "USD",
            locale = "en-US",
            symbol = "$",
            stale = stale,
            offline = offline,
            errorKind = errorKind,
        )

    private fun setContent(
        valueMicro: Long?,
        display: CurrencyInputDisplay,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CurrencyInputContent(valueMicro = valueMicro, onChange = {}, display = display, strings = strings)
            }
        }
    }

    @Test
    fun editableValueRendersWithTheAccessibleLabel() {
        setContent(valueMicro = 1_500_000L, display = editable())
        compose.onNodeWithText("Electricity Cost (per kWh)").assertIsDisplayed()
        compose.onNodeWithText("$1.50").assertIsDisplayed()
    }

    @Test
    fun emptyValueStillRendersTheLabelledFieldNotABlankBox() {
        setContent(valueMicro = null, display = editable())
        compose.onNodeWithText("Electricity Cost (per kWh)").assertIsDisplayed()
    }

    @Test
    fun loadingRendersSkeletonChromeWithItsLabel() {
        setContent(valueMicro = 1_500_000L, display = editable().copy(phase = CurrencyInputPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun staleShowsTheStaleFreshnessChip() {
        setContent(valueMicro = 1_500_000L, display = editable(stale = true))
        compose.onNodeWithText("Stale").assertIsDisplayed()
    }

    @Test
    fun offlineShowsTheOfflineFreshnessChip() {
        setContent(valueMicro = 1_500_000L, display = editable(stale = true, offline = true, errorKind = ErrorKind.Network))
        compose.onNodeWithText("Offline").assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsTheServerErrorCopyWithRetry() {
        setContent(
            valueMicro = 1_500_000L,
            display =
                CurrencyInputDisplay(
                    phase = CurrencyInputPhase.Error,
                    currency = "USD",
                    locale = "en-US",
                    symbol = "$",
                    errorKind = ErrorKind.Http,
                    httpStatus = 503,
                ),
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").assertIsDisplayed()
    }
}

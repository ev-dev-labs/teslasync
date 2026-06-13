package io.teslasync.android.sharedsurfaces.currency

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [CurrencyContent] across every state the surface renders:
 * the null-value fallback, the live amount, the loading symbol, and the stale / offline / failed symbol. Asserts
 * the canonical accessibility value (the web `title`, exposed as the amount's `contentDescription`), the
 * fallback text, and the freshness indicator's TalkBack label. The offline gate's `testReleaseUnitTest` covers
 * the pure logic + formatting; this covers render + a11y. Mirrors the web spec
 * (web/src/components/data-display/format/Currency.tsx).
 */
class CurrencyUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val labels = CurrencyLabels(loading = "Loading\u2026", stale = "Stale", offline = "Offline", error = "Unavailable")
    private val usFormat = CurrencyFormat(symbol = "$", localeTag = "en-US")
    private val amount = 1234.5

    // The canonical value exposed via contentDescription (web `title` = `${symbol}${value.toFixed(2)}`).
    private val canonical = "$1234.50"

    private fun setContent(
        value: Double?,
        format: UiState<CurrencyFormat>,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CurrencyContent(value = value, format = format, labels = labels)
            }
        }
    }

    @Test
    fun nullValueRendersTheFallbackNotABlankBox() {
        setContent(value = null, format = UiState(UiPhase.Content, data = usFormat))
        compose.onNodeWithText("\u2014").assertIsDisplayed()
    }

    @Test
    fun liveAmountRendersWithTheCanonicalAccessibleValue() {
        setContent(value = amount, format = UiState(UiPhase.Content, data = usFormat))
        compose.onNodeWithContentDescription(canonical).assertIsDisplayed()
    }

    @Test
    fun loadingStillRendersTheAmountWithTheDefaultSymbol() {
        // Web parity: useFormatting degrades to `$` before settings load — the amount is never blanked.
        setContent(value = amount, format = UiState.loading())
        compose.onNodeWithContentDescription(canonical).assertIsDisplayed()
    }

    @Test
    fun staleSymbolShowsTheStaleFreshnessLabel() {
        setContent(
            value = amount,
            format = UiState(UiPhase.Content, data = usFormat, stale = true, fetchedAt = 1_700_000_000_000L),
        )
        compose.onNodeWithContentDescription(canonical).assertIsDisplayed()
        compose.onNodeWithContentDescription("Stale").assertIsDisplayed()
    }

    @Test
    fun offlineSymbolShowsTheOfflineFreshnessLabel() {
        setContent(
            value = amount,
            format =
                UiState(
                    phase = UiPhase.Content,
                    data = usFormat,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
        )
        compose.onNodeWithContentDescription(canonical).assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun hardFailureFallsBackToTheDefaultSymbolAndShowsTheFailureLabel() {
        setContent(value = amount, format = UiState(UiPhase.Error, errorKind = ErrorKind.Network))
        compose.onNodeWithContentDescription(canonical).assertIsDisplayed()
        compose.onNodeWithContentDescription("Unavailable").assertIsDisplayed()
    }
}

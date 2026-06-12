package io.teslasync.android.featureviews.addressinput

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.put
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of AddressInput across every branch the prompt's
 * state matrix mandates (web/src/features/driving/components/AddressInput.tsx): the suggestion list, the
 * loading row, the "No results" empty row, the hard error row with retry, and the offline (cached + chip)
 * surface — plus the web `hideLabel` accessible-name contract and the end-to-end debounce → geocode →
 * selection flow on the stateful surface. Every asserted string is resolved from the app's i18n resources
 * so the test follows the device locale rather than hard-coding English. The clock auto-advance is disabled
 * so the loading spinner's infinite animation cannot stall `waitForIdle`; the dropdown's enter animation is
 * settled with an explicit advance. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest`
 * gate covers the pure projection.
 */
class AddressInputUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private fun string(id: Int) = context.getString(id)

    @Test
    fun resultsShowEverySuggestionUnderTheVisibleLabel() {
        setContent(AddressSuggestions(AddressInputStatus.Results, SUGGESTIONS), label = "Origin")

        compose.onNodeWithText("Origin").assertIsDisplayed()
        compose.onNodeWithText(TESLA_HQ_NAME).assertIsDisplayed()
        compose.onNodeWithText(GIGA_TEXAS_NAME).assertIsDisplayed()
    }

    @Test
    fun loadingShowsTheLoadingRow() {
        setContent(AddressSuggestions(AddressInputStatus.Loading))

        compose.onNodeWithText(string(R.string.translation_common_loading)).assertIsDisplayed()
    }

    @Test
    fun emptyShowsTheNoResultsRow() {
        setContent(AddressSuggestions(AddressInputStatus.Empty))

        compose.onNodeWithText(string(R.string.translation_combobox_noResults)).assertIsDisplayed()
    }

    @Test
    fun errorShowsTheFailureMessageAndRetry() {
        setContent(AddressSuggestions(AddressInputStatus.Error, canRetry = true))

        compose.onNodeWithText(string(R.string.translation_error_loadFailed)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_error_retry)).assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedSuggestionsBeneathTheOfflineChip() {
        setContent(
            AddressSuggestions(
                status = AddressInputStatus.Results,
                suggestions = SUGGESTIONS,
                stale = true,
                offline = true,
                canRetry = true,
            ),
        )

        compose.onNodeWithText(string(R.string.translation_common_offline)).assertIsDisplayed()
        compose.onNodeWithText(TESLA_HQ_NAME).assertIsDisplayed()
    }

    @Test
    fun hiddenLabelKeepsTheLocalizedAccessibleName() {
        // Web `hideLabel={!label}` — no visible label, but the field keeps "Address" as its accessible name.
        setContent(AddressSuggestions(AddressInputStatus.Idle), label = null)

        compose.onNodeWithContentDescription(string(R.string.translation_addressInput_label)).assertIsDisplayed()
    }

    @Test
    fun selectingASuggestionEmitsItsLocationAndText() {
        var selected: AddressLocation? = null
        var text = ""
        compose.mainClock.autoAdvance = false
        compose.setContent {
            var value by remember { mutableStateOf("Tesla") }
            text = value
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    AddressInput(
                        value = value,
                        onValueChange = { value = it },
                        onSelect = { selected = it },
                        geocode = { flowOf<Resource<JsonElement>>(Resource.Success(geocodeArray(), fetchedAt = 1L, stale = false)) },
                        logger = NoopLogger,
                    )
                }
            }
        }
        // Fire the 400ms debounce + the geocode emission + the menu enter animation.
        compose.mainClock.advanceTimeBy(SETTLE_MS)
        compose.waitForIdle()

        compose.onNodeWithText(TESLA_HQ_NAME).performClick()
        compose.waitForIdle()

        assert(selected?.name == TESLA_HQ_NAME) { "expected onSelect with the picked address, was $selected" }
        assert(text == TESLA_HQ_NAME) { "expected the text to update to the picked address, was \"$text\"" }
    }

    private fun setContent(
        display: AddressSuggestions,
        label: String? = "Address",
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = WIDTH, height = HEIGHT)) {
                    AddressInputContent(
                        value = "Tesla",
                        onValueChange = {},
                        onSelect = {},
                        display = display,
                        onRetry = {},
                        label = label,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MS)
    }

    private fun geocodeArray() =
        buildJsonArray {
            addJsonObject {
                put("display_name", TESLA_HQ_NAME)
                put("lat", 30.2241)
                put("lng", -97.6186)
            }
            addJsonObject {
                put("display_name", GIGA_TEXAS_NAME)
                put("lat", 30.2210)
                put("lng", -97.6170)
            }
        }

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private companion object {
        const val TESLA_HQ_NAME = "1 Tesla Road, Austin, TX 78725, USA"
        const val GIGA_TEXAS_NAME = "Giga Texas, Austin, TX, USA"
        val WIDTH = 360.dp
        val HEIGHT = 720.dp
        const val SETTLE_MS = 2_000L

        val SUGGESTIONS =
            listOf(
                AddressSuggestion(TESLA_HQ_NAME, 30.2241, -97.6186),
                AddressSuggestion(GIGA_TEXAS_NAME, 30.2210, -97.6170),
            )
    }
}

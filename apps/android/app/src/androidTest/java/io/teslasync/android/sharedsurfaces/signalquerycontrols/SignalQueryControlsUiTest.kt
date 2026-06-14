package io.teslasync.android.sharedsurfaces.signalquerycontrols

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the SignalQueryControls shared surface across every
 * state the web module renders (web/src/components/SignalQueryControls.tsx): the picker's loading skeleton, the
 * selectable multi-select, the empty-signals note, the stale/offline freshness chips, the classified error with
 * a working Retry, the results table rows, and the quick-range preset accessible names. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure model, this covers the render.
 */
class SignalQueryControlsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun strings(): SignalQueryControlsStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return SignalQueryControlsStrings(
            fromLabel = ctx.getString(R.string.translation_signalQuery_from),
            toLabel = ctx.getString(R.string.translation_signalQuery_to),
            quickRangeLabel = ctx.getString(R.string.translation_signalQuery_quickRange),
            presetAriaTemplate = ctx.getString(R.string.translation_signalQuery_preset_aria),
            queryLabel = ctx.getString(R.string.translation_signalQuery_query),
            rowsLabel = ctx.getString(R.string.translation_signalQuery_rows),
            signalsLabel = ctx.getString(R.string.translation_Signals),
            noOptionsLabel = ctx.getString(R.string.translation_combobox_noResults),
            maxReachedLabel = ctx.getString(R.string.translation_combobox_maxReached),
            removeLabel = ctx.getString(R.string.translation_common_remove),
            timestampHeader = ctx.getString(R.string.translation_Timestamp),
            signalHeader = ctx.getString(R.string.translation_Signal),
            valueHeader = ctx.getString(R.string.translation_Value),
            typeHeader = ctx.getString(R.string.translation_Type),
            noResultsLabel = ctx.getString(R.string.translation_combobox_noResults),
            emptyResultsTitle = ctx.getString(R.string.translation_common_noData),
            emptyResultsMessage = ctx.getString(R.string.translation_signalGap_noData),
            loadingLabel = ctx.getString(R.string.translation_a11y_loading),
            staleLabel = ctx.getString(R.string.translation_mqtt_stale),
            offlineLabel = ctx.getString(R.string.translation_common_offline),
            updatingLabel = ctx.getString(R.string.translation_freshness_updating),
            retryLabel = ctx.getString(R.string.translation_common_retry),
            confirmLabel = ctx.getString(R.string.translation_common_confirm),
            cancelLabel = ctx.getString(R.string.translation_common_cancel),
            paginationFirst = ctx.getString(R.string.translation_pagination_first),
            paginationPrevious = ctx.getString(R.string.translation_pagination_previous),
            paginationNext = ctx.getString(R.string.translation_pagination_next),
            paginationLast = ctx.getString(R.string.translation_pagination_last),
        )
    }

    private fun rows(): List<SignalLogEntry> =
        listOf(
            SignalLogEntry(createdAt = "2026-01-01T10:00:00Z", signal = "VehicleSpeed", valueNum = 64.0),
            SignalLogEntry(createdAt = "2026-01-01T10:00:01Z", signal = "ChargeState", valueStr = "Charging"),
        )

    @Composable
    private fun Surface(
        display: SignalPickerDisplay,
        labels: SignalQueryControlsStrings,
        selected: List<String> = listOf("VehicleSpeed"),
        rows: List<SignalLogEntry> = emptyList(),
        onRetry: () -> Unit = {},
    ) {
        TeslaSyncTheme(dynamicColor = false) {
            SignalQueryControlsContent(
                display = display,
                strings = labels,
                selectedSignals = selected,
                onSelectedSignalsChange = {},
                fromValue = "2026-01-01T09:00:00",
                toValue = "2026-01-01T10:00:00",
                onFromChange = {},
                onToChange = {},
                perPage = 25,
                onPerPageChange = {},
                onQuery = {},
                rows = rows,
                page = 1,
                total = rows.size,
                onPageChange = {},
                onRetry = onRetry,
            )
        }
    }

    @Test
    fun loadingStateAnnouncesTheLoadingLabel() {
        val labels = strings()
        compose.setContent { Surface(SignalPickerDisplay(phase = SignalPickerPhase.Loading), labels, selected = emptyList()) }
        compose.onNodeWithTag(SIGNAL_QUERY_PICKER_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.loadingLabel).assertIsDisplayed()
    }

    @Test
    fun contentExposesTheSignalsMultiSelectAccessibleName() {
        val labels = strings()
        compose.setContent {
            Surface(SignalPickerDisplay(phase = SignalPickerPhase.Content, names = listOf("VehicleSpeed", "ChargeState")), labels)
        }
        compose.onNodeWithContentDescription(labels.signalsLabel).assertIsDisplayed()
    }

    @Test
    fun emptySignalsShowsTheFriendlyNote() {
        val labels = strings()
        compose.setContent { Surface(SignalPickerDisplay(phase = SignalPickerPhase.Empty), labels, selected = emptyList()) }
        compose.onNodeWithText(labels.noOptionsLabel).assertIsDisplayed()
    }

    @Test
    fun staleStateShowsTheStaleFreshnessChip() {
        val labels = strings()
        compose.setContent {
            Surface(SignalPickerDisplay(phase = SignalPickerPhase.Content, names = listOf("VehicleSpeed"), stale = true), labels)
        }
        compose.onNodeWithText(labels.staleLabel).assertIsDisplayed()
    }

    @Test
    fun offlineStateShowsTheOfflineFreshnessChip() {
        val labels = strings()
        compose.setContent {
            Surface(
                SignalPickerDisplay(
                    phase = SignalPickerPhase.Content,
                    names = listOf("VehicleSpeed"),
                    offline = true,
                    errorKind = ErrorKind.Network,
                ),
                labels,
            )
        }
        compose.onNodeWithText(labels.offlineLabel).assertIsDisplayed()
    }

    @Test
    fun errorStateOffersAWorkingRetry() {
        var retried = false
        compose.setContent {
            Surface(
                SignalPickerDisplay(phase = SignalPickerPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                strings(),
                selected = emptyList(),
                onRetry = { retried = true },
            )
        }
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun resultsTableRendersRowValues() {
        val labels = strings()
        compose.setContent {
            Surface(SignalPickerDisplay(phase = SignalPickerPhase.Content, names = listOf("VehicleSpeed")), labels, rows = rows())
        }
        compose.onNodeWithTag(SIGNAL_QUERY_TABLE_TAG).assertIsDisplayed()
        compose.onNodeWithText("Charging").assertIsDisplayed()
    }

    @Test
    fun quickRangePresetExposesItsAccessibleName() {
        val labels = strings()
        compose.setContent {
            Surface(SignalPickerDisplay(phase = SignalPickerPhase.Content, names = listOf("VehicleSpeed")), labels)
        }
        compose.onNodeWithContentDescription(labels.presetAria("1h")).assertIsDisplayed()
    }
}

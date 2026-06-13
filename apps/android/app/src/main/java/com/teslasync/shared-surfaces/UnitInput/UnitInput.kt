// The native Jetpack Compose + Material 3 UnitInput shared surface — a parity port of
// web/src/components/forms/UnitInput.tsx. The web component is a number-with-unit field that stores its
// value in TeslaSync's canonical metric, renders it in the user's preferred display unit (derived from
// `useSettings()` every render), parses user-typed text on blur / Enter (locale-aware, unit-symbol
// tolerant), and re-syncs the field when the unit preference changes WITHOUT clobbering text the user is
// actively typing (the resync only fires while unfocused). This native surface keeps that contract end to
// end and renders every state the prompt's matrix mandates without ever hiding a region: loading (the
// first settings fetch's skeleton), content (the field seeded with the formatted value), empty (the
// labeled, still-interactive blank field — the web `value == null` case), a hard error with Retry, and a
// stale/offline freshness chip over the cached preferences.
//
// It performs NO HTTP and binds the unit preferences only through the shared S8 Settings seam
// ([UnitInputSettingsSource]) folded through [UnitInputViewModel] + the pure [UnitInputProjection]; the
// composable resolves the i18n labels (P1/S10) and design tokens (P1/S9) and draws what the projection
// returns, using the shared component library (ui GlassPanel/StatusPill/typography, feedback
// QueryError/Skeleton, motion FadeIn). The interactive field is a faithful port of the web buffer logic
// (a local text buffer kept separate from the canonical value, resynced only while unfocused, committed on
// blur / Done). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition;
// the typed value is never logged.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/UnitInput) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.unitinput

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping the projection a pure, locale-stable function. Every
 * string resolves through the P1/S10 catalog. The field label itself is passed separately because callers
 * supply it (the web `label` prop); it defaults to the extracted `chargePlanner.batteryCapacity` key.
 */
data class UnitInputStrings(
    val loadingLabel: String,
    val staleLabel: String,
    val offlineLabel: String,
)

/**
 * Stateful entry point — the parity port of the web `UnitInput`. Binds the shared Settings feed via
 * [source] into a [UnitInputViewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first
 * composition, collects the settings [io.teslasync.android.data.UiState], projects it together with the
 * caller-provided canonical [value] + [unit], auto-refreshes a stale cache, and renders. The [source]
 * defaults to the app's shared S8 SettingsStore.
 *
 * @param value the canonical metric value (miles, mph, °C, kWh, percent, or currency); `null` ⇒ blank.
 * @param onValueChange called with the canonical metric value (or `null` when blank) on commit.
 * @param unit which unit family this input represents (web `unit`).
 * @param label the field label; defaults to the localized `chargePlanner.batteryCapacity` string.
 * @param parseStrict disable locale-aware separator parsing (web `parseStrict` Blocked-Path escape).
 * @param source the cache-then-network Settings seam (shared store/repository adapter, or a fake).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun UnitInput(
    value: Double?,
    onValueChange: (Double?) -> Unit,
    unit: UnitKind,
    modifier: Modifier = Modifier,
    label: String? = null,
    parseStrict: Boolean = false,
    source: UnitInputSettingsSource = LocalDataContainer.current.settingsStore.asUnitInputSettingsSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: UnitInputViewModel =
        viewModel(key = UnitInputRegistration.SLUG, factory = UnitInputViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val settings by viewModel.settings.collectAsStateWithLifecycle()
    val display =
        remember(settings, value, unit, parseStrict) {
            UnitInputProjection.project(settings, value, unit, parseStrict)
        }

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    val resolvedLabel = label ?: stringResource(R.string.translation_chargePlanner_batteryCapacity)
    FadeIn(modifier = modifier) {
        UnitInputContent(
            display = display,
            onValueChange = onValueChange,
            label = resolvedLabel,
            strings = rememberUnitInputStrings(),
            onRetry = viewModel::retry,
        )
    }
}

/**
 * Stateless UnitInput card — renders every branch the web source draws plus the settings document's
 * lifecycle: the loading skeleton, the interactive field (seeded for content, blank for empty), and the
 * classified error with retry, with a stale/offline freshness chip over the cached preferences. Hoisted
 * out of the ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun UnitInputContent(
    display: UnitInputDisplay,
    onValueChange: (Double?) -> Unit,
    label: String,
    strings: UnitInputStrings,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        when (display.phase) {
            UnitInputPhase.Loading -> UnitInputLoading(strings = strings)
            UnitInputPhase.Error ->
                QueryError(
                    kind = UnitInputProjection.queryErrorKind(display),
                    resourceName = label,
                    onRetry = onRetry,
                )
            UnitInputPhase.Content, UnitInputPhase.Empty ->
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    if (display.showFreshnessChip) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            UnitInputFreshnessChip(display = display, strings = strings)
                        }
                    }
                    UnitInputField(display = display, onValueChange = onValueChange, label = label)
                }
        }
    }
}

/**
 * The interactive number-with-unit field — a faithful port of the web buffer logic. A local text buffer is
 * kept separate from the canonical value so typing is never interrupted; it re-syncs to the formatted
 * display only while unfocused (so an external settings/value change does not clobber in-progress input),
 * and commits on blur / Done by parsing the text into the canonical value via [parseForUnit] and emitting
 * it. The [UnitInputDisplay.symbol] is shown as a trailing suffix; the always-present [label] (with the
 * unit suffix) keeps the empty field a clearly labeled control rather than a blank box, and is the field's
 * accessible name (TalkBack).
 */
@Composable
private fun UnitInputField(
    display: UnitInputDisplay,
    onValueChange: (Double?) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
) {
    var text by remember { mutableStateOf(display.bufferSeed) }
    var focused by remember { mutableStateOf(false) }

    LaunchedEffect(display.bufferSeed) {
        if (!focused) text = display.bufferSeed
    }

    fun commit() {
        val parsed = parseForUnit(text, display.unit, display.settings, UnitInputParseOptions(display.parseStrict))
        onValueChange(parsed)
        text = formatForUnit(parsed, display.unit, display.settings)
    }

    OutlinedTextField(
        value = text,
        onValueChange = { text = it },
        modifier =
            modifier
                .fillMaxWidth()
                .onFocusChanged { state ->
                    if (focused && !state.isFocused) commit()
                    focused = state.isFocused
                },
        singleLine = true,
        label = { Text(label) },
        trailingIcon = { Text(display.symbol, style = MaterialTheme.typography.bodyMedium) },
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { commit() }),
        shape = MaterialTheme.shapes.medium,
    )
}

@Composable
private fun UnitInputFreshnessChip(
    display: UnitInputDisplay,
    strings: UnitInputStrings,
) {
    if (display.offline) {
        StatusPill(text = strings.offlineLabel, tone = StatusTone.Danger)
    } else {
        StatusPill(text = strings.staleLabel, tone = StatusTone.Warning)
    }
}

@Composable
private fun UnitInputLoading(strings: UnitInputStrings) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = LABEL_SKELETON_FRACTION, height = LABEL_SKELETON_HEIGHT)
        Skeleton(widthFraction = FIELD_SKELETON_FRACTION, height = FIELD_SKELETON_HEIGHT)
    }
}

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberUnitInputStrings(): UnitInputStrings =
    UnitInputStrings(
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
    )

private const val LABEL_SKELETON_FRACTION = 0.4f
private const val FIELD_SKELETON_FRACTION = 1f
private val LABEL_SKELETON_HEIGHT = 12.dp
private val FIELD_SKELETON_HEIGHT = 48.dp

// ── Previews — one per rendered state (loading / content energy / content imperial speed / empty /
// stale / offline / error). ─────────────────────────────────────────────────────────────────────────

private const val PREVIEW_LABEL_ENERGY = "Battery Capacity (kWh)"
private const val PREVIEW_LABEL_SPEED = "Cruise Speed"

private fun previewStrings(): UnitInputStrings = UnitInputStrings("Loading", "Stale", "Offline")

private fun previewSettings(
    km: Boolean = false,
    fahrenheit: Boolean = false,
): UnitInputSettings =
    UnitInputSettings(
        unitOfLength = if (km) "km" else "mi",
        unitOfTemp = if (fahrenheit) "F" else "C",
        locale = "en-US",
        decimalPrecision = 2,
        currencySymbol = "$",
    )

@Composable
private fun UnitInputPreviewHost(display: UnitInputDisplay) {
    TeslaSyncTheme(dynamicColor = false) {
        UnitInputContent(
            display = display,
            onValueChange = {},
            label = if (display.unit == UnitKind.Speed) PREVIEW_LABEL_SPEED else PREVIEW_LABEL_ENERGY,
            strings = previewStrings(),
        )
    }
}

@Preview(name = "UnitInput · loading", showBackground = true)
@Composable
private fun UnitInputLoadingPreview() {
    UnitInputPreviewHost(
        UnitInputDisplay(
            phase = UnitInputPhase.Loading,
            unit = UnitKind.Energy,
            settings = previewSettings(),
            symbol = "kWh",
            formattedValue = "",
            hasValue = false,
        ),
    )
}

@Preview(name = "UnitInput · content (energy)", showBackground = true)
@Composable
private fun UnitInputContentPreview() {
    UnitInputPreviewHost(
        UnitInputDisplay(
            phase = UnitInputPhase.Content,
            unit = UnitKind.Energy,
            settings = previewSettings(),
            symbol = "kWh",
            formattedValue = "75",
            hasValue = true,
        ),
    )
}

@Preview(name = "UnitInput · content (imperial speed)", showBackground = true)
@Composable
private fun UnitInputImperialPreview() {
    UnitInputPreviewHost(
        UnitInputDisplay(
            phase = UnitInputPhase.Content,
            unit = UnitKind.Speed,
            settings = previewSettings(),
            symbol = "mph",
            formattedValue = "60",
            hasValue = true,
        ),
    )
}

@Preview(name = "UnitInput · empty", showBackground = true)
@Composable
private fun UnitInputEmptyPreview() {
    UnitInputPreviewHost(
        UnitInputDisplay(
            phase = UnitInputPhase.Empty,
            unit = UnitKind.Energy,
            settings = previewSettings(),
            symbol = "kWh",
            formattedValue = "",
            hasValue = false,
        ),
    )
}

@Preview(name = "UnitInput · stale", showBackground = true)
@Composable
private fun UnitInputStalePreview() {
    UnitInputPreviewHost(
        UnitInputDisplay(
            phase = UnitInputPhase.Content,
            unit = UnitKind.Energy,
            settings = previewSettings(),
            symbol = "kWh",
            formattedValue = "75",
            hasValue = true,
            stale = true,
            refreshing = true,
        ),
    )
}

@Preview(name = "UnitInput · offline", showBackground = true)
@Composable
private fun UnitInputOfflinePreview() {
    UnitInputPreviewHost(
        UnitInputDisplay(
            phase = UnitInputPhase.Content,
            unit = UnitKind.Energy,
            settings = previewSettings(),
            symbol = "kWh",
            formattedValue = "75",
            hasValue = true,
            offline = true,
            errorKind = ErrorKind.Network,
        ),
    )
}

@Preview(name = "UnitInput · error", showBackground = true)
@Composable
private fun UnitInputErrorPreview() {
    UnitInputPreviewHost(
        UnitInputDisplay(
            phase = UnitInputPhase.Error,
            unit = UnitKind.Energy,
            settings = previewSettings(),
            symbol = "kWh",
            formattedValue = "",
            hasValue = false,
            errorKind = ErrorKind.Http,
            httpStatus = HTTP_SERVER_ERROR,
        ),
    )
}

private const val HTTP_SERVER_ERROR = 503

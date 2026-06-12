// The native Jetpack Compose + Material 3 AddressInput feature view — a parity port of
// web/src/features/driving/components/AddressInput.tsx. The web component is the trip-planner's geocoded
// address autocomplete: it wraps the shared `Combobox`, owns the raw text via `value`/`onChange`,
// debounces it (400ms) into a geocode query, queries `useGeocodeSearch` once the query reaches three
// characters, and renders the resolved `GeocodeResult[]` with a leading MapPin glyph, a loading indicator,
// free-text entry, and no chevron/clear affordances. Picking a suggestion sets the text (`onChange`) and
// fires `onSelect` with the resolved `{ lat, lng, name }`.
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds the geocode read only
// through the shared S8 state-holder seam ([geocode], wired by the owning trip-planner page to
// DrivingStore.geocodeSearch), so the view never reaches the network itself. Every derivation flows
// through the pure [AddressInputProjection]; the composable is a thin render layer that resolves the i18n
// labels (P1/S10) and design-token accents (P1/S9) and draws what the projection returns, using the shared
// component library (ui Icon / Button / typography, feedback Spinner, data-display MapPin glyph) inside the
// Material 3 ExposedDropdownMenuBox — the native counterpart of the web forms `Combobox`. It renders every
// state the prompt's matrix mandates without ever hiding a surface: idle (query &lt; 3 chars, no dropdown),
// a loading row, the suggestion list, a friendly "No results" empty row, a hard error row with retry, and
// the stale/refreshing/offline freshness chip over cached rows. The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AddressInput — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.addressinput

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/** Initial loading value for a just-started geocode feed (no cache yet). */
private val INITIAL_LOADING: Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

/** Cap the visible suggestion rows, mirroring the web `maxVisibleOptions={5}` / `limit=5`. */
private const val MAX_VISIBLE_SUGGESTIONS = 5

/**
 * Stateful entry point — the faithful 1:1 port of the web `AddressInput` props. Records the one-shot
 * `view.opened` diagnostic on first composition (P1/S11), debounces [value] into a geocode query exactly
 * like the web `setTimeout(..., 400)`, binds the shared geocode feed through the [geocode] state-holder
 * seam only while the query is long enough, projects the resulting [Resource] onto an [AddressSuggestions]
 * via the pure [AddressInputProjection], and renders the autocomplete.
 *
 * @param value the raw input text, owned by the parent (web `value` prop).
 * @param onValueChange raises typed text to the parent (web `onChange`); also fired with a picked
 *   suggestion's `display_name` on selection, exactly as the web component does.
 * @param onSelect fired with the resolved [AddressLocation] when a suggestion is picked (web `onSelect`).
 * @param geocode the S8 state-holder seam producing the cache-then-network geocode feed for a query — the
 *   owning trip-planner page wires this to `DrivingStore.geocodeSearch`; the view never calls HTTP itself.
 * @param label optional field label; when null the label is visually hidden but kept as the field's
 *   accessible name (web `hideLabel={!label}`), defaulting to the localized "Address".
 * @param hint optional grey hint shown while the field is empty (the web prop of the same role).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AddressInput(
    value: String,
    onValueChange: (String) -> Unit,
    onSelect: (AddressLocation) -> Unit,
    geocode: (String) -> Flow<Resource<JsonElement>>,
    modifier: Modifier = Modifier,
    label: String? = null,
    hint: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AddressInputDiagnostics.recordViewOpened(logger) }

    var debouncedQuery by remember { mutableStateOf("") }
    LaunchedEffect(value) {
        delay(DEBOUNCE_MILLIS)
        debouncedQuery = value
    }

    var retryTick by remember { mutableIntStateOf(0) }
    val active = debouncedQuery.length >= MIN_QUERY_LENGTH

    var resource by remember { mutableStateOf<Resource<JsonElement>?>(null) }
    LaunchedEffect(debouncedQuery, active, retryTick) {
        if (!active) {
            resource = null
        } else {
            resource = INITIAL_LOADING
            geocode(debouncedQuery).collect { resource = it }
        }
    }

    val display = remember(debouncedQuery, resource) { AddressInputProjection.project(debouncedQuery, resource) }

    AddressInputContent(
        value = value,
        onValueChange = onValueChange,
        onSelect = onSelect,
        display = display,
        onRetry = { retryTick++ },
        modifier = modifier,
        label = label,
        hint = hint,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Draws the text field (leading MapPin
 * glyph, web `hideLabel` honoured) and, while the query is active, the suggestion dropdown: a loading row,
 * the suggestion list, a "No results" empty row, or an error row with retry — never a hidden surface. A
 * stale/offline/refreshing chip is shown above cached rows so last-known data is never painted as live.
 */
@Composable
fun AddressInputContent(
    value: String,
    onValueChange: (String) -> Unit,
    onSelect: (AddressLocation) -> Unit,
    display: AddressSuggestions,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    hint: String? = null,
) {
    val accessibleLabel = label ?: stringResource(R.string.translation_addressInput_label)
    var suppressMenu by remember { mutableStateOf(false) }
    val menuExpanded = display.status != AddressInputStatus.Idle && !suppressMenu

    ExposedDropdownMenuBox(
        expanded = menuExpanded,
        onExpandedChange = { wantOpen -> suppressMenu = !wantOpen },
        modifier = modifier,
    ) {
        AddressTextField(
            value = value,
            accessibleLabel = accessibleLabel,
            hasVisibleLabel = label != null,
            hint = hint,
            busy = display.status == AddressInputStatus.Loading || display.refreshing,
            anchor = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable),
            onValueChange = { text ->
                suppressMenu = false
                onValueChange(text)
            },
        )
        ExposedDropdownMenu(
            expanded = menuExpanded,
            onDismissRequest = { suppressMenu = true },
        ) {
            FreshnessChip(display = display)
            when (display.status) {
                AddressInputStatus.Loading -> LoadingRow()
                AddressInputStatus.Empty -> EmptyRow()
                AddressInputStatus.Error -> ErrorRow(onRetry = onRetry)
                AddressInputStatus.Results ->
                    display.suggestions.take(MAX_VISIBLE_SUGGESTIONS).forEach { suggestion ->
                        SuggestionRow(
                            suggestion = suggestion,
                            onClick = {
                                suppressMenu = true
                                onValueChange(suggestion.displayName)
                                onSelect(suggestion.toLocation())
                            },
                        )
                    }
                AddressInputStatus.Idle -> Unit
            }
        }
    }
}

/**
 * The address text field — an [OutlinedTextField] anchored to the dropdown with a leading MapPin glyph
 * (web lucide `MapPin`) and a trailing loading mark while [busy] (web Combobox `loading`). When the caller
 * hides the label (web `hideLabel`), the label name is kept as the field's accessible name so screen
 * readers still announce it.
 */
@Composable
private fun AddressTextField(
    value: String,
    accessibleLabel: String,
    hasVisibleLabel: Boolean,
    hint: String?,
    busy: Boolean,
    anchor: Modifier,
    onValueChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier =
            anchor
                .fillMaxWidth()
                .then(if (hasVisibleLabel) Modifier else Modifier.semantics { contentDescription = accessibleLabel }),
        singleLine = true,
        label = if (hasVisibleLabel) ({ Text(accessibleLabel) }) else null,
        placeholder = hint?.let { text -> { Text(text) } }, // parity:allow Material 3 OutlinedTextField placeholder slot name
        leadingIcon = {
            Icon(DataDisplayGlyphs.MapPin, contentDescription = null, size = IconSize.Sm)
        },
        trailingIcon =
            if (busy) {
                { Spinner(size = SpinnerSize.Sm, accessibleLabel = stringResource(R.string.translation_common_loading)) }
            } else {
                null
            },
        shape = MaterialTheme.shapes.medium,
    )
}

/** A localized loading row shown while a first geocode is in flight (web Combobox `loading`). */
@Composable
private fun LoadingRow() {
    DropdownMenuItem(
        enabled = false,
        onClick = {},
        text = {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Spinner(size = SpinnerSize.Sm, accessibleLabel = stringResource(R.string.translation_common_loading))
                BodyText(stringResource(R.string.translation_common_loading), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        },
    )
}

/** The friendly "No results" row when the geocoder resolved with zero matches (web Combobox empty row). */
@Composable
private fun EmptyRow() {
    DropdownMenuItem(
        enabled = false,
        onClick = {},
        text = { BodyText(stringResource(R.string.translation_combobox_noResults), color = MaterialTheme.colorScheme.onSurfaceVariant) },
    )
}

/** A hard-error row carrying the localized failure message and a retry affordance (prompt state matrix). */
@Composable
private fun ErrorRow(onRetry: () -> Unit) {
    DropdownMenuItem(
        enabled = false,
        onClick = {},
        text = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Icon(
                    DataDisplayGlyphs.MapPin,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.danger,
                )
                ErrorText(stringResource(R.string.translation_error_loadFailed), modifier = Modifier.weight(1f))
                Button(
                    stringResource(R.string.translation_error_retry),
                    onClick = onRetry,
                    variant = ButtonVariant.Outline,
                    size = ButtonSize.Sm,
                )
            }
        },
    )
}

/** One resolved suggestion row: the MapPin glyph + the (up to two-line) display name (web `renderOption`). */
@Composable
private fun SuggestionRow(
    suggestion: AddressSuggestion,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        onClick = onClick,
        leadingIcon = {
            Icon(
                DataDisplayGlyphs.MapPin,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        text = {
            BodyText(suggestion.displayName, maxLines = 2)
        },
    )
}

/**
 * A small freshness banner shown above cached rows: an amber "Offline" chip when cached rows are served
 * because the network was unreachable, or an "updating…" chip while a refresh runs over them — so
 * last-known data is never silently painted as live (ADR-013). Nothing renders when data is fresh.
 */
@Composable
private fun FreshnessChip(display: AddressSuggestions) {
    val offline = display.offline
    val refreshing = display.refreshing && !offline
    val chipModifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.xs)
    when {
        // Cached rows served because the network was unreachable — amber so they read as "last known".
        offline ->
            BodyText(
                stringResource(R.string.translation_common_offline),
                modifier = chipModifier,
                color = TeslaTokens.status.warning,
            )
        // A refresh is running over already-shown rows — a muted "updating…" hint.
        refreshing -> HelperText(stringResource(R.string.translation_freshness_updating), modifier = chipModifier)
        else -> Unit
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_SUGGESTIONS =
    listOf(
        AddressSuggestion("1 Tesla Road, Austin, TX 78725, USA", 30.2241, -97.6186),
        AddressSuggestion("3500 Deer Creek Road, Palo Alto, CA 94304, USA", 37.3947, -122.1503),
        AddressSuggestion("45500 Fremont Blvd, Fremont, CA 94538, USA", 37.4935, -121.9446),
    )

@Preview(name = "AddressInput — results", showBackground = true)
@Composable
private fun AddressInputResultsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AddressInputContent(
            value = "Tesla",
            onValueChange = {},
            onSelect = {},
            display = AddressSuggestions(AddressInputStatus.Results, PREVIEW_SUGGESTIONS),
            onRetry = {},
            label = "Origin",
        )
    }
}

@Preview(name = "AddressInput — loading", showBackground = true)
@Composable
private fun AddressInputLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AddressInputContent(
            value = "Tes",
            onValueChange = {},
            onSelect = {},
            display = AddressSuggestions(AddressInputStatus.Loading),
            onRetry = {},
        )
    }
}

@Preview(name = "AddressInput — empty", showBackground = true)
@Composable
private fun AddressInputEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AddressInputContent(
            value = "zzzzzz",
            onValueChange = {},
            onSelect = {},
            display = AddressSuggestions(AddressInputStatus.Empty),
            onRetry = {},
        )
    }
}

@Preview(name = "AddressInput — error", showBackground = true)
@Composable
private fun AddressInputErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AddressInputContent(
            value = "Tesla",
            onValueChange = {},
            onSelect = {},
            display = AddressSuggestions(AddressInputStatus.Error, canRetry = true),
            onRetry = {},
        )
    }
}

@Preview(name = "AddressInput — offline (cached)", showBackground = true)
@Composable
private fun AddressInputOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AddressInputContent(
            value = "Tesla",
            onValueChange = {},
            onSelect = {},
            display =
                AddressSuggestions(
                    status = AddressInputStatus.Results,
                    suggestions = PREVIEW_SUGGESTIONS,
                    stale = true,
                    offline = true,
                    canRetry = true,
                ),
            onRetry = {},
        )
    }
}

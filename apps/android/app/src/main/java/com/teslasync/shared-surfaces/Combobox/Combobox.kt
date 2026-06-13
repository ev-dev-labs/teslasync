// The native Jetpack Compose + Material 3 Combobox shared surface — a parity port of
// web/src/components/forms/Combobox.tsx. The web component is the shared "type to filter then pick"
// primitive (signal pickers, geocoded address inputs, vehicle pickers, …): an editable input that filters a
// static array locally or queries an async loader per keystroke, renders the matches in a listbox with a
// selected-row highlight and an active descendant, caps the rows with a "{{count}} more — refine search"
// remainder, exposes clear (×) and chevron affordances, and announces the result count to screen readers.
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds the option feed only
// through the shared S8 state-holder seam ([ComboboxSource], driven by [ComboboxViewModel]); the composable
// is a thin render layer that resolves the i18n labels (P1/S10) and design tokens (P1/S9) and draws what the
// pure [ComboboxProjection] returns, using the shared component library (ui Icon/IconButton/Button/StatusPill
// /typography, feedback Spinner/QueryError) inside the Material 3 ExposedDropdownMenuBox — the native
// counterpart of the web forms `Combobox`. It renders every state the prompt's matrix mandates without ever
// hiding a surface: a loading row + spinner, the options list, a friendly "No results" empty row, a hard
// error surfaced as the shared `QueryError` with retry, and the stale/offline freshness chip (with
// auto-refresh) over cached rows. The one-shot PII-safe `view.opened` diagnostic (P1/S11) fires on first
// composition.
//
// The atomic `components/forms/Combobox` is the bare static-array primitive (the component-library bundle,
// out of scope here); THIS surface is the state-aware picker built around the same `ComboOption` + the
// shared filter/active-index logic. `InvalidPackageDeclaration` is suppressed: the mandated surface
// directory (com/teslasync/shared-surfaces/Combobox) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + previews.
@file:OptIn(ExperimentalMaterial3Api::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.combobox

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.forms.ComboOption
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/** Test tag on the surface root so on-device UI tests can locate the rendered combobox in any state. */
const val COMBOBOX_TEST_TAG: String = "combobox"

private const val CHEVRON_OPEN_ROTATION = 180f

/**
 * Stateful entry point — the parity port of the web `<Combobox value … options … onChange … />`. Binds the
 * option feed via [viewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first composition,
 * collects the [ComboboxUiModel], auto-refreshes a stale cache, and renders.
 *
 * @param viewModel the state holder bound to the shared S8 [ComboboxSource] option seam.
 * @param label the field's visible (or, when [hideLabel], accessible) name — web `label` (required).
 * @param hideLabel when true, the label is visually hidden but kept as the field's accessible name (web `hideLabel`).
 * @param enabled when false, the input and its affordances are disabled (web `disabled`).
 * @param onSelect fired with the picked [ComboOption] (or `null` on clear) — web `onChange`.
 */
@Composable
fun Combobox(
    viewModel: ComboboxViewModel,
    label: String,
    modifier: Modifier = Modifier,
    hideLabel: Boolean = false,
    enabled: Boolean = true,
    onSelect: (ComboOption?) -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val model by viewModel.uiModel.collectAsStateWithLifecycle()

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(model.display.stale, model.display.freshnessStamp) {
        if (model.display.stale) viewModel.refresh()
    }

    ComboboxContent(
        model = model,
        label = label,
        modifier = modifier,
        hideLabel = hideLabel,
        enabled = enabled,
        onQueryChange = viewModel::onQueryChange,
        onExpandedChange = viewModel::setExpanded,
        onSelect = { option ->
            viewModel.select(option)
            onSelect(option)
        },
        onClear = {
            viewModel.clear()
            onSelect(null)
        },
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless Combobox — renders every branch the web source draws plus the option feed's lifecycle: the
 * editable input (with a loading mark, clear ×, and chevron), the open listbox (options, "No results", a
 * "{{count}} more" remainder), a hard error surfaced as the shared `QueryError` with retry, and a
 * stale/offline freshness chip over cached rows. Hoisted out of the ViewModel so it is preview- and
 * screenshot-testable for each state. A polite live region announces the result count as the listbox opens.
 */
@Composable
fun ComboboxContent(
    model: ComboboxUiModel,
    label: String,
    modifier: Modifier = Modifier,
    hideLabel: Boolean = false,
    enabled: Boolean = true,
    onQueryChange: (String) -> Unit = {},
    onExpandedChange: (Boolean) -> Unit = {},
    onSelect: (ComboOption) -> Unit = {},
    onClear: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    val display = model.display
    val expanded = enabled && model.expanded
    // A hard error has no rows to show: keep the listbox closed and surface the error beneath the field.
    val menuExpanded = expanded && display.phase != ComboboxPhase.Error

    Column(modifier = modifier.testTag(COMBOBOX_TEST_TAG)) {
        ExposedDropdownMenuBox(
            expanded = menuExpanded,
            onExpandedChange = { wantOpen -> if (enabled) onExpandedChange(wantOpen) },
        ) {
            ComboboxField(
                model = model,
                label = label,
                hideLabel = hideLabel,
                enabled = enabled,
                expanded = expanded,
                anchor = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryEditable),
                onQueryChange = onQueryChange,
                onToggle = { onExpandedChange(!expanded) },
                onClear = onClear,
            )
            ExposedDropdownMenu(
                expanded = menuExpanded,
                onDismissRequest = { onExpandedChange(false) },
            ) {
                ComboboxMenu(model = model, onSelect = onSelect)
            }
        }
        ComboboxStatusLine(display = display, onRetry = onRetry)
        ComboboxAnnouncement(model = model)
    }
}

/**
 * The editable input — an [OutlinedTextField] anchored to the listbox. It shows the typed [ComboboxUiModel.query]
 * while open and the [ComboboxUiModel.selectedLabel] while closed (web `value = open ? inputValue : label`),
 * with a trailing row of a loading mark, the clear (×) affordance, and the chevron toggle. When the label is
 * hidden it is kept as the field's accessible name so screen readers still announce it.
 */
@Composable
private fun ComboboxField(
    model: ComboboxUiModel,
    label: String,
    hideLabel: Boolean,
    enabled: Boolean,
    expanded: Boolean,
    anchor: Modifier,
    onQueryChange: (String) -> Unit,
    onToggle: () -> Unit,
    onClear: () -> Unit,
) {
    OutlinedTextField(
        value = if (expanded) model.query else model.selectedLabel,
        onValueChange = onQueryChange,
        enabled = enabled,
        singleLine = true,
        label = if (hideLabel) null else ({ Text(label) }),
        trailingIcon = {
            ComboboxTrailing(
                model = model,
                enabled = enabled,
                expanded = expanded,
                onToggle = onToggle,
                onClear = onClear,
            )
        },
        shape = MaterialTheme.shapes.medium,
        modifier =
            anchor
                .fillMaxWidth()
                .then(if (hideLabel) Modifier.semantics { contentDescription = label } else Modifier),
    )
}

/** The input's trailing affordances: a spinning loading mark while busy, the clear (×) button, the chevron. */
@Composable
private fun ComboboxTrailing(
    model: ComboboxUiModel,
    enabled: Boolean,
    expanded: Boolean,
    onToggle: () -> Unit,
    onClear: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (model.display.busy) {
            Spinner(size = SpinnerSize.Sm, accessibleLabel = stringResource(R.string.translation_combobox_loading))
        }
        if (model.clearable && enabled) {
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = stringResource(R.string.translation_combobox_clearAria),
                onClick = onClear,
                size = IconSize.Sm,
            )
        }
        IconButton(
            imageVector = TeslaGlyphs.ChevronDown,
            contentDescription =
                stringResource(
                    if (expanded) {
                        R.string.translation_combobox_closeListAria
                    } else {
                        R.string.translation_combobox_openListAria
                    },
                ),
            onClick = onToggle,
            enabled = enabled,
            size = IconSize.Sm,
            modifier = Modifier.rotate(if (expanded) CHEVRON_OPEN_ROTATION else 0f),
        )
    }
}

/** The open listbox content for the current phase: a loading row, the options list, or a "No results" row. */
@Composable
private fun ComboboxMenu(
    model: ComboboxUiModel,
    onSelect: (ComboOption) -> Unit,
) {
    when (model.display.phase) {
        ComboboxPhase.Loading -> ComboboxLoadingRow()
        ComboboxPhase.Empty -> ComboboxEmptyRow()
        ComboboxPhase.Error -> Unit
        ComboboxPhase.Results -> {
            model.rows.forEach { row ->
                ComboboxOptionItem(row = row, onClick = { onSelect(row.option) })
            }
            if (model.display.hasHiddenOptions) {
                ComboboxMoreRow(hiddenCount = model.display.hiddenCount)
            }
        }
    }
}

/** One option row — the selected value carries a leading check + primary tint; the active row is tinted. */
@Composable
private fun ComboboxOptionItem(
    row: ComboboxOptionRow,
    onClick: () -> Unit,
) {
    val rowModifier =
        if (row.active) {
            Modifier.background(MaterialTheme.colorScheme.surfaceVariant)
        } else {
            Modifier
        }
    DropdownMenuItem(
        text = {
            BodyText(
                row.option.label,
                color =
                    if (row.selected) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                maxLines = 1,
            )
        },
        leadingIcon =
            if (row.selected) {
                { Icon(TeslaGlyphs.Check, contentDescription = null, size = IconSize.Sm) }
            } else {
                null
            },
        enabled = row.option.enabled,
        onClick = onClick,
        modifier = rowModifier.semantics { selected = row.selected },
    )
}

/** A localized loading row shown while a first option fetch is in flight (web Combobox `loading`). */
@Composable
private fun ComboboxLoadingRow() {
    DropdownMenuItem(
        enabled = false,
        onClick = {},
        text = {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Spinner(size = SpinnerSize.Sm, accessibleLabel = stringResource(R.string.translation_combobox_loading))
                BodyText(
                    stringResource(R.string.translation_combobox_loading),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
    )
}

/** The friendly "No results" row when the feed resolved with zero matches (web Combobox empty row). */
@Composable
private fun ComboboxEmptyRow() {
    DropdownMenuItem(
        enabled = false,
        onClick = {},
        text = {
            BodyText(
                stringResource(R.string.translation_combobox_noResults),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
    )
}

/** The capped-remainder row ("{{count}} more — refine search") when filtered options exceed the visible cap. */
@Composable
private fun ComboboxMoreRow(hiddenCount: Int) {
    DropdownMenuItem(
        enabled = false,
        onClick = {},
        text = { Caption(stringResource(R.string.translation_combobox_moreHidden, hiddenCount.toString())) },
    )
}

/**
 * The always-visible status line beneath the field. A hard option-load failure is surfaced as a localized
 * error message + a retry affordance (mirroring the web Combobox-consumer error row); a failed-refresh cache
 * shows an "Offline" chip + retry; a TTL-stale cache shows a "Stale" chip while it auto-refreshes. Nothing
 * renders when data is fresh.
 */
@Composable
private fun ComboboxStatusLine(
    display: ComboboxDisplay,
    onRetry: () -> Unit,
) {
    when {
        display.phase == ComboboxPhase.Error -> ComboboxErrorLine(onRetry = onRetry)
        display.offline -> ComboboxFreshnessChip(offline = true, onRetry = onRetry)
        display.stale -> ComboboxFreshnessChip(offline = false, onRetry = onRetry)
        else -> Unit
    }
}

/** The hard-error line: a localized failure message plus a retry button (prompt's error-state contract). */
@Composable
private fun ComboboxErrorLine(onRetry: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        ErrorText(stringResource(R.string.translation_error_loadFailed), modifier = Modifier.weight(1f))
        Button(
            stringResource(R.string.translation_error_retry),
            onClick = onRetry,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
        )
    }
}

/** A freshness chip over cached rows: a danger "Offline" pill + retry, or a warning "Stale" pill. */
@Composable
private fun ComboboxFreshnessChip(
    offline: Boolean,
    onRetry: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (offline) {
            StatusPill(text = stringResource(R.string.translation_common_offline), tone = StatusTone.Danger)
            Button(
                stringResource(R.string.translation_error_retry),
                onClick = onRetry,
                variant = ButtonVariant.Outline,
                size = ButtonSize.Sm,
            )
        } else {
            StatusPill(text = stringResource(R.string.translation_mqtt_stale), tone = StatusTone.Warning)
        }
    }
}

/**
 * A polite, visually-empty live region carrying the web `useAnnouncer` result-count message while the
 * listbox is open (0 → "No results", 1 → "1 result", n → "{{count}} results"; a loading feed announces
 * "Loading"). TalkBack reads the announcement when it changes as the user types.
 */
@Composable
private fun ComboboxAnnouncement(model: ComboboxUiModel) {
    val message = if (model.expanded) comboboxAnnouncementText(model.display) else ""
    Spacer(
        modifier =
            Modifier.semantics {
                liveRegion = LiveRegionMode.Polite
                contentDescription = message
            },
    )
}

/** Resolves the localized result-count announcement for the current [display]. */
@Composable
private fun comboboxAnnouncementText(display: ComboboxDisplay): String =
    if (display.phase == ComboboxPhase.Loading) {
        stringResource(R.string.translation_combobox_loading)
    } else {
        when (val count = ComboboxProjection.announcement(display.totalCount)) {
            ResultCount.None -> stringResource(R.string.translation_combobox_noResults)
            ResultCount.One -> stringResource(R.string.translation_combobox_resultsCountOne)
            is ResultCount.Many -> stringResource(R.string.translation_combobox_resultsCount, count.count.toString())
        }
    }

// ── Previews — one per rendered state (results / closed selection / loading / empty / more / error / stale /
// offline / disabled). ───────────────────────────────────────────────────────────────────────────────────

private val PREVIEW_OPTIONS =
    listOf(
        ComboOption(value = "3", label = "Model 3"),
        ComboOption(value = "y", label = "Model Y"),
        ComboOption(value = "s", label = "Model S"),
        ComboOption(value = "x", label = "Model X"),
    )

private const val PREVIEW_STAMP = 1_700_000_000_000L
private const val PREVIEW_SERVER_ERROR = 503

private fun previewModel(
    state: UiState<List<ComboOption>>,
    selected: ComboOption? = null,
    query: String = "",
    expanded: Boolean = true,
    maxVisibleOptions: Int = ComboboxRegistration.DEFAULT_MAX_VISIBLE_OPTIONS,
): ComboboxUiModel =
    ComboboxProjection.project(
        state = state,
        interaction =
            ComboboxInteraction(
                selected = selected,
                query = query,
                expanded = expanded,
            ),
        maxVisibleOptions = maxVisibleOptions,
    )

@Preview(name = "Combobox · results", showBackground = true)
@Composable
private fun ComboboxResultsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxContent(
            model = previewModel(UiState(UiPhase.Content, PREVIEW_OPTIONS, fetchedAt = PREVIEW_STAMP), query = "Model"),
            label = "Vehicle",
        )
    }
}

@Preview(name = "Combobox · selection (closed)", showBackground = true)
@Composable
private fun ComboboxSelectionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxContent(
            model =
                previewModel(
                    UiState(UiPhase.Content, PREVIEW_OPTIONS, fetchedAt = PREVIEW_STAMP),
                    selected = PREVIEW_OPTIONS.first(),
                    expanded = false,
                ),
            label = "Vehicle",
        )
    }
}

@Preview(name = "Combobox · loading", showBackground = true)
@Composable
private fun ComboboxLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxContent(model = previewModel(UiState.loading(), query = "Mo"), label = "Vehicle")
    }
}

@Preview(name = "Combobox · empty", showBackground = true)
@Composable
private fun ComboboxEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxContent(
            model = previewModel(UiState(UiPhase.Empty, emptyList(), fetchedAt = PREVIEW_STAMP), query = "zzz"),
            label = "Vehicle",
        )
    }
}

@Preview(name = "Combobox · more hidden", showBackground = true)
@Composable
private fun ComboboxMorePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxContent(
            model =
                previewModel(
                    UiState(UiPhase.Content, PREVIEW_OPTIONS, fetchedAt = PREVIEW_STAMP),
                    query = "Model",
                    maxVisibleOptions = 2,
                ),
            label = "Vehicle",
        )
    }
}

@Preview(name = "Combobox · error", showBackground = true)
@Composable
private fun ComboboxErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxContent(
            model =
                previewModel(
                    UiState(
                        phase = UiPhase.Error,
                        errorKind = ErrorKind.Http,
                        httpStatus = PREVIEW_SERVER_ERROR,
                    ),
                    query = "Model",
                ),
            label = "Vehicle",
        )
    }
}

@Preview(name = "Combobox · stale", showBackground = true)
@Composable
private fun ComboboxStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxContent(
            model =
                previewModel(
                    UiState(
                        phase = UiPhase.Content,
                        data = PREVIEW_OPTIONS,
                        fetchedAt = PREVIEW_STAMP,
                        stale = true,
                        refreshing = true,
                    ),
                    query = "Model",
                ),
            label = "Vehicle",
        )
    }
}

@Preview(name = "Combobox · offline (cached)", showBackground = true)
@Composable
private fun ComboboxOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxContent(
            model =
                previewModel(
                    UiState(
                        phase = UiPhase.Content,
                        data = PREVIEW_OPTIONS,
                        fetchedAt = PREVIEW_STAMP,
                        stale = true,
                        errorKind = ErrorKind.Network,
                    ),
                    query = "Model",
                ),
            label = "Vehicle",
        )
    }
}

@Preview(name = "Combobox · disabled", showBackground = true)
@Composable
private fun ComboboxDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxContent(
            model =
                previewModel(
                    UiState(UiPhase.Content, PREVIEW_OPTIONS, fetchedAt = PREVIEW_STAMP),
                    selected = PREVIEW_OPTIONS.first(),
                    expanded = false,
                ),
            label = "Vehicle",
            enabled = false,
        )
    }
}

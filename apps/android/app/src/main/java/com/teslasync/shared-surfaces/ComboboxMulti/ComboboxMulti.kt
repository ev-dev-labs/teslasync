// The native Jetpack Compose + Material 3 ComboboxMulti shared surface — a parity port of
// web/src/components/forms/ComboboxMulti.tsx. The web component is a fully-controlled WAI-ARIA multi-select
// combobox: the selected `value` renders as removable chips inside the field, a text input filters / adds the
// next option, an `options` array (static OR an async loader) feeds the dropdown, already-selected options are
// hidden from the list, ArrowUp/Down/Home/End/Enter/Escape/Backspace drive keyboard selection, and a polite
// live region (`useAnnouncer`) voices the result count + chip removals. This surface keeps that contract end to
// end and renders every state the web source draws without ever hiding a region: the chips + filter field, the
// trailing loading spinner, the open dropdown's option list, the "No results" / "Maximum reached" empty rows,
// the "Loading" row, the "{{count}} more — refine search" overflow footer, and — for the genuine async-loader
// lifecycle the web `options` prop carries — a hard error with retry plus a stale/offline freshness chip over
// last-known options.
//
// It performs NO HTTP. The options bind only through the caller-supplied [ComboboxMultiOptionsSource] (the web
// `options` prop) folded through [ComboboxMultiViewModel] + the pure [ComboboxMultiProjection]; the composable
// resolves the i18n copy (P1/S10), reads the design tokens (P1/S9), binds the shared `useAnnouncer` state
// holder (P1/S8 [Announcer]), and draws what the projection returns with the shared component library (ui
// chips/typography/StatusPill, feedback QueryError, motion FadeIn). The one-shot PII-safe `view.opened`
// diagnostic (P1/S11) is emitted on first composition. The web `useId` (DOM ids for aria-controls /
// activedescendant) is realised through Compose semantics + test tags — Compose wires the a11y tree directly,
// so no manual id strings are needed.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ComboboxMulti) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content, strings holder, callbacks, and previews.
@file:OptIn(ExperimentalLayoutApi::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.comboboxmulti

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.FieldLabelText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.announcerregion.Announcer
import io.teslasync.android.sharedsurfaces.announcerregion.GlobalAnnouncer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag for the filter text field (web `role="combobox"` input). */
const val COMBOBOX_MULTI_INPUT_TAG: String = "comboboxMulti.input"

/** Test tag for the open dropdown container (web `role="listbox"`). */
const val COMBOBOX_MULTI_DROPDOWN_TAG: String = "comboboxMulti.dropdown"

/** Test tag for the visually-hidden loading status live region (web `statusId` `VisuallyHidden`). */
const val COMBOBOX_MULTI_STATUS_TAG: String = "comboboxMulti.status"

/** Test tag for the dropdown "Loading" row. */
const val COMBOBOX_MULTI_LOADING_TAG: String = "comboboxMulti.loading"

/** Test tag for the dropdown empty ("No results" / "Maximum reached") row. */
const val COMBOBOX_MULTI_EMPTY_TAG: String = "comboboxMulti.empty"

/** Test tag for the dropdown hard-error surface. */
const val COMBOBOX_MULTI_ERROR_TAG: String = "comboboxMulti.error"

/** Test tag for the "{{count}} more — refine search" overflow footer. */
const val COMBOBOX_MULTI_OVERFLOW_TAG: String = "comboboxMulti.overflow"

/** Test tag for the trailing loading spinner. */
const val COMBOBOX_MULTI_SPINNER_TAG: String = "comboboxMulti.spinner"

/**
 * Localized copy the surface folds into its output. Built from `stringResource` at the render boundary (tests
 * pass a deterministic instance), keeping the projection a pure, locale-stable function. Every string resolves
 * through the P1/S10 catalog; the templated members honour both the Android `%1$s` arg and the web ICU
 * `{{count}}`/`{{label}}` token so the same holder serves production and web-shaped test fixtures.
 */
data class ComboboxMultiStrings(
    val noResults: String,
    val resultsCountOne: String,
    val resultsCountTemplate: String,
    val removedChipTemplate: String,
    val removeChipTemplate: String,
    val maxReached: String,
    val loading: String,
    val hideOptions: String,
    val showOptions: String,
    val moreHiddenTemplate: String,
    val stale: String,
    val offline: String,
) {
    /** "{{count}} results" filled for [count]. */
    fun resultsCount(count: Int): String = fill(resultsCountTemplate, count.toString())

    /** "Removed {{label}}" filled for [label]. */
    fun removedChip(label: String): String = fill(removedChipTemplate, label)

    /** "Remove {{label}}" filled for [label]. */
    fun removeChip(label: String): String = fill(removeChipTemplate, label)

    /** "{{count}} more — refine search" filled for [count]. */
    fun moreHidden(count: Int): String = fill(moreHiddenTemplate, count.toString())

    private fun fill(
        template: String,
        value: String,
    ): String = template.replace(ARG_TOKEN, value).replace(COUNT_TOKEN, value).replace(LABEL_TOKEN, value)

    private companion object {
        const val ARG_TOKEN = "%1\$s"
        const val COUNT_TOKEN = "{{count}}"
        const val LABEL_TOKEN = "{{label}}"
    }
}

/**
 * The user-action callbacks the stateless [ComboboxMultiContent] raises. Defaulted to no-ops so previews and
 * screenshot tests can render every state without wiring a host. The stateful [ComboboxMulti] supplies the real
 * implementations bound to the [ComboboxMultiViewModel] + the controlled `onValueChange`.
 */
data class ComboboxMultiCallbacks(
    val onQueryChange: (String) -> Unit = {},
    val onFocus: () -> Unit = {},
    val onToggle: () -> Unit = {},
    val onActiveIndexChange: (Int) -> Unit = {},
    val onMoveDown: () -> Unit = {},
    val onMoveUp: () -> Unit = {},
    val onMoveToStart: () -> Unit = {},
    val onMoveToEnd: () -> Unit = {},
    val onClose: () -> Unit = {},
    val onAdd: (ComboboxMultiOption) -> Unit = {},
    val onRemove: (Int) -> Unit = {},
    val onRetry: () -> Unit = {},
)

/**
 * Stateful entry point — the parity port of the web `ComboboxMulti`. Binds the caller's [optionsSource] into a
 * [ComboboxMultiViewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first composition,
 * collects the interaction + options state, projects them with the controlled [value], auto-refreshes a stale
 * cache, announces result counts + chip removals through the shared [announcer] (web `useAnnouncer`), and
 * renders. The selection stays controlled (web `value` / `onChange`).
 *
 * @param value the selected options (web `value`).
 * @param onValueChange fired when a chip is added or removed (web `onChange`).
 * @param optionsSource the static/async options seam (web `options`).
 * @param label the required visible-or-accessible field label.
 */
@Composable
fun ComboboxMulti(
    value: List<ComboboxMultiOption>,
    onValueChange: (List<ComboboxMultiOption>) -> Unit,
    optionsSource: ComboboxMultiOptionsSource,
    label: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
    hideLabel: Boolean = false,
    disabled: Boolean = false,
    loading: Boolean = false,
    maxItems: Int? = null,
    maxVisibleOptions: Int = ComboboxMultiRegistration.DEFAULT_MAX_VISIBLE_OPTIONS,
    asyncDebounceMs: Long = ComboboxMultiRegistration.DEFAULT_ASYNC_DEBOUNCE_MS,
    noChevron: Boolean = false,
    announcer: Announcer = GlobalAnnouncer,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ComboboxMultiViewModel =
        viewModel(
            key = ComboboxMultiRegistration.SLUG,
            factory = ComboboxMultiViewModel.factory(optionsSource, logger, asyncDebounceMs),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val optionsState by viewModel.options.collectAsStateWithLifecycle()
    val strings = rememberComboboxMultiStrings()

    val display =
        remember(optionsState, value, interaction.query, maxItems, maxVisibleOptions, loading) {
            ComboboxMultiProjection.project(
                optionsState = optionsState,
                request =
                    ComboboxMultiRequest(
                        query = interaction.query,
                        selected = value,
                        maxItems = maxItems,
                        maxVisibleOptions = maxVisibleOptions,
                        loading = loading,
                    ),
            )
        }

    LaunchedEffect(interaction.open, display.visibleOptions.size) {
        viewModel.syncActiveIndex(display.visibleOptions.size)
    }
    LaunchedEffect(display.stale, optionsState.fetchedAt) {
        if (display.stale) viewModel.refresh()
    }
    val resultMessage =
        announcementText(strings, ComboboxMultiProjection.resultAnnouncement(display.totalMatches), display.totalMatches)
    LaunchedEffect(interaction.open, display.fieldLoading, resultMessage) {
        if (interaction.open && !display.fieldLoading) announcer.announce(resultMessage)
    }

    FadeIn(modifier = modifier) {
        ComboboxMultiContent(
            value = value,
            interaction = interaction,
            display = display,
            strings = strings,
            label = label,
            hint = hint,
            hideLabel = hideLabel,
            disabled = disabled,
            maxItems = maxItems,
            noChevron = noChevron,
            callbacks =
                ComboboxMultiCallbacks(
                    onQueryChange = viewModel::setQuery,
                    onFocus = { if (!disabled) viewModel.openDropdown() },
                    onToggle = { if (!disabled) viewModel.toggleDropdown() },
                    onActiveIndexChange = viewModel::setActiveIndex,
                    onMoveDown = { viewModel.moveActiveDown(display.visibleOptions.size) },
                    onMoveUp = { viewModel.moveActiveUp(display.visibleOptions.size) },
                    onMoveToStart = viewModel::moveActiveToStart,
                    onMoveToEnd = { viewModel.moveActiveToEnd(display.visibleOptions.size) },
                    onClose = viewModel::closeDropdown,
                    onAdd = { option -> addOption(value, option, display.atMax, onValueChange, viewModel) },
                    onRemove = { index -> removeOption(value, index, onValueChange, announcer, strings) },
                    onRetry = viewModel::retry,
                ),
        )
    }
}

private fun addOption(
    value: List<ComboboxMultiOption>,
    option: ComboboxMultiOption,
    atMax: Boolean,
    onValueChange: (List<ComboboxMultiOption>) -> Unit,
    viewModel: ComboboxMultiViewModel,
) {
    if (atMax || value.any { it.key == option.key }) return
    onValueChange(value + option)
    viewModel.onOptionCommitted()
}

private fun removeOption(
    value: List<ComboboxMultiOption>,
    index: Int,
    onValueChange: (List<ComboboxMultiOption>) -> Unit,
    announcer: Announcer,
    strings: ComboboxMultiStrings,
) {
    if (index !in value.indices) return
    val removed = value[index]
    onValueChange(value.toMutableList().also { it.removeAt(index) })
    announcer.announce(strings.removedChip(removed.chipLabel))
}

/**
 * Stateless ComboboxMulti — renders every branch the web source draws (the chips + filter field, the trailing
 * spinner, the open dropdown's loading / options / empty / max-reached / overflow rows, and the async-feed's
 * error + stale/offline surfaces) plus the visually-hidden loading status region. Hoisted out of the ViewModel
 * so it is preview- and screenshot-testable for each state.
 */
@Composable
fun ComboboxMultiContent(
    value: List<ComboboxMultiOption>,
    interaction: ComboboxMultiInteraction,
    display: ComboboxMultiDisplay,
    strings: ComboboxMultiStrings,
    label: String,
    modifier: Modifier = Modifier,
    hint: String? = null,
    hideLabel: Boolean = false,
    disabled: Boolean = false,
    maxItems: Int? = null,
    noChevron: Boolean = false,
    callbacks: ComboboxMultiCallbacks = ComboboxMultiCallbacks(),
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        if (!hideLabel) {
            FieldLabelText(labelWithCount(label, value.size, maxItems))
        }
        ComboboxField(
            value = value,
            interaction = interaction,
            display = display,
            strings = strings,
            label = labelWithCount(label, value.size, maxItems),
            hint = hint,
            disabled = disabled,
            noChevron = noChevron,
            callbacks = callbacks,
        )
        StatusRegion(loading = display.fieldLoading, strings = strings)
        if (interaction.open) {
            ComboboxDropdown(
                interaction = interaction,
                display = display,
                strings = strings,
                label = label,
                callbacks = callbacks,
            )
        }
    }
}

@Composable
private fun ComboboxField(
    value: List<ComboboxMultiOption>,
    interaction: ComboboxMultiInteraction,
    display: ComboboxMultiDisplay,
    strings: ComboboxMultiStrings,
    label: String,
    hint: String?,
    disabled: Boolean,
    noChevron: Boolean,
    callbacks: ComboboxMultiCallbacks,
) {
    val focusRequester = remember { FocusRequester() }
    Surface(
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth().alpha(if (disabled) DISABLED_ALPHA else 1f),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable(enabled = !disabled) { focusRequester.requestFocus() }
                    .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            FlowRow(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                value.forEachIndexed { index, option ->
                    ComboboxChip(
                        option = option,
                        strings = strings,
                        enabled = !disabled,
                        onRemove = { callbacks.onRemove(index) },
                    )
                }
                FilterInput(
                    value = value,
                    interaction = interaction,
                    display = display,
                    strings = strings,
                    label = label,
                    hint = hint,
                    disabled = disabled,
                    focusRequester = focusRequester,
                    callbacks = callbacks,
                )
            }
            if (display.fieldLoading) {
                FieldSpinner(strings)
            }
            if (!noChevron) {
                ChevronToggle(
                    open = interaction.open,
                    enabled = !disabled,
                    strings = strings,
                    onToggle = callbacks.onToggle,
                )
            }
        }
    }
}

@Composable
private fun FilterInput(
    value: List<ComboboxMultiOption>,
    interaction: ComboboxMultiInteraction,
    display: ComboboxMultiDisplay,
    strings: ComboboxMultiStrings,
    label: String,
    hint: String?,
    disabled: Boolean,
    focusRequester: FocusRequester,
    callbacks: ComboboxMultiCallbacks,
) {
    // Ghost-prompt precedence, web parity: empty selection → caller hint; at the cap → "Maximum reached";
    // otherwise nothing (the chips already convey the selection).
    val ghostPrompt =
        when {
            value.isEmpty() -> hint
            display.atMax -> strings.maxReached
            else -> null
        }
    BasicTextField(
        value = interaction.query,
        onValueChange = callbacks.onQueryChange,
        enabled = !disabled,
        singleLine = true,
        textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        modifier =
            Modifier
                .widthIn(min = INPUT_MIN_WIDTH)
                .focusRequester(focusRequester)
                .onFocusChanged { if (it.isFocused) callbacks.onFocus() }
                .onPreviewKeyEvent { event -> handleComboboxKey(event, interaction, display, value, callbacks) }
                .testTag(COMBOBOX_MULTI_INPUT_TAG)
                .semantics { contentDescription = label },
        decorationBox = { innerTextField ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (interaction.query.isEmpty() && !ghostPrompt.isNullOrEmpty()) {
                    Text(
                        text = ghostPrompt,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                innerTextField()
            }
        },
    )
}

@Composable
private fun ComboboxChip(
    option: ComboboxMultiOption,
    strings: ComboboxMultiStrings,
    enabled: Boolean,
    onRemove: () -> Unit,
) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
    ) {
        Row(
            modifier = Modifier.padding(start = Spacing.sm, end = Spacing.xs, top = Spacing.xs, bottom = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = option.chipLabel,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = CHIP_MAX_WIDTH),
            )
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = strings.removeChip(option.chipLabel),
                onClick = onRemove,
                enabled = enabled,
                size = IconSize.Xs,
            )
        }
    }
}

@Composable
private fun ChevronToggle(
    open: Boolean,
    enabled: Boolean,
    strings: ComboboxMultiStrings,
    onToggle: () -> Unit,
) {
    val rotation by animateFloatAsState(if (open) CHEVRON_OPEN_DEG else 0f, label = "comboboxMulti.chevron")
    val description = if (open) strings.hideOptions else strings.showOptions
    Box(
        modifier =
            Modifier
                .size(TOGGLE_SIZE)
                .clip(CircleShape)
                .clickable(enabled = enabled, role = Role.Button, onClickLabel = description, onClick = onToggle)
                .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            TeslaGlyphs.ChevronDown,
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.rotate(rotation),
        )
    }
}

@Composable
private fun FieldSpinner(strings: ComboboxMultiStrings) {
    CircularProgressIndicator(
        modifier =
            Modifier
                .size(SPINNER_SIZE)
                .testTag(COMBOBOX_MULTI_SPINNER_TAG)
                .semantics { contentDescription = strings.loading },
        strokeWidth = SPINNER_STROKE,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun StatusRegion(
    loading: Boolean,
    strings: ComboboxMultiStrings,
) {
    Box(
        modifier =
            Modifier
                .size(STATUS_REGION_SIZE)
                .testTag(COMBOBOX_MULTI_STATUS_TAG)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = if (loading) strings.loading else ""
                },
    )
}

@Composable
private fun ComboboxDropdown(
    interaction: ComboboxMultiInteraction,
    display: ComboboxMultiDisplay,
    strings: ComboboxMultiStrings,
    label: String,
    callbacks: ComboboxMultiCallbacks,
) {
    Surface(
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surface,
        tonalElevation = Elevation.overlay,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        modifier = Modifier.fillMaxWidth().testTag(COMBOBOX_MULTI_DROPDOWN_TAG),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = DROPDOWN_MAX_HEIGHT)
                    .verticalScroll(rememberScrollState())
                    .padding(vertical = Spacing.xs)
                    .semantics { contentDescription = label },
        ) {
            if (display.showFreshnessChip) {
                FreshnessRow(display = display, strings = strings)
            }
            when (display.listPhase) {
                ComboboxListPhase.Loading -> DropdownMessageRow(strings.loading, COMBOBOX_MULTI_LOADING_TAG)
                ComboboxListPhase.Error -> DropdownError(display = display, label = label, onRetry = callbacks.onRetry)
                ComboboxListPhase.Empty ->
                    DropdownMessageRow(
                        if (display.atMax) strings.maxReached else strings.noResults,
                        COMBOBOX_MULTI_EMPTY_TAG,
                    )
                ComboboxListPhase.Options -> DropdownOptions(interaction = interaction, display = display, callbacks = callbacks)
            }
            if (display.listPhase == ComboboxListPhase.Options && display.hasOverflow) {
                OverflowRow(strings.moreHidden(display.overflowCount))
            }
        }
    }
}

@Composable
private fun DropdownOptions(
    interaction: ComboboxMultiInteraction,
    display: ComboboxMultiDisplay,
    callbacks: ComboboxMultiCallbacks,
) {
    display.visibleOptions.forEachIndexed { index, option ->
        OptionRow(
            option = option,
            isActive = index == interaction.activeIndex,
            atMax = display.atMax,
            onClick = { callbacks.onAdd(option) },
        )
    }
}

@Composable
private fun OptionRow(
    option: ComboboxMultiOption,
    isActive: Boolean,
    atMax: Boolean,
    onClick: () -> Unit,
) {
    val background = if (isActive) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(background)
                .clickable(enabled = !atMax, role = Role.Button, onClickLabel = option.label, onClick = onClick)
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .alpha(if (atMax) DISABLED_ALPHA else 1f)
                .semantics { contentDescription = option.label },
    ) {
        BodyText(option.label, maxLines = 1)
    }
}

@Composable
private fun DropdownMessageRow(
    message: String,
    tag: String,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .testTag(tag),
    ) {
        HelperText(message)
    }
}

@Composable
private fun OverflowRow(message: String) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.xs)
                .testTag(COMBOBOX_MULTI_OVERFLOW_TAG),
    ) {
        Caption(message)
    }
}

@Composable
private fun FreshnessRow(
    display: ComboboxMultiDisplay,
    strings: ComboboxMultiStrings,
) {
    Box(modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.xs)) {
        if (display.offline) {
            StatusPill(text = strings.offline, tone = StatusTone.Danger)
        } else {
            StatusPill(text = strings.stale, tone = StatusTone.Warning)
        }
    }
}

@Composable
private fun DropdownError(
    display: ComboboxMultiDisplay,
    label: String,
    onRetry: () -> Unit,
) {
    QueryError(
        kind = ComboboxMultiProjection.queryErrorKind(display.errorKind, display.httpStatus),
        resourceName = label,
        onRetry = onRetry,
        modifier = Modifier.fillMaxWidth().padding(Spacing.sm).testTag(COMBOBOX_MULTI_ERROR_TAG),
    )
}

// ── Pure helpers (unit-testable) ──────────────────────────────────────────────

/** The visible label, suffixed with the selected/maximum count when [maxItems] is set (web label `(n/max)`). */
internal fun labelWithCount(
    label: String,
    selectedCount: Int,
    maxItems: Int?,
): String = if (maxItems != null) "$label ($selectedCount/$maxItems)" else label

/** The result-count announcement copy for [kind] (web announce effect). */
internal fun announcementText(
    strings: ComboboxMultiStrings,
    kind: ResultAnnouncement,
    count: Int,
): String =
    when (kind) {
        ResultAnnouncement.NoResults -> strings.noResults
        ResultAnnouncement.OneResult -> strings.resultsCountOne
        ResultAnnouncement.ManyResults -> strings.resultsCount(count)
    }

private fun handleComboboxKey(
    event: KeyEvent,
    interaction: ComboboxMultiInteraction,
    display: ComboboxMultiDisplay,
    value: List<ComboboxMultiOption>,
    callbacks: ComboboxMultiCallbacks,
): Boolean {
    if (event.type != KeyEventType.KeyDown) return false
    return when (event.key) {
        Key.DirectionDown -> consume(callbacks.onMoveDown)
        Key.DirectionUp -> consume(callbacks.onMoveUp)
        Key.MoveHome -> consumeIf(interaction.open, callbacks.onMoveToStart)
        Key.MoveEnd -> consumeIf(interaction.open, callbacks.onMoveToEnd)
        Key.Enter, Key.NumPadEnter -> commitActive(interaction, display, callbacks)
        Key.Escape -> consumeIf(interaction.open, callbacks.onClose)
        Key.Backspace -> removeTrailing(interaction, value, callbacks)
        else -> false
    }
}

private inline fun consume(action: () -> Unit): Boolean {
    action()
    return true
}

private inline fun consumeIf(
    condition: Boolean,
    action: () -> Unit,
): Boolean {
    if (!condition) return false
    action()
    return true
}

private fun commitActive(
    interaction: ComboboxMultiInteraction,
    display: ComboboxMultiDisplay,
    callbacks: ComboboxMultiCallbacks,
): Boolean {
    val index = interaction.activeIndex
    if (!interaction.open || index !in display.visibleOptions.indices) return false
    callbacks.onAdd(display.visibleOptions[index])
    return true
}

private fun removeTrailing(
    interaction: ComboboxMultiInteraction,
    value: List<ComboboxMultiOption>,
    callbacks: ComboboxMultiCallbacks,
): Boolean {
    if (interaction.query.isNotEmpty() || value.isEmpty()) return false
    callbacks.onRemove(value.lastIndex)
    return true
}

@Composable
private fun rememberComboboxMultiStrings(): ComboboxMultiStrings =
    ComboboxMultiStrings(
        noResults = stringResource(R.string.translation_combobox_noResults),
        resultsCountOne = stringResource(R.string.translation_combobox_resultsCountOne),
        resultsCountTemplate = stringResource(R.string.translation_combobox_resultsCount),
        removedChipTemplate = stringResource(R.string.translation_combobox_removedChip),
        removeChipTemplate = stringResource(R.string.translation_combobox_removeChip),
        maxReached = stringResource(R.string.translation_combobox_maxReached),
        loading = stringResource(R.string.translation_combobox_loading),
        hideOptions = stringResource(R.string.translation_combobox_closeListAria),
        showOptions = stringResource(R.string.translation_combobox_openListAria),
        moreHiddenTemplate = stringResource(R.string.translation_combobox_moreHidden),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_common_offline),
    )

private const val DISABLED_ALPHA = 0.5f
private const val CHEVRON_OPEN_DEG = 180f
private val INPUT_MIN_WIDTH = 96.dp
private val CHIP_MAX_WIDTH = 160.dp
private val TOGGLE_SIZE = 36.dp
private val SPINNER_SIZE = 16.dp
private val SPINNER_STROKE = 2.dp
private val STATUS_REGION_SIZE = 1.dp
private val DROPDOWN_MAX_HEIGHT = 256.dp

// ── Previews — one per rendered state ─────────────────────────────────────────

private fun previewStrings(): ComboboxMultiStrings =
    ComboboxMultiStrings(
        noResults = "No results",
        resultsCountOne = "1 result",
        resultsCountTemplate = "{{count}} results",
        removedChipTemplate = "Removed {{label}}",
        removeChipTemplate = "Remove {{label}}",
        maxReached = "Maximum reached",
        loading = "Loading",
        hideOptions = "Hide options",
        showOptions = "Show options",
        moreHiddenTemplate = "{{count}} more — refine search",
        stale = "Stale",
        offline = "Offline",
    )

private fun previewOptions(count: Int): List<ComboboxMultiOption> =
    (1..count).map { ComboboxMultiOption(key = "opt-$it", label = "Option $it") }

@Suppress("LongParameterList")
private fun previewDisplay(
    visible: List<ComboboxMultiOption> = previewOptions(3),
    totalMatches: Int = visible.size,
    overflow: Int = 0,
    atMax: Boolean = false,
    phase: ComboboxListPhase = ComboboxListPhase.Options,
    fieldLoading: Boolean = false,
    stale: Boolean = false,
    offline: Boolean = false,
    errorKind: ErrorKind? = null,
): ComboboxMultiDisplay =
    ComboboxMultiDisplay(
        visibleOptions = visible,
        totalMatches = totalMatches,
        overflowCount = overflow,
        atMax = atMax,
        listPhase = phase,
        fieldLoading = fieldLoading,
        stale = stale,
        offline = offline,
        errorKind = errorKind,
    )

@Preview(name = "ComboboxMulti · closed with chips", showBackground = true)
@Composable
private fun ComboboxMultiClosedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxMultiContent(
            value = listOf(ComboboxMultiOption("a", "Alpha"), ComboboxMultiOption("b", "Bravo")),
            interaction = ComboboxMultiInteraction(open = false),
            display = previewDisplay(phase = ComboboxListPhase.Options),
            strings = previewStrings(),
            label = "Vehicles",
        )
    }
}

@Preview(name = "ComboboxMulti · open options", showBackground = true)
@Composable
private fun ComboboxMultiOptionsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxMultiContent(
            value = listOf(ComboboxMultiOption("a", "Alpha")),
            interaction = ComboboxMultiInteraction(open = true, activeIndex = 0),
            display = previewDisplay(visible = previewOptions(3)),
            strings = previewStrings(),
            label = "Vehicles",
        )
    }
}

@Preview(name = "ComboboxMulti · loading", showBackground = true)
@Composable
private fun ComboboxMultiLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxMultiContent(
            value = emptyList(),
            interaction = ComboboxMultiInteraction(open = true),
            display = previewDisplay(visible = emptyList(), totalMatches = 0, phase = ComboboxListPhase.Loading, fieldLoading = true),
            strings = previewStrings(),
            label = "Vehicles",
        )
    }
}

@Preview(name = "ComboboxMulti · empty", showBackground = true)
@Composable
private fun ComboboxMultiEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxMultiContent(
            value = emptyList(),
            interaction = ComboboxMultiInteraction(open = true, query = "zzz"),
            display = previewDisplay(visible = emptyList(), totalMatches = 0, phase = ComboboxListPhase.Empty),
            strings = previewStrings(),
            label = "Vehicles",
        )
    }
}

@Preview(name = "ComboboxMulti · max reached", showBackground = true)
@Composable
private fun ComboboxMultiMaxPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxMultiContent(
            value = listOf(ComboboxMultiOption("a", "Alpha"), ComboboxMultiOption("b", "Bravo")),
            interaction = ComboboxMultiInteraction(open = true),
            display = previewDisplay(visible = emptyList(), totalMatches = 0, atMax = true, phase = ComboboxListPhase.Empty),
            strings = previewStrings(),
            label = "Vehicles",
            maxItems = 2,
        )
    }
}

@Preview(name = "ComboboxMulti · overflow", showBackground = true)
@Composable
private fun ComboboxMultiOverflowPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxMultiContent(
            value = emptyList(),
            interaction = ComboboxMultiInteraction(open = true, activeIndex = 0),
            display = previewDisplay(visible = previewOptions(3), totalMatches = 12, overflow = 9),
            strings = previewStrings(),
            label = "Vehicles",
        )
    }
}

@Preview(name = "ComboboxMulti · stale", showBackground = true)
@Composable
private fun ComboboxMultiStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxMultiContent(
            value = emptyList(),
            interaction = ComboboxMultiInteraction(open = true, activeIndex = 0),
            display = previewDisplay(visible = previewOptions(2), stale = true, fieldLoading = true),
            strings = previewStrings(),
            label = "Vehicles",
        )
    }
}

@Preview(name = "ComboboxMulti · offline", showBackground = true)
@Composable
private fun ComboboxMultiOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxMultiContent(
            value = emptyList(),
            interaction = ComboboxMultiInteraction(open = true, activeIndex = 0),
            display = previewDisplay(visible = previewOptions(2), offline = true, errorKind = ErrorKind.Network),
            strings = previewStrings(),
            label = "Vehicles",
        )
    }
}

@Preview(name = "ComboboxMulti · error", showBackground = true)
@Composable
private fun ComboboxMultiErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ComboboxMultiContent(
            value = emptyList(),
            interaction = ComboboxMultiInteraction(open = true),
            display =
                previewDisplay(
                    visible = emptyList(),
                    totalMatches = 0,
                    phase = ComboboxListPhase.Error,
                    errorKind = ErrorKind.Network,
                ),
            strings = previewStrings(),
            label = "Vehicles",
        )
    }
}

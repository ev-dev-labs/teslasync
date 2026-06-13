// Compose render layer for the SignalConfigModal surface — the native analogue of the JSX the web component returns
// (web/src/components/ui/SignalConfigModal.tsx). It is a thin shell over the pure [SignalConfigProjection] derivations
// + the [SignalPreset] transforms (SignalConfigModalModel.kt): a Material 3 modal hosting the selected/total counter,
// the eight one-tap preset buttons, the master Select-All + master-interval + search controls, the per-category
// collapsible sections (each with a tri-state category checkbox, a (n/total) count, and a "set all" cadence select),
// the per-signal checkbox + cadence row, the friendly empty states (no categories, or the search cleared every row),
// and the Cancel + "Subscribe N Signals" footer (the submit disables while nothing is selected, web `disabled={…===0}`).
// Spacing/shape come from the generated theme tokens (P1/S9); the view performs NO HTTP and owns no store — the parent
// supplies the available categories + initial selection and receives the chosen `{ name, interval }[]` through the
// [onSubmit] callback, exactly as the web component's props are.
//
// States: this is a PURE PRESENTATIONAL surface with no data source, so — exactly like the sibling
// KeyboardShortcutsModal — the cache lifecycle phases (loading / error / stale / offline) have no analogue: there is
// no request, no cache, and no freshness window to model, and inventing them would be drift. The two states the web
// source actually defines are reproduced: the populated list (one collapsible section per category) and the empty
// fallback (no categories at all, or the search filter cleared every row — never a blank box).
//
// i18n note (P1/S10): the web source is an outlier — it uses NO `useTranslation` and hardcodes its English copy, so
// the shared catalog (generated from web/src/i18n across every platform, outside this artifact's allowed files) has no
// surface-specific keys to bind. Every string still flows through the single [SignalConfigStrings] carrier (a
// localization seam a host/test/preview can override) so the composable holds no inline copy; the carrier reuses the
// existing catalog keys where faithful ones exist (close, cancel, Subscribe, Signals) and otherwise carries the web's
// own hardcoded copy verbatim. The interval *labels* ("500ms" … "24h") are duration tokens from the model, not prose.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/modals-dialogs/SignalConfigModal) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed because the file's primary export is the `SignalConfigModal` composable (matching the filename); the
// co-located carriers/test-tags are supporting types.
@file:OptIn(ExperimentalLayoutApi::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.signalconfigmodal

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.TriStateCheckbox
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tags for the nodes the UI test selects. */
object SignalConfigModalTestTags {
    const val ROOT: String = "signal-config-modal"
    const val PRESETS: String = "signal-config-presets"
    const val LIST: String = "signal-config-list"
    const val EMPTY: String = "signal-config-empty"
    const val SUBSCRIBE: String = "signal-config-subscribe"
}

/**
 * The already-resolved modal copy the composable reads. Bundled into one carrier so the stateless
 * [SignalConfigModalContent] takes plain strings and stays trivially previewable + UI-testable. Where the shared
 * catalog (P1/S10) carries a faithful key it is reused via [rememberSignalConfigStrings]; the rest is the web source's
 * own hardcoded copy (it uses no i18n — see the file header).
 */
data class SignalConfigStrings(
    val title: String,
    val close: String,
    val cancel: String,
    val subscribe: String,
    val signals: String,
    val signalsSelectedSuffix: String,
    val selectAll: String,
    val deselectAll: String,
    val masterInterval: String,
    val searchHint: String,
    val setAll: String,
    val atConnector: String,
    val noSignalsAvailable: String,
    val noSignalsMatch: String,
)

/** One preset's display copy — its button name + the tooltip-style description (web `PRESETS[i].name` / `.desc`). */
data class SignalPresetCopy(
    val name: String,
    val description: String,
)

/**
 * Resolves the [SignalConfigStrings] carrier. `close`, `cancel`, `subscribe`, and `signals` bind to existing catalog
 * keys (P1/S10); the surface-specific labels carry the web source's hardcoded English verbatim because the web
 * component defines no i18n keys and the catalog cannot be extended from within this surface's allowed files.
 */
@Composable
fun rememberSignalConfigStrings(): SignalConfigStrings =
    SignalConfigStrings(
        title = SIGNAL_CONFIG_TITLE,
        close = stringResource(R.string.translation_common_close),
        cancel = stringResource(R.string.translation_common_cancel),
        subscribe = stringResource(R.string.translation_Subscribe),
        signals = stringResource(R.string.translation_Signals),
        signalsSelectedSuffix = SIGNALS_SELECTED_SUFFIX,
        selectAll = SELECT_ALL_LABEL,
        deselectAll = DESELECT_ALL_LABEL,
        masterInterval = MASTER_INTERVAL_LABEL,
        searchHint = SEARCH_HINT_LABEL,
        setAll = SET_ALL_LABEL,
        atConnector = AT_CONNECTOR_LABEL,
        noSignalsAvailable = NO_SIGNALS_AVAILABLE_LABEL,
        noSignalsMatch = NO_SIGNALS_MATCH_LABEL,
    )

/** The interval-cadence descriptions shown beside each label in the master select (web `INTERVAL_OPTIONS[i].desc`). */
@Composable
fun rememberIntervalDescriptions(): Map<Int, String> = remember { INTERVAL_DESCRIPTIONS }

/** The eight presets' display copy (web `PRESETS`), keyed by preset for the button row + its descriptive label. */
@Composable
fun rememberPresetCopy(): Map<SignalPreset, SignalPresetCopy> = remember { PRESET_COPY }

/**
 * Stateful entry point — the faithful port of the web `SignalConfigModal({ open, onClose, categories,
 * initialSelected, initialInterval, onSubmit })`. The owning view gates composition (web `open`); on first
 * composition it records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and hosts the modal. The assembled
 * `{ name, interval }[]` is handed to [onSubmit] and the sheet then dismisses (web `handleSubmit` → `onClose()`).
 * No HTTP, no store — the parent owns the data + callbacks exactly as the web component's props are.
 *
 * @param onClose dismiss handler (web `onClose`); invoked by Cancel/close and after a successful submit.
 * @param categories the available signal categories + their fields (web `categories`).
 * @param onSubmit receives the selected `{ name, interval }` rows on subscribe (web `onSubmit`).
 * @param initialSelected the field names selected when the sheet opens (web `initialSelected`).
 * @param initialInterval the cadence every row is seeded at (web `initialInterval`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun SignalConfigModal(
    onClose: () -> Unit,
    categories: List<SignalCategoryDef>,
    onSubmit: (List<SubscribedSignal>) -> Unit,
    modifier: Modifier = Modifier,
    initialSelected: List<String> = emptyList(),
    initialInterval: Int = SignalIntervals.DEFAULT_VALUE,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SignalConfigModalDiagnostics.recordViewOpened(logger) }
    val strings = rememberSignalConfigStrings()
    val intervalDescriptions = rememberIntervalDescriptions()
    val presetCopy = rememberPresetCopy()

    Modal(
        onDismissRequest = onClose,
        modifier = modifier,
        title = strings.title,
        accessibleName = strings.title,
        closeLabel = strings.close,
    ) {
        SignalConfigModalContent(
            categories = categories,
            initialSelected = initialSelected,
            initialInterval = initialInterval,
            strings = strings,
            intervalDescriptions = intervalDescriptions,
            presetCopy = presetCopy,
            onSubmit = { payload ->
                onSubmit(payload)
                onClose()
            },
            onCancel = onClose,
        )
    }
}

/**
 * Stateless renderer + working-state owner — the unit/UI-test + preview entry point. Seeds its working list from the
 * props (web `useState` initializer), owns the search/master-interval/expanded-set local state, projects the list
 * through [SignalConfigProjection] on every change, and renders the counter, presets, master controls, the grouped
 * sections (or the empty state), and the footer. The assembled submission flows back through [onSubmit].
 */
@Composable
fun SignalConfigModalContent(
    categories: List<SignalCategoryDef>,
    initialSelected: List<String>,
    initialInterval: Int,
    strings: SignalConfigStrings,
    intervalDescriptions: Map<Int, String>,
    presetCopy: Map<SignalPreset, SignalPresetCopy>,
    onSubmit: (List<SubscribedSignal>) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var signals by remember(categories, initialSelected, initialInterval) {
        mutableStateOf(SignalConfigProjection.seed(categories, initialSelected, initialInterval))
    }
    var search by remember { mutableStateOf("") }
    var masterInterval by remember(initialInterval) { mutableStateOf(initialInterval) }
    var expanded by remember(categories) { mutableStateOf(categories.map { it.category }.toSet()) }

    val groups = SignalConfigProjection.group(SignalConfigProjection.filter(signals, search))
    val total = signals.size
    val selectedCount = SignalConfigProjection.selectedCount(signals)
    val allSelected = SignalConfigProjection.allSelected(signals)

    Column(
        modifier = modifier.fillMaxWidth().testTag(SignalConfigModalTestTags.ROOT),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Caption(selectedSummary(strings, selectedCount, total))

        SignalConfigMasterControls(
            strings = strings,
            presetCopy = presetCopy,
            intervalDescriptions = intervalDescriptions,
            allSelected = allSelected,
            someSelected = selectedCount > 0,
            masterInterval = masterInterval,
            search = search,
            onPreset = { preset -> signals = preset.apply(signals) },
            onToggleAll = { signals = SignalConfigProjection.setAllSelected(signals, !allSelected) },
            onMasterInterval = { value ->
                masterInterval = value
                signals = SignalConfigProjection.setAllInterval(signals, value)
            },
            onSearch = { search = it },
        )

        SignalConfigList(
            groups = groups,
            total = total,
            strings = strings,
            expanded = expanded,
            onToggleExpand = { category ->
                expanded = if (category in expanded) expanded - category else expanded + category
            },
            onToggleCategory = { category -> signals = SignalConfigProjection.toggleCategory(signals, category) },
            onCategoryInterval = { category, value ->
                signals = SignalConfigProjection.setCategoryInterval(signals, category, value)
            },
            onToggleSignal = { name ->
                signals = SignalConfigProjection.updateSignal(signals, name) { it.copy(selected = !it.selected) }
            },
            onSignalInterval = { name, value ->
                signals = SignalConfigProjection.updateSignal(signals, name) { it.copy(interval = value) }
            },
        )

        SignalConfigFooter(
            strings = strings,
            selectedCount = selectedCount,
            realtimeCount = SignalConfigProjection.countAtInterval(signals, SignalIntervals.REALTIME_VALUE),
            defaultCount = SignalConfigProjection.countAtInterval(signals, SignalIntervals.DEFAULT_VALUE),
            onCancel = onCancel,
            onSubmit = { onSubmit(SignalConfigProjection.buildSubmission(signals)) },
        )
    }
}

/**
 * The sticky master controls — the preset button row, the Select-All tri-state toggle, the master cadence select, and
 * the search box (web's master-controls header). Stacked vertically for the narrow modal column (Android idiom) while
 * preserving every control the web row offers.
 */
@Composable
private fun SignalConfigMasterControls(
    strings: SignalConfigStrings,
    presetCopy: Map<SignalPreset, SignalPresetCopy>,
    intervalDescriptions: Map<Int, String>,
    allSelected: Boolean,
    someSelected: Boolean,
    masterInterval: Int,
    search: String,
    onPreset: (SignalPreset) -> Unit,
    onToggleAll: () -> Unit,
    onMasterInterval: (Int) -> Unit,
    onSearch: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        FlowRow(
            modifier = Modifier.fillMaxWidth().testTag(SignalConfigModalTestTags.PRESETS),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            SignalPreset.ORDERED.forEach { preset ->
                val copy = presetCopy[preset]
                if (copy != null) {
                    Button(
                        label = copy.name,
                        onClick = { onPreset(preset) },
                        variant = ButtonVariant.Outline,
                        size = ButtonSize.Sm,
                    )
                }
            }
        }

        TriStateCheckbox(
            state = toggleState(all = allSelected, some = someSelected),
            onClick = onToggleAll,
            label = if (allSelected) strings.deselectAll else strings.selectAll,
        )

        Select(
            options = masterIntervalOptions(intervalDescriptions),
            selectedValue = masterInterval.toString(),
            onSelect = { onMasterInterval(it.toInt()) },
            label = strings.masterInterval,
        )

        SearchInput(value = search, onValueChange = onSearch, hint = strings.searchHint)
    }
}

/** The grouped signal list, or the friendly empty state when there are no categories / the search cleared every row. */
@Composable
private fun SignalConfigList(
    groups: List<SignalCategoryGroup>,
    total: Int,
    strings: SignalConfigStrings,
    expanded: Set<String>,
    onToggleExpand: (String) -> Unit,
    onToggleCategory: (String) -> Unit,
    onCategoryInterval: (String, Int) -> Unit,
    onToggleSignal: (String) -> Unit,
    onSignalInterval: (String, Int) -> Unit,
) {
    when {
        total == 0 ->
            EmptyState(
                message = strings.noSignalsAvailable,
                modifier = Modifier.testTag(SignalConfigModalTestTags.EMPTY),
                icon = FeedbackGlyphs.Bolt,
            )

        groups.isEmpty() ->
            EmptyState(
                message = strings.noSignalsMatch,
                modifier = Modifier.testTag(SignalConfigModalTestTags.EMPTY),
                icon = FeedbackGlyphs.Bolt,
            )

        else ->
            Column(
                modifier = Modifier.fillMaxWidth().testTag(SignalConfigModalTestTags.LIST),
                verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                groups.forEach { group ->
                    SignalCategorySection(
                        group = group,
                        strings = strings,
                        expanded = group.category in expanded,
                        onToggleExpand = { onToggleExpand(group.category) },
                        onToggleCategory = { onToggleCategory(group.category) },
                        onCategoryInterval = { onCategoryInterval(group.category, it) },
                        onToggleSignal = onToggleSignal,
                        onSignalInterval = onSignalInterval,
                    )
                }
            }
    }
}

/**
 * One collapsible category section — the header (a tri-state category checkbox, the chevron + name + count expand
 * target, and a "set all" cadence select) plus, while expanded, the per-signal rows beneath a divider.
 */
@Composable
private fun SignalCategorySection(
    group: SignalCategoryGroup,
    strings: SignalConfigStrings,
    expanded: Boolean,
    onToggleExpand: () -> Unit,
    onToggleCategory: () -> Unit,
    onCategoryInterval: (Int) -> Unit,
    onToggleSignal: (String) -> Unit,
    onSignalInterval: (String, Int) -> Unit,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                TriStateCheckbox(
                    state = toggleState(all = group.allSelected, some = group.someSelected),
                    onClick = onToggleCategory,
                    modifier = Modifier.semantics { contentDescription = group.category },
                )
                Row(
                    modifier = Modifier.weight(1f).clickable(onClick = onToggleExpand).padding(vertical = Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Icon(
                        TeslaGlyphs.ChevronDown,
                        contentDescription = null,
                        modifier = Modifier.rotate(if (expanded) EXPANDED_ROTATION else COLLAPSED_ROTATION),
                    )
                    Subhead(group.category, modifier = Modifier.weight(1f))
                    Caption("(${group.selectedCount}/${group.signals.size})")
                }
                Select(
                    options = intervalLabelOptions(),
                    selectedValue = null,
                    onSelect = { onCategoryInterval(it.toInt()) },
                    emptyLabel = strings.setAll,
                    modifier = Modifier.width(CATEGORY_SELECT_WIDTH),
                )
            }

            if (expanded) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Column {
                    group.signals.forEach { signal ->
                        SignalRow(
                            signal = signal,
                            onToggle = { onToggleSignal(signal.name) },
                            onInterval = { onSignalInterval(signal.name, it) },
                        )
                    }
                }
            }
        }
    }
}

/** One signal row — its subscribe checkbox, the monospaced signal name, and its per-signal cadence select. */
@Composable
private fun SignalRow(
    signal: SignalConfig,
    onToggle: () -> Unit,
    onInterval: (Int) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Checkbox(
            checked = signal.selected,
            onCheckedChange = { onToggle() },
            modifier = Modifier.semantics { contentDescription = signal.name },
        )
        CodeText(signal.name, modifier = Modifier.weight(1f))
        Select(
            options = intervalLabelOptions(),
            selectedValue = signal.interval.toString(),
            onSelect = { onInterval(it.toInt()) },
            modifier = Modifier.width(ROW_SELECT_WIDTH),
        )
    }
}

/** The footer — the at-a-glance subscription summary and the Cancel + "Subscribe N Signals" actions. */
@Composable
private fun SignalConfigFooter(
    strings: SignalConfigStrings,
    selectedCount: Int,
    realtimeCount: Int,
    defaultCount: Int,
    onCancel: () -> Unit,
    onSubmit: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        HelperText(footerSummary(strings, selectedCount, realtimeCount, defaultCount))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, alignment = Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(label = strings.cancel, onClick = onCancel, variant = ButtonVariant.Ghost)
            Button(
                label = subscribeLabel(strings, selectedCount),
                onClick = onSubmit,
                modifier = Modifier.testTag(SignalConfigModalTestTags.SUBSCRIBE),
                variant = ButtonVariant.Primary,
                enabled = selectedCount > 0,
                leadingIcon = FeedbackGlyphs.Bolt,
            )
        }
    }
}

// ── Pure copy helpers (kept off the composables so they are trivially readable) ─────────────────────────────────────

private fun selectedSummary(
    strings: SignalConfigStrings,
    selected: Int,
    total: Int,
): String = "$selected / $total ${strings.signalsSelectedSuffix}"

private fun subscribeLabel(
    strings: SignalConfigStrings,
    count: Int,
): String = "${strings.subscribe} $count ${strings.signals}"

private fun footerSummary(
    strings: SignalConfigStrings,
    selected: Int,
    realtime: Int,
    default: Int,
): String {
    val base = "$selected ${strings.signalsSelectedSuffix}"
    if (selected == 0) return base
    val realtimeToken = SignalIntervals.labelFor(SignalIntervals.REALTIME_VALUE)
    val defaultToken = SignalIntervals.labelFor(SignalIntervals.DEFAULT_VALUE)
    val realtimePart = "$realtime ${strings.atConnector} $realtimeToken"
    val defaultPart = "$default ${strings.atConnector} $defaultToken"
    return "$base • $realtimePart • $defaultPart"
}

private fun toggleState(
    all: Boolean,
    some: Boolean,
): ToggleableState =
    when {
        all -> ToggleableState.On
        some -> ToggleableState.Indeterminate
        else -> ToggleableState.Off
    }

private fun masterIntervalOptions(descriptions: Map<Int, String>): List<SelectOption> =
    SignalIntervals.OPTIONS.map { option ->
        val description = descriptions[option.value]
        val label = if (description != null) "${option.label} ($description)" else option.label
        SelectOption(value = option.value.toString(), label = label)
    }

private fun intervalLabelOptions(): List<SelectOption> =
    SignalIntervals.OPTIONS.map { option -> SelectOption(value = option.value.toString(), label = option.label) }

// ── Surface copy (P1/S10) ───────────────────────────────────────────────────────────────────────────────────────
// The web SignalConfigModal uses no i18n facade — it hardcodes the strings below. The shared catalog (generated from
// web/src/i18n across android/apple/windows, outside this surface's allowed files) therefore has no matching keys, so
// the web copy is mirrored here verbatim and funnelled through the SignalConfigStrings carrier (still a single
// localization seam). The few faithful existing keys (close/cancel/Subscribe/Signals) are bound in
// rememberSignalConfigStrings instead.

private const val SIGNAL_CONFIG_TITLE = "Fleet Telemetry Signal Configuration"
private const val SIGNALS_SELECTED_SUFFIX = "signals selected"
private const val SELECT_ALL_LABEL = "Select All"
private const val DESELECT_ALL_LABEL = "Deselect All"
private const val MASTER_INTERVAL_LABEL = "Master Interval"
private const val SEARCH_HINT_LABEL = "Search signals…"
private const val SET_ALL_LABEL = "Set all…"
private const val AT_CONNECTOR_LABEL = "at"
private const val NO_SIGNALS_AVAILABLE_LABEL = "No signals available to configure."
private const val NO_SIGNALS_MATCH_LABEL = "No signals match your search."

private const val EXPANDED_ROTATION = 0f
private const val COLLAPSED_ROTATION = -90f
private val CATEGORY_SELECT_WIDTH = 132.dp
private val ROW_SELECT_WIDTH = 116.dp

private val INTERVAL_DESCRIPTIONS: Map<Int, String> =
    mapOf(
        0 to "Real-time",
        1 to "Fast",
        5 to "Medium",
        10 to "Default",
        30 to "Slow",
        60 to "1 min",
        300 to "Rare",
        900 to "15 min",
        3600 to "1 hour",
        86400 to "Daily",
    )

private val PRESET_COPY: Map<SignalPreset, SignalPresetCopy> =
    mapOf(
        SignalPreset.RealtimeDriving to
            SignalPresetCopy("⚡ Real-time Driving", "Driving signals at 1s, battery at 10s, config at 24h"),
        SignalPreset.Balanced to
            SignalPresetCopy("⚖️ Balanced", "All signals at 10s — good balance of data and battery"),
        SignalPreset.LowPower to
            SignalPresetCopy("🔋 Low Power", "All signals at 60s — minimal battery impact"),
        SignalPreset.TrackMode to
            SignalPresetCopy("🏎️ Track Mode", "Driving & powertrain at 1s, everything else at 30s"),
        SignalPreset.CostSaver to
            SignalPresetCopy("💰 Cost Saver", "Essential signals only at 5–15min, non-essentials off"),
        SignalPreset.SleepWatch to
            SignalPresetCopy("😴 Sleep Watch", "Security & location at 60s, charging at 1min, rest off"),
        SignalPreset.Diagnostics to
            SignalPresetCopy("🔧 Diagnostics", "Powertrain/tires/climate at 5s, driving at 10s"),
        SignalPreset.TripLogger to
            SignalPresetCopy("🗺️ Trip Logger", "Location at 1s, driving at 5s — optimized for routes"),
    )

// ── Previews (tooling-only; each @Preview entry point exercises one render branch) ──────────────────────────────────

private val PREVIEW_STRINGS =
    SignalConfigStrings(
        title = "Fleet Telemetry Signal Configuration",
        close = "Close",
        cancel = "Cancel",
        subscribe = "Subscribe",
        signals = "Signals",
        signalsSelectedSuffix = "signals selected",
        selectAll = "Select All",
        deselectAll = "Deselect All",
        masterInterval = "Master Interval",
        searchHint = "Search signals…",
        setAll = "Set all…",
        atConnector = "at",
        noSignalsAvailable = "No signals available to configure.",
        noSignalsMatch = "No signals match your search.",
    )

private val PREVIEW_CATEGORIES =
    listOf(
        SignalCategoryDef("Driving", listOf("VehicleSpeed", "Gear", "AccelerationPedalPos")),
        SignalCategoryDef("Charging", listOf("ChargeState", "ChargeAmps")),
        SignalCategoryDef("Climate", listOf("InsideTemp", "OutsideTemp")),
    )

@Preview(name = "Populated — categories + presets", showBackground = true, widthDp = 380)
@Composable
private fun SignalConfigPopulatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalConfigModalContent(
            categories = PREVIEW_CATEGORIES,
            initialSelected = listOf("VehicleSpeed", "ChargeState"),
            initialInterval = SignalIntervals.DEFAULT_VALUE,
            strings = PREVIEW_STRINGS,
            intervalDescriptions = INTERVAL_DESCRIPTIONS,
            presetCopy = PRESET_COPY,
            onSubmit = {},
            onCancel = {},
        )
    }
}

@Preview(name = "Empty — no categories", showBackground = true, widthDp = 380)
@Composable
private fun SignalConfigEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalConfigModalContent(
            categories = emptyList(),
            initialSelected = emptyList(),
            initialInterval = SignalIntervals.DEFAULT_VALUE,
            strings = PREVIEW_STRINGS,
            intervalDescriptions = INTERVAL_DESCRIPTIONS,
            presetCopy = PRESET_COPY,
            onSubmit = {},
            onCancel = {},
        )
    }
}

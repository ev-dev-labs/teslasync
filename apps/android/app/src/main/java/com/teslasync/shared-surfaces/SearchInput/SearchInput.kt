// The native Jetpack Compose + Material 3 SearchInput shared surface — a parity port of
// web/src/components/forms/SearchInput.tsx. The web component is a debounced search field (leading magnifier,
// trailing clear button) that, when a `historyScope` is set, exposes a focus-driven "recent searches" dropdown
// with per-entry remove and a clear-all action, all backed by `@/lib/searchHistory`. This native surface keeps
// that contract end to end and renders every state the prompt's matrix mandates without ever hiding a region:
// loading (the recent-search feed's first read), content (the selectable list), empty (resolved with no recent
// searches → a friendly empty state, never a blank box), error (a classified QueryError with retry), and the
// stale/offline freshness envelope over a cached list.
//
// It performs NO IO and binds the recent-search history only through the shared P1/S8 seam
// ([SearchInputSource]) folded through [SearchInputViewModel] + the pure [SearchInputProjection]; the composable
// resolves the i18n labels (P1/S10) and design tokens (P1/S9) and draws what the projection returns, using the
// shared component library (ui Icon/IconButton/Button/StatusPill/typography, feedback QueryError/EmptyState/
// Skeleton, motion FadeIn). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first
// composition. The atomic `forms/SearchInput` is the bare inline field (component-library bundle, out of
// scope); this surface is the state-aware, history-backed version built around the same shared primitives.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SearchInput) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.searchinput

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay

/** Test tag on the surface root so on-device UI tests can locate the field + dropdown in any state. */
const val SEARCH_INPUT_TEST_TAG: String = "search-input"

/** Test tag on the recent-searches dropdown so UI tests can assert each state renders. */
const val SEARCH_INPUT_HISTORY_TEST_TAG: String = "search-input-history"

private const val DEFAULT_DEBOUNCE_MS: Long = 250L
private const val HISTORY_SKELETON_ROWS: Int = 3
private const val HISTORY_SKELETON_FRACTION: Float = 0.7f
private val HISTORY_SKELETON_HEIGHT: Dp = 14.dp

/**
 * Stateful entry point — the parity port of the web `<SearchInput value onChange historyScope … />`. Buffers
 * local typing and emits [onValueChange] only after [debounceMs] of quiet (web's debounce), records the
 * one-shot `view.opened` diagnostic (P1/S11) on first composition, binds the recent-search feed via
 * [viewModel], auto-refreshes a stale cache, and renders the field plus a focus-driven history dropdown that
 * reproduces every state the web exposes.
 *
 * @param value the committed query (controlled by the parent, web `value`).
 * @param onValueChange called with the new value once the debounce window elapses (web `onChange`).
 * @param viewModel the state holder bound to the shared P1/S8 recent-search seam.
 * @param hint the field's floating label; defaults to the `common.search` label.
 * @param debounceMs the debounce window in milliseconds (web `debounceMs`, default 250).
 * @param showHistoryOnFocus whether focusing the empty field opens the dropdown (web `showHistoryOnFocus`).
 */
@Composable
fun SearchInput(
    value: String,
    onValueChange: (String) -> Unit,
    viewModel: SearchInputViewModel,
    modifier: Modifier = Modifier,
    hint: String? = null,
    debounceMs: Long = DEFAULT_DEBOUNCE_MS,
    showHistoryOnFocus: Boolean = true,
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val strings = rememberSearchInputStrings(hint)
    val state by viewModel.state.collectAsStateWithLifecycle()
    val display = remember(state) { SearchInputProjection.project(state) }

    var local by remember { mutableStateOf(value) }
    var focused by remember { mutableStateOf(false) }

    // Re-sync from the parent if the controlled value changes externally (web's value→local effect).
    LaunchedEffect(value) { if (value != local) local = value }

    // Debounce: only emit onChange once the user stops typing for `debounceMs` (web's debounce effect).
    LaunchedEffect(local, value, debounceMs) {
        if (local != value) {
            delay(debounceMs)
            onValueChange(local)
        }
    }

    // Stale TTL → auto-refresh (prompt's stale-state contract); keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    val historyOpen = showHistoryOnFocus && focused && local.isEmpty()

    FadeIn(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.fillMaxWidth().testTag(SEARCH_INPUT_TEST_TAG)) {
            SearchField(
                value = local,
                onValueChange = { local = it },
                onFocusChange = { isFocused ->
                    // Record on blur (web records on blur) — only when the typed query clears the minimum.
                    if (focused && !isFocused && shouldRecordQuery(local)) viewModel.record(local)
                    focused = isFocused
                },
                onClear = {
                    local = ""
                    onValueChange("")
                },
                onSearch = { if (shouldRecordQuery(local)) viewModel.record(local) },
                strings = strings,
            )
            if (historyOpen) {
                SearchInputHistoryPanel(
                    display = display,
                    strings = strings,
                    onSelect = { entry ->
                        // Skip the debounce for an explicit selection so the parent sees it immediately, and
                        // record it (web `selectEntry` calls `recordSearch`).
                        local = entry
                        onValueChange(entry)
                        viewModel.record(entry)
                    },
                    onRemove = viewModel::remove,
                    onClearAll = viewModel::clearAll,
                    onRetry = viewModel::retry,
                )
            }
        }
    }
}

/**
 * Stateless debounced field — the leading magnifier + trailing clear button frame a single-line
 * [OutlinedTextField], with an IME "search" action that records the current query. Hoisted out of the stateful
 * entry point so it is preview- and screenshot-testable on its own.
 */
@Composable
fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    onFocusChange: (Boolean) -> Unit,
    onClear: () -> Unit,
    onSearch: () -> Unit,
    strings: SearchInputStrings,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth().onFocusChanged { onFocusChange(it.isFocused) },
        singleLine = true,
        label = { Text(strings.searchHint) },
        leadingIcon = { Icon(FormsGlyphs.Search, contentDescription = null) },
        trailingIcon =
            if (value.isNotEmpty()) {
                {
                    IconButton(
                        TeslaGlyphs.Close,
                        contentDescription = strings.clearLabel,
                        onClick = onClear,
                        size = IconSize.Sm,
                    )
                }
            } else {
                null
            },
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { onSearch() }),
        shape = MaterialTheme.shapes.medium,
    )
}

/**
 * Stateless recent-searches dropdown — renders every branch the web source draws plus the recent-search feed's
 * lifecycle: a loading shimmer, the selectable list (+ per-entry remove + clear-all), the empty state, and the
 * classified error with retry, with a stale/offline freshness chip over a cached list. Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun SearchInputHistoryPanel(
    display: SearchHistoryDisplay,
    strings: SearchInputStrings,
    modifier: Modifier = Modifier,
    onSelect: (String) -> Unit = {},
    onRemove: (String) -> Unit = {},
    onClearAll: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(top = Spacing.xs).testTag(SEARCH_INPUT_HISTORY_TEST_TAG),
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            when (display.phase) {
                SearchHistoryPhase.Loading -> {
                    HistoryHeader(display = display, strings = strings)
                    HistoryLoading(strings = strings)
                }
                SearchHistoryPhase.Error ->
                    QueryError(
                        kind = SearchInputProjection.queryErrorKind(display),
                        resourceName = strings.historyTitle,
                        onRetry = onRetry,
                    )
                SearchHistoryPhase.Empty ->
                    EmptyState(message = strings.emptyMessage, title = strings.historyTitle)
                SearchHistoryPhase.Content -> {
                    HistoryHeader(display = display, strings = strings)
                    HistoryList(display = display, strings = strings, onSelect = onSelect, onRemove = onRemove)
                    Button(
                        label = strings.clearHistoryLabel,
                        onClick = onClearAll,
                        variant = ButtonVariant.Ghost,
                        size = ButtonSize.Sm,
                    )
                }
            }
        }
    }
}

/** The dropdown heading — the web "Recent searches" caption, with a stale/offline freshness chip when set. */
@Composable
private fun HistoryHeader(
    display: SearchHistoryDisplay,
    strings: SearchInputStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(strings.historyTitle)
        Spacer(modifier = Modifier.weight(1f))
        if (display.showFreshnessChip) {
            if (display.offline) {
                StatusPill(text = strings.offlineLabel, tone = StatusTone.Danger)
            } else {
                StatusPill(text = strings.staleLabel, tone = StatusTone.Warning)
            }
        }
    }
}

/** The selectable recent-search rows — each row selects the query; the trailing button removes that entry. */
@Composable
private fun HistoryList(
    display: SearchHistoryDisplay,
    strings: SearchInputStrings,
    onSelect: (String) -> Unit,
    onRemove: (String) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        display.entries.forEach { entry ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Row(
                    modifier =
                        Modifier
                            .weight(1f)
                            .clickable { onSelect(entry) }
                            .padding(vertical = Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    Icon(
                        FormsGlyphs.Search,
                        contentDescription = null,
                        size = IconSize.Sm,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    BodyText(entry, maxLines = 1)
                }
                IconButton(
                    TeslaGlyphs.Close,
                    contentDescription = strings.removeLabel(entry),
                    onClick = { onRemove(entry) },
                    size = IconSize.Sm,
                )
            }
        }
    }
}

/** Shimmering rows shown while the recent-search feed first loads; announces the loading label to TalkBack. */
@Composable
private fun HistoryLoading(strings: SearchInputStrings) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(HISTORY_SKELETON_ROWS) {
            Skeleton(widthFraction = HISTORY_SKELETON_FRACTION, height = HISTORY_SKELETON_HEIGHT)
        }
    }
}

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberSearchInputStrings(hint: String?): SearchInputStrings =
    SearchInputStrings(
        searchHint = hint ?: stringResource(R.string.translation_common_search),
        clearLabel = stringResource(R.string.translation_common_clear),
        historyTitle = stringResource(R.string.translation_search_history_title),
        clearHistoryLabel = stringResource(R.string.translation_search_history_clear),
        removeAriaTemplate = stringResource(R.string.translation_search_history_removeAria),
        emptyMessage = stringResource(R.string.translation_common_noData),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
    )

// ── Previews — the field (empty / filled) and the dropdown in every rendered state. ──────────────────────

private fun previewStrings(): SearchInputStrings =
    SearchInputStrings(
        searchHint = "Search",
        clearLabel = "Clear",
        historyTitle = "Recent searches",
        clearHistoryLabel = "Clear history",
        removeAriaTemplate = "Remove \"%1\$s\" from search history",
        emptyMessage = "No data available",
        loadingLabel = "Loading",
        staleLabel = "Stale",
        offlineLabel = "Offline",
    )

private fun previewEntries(): List<String> = listOf("supercharger", "weekend trip", "home charging")

private fun previewDisplay(
    phase: SearchHistoryPhase,
    entries: List<String> = previewEntries(),
    stale: Boolean = false,
    offline: Boolean = false,
    errorKind: ErrorKind? = null,
): SearchHistoryDisplay =
    SearchHistoryDisplay(
        phase = phase,
        entries = if (phase == SearchHistoryPhase.Content) entries else emptyList(),
        stale = stale,
        offline = offline,
        errorKind = errorKind,
    )

@Preview(name = "SearchInput · field empty", showBackground = true)
@Composable
private fun SearchFieldEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SearchField(
            value = "",
            onValueChange = {},
            onFocusChange = {},
            onClear = {},
            onSearch = {},
            strings = previewStrings(),
        )
    }
}

@Preview(name = "SearchInput · field filled", showBackground = true)
@Composable
private fun SearchFieldFilledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SearchField(
            value = "supercharger",
            onValueChange = {},
            onFocusChange = {},
            onClear = {},
            onSearch = {},
            strings = previewStrings(),
        )
    }
}

@Preview(name = "SearchInput · history content", showBackground = true)
@Composable
private fun HistoryContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SearchInputHistoryPanel(display = previewDisplay(SearchHistoryPhase.Content), strings = previewStrings())
    }
}

@Preview(name = "SearchInput · history stale", showBackground = true)
@Composable
private fun HistoryStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SearchInputHistoryPanel(
            display = previewDisplay(SearchHistoryPhase.Content, stale = true),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "SearchInput · history offline", showBackground = true)
@Composable
private fun HistoryOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SearchInputHistoryPanel(
            display = previewDisplay(SearchHistoryPhase.Content, offline = true, errorKind = ErrorKind.Network),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "SearchInput · history empty", showBackground = true)
@Composable
private fun HistoryEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SearchInputHistoryPanel(display = previewDisplay(SearchHistoryPhase.Empty), strings = previewStrings())
    }
}

@Preview(name = "SearchInput · history loading", showBackground = true)
@Composable
private fun HistoryLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SearchInputHistoryPanel(display = previewDisplay(SearchHistoryPhase.Loading), strings = previewStrings())
    }
}

@Preview(name = "SearchInput · history error", showBackground = true)
@Composable
private fun HistoryErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SearchInputHistoryPanel(
            display = previewDisplay(SearchHistoryPhase.Error, errorKind = ErrorKind.Http),
            strings = previewStrings(),
        )
    }
}

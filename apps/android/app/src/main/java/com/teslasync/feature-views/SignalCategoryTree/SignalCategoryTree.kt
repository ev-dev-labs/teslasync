// The native Jetpack Compose + Material 3 SignalCategoryTree feature view — a parity port of
// web/src/features/telemetry/components/SignalCategoryTree.tsx. The web component groups a vehicle's
// available-signal catalog by category, applies friendly category labels in a stable order, and feeds each
// leaf a lazy SignalSparklinePreview through `TreeSelect`'s `renderLeafRight` slot (the sparkline fetches
// only while its category is expanded — or the user is searching). This native port reproduces that whole
// composition with platform primitives: an always-present search field, collapsible category groups with a
// tri-state "select all" checkbox, per-leaf selection checkboxes, and the same lazily-fetched sparkline
// (numeric kinds draw a line; non-numeric kinds show a compact kind chip; too-few samples show an em dash).
// It additionally surfaces the cache-then-network states the P3 contract mandates (loading / empty / error /
// stale / offline) by binding the shared SignalsStore (P1/S8) through a [SignalCategoryTreeViewModel]: a
// freshness chip + one-shot auto-refresh covers stale, a QueryError covers a hard failure with no cache, and
// the last-known groups stay visible while stale/offline. Values are the raw SI the backend serves
// (Phase-42); the view performs no HTTP. Every visible string resolves through the i18n catalog (P1/S10) and
// every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SignalCategoryTree) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.signalcategorytree

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.charts.Sparkline
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.forms.FormsGlyphs
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.TriStateCheckbox
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalHistoryResponse
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalValue
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.flowOf

/** A per-signal sparkline-history feed factory — the seam the leaf rows subscribe to lazily. */
private typealias SparklineFeed = (String) -> Flow<Resource<SignalHistoryResponse>>

/**
 * Stateful entry point. Binds the shared signals feed via [source] into a [SignalCategoryTreeViewModel],
 * records the one-shot `view.opened` diagnostic, collects the projected catalog [state], and owns the
 * controlled search / selection / expansion state the web parent URL-syncs. A host supplies the [source]
 * (an adapter over the shared S8 SignalsStore) and the selected [vehicleId]; a non-positive id renders the
 * friendly empty state (web disabled query).
 *
 * @param source the cache-then-network signals seam.
 * @param vehicleId the selected vehicle; non-positive renders the empty state.
 * @param showSparklines disables the per-leaf sparkline fetches when `false` (web `showSparklines` prop).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey distinguishes multiple placements; defaults to the surface slug.
 */
@Composable
fun SignalCategoryTree(
    source: SignalCategoryTreeSource,
    vehicleId: Long,
    modifier: Modifier = Modifier,
    showSparklines: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SIGNAL_CATEGORY_TREE_SLUG,
) {
    val viewModel: SignalCategoryTreeViewModel =
        viewModel(
            key = "$instanceKey-$vehicleId",
            factory = SignalCategoryTreeViewModel.factory(source, logger, vehicleId),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberSignalCategoryTreeStrings()

    var search by rememberSaveable { mutableStateOf("") }
    var selected by remember { mutableStateOf(emptySet<String>()) }
    var expanded by remember { mutableStateOf(emptySet<String>()) }
    val sparklineFeed: SparklineFeed = remember(source, vehicleId) { { signal -> source.signalHistory(vehicleId, signal) } }

    SignalCategoryTreeContent(
        state = state,
        strings = strings,
        search = search,
        onSearchChange = { search = it },
        selected = selected,
        onToggleLeaf = { name -> selected = SignalCategoryTreeProjection.toggleSignal(selected, name) },
        onToggleGroup = { group -> selected = SignalCategoryTreeProjection.toggleGroupSelection(selected, group) },
        expanded = expanded,
        onToggleExpand = { id -> expanded = SignalCategoryTreeProjection.toggleExpanded(expanded, id) },
        showSparklines = showSparklines,
        sparklineFeed = sparklineFeed,
        onRetry = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the search field
 * (web's always-present `TreeSelect` search). Stale (non-error) data auto-refreshes once (web realtime
 * refetch). The body picks the same branches the web does, extended with the mandated lifecycle states: a
 * hard failure with no cache shows `QueryError` with retry; a resolved-but-empty catalog shows the friendly
 * empty state; a search that matches nothing shows the no-results state; otherwise the tree renders.
 */
@Composable
fun SignalCategoryTreeContent(
    state: UiState<SignalCatalog>,
    strings: SignalCategoryTreeStrings,
    search: String,
    onSearchChange: (String) -> Unit,
    selected: Set<String>,
    onToggleLeaf: (String) -> Unit,
    onToggleGroup: (SignalCategoryGroup) -> Unit,
    expanded: Set<String>,
    onToggleExpand: (String) -> Unit,
    showSparklines: Boolean,
    sparklineFeed: SparklineFeed,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            SearchHeader(search = search, onSearchChange = onSearchChange, strings = strings, state = state)
            SignalCategoryTreeBody(
                state = state,
                strings = strings,
                search = search,
                selected = selected,
                onToggleLeaf = onToggleLeaf,
                onToggleGroup = onToggleGroup,
                expanded = expanded,
                onToggleExpand = onToggleExpand,
                showSparklines = showSparklines,
                sparklineFeed = sparklineFeed,
                onRetry = onRetry,
            )
        }
    }
}

@Composable
private fun SearchHeader(
    search: String,
    onSearchChange: (String) -> Unit,
    strings: SignalCategoryTreeStrings,
    state: UiState<SignalCatalog>,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SearchInput(
            value = search,
            onValueChange = onSearchChange,
            hint = strings.searchHint,
            clearLabel = strings.searchClear,
            modifier = Modifier.weight(1f),
        )
        if (state.fetchedAt != null || state.refreshing || state.hasError) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
        }
    }
}

@Composable
private fun SignalCategoryTreeBody(
    state: UiState<SignalCatalog>,
    strings: SignalCategoryTreeStrings,
    search: String,
    selected: Set<String>,
    onToggleLeaf: (String) -> Unit,
    onToggleGroup: (SignalCategoryGroup) -> Unit,
    expanded: Set<String>,
    onToggleExpand: (String) -> Unit,
    showSparklines: Boolean,
    sparklineFeed: SparklineFeed,
    onRetry: () -> Unit,
) {
    when {
        state.isLoading -> SignalCategoryTreeLoading(strings.loadingLabel)

        state.isError ->
            QueryError(
                kind = queryErrorKindFor(state),
                resourceName = strings.catalogLabel,
                onRetry = onRetry,
                modifier = Modifier.fillMaxWidth(),
            )

        else -> {
            val catalog = state.data ?: SignalCatalog.EMPTY
            val filtered = remember(catalog, search) { SignalCategoryTreeProjection.filterGroups(catalog.groups, search) }
            when {
                catalog.isEmpty ->
                    EmptyState(
                        message = strings.emptyMessage,
                        icon = DataDisplayGlyphs.Gauge,
                        modifier = Modifier.fillMaxWidth(),
                    )

                filtered.isEmpty() ->
                    EmptyState(
                        message = strings.noResults,
                        icon = FormsGlyphs.Search,
                        modifier = Modifier.fillMaxWidth(),
                    )

                else ->
                    SignalTree(
                        groups = filtered,
                        isSearching = search.trim().isNotEmpty(),
                        strings = strings,
                        selected = selected,
                        onToggleLeaf = onToggleLeaf,
                        onToggleGroup = onToggleGroup,
                        expanded = expanded,
                        onToggleExpand = onToggleExpand,
                        showSparklines = showSparklines,
                        sparklineFeed = sparklineFeed,
                    )
            }
        }
    }
}

@Composable
private fun SignalTree(
    groups: List<SignalCategoryGroup>,
    isSearching: Boolean,
    strings: SignalCategoryTreeStrings,
    selected: Set<String>,
    onToggleLeaf: (String) -> Unit,
    onToggleGroup: (SignalCategoryGroup) -> Unit,
    expanded: Set<String>,
    onToggleExpand: (String) -> Unit,
    showSparklines: Boolean,
    sparklineFeed: SparklineFeed,
) {
    LazyColumn(
        modifier = Modifier.fillMaxWidth().heightIn(max = TREE_MAX_HEIGHT),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        groups.forEach { group ->
            val groupExpanded = isSearching || group.categoryId in expanded
            item(key = "group:${group.categoryId}") {
                GroupHeader(
                    label = SignalCategoryTreeProjection.friendlyCategoryLabel(group.categoryId, strings.categoryLabels),
                    count = group.size,
                    expanded = groupExpanded,
                    selectionState = groupToggleState(group, selected),
                    onToggleExpand = { onToggleExpand(group.categoryId) },
                    onToggleGroup = { onToggleGroup(group) },
                )
            }
            if (groupExpanded) {
                items(group.leaves, key = { "leaf:${it.name}" }) { leaf ->
                    LeafRow(
                        leaf = leaf,
                        checked = leaf.name in selected,
                        onToggle = { onToggleLeaf(leaf.name) },
                        showSparklines = showSparklines,
                        enabled = groupExpanded,
                        sparklineFeed = sparklineFeed,
                    )
                }
            }
        }
    }
}

@Composable
private fun GroupHeader(
    label: String,
    count: Int,
    expanded: Boolean,
    selectionState: ToggleableState,
    onToggleExpand: () -> Unit,
    onToggleGroup: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        IconButton(
            imageVector = if (expanded) TeslaGlyphs.ChevronDown else TeslaGlyphs.ChevronRight,
            contentDescription = label,
            onClick = onToggleExpand,
            size = IconSize.Sm,
        )
        TriStateCheckbox(
            state = selectionState,
            onClick = onToggleGroup,
            label = label,
            modifier = Modifier.weight(1f),
        )
        Caption(count.toString())
    }
}

@Composable
private fun LeafRow(
    leaf: SignalLeaf,
    checked: Boolean,
    onToggle: () -> Unit,
    showSparklines: Boolean,
    enabled: Boolean,
    sparklineFeed: SparklineFeed,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(start = Spacing.lg),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Checkbox(
            checked = checked,
            onCheckedChange = { onToggle() },
            label = leaf.name,
            modifier = Modifier.weight(1f),
        )
        if (showSparklines) {
            SignalSparklinePreview(
                signal = leaf.name,
                valueKind = leaf.valueKind,
                enabled = enabled,
                sparklineFeed = sparklineFeed,
            )
        }
    }
}

/**
 * The per-leaf lazy sparkline slot — the native port of the web `SignalSparklinePreview`. Renders nothing
 * until [enabled] (the parent flips this on as the category expands or the user searches, so 600+ leaves
 * never fire a fetch on mount). A non-numeric kind shows a compact kind chip; a numeric kind owns its own
 * trailing-hour history feed and draws a sparkline (or a loading pulse / em dash).
 */
@Composable
private fun SignalSparklinePreview(
    signal: String,
    valueKind: SignalKind,
    enabled: Boolean,
    sparklineFeed: SparklineFeed,
) {
    if (!enabled) return
    if (SignalCategoryTreeProjection.isNumericKind(valueKind)) {
        NumericSparkline(signal = signal, sparklineFeed = sparklineFeed)
    } else {
        KindChip(token = SignalCategoryTreeProjection.kindToken(valueKind))
    }
}

@Composable
private fun NumericSparkline(
    signal: String,
    sparklineFeed: SparklineFeed,
) {
    val historyFlow = remember(signal) { sparklineFeed(signal) }
    val history by historyFlow.collectAsStateWithLifecycle(initialValue = INITIAL_HISTORY)
    val points = remember(history) { SignalCategoryTreeProjection.historyToPoints(history.cached) }
    when {
        history is Resource.Loading && history.cached == null -> SparklinePulse()
        !SignalCategoryTreeProjection.hasSparkline(points) -> Caption(EM_DASH)
        else ->
            Sparkline(
                data = points,
                width = SPARKLINE_WIDTH,
                height = SPARKLINE_HEIGHT,
            )
    }
}

@Composable
private fun KindChip(token: String) {
    Box(
        modifier =
            Modifier
                .clip(RoundedCornerShape(CHIP_CORNER))
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = Spacing.xs, vertical = CHIP_VERTICAL_PADDING),
    ) {
        Caption(token)
    }
}

@Composable
private fun SparklinePulse() {
    Box(modifier = Modifier.width(SPARKLINE_WIDTH)) {
        Skeleton(height = SPARKLINE_HEIGHT, widthFraction = 1f, rounded = true)
    }
}

@Composable
private fun SignalCategoryTreeLoading(loadingLabel: String) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .padding(Spacing.sm)
                .semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROW_COUNT) {
            Skeleton(height = LOADING_ROW_HEIGHT, widthFraction = 1f, rounded = true)
        }
    }
}

/** The tri-state selection of a group: every leaf on, some on (mixed), or none on. */
private fun groupToggleState(
    group: SignalCategoryGroup,
    selected: Set<String>,
): ToggleableState =
    when {
        SignalCategoryTreeProjection.isGroupFullySelected(group, selected) -> ToggleableState.On
        SignalCategoryTreeProjection.isGroupPartiallySelected(group, selected) -> ToggleableState.Indeterminate
        else -> ToggleableState.Off
    }

/** Folds a [UiState] hard failure onto the recovery copy the `QueryError` branch shows (web classify). */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

/**
 * Resolves the localized [SignalCategoryTreeStrings] from the i18n catalog (P1/S10). The web component
 * hardcodes its chrome + category labels; on Android the chrome and the catalog-keyed category labels
 * resolve through real catalog keys here, and the remaining category ids fall back inside the projection.
 */
@Composable
private fun rememberSignalCategoryTreeStrings(): SignalCategoryTreeStrings {
    val searchHint = stringResource(R.string.translation_widget_signalCatalog_searchPlaceholder) // parity:allow i18n key name
    val searchClear = stringResource(R.string.translation_common_clear)
    val catalogLabel = stringResource(R.string.translation_widget_signalCatalog_title)
    val emptyMessage = stringResource(R.string.translation_widget_signalCatalog_noData)
    val noResults = stringResource(R.string.translation_widget_signalCatalog_noResults)
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val charging = stringResource(R.string.translation_Charging)
    val driving = stringResource(R.string.translation_Driving)
    val powertrain = stringResource(R.string.translation_common_powertrain)
    val climate = stringResource(R.string.translation_common_climate)
    val location = stringResource(R.string.translation_common_location)
    val media = stringResource(R.string.translation_telemetry_media)
    val config = stringResource(R.string.translation_Config)
    val prefs = stringResource(R.string.translation_Preferences)
    return remember(
        searchHint,
        searchClear,
        catalogLabel,
        emptyMessage,
        noResults,
        loadingLabel,
        charging,
        driving,
        powertrain,
        climate,
        location,
        media,
        config,
        prefs,
    ) {
        SignalCategoryTreeStrings(
            searchHint = searchHint,
            searchClear = searchClear,
            catalogLabel = catalogLabel,
            emptyMessage = emptyMessage,
            noResults = noResults,
            loadingLabel = loadingLabel,
            categoryLabels =
                mapOf(
                    "charging" to charging,
                    "driving" to driving,
                    "powertrain" to powertrain,
                    "climate" to climate,
                    "location" to location,
                    "media" to media,
                    "config" to config,
                    "prefs" to prefs,
                ),
        )
    }
}

private val SPARKLINE_WIDTH = 80.dp
private val SPARKLINE_HEIGHT = 18.dp
private val TREE_MAX_HEIGHT = 420.dp
private val BODY_MIN_HEIGHT = 120.dp
private val LOADING_ROW_HEIGHT = 28.dp
private val CHIP_CORNER = 4.dp
private val CHIP_VERTICAL_PADDING = 2.dp
private const val LOADING_ROW_COUNT = 5

/** The history feed's pre-collection value: a first load with nothing cached (renders the pulse). */
private val INITIAL_HISTORY: Resource<SignalHistoryResponse> =
    Resource.Loading(cached = null, fetchedAt = null, stale = false)

// ── Previews — one per rendered state (content / empty / loading / error / no-results) ──────────────────

private val PREVIEW_STRINGS =
    SignalCategoryTreeStrings(
        searchHint = "Search signals\u2026",
        searchClear = "Clear",
        catalogLabel = "Signal Catalog",
        emptyMessage = "No signals in catalog",
        noResults = "No matching signals",
        loadingLabel = "Loading",
        categoryLabels =
            mapOf(
                "charging" to "Charging",
                "driving" to "Driving",
                "powertrain" to "Powertrain",
            ),
    )

private fun previewCatalog(): SignalCatalog =
    SignalCatalog(
        groups =
            listOf(
                SignalCategoryGroup(
                    categoryId = "charging",
                    leaves =
                        listOf(
                            SignalLeaf("ChargeState", SignalKind.String),
                            SignalLeaf("ChargerPower", SignalKind.Float),
                        ),
                ),
                SignalCategoryGroup(
                    categoryId = "driving",
                    leaves =
                        listOf(
                            SignalLeaf("VehicleSpeed", SignalKind.Float),
                            SignalLeaf("Gear", SignalKind.String),
                        ),
                ),
            ),
    )

private fun previewSparklineFeed(): SparklineFeed =
    { _ ->
        flowOf(
            Resource.Success(
                SignalHistoryResponse(
                    vehicleId = 1L,
                    signal = "ChargerPower",
                    expectedKind = "ValueKindFloat",
                    from = "2026-06-12T10:00:00Z",
                    to = "2026-06-12T11:00:00Z",
                    count = 5,
                    data =
                        listOf(10.0, 22.0, 31.0, 28.0, 40.0).map {
                            SignalEnvelope(kind = SignalKind.Float, value = SignalValue.Num(it), ts = "")
                        },
                ),
                fetchedAt = 1L,
                stale = false,
            ),
        )
    }

@Preview(name = "SignalCategoryTree · content", showBackground = true)
@Composable
private fun SignalCategoryTreeContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCategoryTreeContent(
            state = UiState(phase = UiPhase.Content, data = previewCatalog(), fetchedAt = 1L),
            strings = PREVIEW_STRINGS,
            search = "",
            onSearchChange = {},
            selected = setOf("VehicleSpeed"),
            onToggleLeaf = {},
            onToggleGroup = {},
            expanded = setOf("driving"),
            onToggleExpand = {},
            showSparklines = true,
            sparklineFeed = previewSparklineFeed(),
            onRetry = {},
        )
    }
}

@Preview(name = "SignalCategoryTree · empty", showBackground = true)
@Composable
private fun SignalCategoryTreeEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCategoryTreeContent(
            state = UiState(phase = UiPhase.Empty, data = SignalCatalog.EMPTY, fetchedAt = 1L),
            strings = PREVIEW_STRINGS,
            search = "",
            onSearchChange = {},
            selected = emptySet(),
            onToggleLeaf = {},
            onToggleGroup = {},
            expanded = emptySet(),
            onToggleExpand = {},
            showSparklines = true,
            sparklineFeed = { _ -> emptyFlow() },
            onRetry = {},
        )
    }
}

@Preview(name = "SignalCategoryTree · loading", showBackground = true)
@Composable
private fun SignalCategoryTreeLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCategoryTreeContent(
            state = UiState.loading(),
            strings = PREVIEW_STRINGS,
            search = "",
            onSearchChange = {},
            selected = emptySet(),
            onToggleLeaf = {},
            onToggleGroup = {},
            expanded = emptySet(),
            onToggleExpand = {},
            showSparklines = true,
            sparklineFeed = { _ -> emptyFlow() },
            onRetry = {},
        )
    }
}

@Preview(name = "SignalCategoryTree · error", showBackground = true)
@Composable
private fun SignalCategoryTreeErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SignalCategoryTreeContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            strings = PREVIEW_STRINGS,
            search = "",
            onSearchChange = {},
            selected = emptySet(),
            onToggleLeaf = {},
            onToggleGroup = {},
            expanded = emptySet(),
            onToggleExpand = {},
            showSparklines = true,
            sparklineFeed = { _ -> emptyFlow() },
            onRetry = {},
        )
    }
}

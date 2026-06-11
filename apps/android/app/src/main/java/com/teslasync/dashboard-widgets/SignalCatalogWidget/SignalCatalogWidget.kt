// The native Jetpack Compose + Material 3 Signal Catalog dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SignalCatalogWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while loading, a `QueryError` retry surface on hard failure, otherwise a title + book glyph + freshness
// header) wrapping the web body: the "No signals in catalog" empty state when the catalog is empty, the
// compact (1-column) total-count layout (web `isCompact`), or the standard layout — a search box over the
// signals grouped by source module (each category header carrying its count) with each row showing the
// monospaced signal name, its optional unit chip and its observation count, narrowing to a "No matching
// signals" empty state when the search filters everything out. All data flows through the shared
// [SignalCatalogWidgetViewModel] (P1/S8); the view performs no HTTP. Every string resolves through the
// i18n catalog (P1/S10) and the refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SignalCatalogWidget) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + previews + glyph.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.signalcatalog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

private val BODY_MIN_HEIGHT = 120.dp
private val SEARCH_SKELETON_HEIGHT = 40.dp
private val SKELETON_TITLE_HEIGHT = 14.dp
private val ROW_MIN_HEIGHT = 32.dp
private const val SKELETON_TITLE_WIDTH = 0.5f
private const val SKELETON_ROW_COUNT = 5

/**
 * Stateful entry point. Collects the shared [SignalCatalogWidgetViewModel] state, records the one-shot
 * `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host supplies the
 * view-model (wired via [SignalCatalogWidgetViewModel.factory]).
 *
 * @param viewModel the state holder bound to the shared catalog + vehicles + observations feeds.
 * @param size the grid footprint; controls the compact (count-only) vs standard (search + list) layout.
 */
@Composable
fun SignalCatalogWidget(
    viewModel: SignalCatalogWidgetViewModel,
    modifier: Modifier = Modifier,
    size: SignalCatalogSize = SignalCatalogRegistration.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    SignalCatalogWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless Signal Catalog panel — renders every state the web widget does (loading / content / empty /
 * "no matching signals" / error, plus stale + offline via the header freshness chip over the cached
 * catalog). Stale (non-error) data auto-refreshes once (web TanStack stale refetch). Hoisted out of the
 * ViewModel so each state is preview- and screenshot-testable with hand-built [UiState] inputs. The search
 * query is local UI state; the grouped projection recomputes as it changes.
 */
@Composable
fun SignalCatalogWidgetContent(
    state: UiState<SignalCatalogSnapshot>,
    size: SignalCatalogSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val title = stringResource(R.string.translation_widget_signalCatalog_title)
    val uncategorized = stringResource(R.string.translation_widget_signalCatalog_uncategorized)
    val searchHint = stringResource(R.string.translation_widget_signalCatalog_searchPlaceholder) // parity:allow generated i18n resource id
    var search by rememberSaveable { mutableStateOf("") }
    val display =
        remember(state.data, size, search, uncategorized) {
            SignalCatalogProjection.project(
                snapshot = state.data ?: SignalCatalogSnapshot.EMPTY,
                size = size,
                query = search,
                uncategorizedLabel = uncategorized,
            )
        }
    GlassPanel(modifier = modifier.fillMaxSize(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> SignalCatalogLoading()
            state.isError -> SignalCatalogError(state = state, title = title, onRetry = onRetry, modifier = Modifier.weight(1f))
            else -> {
                SignalCatalogHeader(state = state, title = title, compact = size.isCompact, onRefresh = onRefresh)
                SignalCatalogBody(
                    display = display,
                    search = search,
                    onSearchChange = { search = it },
                    searchHint = searchHint,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun ColumnScope.SignalCatalogBody(
    display: SignalCatalogDisplay,
    search: String,
    onSearchChange: (String) -> Unit,
    searchHint: String,
    modifier: Modifier = Modifier,
) {
    when {
        !display.hasEntries ->
            SignalCatalogEmpty(
                message = stringResource(R.string.translation_widget_signalCatalog_noData),
                modifier = modifier,
            )

        display.isCompact -> SignalCatalogCompact(display = display, modifier = modifier)

        else -> {
            Input(
                value = search,
                onValueChange = onSearchChange,
                modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
                label = searchHint,
            )
            SignalCatalogResults(display = display, modifier = modifier)
        }
    }
}

@Composable
private fun SignalCatalogHeader(
    state: UiState<SignalCatalogSnapshot>,
    title: String,
    compact: Boolean,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = if (compact) Arrangement.End else Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (!compact) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = SignalCatalogGlyphs.BookOpen,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.primary,
                )
                PanelTitle(title, modifier = Modifier.semantics { heading() })
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = compact,
            )
            IconButton(
                imageVector = FeedbackGlyphs.Refresh,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRefresh,
                enabled = !state.refreshing,
                size = IconSize.Sm,
            )
        }
    }
}

/** Compact (1-column) layout — the total signal count over a "signals available" caption (web `isCompact`). */
@Composable
private fun SignalCatalogCompact(
    display: SignalCatalogDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        MetricValue(display.signalCountLabel)
        Caption(stringResource(R.string.translation_widget_signalCatalog_signalsAvailable))
    }
}

/** Standard layout body — the scrollable grouped list, or the "No matching signals" empty state. */
@Composable
private fun SignalCatalogResults(
    display: SignalCatalogDisplay,
    modifier: Modifier = Modifier,
) {
    if (!display.hasResults) {
        Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            SignalCatalogEmpty(message = stringResource(R.string.translation_widget_signalCatalog_noResults))
        }
        return
    }
    Column(
        modifier = modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        display.groups.forEach { group ->
            SignalCatalogGroupSection(group = group)
        }
    }
}

@Composable
private fun SignalCatalogGroupSection(group: SignalCatalogGroup) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth().semantics { heading() },
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MetricLabel(group.category)
            MetricLabel("(${group.size})")
        }
        group.rows.forEach { row -> SignalCatalogRowItem(row = row) }
    }
}

@Composable
private fun SignalCatalogRowItem(row: SignalCatalogRow) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = ROW_MIN_HEIGHT).semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CodeText(row.name, modifier = Modifier.weight(1f))
        if (row.unit != null) {
            Badge(text = row.unit, variant = BadgeVariant.Neutral)
        }
        MetricLabel(row.observationCountLabel)
    }
}

@Composable
private fun SignalCatalogEmpty(
    message: String,
    modifier: Modifier = Modifier,
) {
    EmptyState(
        message = message,
        icon = SignalCatalogGlyphs.BookOpen,
        modifier = modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT),
    )
}

@Composable
private fun ColumnScope.SignalCatalogLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_WIDTH, height = SKELETON_TITLE_HEIGHT)
        Skeleton(height = SEARCH_SKELETON_HEIGHT, rounded = true)
        SkeletonLines(lines = SKELETON_ROW_COUNT)
    }
}

@Composable
private fun SignalCatalogError(
    state: UiState<SignalCatalogSnapshot>,
    title: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT).padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = queryErrorKindFor(state),
            resourceName = title,
            onRetry = onRetry,
        )
    }
}

/**
 * Folds an [UiState] hard failure onto a [QueryErrorKind]: an [ErrorKind.Network]/[ErrorKind.Timeout] is
 * treated as offline, [ErrorKind.CircuitOpen] as transient back-pressure, and an HTTP status selects the
 * not-found / unauthorized / server bucket.
 */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

/**
 * The book glyph the web widget shows in its header (`BookOpen` from `lucide-react`), authored as a 24×24
 * stroked [ImageVector] — Android has no bundled `lucide-react` equivalent, so the surface ships its own
 * (the same approach the sibling LiveSignals widget uses for its section glyphs). Monochrome; recolored at
 * render time by `Icon`'s `tint`.
 */
private object SignalCatalogGlyphs {
    val BookOpen: ImageVector =
        ImageVector
            .Builder(
                name = "BookOpen",
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = 24f,
                viewportHeight = 24f,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                ) {
                    // spine
                    moveTo(12f, 7f)
                    lineTo(12f, 20f)
                    // left page
                    moveTo(12f, 7f)
                    lineTo(4f, 5.5f)
                    lineTo(4f, 17.5f)
                    lineTo(12f, 19f)
                    // right page
                    moveTo(12f, 7f)
                    lineTo(20f, 5.5f)
                    lineTo(20f, 17.5f)
                    lineTo(12f, 19f)
                }
            }.build()
}

// ── Previews — one per rendered state (content / compact / empty / no-results / loading / error) ─────────

private fun previewSnapshot(): SignalCatalogSnapshot =
    SignalCatalogSnapshot(
        entries =
            listOf(
                catalogEntry("BatteryLevel", "battery", "%"),
                catalogEntry("PackVoltage", "battery", "V"),
                catalogEntry("VehicleSpeed", "drive", null),
                catalogEntry("OutsideTemp", "climate", "°C"),
            ),
        observationCounts = mapOf("BatteryLevel" to 1280, "VehicleSpeed" to 432),
    )

private fun catalogEntry(
    name: String,
    module: String,
    unit: String?,
): io.teslasync.shared.core.presentation.telemetry.SignalCatalogEntry =
    io.teslasync.shared.core.presentation.telemetry.SignalCatalogEntry(
        name = name,
        valueType = "numeric",
        sourceModule = module,
        unit = unit,
        description = null,
        firstSeenAt = "",
        lastSeenAt = "",
    )

@Preview(name = "SignalCatalog · content", showBackground = true)
@Composable
private fun SignalCatalogContentPreview() {
    TeslaSyncTheme {
        SignalCatalogWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = System.currentTimeMillis()),
            size = SignalCatalogRegistration.defaultSize,
        )
    }
}

@Preview(name = "SignalCatalog · compact", showBackground = true)
@Composable
private fun SignalCatalogCompactPreview() {
    TeslaSyncTheme {
        SignalCatalogWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = System.currentTimeMillis()),
            size = SignalCatalogSize(cols = 1, rows = 4),
        )
    }
}

@Preview(name = "SignalCatalog · empty", showBackground = true)
@Composable
private fun SignalCatalogEmptyPreview() {
    TeslaSyncTheme {
        SignalCatalogWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = SignalCatalogSnapshot.EMPTY, fetchedAt = 1L),
            size = SignalCatalogRegistration.defaultSize,
        )
    }
}

@Preview(name = "SignalCatalog · loading", showBackground = true)
@Composable
private fun SignalCatalogLoadingPreview() {
    TeslaSyncTheme {
        SignalCatalogWidgetContent(
            state = UiState.loading(),
            size = SignalCatalogRegistration.defaultSize,
        )
    }
}

@Preview(name = "SignalCatalog · error", showBackground = true)
@Composable
private fun SignalCatalogErrorPreview() {
    TeslaSyncTheme {
        SignalCatalogWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = SignalCatalogRegistration.defaultSize,
        )
    }
}

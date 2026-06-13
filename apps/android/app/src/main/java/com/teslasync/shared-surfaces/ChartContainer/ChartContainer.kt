// The native Jetpack Compose + Material 3 ChartContainer shared surface — a parity port of
// web/src/components/charts/ChartContainer.tsx. The web component is a chart *frame* that is also an optional
// annotation host: a GlassPanel with a title/subtitle header + an action toolbar (export menu + fullscreen),
// a height-bound body that switches between a loading spinner / an EmptyState / the chart children / a
// SectionErrorBoundary, a visually-hidden a11y `<table>` fallback, and — when given an `annotations` config —
// an "Add" + "Hide/Show" toggle, a mobile marker row, an AnnotationList footer, an AddAnnotationPopover, and
// a function-children render-prop that receives the visible annotations + hidden + hidden-series state.
//
// This port keeps that contract end to end while staying idiomatic. The frame chrome (title, body states,
// a11y data table, export menu, fullscreen) is the shared atomic `components/charts/ChartContainer` (imported
// as [ChartFrame]) — the P3 component-library atom this surface is NOT allowed to rebuild — so this surface
// adds only the value the atom lacks: it binds the durable annotation feed (P1/S8) through the shared
// [ChartContainerViewModel], renders EVERY state that feed can carry (loading / content / empty / stale /
// offline / error, never a blank box), drives the add/hide/remove flow + the AddAnnotationPopover, threads
// the visible annotations to the children, and emits the PII-safe `view.opened` diagnostic (P1/S11). It
// performs NO HTTP; every visible string resolves through the i18n catalog (P1/S10) and every control carries
// a TalkBack label.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web frame's "error" is a render-time
// SectionErrorBoundary around the children — reproduced here as the host-driven [error]/[onRetry] body state
// (the native idiom, mirroring the sibling MonthlyCostChart). The annotation feed's stale/offline/hard-error
// states surface as a freshness chip + a retry control in the always-visible toolbar (so retry is reachable
// regardless of the body state), and the marker row + footer list render with the chart content. The web
// `localStorage` hide-toggle persistence maps to the injected [ChartHiddenPrefs] seam; the URL-persisted
// hidden-series state maps to the in-memory [ChartHiddenSeries] (the host may persist both later).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ChartContainer) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located render scope + adapters alongside the namesake composable.
@file:OptIn(ExperimentalLayoutApi::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartcontainer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.charts.AnnotationList
import io.teslasync.android.components.charts.ChartDefaults
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.annotationColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.modalsdialogs.addannotationpopover.AddAnnotationPopover
import io.teslasync.android.modalsdialogs.addannotationpopover.AnnotationResult
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.annotations.DataAnnotation
import java.time.Instant
import io.teslasync.android.components.charts.AnnotationCategory as ChartCategory
import io.teslasync.android.components.charts.ChartContainer as ChartFrame
import io.teslasync.android.components.charts.DataAnnotation as ChartListAnnotation

/** Marker-chip dot diameter — the web `h-2.5 w-2.5` annotation marker. */
private val MARKER_DOT_SIZE: Dp = 8.dp

/**
 * The render-prop scope handed to the chart [content] — the native analogue of the web function-children
 * argument `{ annotations, hidden, hiddenSeries }`. Children read [annotations] to draw their reference-line
 * overlays (already gated by [hidden]) and [hiddenSeries] to set `hide=` on each series; [onToggleSeries]
 * flips a series from a context-aware legend.
 */
@Immutable
class ChartContainerScope(
    val annotations: List<DataAnnotation>,
    val hidden: Boolean,
    val hiddenSeries: ChartHiddenSeries,
    val onToggleSeries: (String) -> Unit,
)

/**
 * Stateful entry point — the faithful port of the web `<ChartContainer>`. When [annotations] + [source] are
 * supplied the container takes ownership of the annotation flow (web `annotations` prop) by binding a
 * [ChartContainerViewModel]; otherwise it is a purely presentational frame (the web component without the
 * prop). Records the one-shot `view.opened` diagnostic, renders the chart [content] via the render-prop scope,
 * and never performs HTTP.
 *
 * @param title the chart title (web `title`).
 * @param ariaLabel the required accessible name for the chart body (web `ariaLabel`, `role="img"`).
 * @param annotations the annotation-integration config (web `annotations`); `null` opts out of the overlay.
 * @param source the annotation feed + mutation seam (required when [annotations] is set; supplied by the host).
 * @param loading whether the host's chart data is loading (web `loading`).
 * @param empty whether the host resolved no chart data (web `empty`).
 * @param error whether the host's chart load hard-failed — renders the error body with retry (web SectionErrorBoundary).
 * @param onRetry re-runs the host's chart load (the body error retry).
 * @param data / dataColumns the a11y fallback table source (web `data` / `dataColumns`).
 * @param exportable whether the export menu may render (web `exportable`); the host wires the capture callbacks.
 * @param fullscreen / onToggleFullscreen the controlled fullscreen toggle (web `fullscreen` + FullscreenButton).
 * @param action an extra host-supplied toolbar control (web `action`).
 * @param content the chart body, invoked with the [ChartContainerScope] render-prop (web function-children).
 */
@Composable
fun ChartContainer(
    title: String,
    ariaLabel: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    loading: Boolean = false,
    empty: Boolean = false,
    error: Boolean = false,
    onRetry: (() -> Unit)? = null,
    height: Dp = ChartDefaults.Height,
    ariaDescription: String? = null,
    data: List<ChartDataRow>? = null,
    dataColumns: List<ChartDataColumn>? = null,
    exportable: Boolean = true,
    onExportImage: (() -> Unit)? = null,
    onCopyImage: (() -> Unit)? = null,
    onExportCsv: (() -> Unit)? = null,
    fullscreen: Boolean = false,
    onToggleFullscreen: (() -> Unit)? = null,
    action: (@Composable () -> Unit)? = null,
    annotations: ChartAnnotationsConfig? = null,
    source: ChartContainerSource? = null,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable (ChartContainerScope) -> Unit,
) {
    if (annotations != null && source != null) {
        AnnotatedChartContainer(
            config = annotations,
            source = source,
            title = title,
            ariaLabel = ariaLabel,
            modifier = modifier,
            subtitle = subtitle,
            loading = loading,
            empty = empty,
            error = error,
            onRetry = onRetry,
            height = height,
            ariaDescription = ariaDescription,
            data = data,
            dataColumns = dataColumns,
            exportable = exportable,
            onExportImage = onExportImage,
            onCopyImage = onCopyImage,
            onExportCsv = onExportCsv,
            fullscreen = fullscreen,
            onToggleFullscreen = onToggleFullscreen,
            action = action,
            logger = logger,
            content = content,
        )
    } else {
        LaunchedEffect(Unit) { logger.info("view.opened", mapOf("slug" to CHART_CONTAINER_SLUG)) }
        ChartContainerContent(
            title = title,
            ariaLabel = ariaLabel,
            modifier = modifier,
            subtitle = subtitle,
            loading = loading,
            empty = empty,
            error = error,
            onRetry = onRetry,
            height = height,
            ariaDescription = ariaDescription,
            data = data,
            dataColumns = dataColumns,
            exportable = exportable,
            onExportImage = onExportImage,
            onCopyImage = onCopyImage,
            onExportCsv = onExportCsv,
            fullscreen = fullscreen,
            onToggleFullscreen = onToggleFullscreen,
            action = action,
            annotationsEnabled = false,
            feedState = UiState.loading(),
            hidden = false,
            popoverOpen = false,
            hiddenSeries = ChartHiddenSeries(),
            content = content,
        )
    }
}

/**
 * The annotation-bound path — binds the feed/toggle/popover via a [ChartContainerViewModel], records the
 * one-shot diagnostic, auto-refreshes a stale feed (the web freshness contract), and maps the popover's
 * assembled [AnnotationResult] onto the view-model's primitive create action.
 */
@Composable
private fun AnnotatedChartContainer(
    config: ChartAnnotationsConfig,
    source: ChartContainerSource,
    title: String,
    ariaLabel: String,
    modifier: Modifier,
    subtitle: String?,
    loading: Boolean,
    empty: Boolean,
    error: Boolean,
    onRetry: (() -> Unit)?,
    height: Dp,
    ariaDescription: String?,
    data: List<ChartDataRow>?,
    dataColumns: List<ChartDataColumn>?,
    exportable: Boolean,
    onExportImage: (() -> Unit)?,
    onCopyImage: (() -> Unit)?,
    onExportCsv: (() -> Unit)?,
    fullscreen: Boolean,
    onToggleFullscreen: (() -> Unit)?,
    action: (@Composable () -> Unit)?,
    logger: Logger,
    content: @Composable (ChartContainerScope) -> Unit,
) {
    val hiddenKey = config.hiddenStorageKey(title)
    val viewModel: ChartContainerViewModel =
        viewModel(
            key = hiddenKey,
            factory = ChartContainerViewModel.factory(source, config, hiddenKey, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }

    val feedState by viewModel.annotations.collectAsStateWithLifecycle()
    val hidden by viewModel.hidden.collectAsStateWithLifecycle()
    val popoverOpen by viewModel.popoverOpen.collectAsStateWithLifecycle()
    val hiddenSeries by viewModel.hiddenSeries.collectAsStateWithLifecycle()

    // Auto-refresh a stale-but-reachable feed (the web freshness auto-refetch); a hard error waits for retry.
    LaunchedEffect(feedState.stale, feedState.refreshing, feedState.hasError) {
        if (feedState.stale && !feedState.refreshing && !feedState.hasError) viewModel.retry()
    }

    ChartContainerContent(
        title = title,
        ariaLabel = ariaLabel,
        modifier = modifier,
        subtitle = subtitle,
        loading = loading,
        empty = empty,
        error = error,
        onRetry = onRetry,
        height = height,
        ariaDescription = ariaDescription,
        data = data,
        dataColumns = dataColumns,
        exportable = exportable,
        onExportImage = onExportImage,
        onCopyImage = onCopyImage,
        onExportCsv = onExportCsv,
        fullscreen = fullscreen,
        onToggleFullscreen = onToggleFullscreen,
        action = action,
        annotationsEnabled = true,
        feedState = feedState,
        hidden = hidden,
        popoverOpen = popoverOpen,
        hiddenSeries = hiddenSeries,
        onAddClick = viewModel::openPopover,
        onToggleHidden = viewModel::toggleHidden,
        onCancelPopover = viewModel::closePopover,
        onAdd = { result ->
            viewModel.addAnnotation(result.occurredAt, result.category.wire, result.label, result.description)
        },
        onRemoveAnnotation = viewModel::removeAnnotation,
        onAnnotationRetry = viewModel::retry,
        onToggleSeries = viewModel::toggleSeries,
        content = content,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies the
 * annotation [feedState] into an [AnnotationFeed], derives the host body status + the a11y fallback table, and
 * composes the shared [ChartFrame] (chrome + body states + export + fullscreen + data table) with the
 * annotation toolbar, marker row, footer list, and AddAnnotationPopover layered on. Every visible string is
 * localized; the toolbar retry + the freshness chip keep the annotation feed's error/offline states reachable
 * regardless of the chart body state.
 */
@Composable
fun ChartContainerContent(
    title: String,
    ariaLabel: String,
    feedState: UiState<List<DataAnnotation>>,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    loading: Boolean = false,
    empty: Boolean = false,
    error: Boolean = false,
    onRetry: (() -> Unit)? = null,
    height: Dp = ChartDefaults.Height,
    ariaDescription: String? = null,
    data: List<ChartDataRow>? = null,
    dataColumns: List<ChartDataColumn>? = null,
    exportable: Boolean = true,
    onExportImage: (() -> Unit)? = null,
    onCopyImage: (() -> Unit)? = null,
    onExportCsv: (() -> Unit)? = null,
    fullscreen: Boolean = false,
    onToggleFullscreen: (() -> Unit)? = null,
    action: (@Composable () -> Unit)? = null,
    annotationsEnabled: Boolean = false,
    hidden: Boolean = false,
    popoverOpen: Boolean = false,
    hiddenSeries: ChartHiddenSeries = ChartHiddenSeries(),
    onAddClick: () -> Unit = {},
    onToggleHidden: () -> Unit = {},
    onCancelPopover: () -> Unit = {},
    onAdd: (AnnotationResult) -> Unit = {},
    onRemoveAnnotation: (String) -> Unit = {},
    onAnnotationRetry: () -> Unit = {},
    onToggleSeries: (String) -> Unit = {},
    content: @Composable (ChartContainerScope) -> Unit,
) {
    val feed = classifyAnnotationFeed(feedState)
    val fetched = feed.fetched()
    val visible = visibleAnnotations(annotationsEnabled, hidden, fetched)
    val status = chartFrameStatus(chartBodyStatus(loading, error, empty))

    val tableColumns = dataColumns.orEmpty()
    val showTable = hasFallbackTable(data, dataColumns)
    val scope = ChartContainerScope(visible, hidden, hiddenSeries, onToggleSeries)

    ChartFrame(
        title = title,
        modifier = modifier,
        subtitle = subtitle,
        status = status,
        height = height,
        action = {
            ChartContainerToolbar(
                annotationsEnabled = annotationsEnabled,
                hidden = hidden,
                feed = feed,
                feedState = feedState,
                hostAction = action,
                onAddClick = onAddClick,
                onToggleHidden = onToggleHidden,
                onAnnotationRetry = onAnnotationRetry,
            )
        },
        accessibleDescription = composeAccessibleDescription(ariaLabel, ariaDescription),
        dataTableHeader = if (showTable) chartTableHeader(tableColumns) else null,
        dataTableRows = if (showTable) chartTableRows(data.orEmpty(), tableColumns) else null,
        dataTableLabel = stringResource(R.string.translation_chart_a11y_fallbackTableLabel, title),
        emptyMessage = stringResource(R.string.translation_chart_noData),
        errorMessage = stringResource(R.string.translation_errors_section_chartTitle),
        retryLabel = if (onRetry != null) stringResource(R.string.translation_common_retry) else null,
        onRetry = onRetry,
        onExportImage = if (exportable) onExportImage else null,
        onCopyImage = if (exportable) onCopyImage else null,
        onExportCsv = if (exportable) onExportCsv else null,
        fullscreen = fullscreen,
        onToggleFullscreen = onToggleFullscreen,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            if (showMarkerRow(annotationsEnabled, hidden, visible)) {
                MarkerChipRow(
                    annotations = visible,
                    label = stringResource(R.string.translation_annotations_markerRow),
                )
            }
            content(scope)
            if (annotationsEnabled && fetched.isNotEmpty()) {
                AnnotationListFooter(
                    annotations = fetched,
                    title = stringResource(R.string.translation_annotations_markerRow),
                    removeLabel = stringResource(R.string.translation_common_remove),
                    onRemove = onRemoveAnnotation,
                )
            }
        }
    }

    if (annotationsEnabled && popoverOpen) {
        val timestamp = remember(popoverOpen) { Instant.now().toString() }
        AddAnnotationPopover(
            open = true,
            timestamp = timestamp,
            onAdd = onAdd,
            onCancel = onCancelPopover,
            editableDate = true,
        )
    }
}

/**
 * The annotation toolbar rendered in the [ChartFrame] header before the export menu + fullscreen — the web
 * `Add` + `Hide/Show` buttons plus the freshness chip and a retry control. The retry stays reachable for any
 * stale/offline/hard-error feed regardless of the chart body state (P3 "every state renders, with retry").
 */
@Composable
private fun ChartContainerToolbar(
    annotationsEnabled: Boolean,
    hidden: Boolean,
    feed: AnnotationFeed,
    feedState: UiState<List<DataAnnotation>>,
    hostAction: (@Composable () -> Unit)?,
    onAddClick: () -> Unit,
    onToggleHidden: () -> Unit,
    onAnnotationRetry: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        hostAction?.invoke()
        if (annotationsEnabled) {
            IconButton(
                imageVector = TeslaGlyphs.Plus,
                contentDescription = stringResource(R.string.translation_annotations_add),
                onClick = onAddClick,
                size = IconSize.Sm,
            )
            IconButton(
                imageVector = if (hidden) TeslaGlyphs.EyeOff else TeslaGlyphs.Eye,
                contentDescription =
                    if (hidden) {
                        stringResource(R.string.translation_annotations_show)
                    } else {
                        stringResource(R.string.translation_annotations_hide)
                    },
                onClick = onToggleHidden,
                size = IconSize.Sm,
            )
            AnnotationFeedStatus(feed = feed, feedState = feedState, onRetry = onAnnotationRetry)
        }
    }
}

/**
 * The annotation feed's freshness/offline/error indicator — a [DataFreshness] chip while refreshing/stale, and
 * a retry control with a polite live-region announcement when the feed is stale/offline or hard-failed. Pure
 * presentation; the classification + announcement come from the unit-tested model.
 */
@Composable
private fun AnnotationFeedStatus(
    feed: AnnotationFeed,
    feedState: UiState<List<DataAnnotation>>,
    onRetry: () -> Unit,
) {
    val labels =
        AnnotationFeedLabels(
            stale = stringResource(R.string.translation_mqtt_stale),
            offline = stringResource(R.string.translation_common_offline),
            error = stringResource(R.string.translation_queryError_title),
        )
    val announcement = annotationFeedAnnouncement(feed, labels)

    if (feedState.refreshing || feedState.stale || feedState.hasError) {
        DataFreshness(
            updatedAtMillis = feedState.fetchedAt?.takeIf { it > 0 },
            isFetching = feedState.refreshing,
            isStale = feedState.stale,
            isError = feedState.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberChartFreshnessFormatter(),
        )
    }
    if (feed.canRetry()) {
        Button(
            label = stringResource(R.string.translation_common_retry),
            onClick = onRetry,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            modifier =
                Modifier.semantics {
                    if (announcement != null) contentDescription = announcement
                    liveRegion = LiveRegionMode.Polite
                },
        )
    }
}

/**
 * The mobile annotation marker row — the web `showMarkerRow` chip strip above the chart on small viewports. A
 * wrapping row of category-colored dots + labels; the row carries the localized "Annotations on this chart"
 * group label for assistive tech.
 */
@Composable
private fun MarkerChipRow(
    annotations: List<DataAnnotation>,
    label: String,
) {
    val chipBackground = MaterialTheme.colorScheme.surfaceVariant
    FlowRow(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        annotations.forEach { annotation ->
            val dotColor = annotationColor(annotationCategoryFromWire(annotation.category))
            Row(
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(chipBackground)
                        .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Box(modifier = Modifier.size(MARKER_DOT_SIZE).clip(CircleShape).background(dotColor))
                Caption(annotation.label)
            }
        }
    }
}

/** The annotation roster below the chart — the web `AnnotationList` footer, mapped onto the shared chart list atom. */
@Composable
private fun AnnotationListFooter(
    annotations: List<DataAnnotation>,
    title: String,
    removeLabel: String,
    onRemove: (String) -> Unit,
) {
    AnnotationList(
        annotations = annotations.map(::toAnnotationListItem),
        title = title,
        removeLabel = removeLabel,
        onRemove = onRemove,
    )
}

// ── render-side adapters ──────────────────────────────────────────────────────────────────────────────────

/** Maps a wire category token onto the shared chart-component [ChartCategory] for the dot color + the list atom. */
private fun annotationCategoryFromWire(wire: String): ChartCategory =
    when (wire.trim().lowercase()) {
        "milestone" -> ChartCategory.Milestone
        "maintenance" -> ChartCategory.Maintenance
        "trip" -> ChartCategory.Trip
        "issue" -> ChartCategory.Issue
        "upgrade" -> ChartCategory.Upgrade
        else -> ChartCategory.Custom
    }

/**
 * Adapts a shared-core [DataAnnotation] onto the chart-component [ChartListAnnotation] the footer
 * [AnnotationList] consumes. The list never reads the chart x-[index] (only the on-plot marker rail does, and
 * the chart children own that), so it is fixed at 0; the ISO timestamp is rendered as a short date label.
 */
private fun toAnnotationListItem(annotation: DataAnnotation): ChartListAnnotation =
    ChartListAnnotation(
        id = annotation.id,
        index = 0,
        label = annotation.label,
        category = annotationCategoryFromWire(annotation.category),
        description = annotation.description,
        timestampLabel = formatAnnotationDate(annotation.timestamp),
    )

/** Maps a [ChartBodyStatus] onto the shared frame's [ChartStatus]. */
private fun chartFrameStatus(status: ChartBodyStatus): ChartStatus =
    when (status) {
        ChartBodyStatus.Loading -> ChartStatus.Loading
        ChartBodyStatus.Error -> ChartStatus.Error
        ChartBodyStatus.Empty -> ChartStatus.Empty
        ChartBodyStatus.Content -> ChartStatus.Ready
    }

/** Localized relative-age formatter for the annotation freshness chip (`translation_freshness_*`). */
@Composable
private fun rememberChartFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private fun previewAnnotation(
    id: String,
    label: String,
    category: String,
): DataAnnotation =
    DataAnnotation(
        id = id,
        timestamp = "2026-05-01T00:00:00Z",
        label = label,
        description = null,
        category = category,
        context = "cost",
        vehicleId = 1L,
        createdAt = "2026-05-01T00:00:00Z",
    )

private val PREVIEW_ROWS =
    listOf(
        previewAnnotation("1", "Battery swap", "maintenance"),
        previewAnnotation("2", "Road trip", "trip"),
    )

@Composable
private fun PreviewBody() {
    Caption("chart goes here")
}

@Preview(name = "Content + annotations")
@Composable
private fun ChartContainerContentPreview() {
    TeslaSyncTheme {
        ChartContainerContent(
            title = "Monthly Cost",
            ariaLabel = "Monthly charging cost trend",
            feedState = UiState(UiPhase.Content, data = PREVIEW_ROWS, fetchedAt = 100L),
            annotationsEnabled = true,
        ) { PreviewBody() }
    }
}

@Preview(name = "Loading")
@Composable
private fun ChartContainerLoadingPreview() {
    TeslaSyncTheme {
        ChartContainerContent(
            title = "Monthly Cost",
            ariaLabel = "Monthly charging cost trend",
            feedState = UiState.loading(),
            loading = true,
            annotationsEnabled = true,
        ) { PreviewBody() }
    }
}

@Preview(name = "Empty")
@Composable
private fun ChartContainerEmptyPreview() {
    TeslaSyncTheme {
        ChartContainerContent(
            title = "Monthly Cost",
            ariaLabel = "Monthly charging cost trend",
            feedState = UiState(UiPhase.Empty, data = emptyList()),
            empty = true,
            annotationsEnabled = true,
        ) { PreviewBody() }
    }
}

@Preview(name = "Offline (last known)")
@Composable
private fun ChartContainerOfflinePreview() {
    TeslaSyncTheme {
        ChartContainerContent(
            title = "Monthly Cost",
            ariaLabel = "Monthly charging cost trend",
            feedState =
                UiState(
                    UiPhase.Content,
                    data = PREVIEW_ROWS,
                    fetchedAt = 100L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            annotationsEnabled = true,
        ) { PreviewBody() }
    }
}

@Preview(name = "Error (no cache)")
@Composable
private fun ChartContainerErrorPreview() {
    TeslaSyncTheme {
        ChartContainerContent(
            title = "Monthly Cost",
            ariaLabel = "Monthly charging cost trend",
            feedState =
                UiState(
                    UiPhase.Error,
                    errorKind = ErrorKind.Network,
                ),
            annotationsEnabled = true,
            onAnnotationRetry = {},
        ) { PreviewBody() }
    }
}

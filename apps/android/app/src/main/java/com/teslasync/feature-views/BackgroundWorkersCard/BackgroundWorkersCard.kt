// The native Jetpack Compose + Material 3 BackgroundWorkersCard feature view — a parity port of
// web/src/features/system/components/status/BackgroundWorkersCard.tsx. The web component is an operator-grade,
// per-instance worker-visibility panel: it groups the `/system/workers` rows by worker `name` (one group per
// type, one row per host when a worker is horizontally scaled), and renders a two-axis top-line summary
// (worker types vs. instances + a replicated count), a per-group rollup (status dot + Boxes glyph + name +
// "healthy / total" chip + instance count), per-instance rows (status dot + Server glyph + short host + status
// chip + latency, plus the probe error message when a probe fails), a "set *_HOSTS to scale" callout when no
// worker is replicated, and a footer link to the API logs.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (the web
// component uses none). The owning system-status host supplies the `WorkersHealth` through the shared P1/S8
// state-holder layer as a [UiState], so this feature view renders every lifecycle state that layer can carry —
// loading skeleton, hard error with retry, empty, content, and stale/offline ("last known") — without ever
// fetching. A web-parity overload that takes the raw `health` prop is also provided for hosts that already hold
// the value. Every value derivation + formatter flows through the pure [WorkersProjection]; the composable is a
// thin render layer.
//
// The web component itself renders no title (its parent `AccordionSection` supplies "Background workers" + a
// Boxes glyph); this standalone native surface reproduces that section identity in its own header so the
// honest freshness chip (refreshing / stale / offline) has a home and the panel is never a blank box.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackgroundWorkersCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling AcDcStatsPanel
// surface does. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backgroundworkerscard

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// ── Layout geometry (web Tailwind values, reproduced) ───────────────────────────────────────────────

/** Web `h-2.5 w-2.5` group-header status dot. */
private val GROUP_DOT_SIZE: Dp = 10.dp

/** Web `h-2 w-2` per-instance status dot. */
private val INSTANCE_DOT_SIZE: Dp = 8.dp

/** Web `w-16` (4rem) latency column. */
private val LATENCY_WIDTH: Dp = 56.dp

/** Loading skeleton block heights. */
private val LOADING_TITLE_HEIGHT: Dp = 16.dp
private val LOADING_SUMMARY_BAR_HEIGHT: Dp = 12.dp
private val LOADING_GROUP_HEIGHT: Dp = 64.dp
private const val LOADING_TITLE_WIDTH_FRACTION: Float = 0.5f
private const val LOADING_GROUP_COUNT: Int = 2

/** The top-line summary is a three-column grid (web `md:grid-cols-3`). */
private const val SUMMARY_CELL_COUNT: Int = 3

/**
 * Stateful entry point for the background-workers panel. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared system-status feed can carry. The host
 * owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`) and [onOpenApiLogs] (navigation to the
 * API-logs surface, web `<Link to="/api-logs">`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the workers health (web `health`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param onOpenApiLogs opens the API-logs surface (web `/api-logs`); defaults to a no-op for prop-only hosts.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun BackgroundWorkersCard(
    state: UiState<WorkersHealthData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenApiLogs: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { BackgroundWorkersCardDiagnostics.recordViewOpened(logger) }
    BackgroundWorkersCardContent(state = state, onRetry = onRetry, modifier = modifier, onOpenApiLogs = onOpenApiLogs)
}

/**
 * Web-parity overload mirroring the web component's `health: WorkersHealth | undefined` prop, for hosts that
 * already hold the value. A `null` or empty-workers payload renders the empty state (web
 * `!health || workers.length === 0`); a populated payload renders the panel. Records `view.opened` like the
 * stateful entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun BackgroundWorkersCard(
    health: WorkersHealthData?,
    modifier: Modifier = Modifier,
    onOpenApiLogs: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(health) {
            if (health == null || health.workers.isEmpty()) {
                UiState(UiPhase.Empty)
            } else {
                UiState(UiPhase.Content, data = health)
            }
        }
    BackgroundWorkersCard(state = state, onRetry = {}, modifier = modifier, onOpenApiLogs = onOpenApiLogs, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web panel
 * (summary grid, grouped instance rows, scale-hint callout, API-logs link) and adds the lifecycle chrome the
 * host's feed implies: a loading skeleton, a hard-error retry surface (web `QueryError` equivalent), a friendly
 * empty state, and a freshness chip in the header that reflects refreshing / stale / offline. Stale (non-error)
 * data auto-refreshes, mirroring the freshness contract. [locale] is reserved for any locale-sensitive
 * formatting the host wishes to pin (the projection itself emits locale-invariant digits for web parity).
 */
@Composable
fun BackgroundWorkersCardContent(
    state: UiState<WorkersHealthData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    onOpenApiLogs: () -> Unit = {},
    @Suppress("UNUSED_PARAMETER") locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> WorkersLoading()
            state.isError -> WorkersError(onRetry = onRetry)
            else -> {
                val display = remember(state.data) { state.data?.let { WorkersProjection.project(it) } }
                WorkersLoaded(state = state, display = display, onOpenApiLogs = onOpenApiLogs)
            }
        }
    }
}

/**
 * The non-loading/non-error body: the always-present title header (with the freshness chip when the cached data
 * is refreshing / stale / offline), then either the friendly empty state (no workers reporting) or the summary
 * grid + grouped instance rows + scale-hint callout + API-logs footer. Laid out as a spaced column so the panel
 * reads as one surface and is never a blank box.
 */
@Composable
private fun ColumnScope.WorkersLoaded(
    state: UiState<WorkersHealthData>,
    display: WorkersDisplay?,
    onOpenApiLogs: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        WorkersHeader(state = state)
        if (display == null || display.isEmpty) {
            WorkersEmpty()
        } else {
            WorkersSummaryGrid(summary = display.summary)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                display.groups.forEach { group -> WorkerGroupCard(group = group) }
            }
            if (display.showScaleHint) WorkersScaleHint()
            WorkersApiLogsFooter(onOpenApiLogs = onOpenApiLogs)
        }
    }
}

/**
 * The panel header — the Boxes glyph + "Background workers" title (mirroring the web parent's `AccordionSection`
 * heading), plus the honest freshness chip (refreshing / stale / offline) at the trailing edge when cached data
 * is being shown.
 */
@Composable
private fun WorkersHeader(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = WorkersGlyphs.Boxes,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SectionTitle(
            text = stringResource(R.string.translation_system_workers_title),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        if (shouldShowFreshness(state)) {
            WorkersFreshnessChip(state = state)
        }
    }
}

/** True when cached data is refreshing / stale / offline and the panel content (not loading/error) is shown. */
private fun shouldShowFreshness(state: UiState<*>): Boolean =
    !state.isLoading && !state.isError && (state.stale || state.refreshing || state.hasError)

/**
 * The two-axis top-line summary — the native counterpart of the web `grid-cols-2 md:grid-cols-3`: worker types
 * (healthy groups of total), instances (healthy of total), and the replicated-group count (or "single instance
 * each" when nothing is scaled). Each cell is a muted label over a primary value.
 */
@Composable
private fun WorkersSummaryGrid(summary: WorkersSummary) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        SummaryCell(
            label = stringResource(R.string.translation_system_workers_types),
            value =
                stringResource(
                    R.string.translation_system_workers_ofTypes,
                    summary.healthyGroups.toString(),
                    summary.groupCount.toString(),
                ),
        )
        SummaryCell(
            label = stringResource(R.string.translation_system_workers_instances),
            value =
                stringResource(
                    R.string.translation_system_workers_ofInstances,
                    summary.healthyInstances.toString(),
                    summary.totalInstances.toString(),
                ),
        )
        SummaryCell(
            label = stringResource(R.string.translation_system_workers_replicated),
            value = replicatedValue(summary),
        )
    }
}

/** Web `multiInstanceGroups > 0 ? "{n} of {m} type(s)" : "single instance each"` (singular/plural on `m`). */
@Composable
private fun replicatedValue(summary: WorkersSummary): String =
    when {
        summary.multiInstanceGroups <= 0 ->
            stringResource(R.string.translation_system_workers_singleInstanceEach)
        summary.groupCount == 1 ->
            stringResource(
                R.string.translation_system_workers_ofTypeOne,
                summary.multiInstanceGroups.toString(),
                summary.groupCount.toString(),
            )
        else ->
            stringResource(
                R.string.translation_system_workers_ofTypes,
                summary.multiInstanceGroups.toString(),
                summary.groupCount.toString(),
            )
    }

/** One summary cell — a muted label over a primary value, taking an equal share of the row width. */
@Composable
private fun RowScope.SummaryCell(
    label: String,
    value: String,
) {
    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        BodyText(value, maxLines = 1)
    }
}

/**
 * One worker-type group card — a bordered container with a rollup header (status dot + Boxes glyph + name +
 * "healthy / total" chip + instance count) over its 1..N instance rows, separated by dividers (web `divide-y`).
 */
@Composable
private fun WorkerGroupCard(group: WorkerGroup) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.medium),
    ) {
        WorkerGroupHeader(group = group)
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        group.instances.forEachIndexed { index, instance ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            WorkerInstanceRow(instance = instance)
        }
    }
}

/** The group rollup header. The status dot carries the combined "{name} status: {severity}" TalkBack label. */
@Composable
private fun WorkerGroupHeader(group: WorkerGroup) {
    val severityLabel = stringResource(severityLabelRes(group.severity))
    val dotDescription =
        stringResource(R.string.translation_system_workers_a11y_groupStatus, group.name, severityLabel)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = HEADER_TINT_ALPHA))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        StatusDot(color = severityColor(group.severity), description = dotDescription, size = GROUP_DOT_SIZE)
        Icon(
            imageVector = WorkersGlyphs.Boxes,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = group.name,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Badge(
            text =
                stringResource(
                    R.string.translation_system_workers_healthyCount,
                    group.healthy.toString(),
                    group.total.toString(),
                ),
            variant = severityBadgeVariant(group.severity),
        )
        Caption(instanceCountLabel(group.total))
    }
}

/** Web `g.total > 1 ? "{n} instances" : "1 instance"`. */
@Composable
private fun instanceCountLabel(total: Int): String =
    if (total > 1) {
        stringResource(R.string.translation_system_workers_instanceCount, total.toString())
    } else {
        stringResource(R.string.translation_system_workers_instanceCountOne)
    }

/**
 * One instance row — status dot + Server glyph + short host (monospace, truncated, full URL exposed to
 * TalkBack) + status chip + right-aligned latency, with the probe error message rendered beneath it when the
 * probe failed (web's red error callout).
 */
@Composable
private fun WorkerInstanceRow(instance: WorkerInstance) {
    val instanceLabel = stringResource(instanceLabelRes(instance.status))
    val dotDescription =
        stringResource(R.string.translation_system_workers_a11y_instanceStatus, instanceLabel)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            StatusDot(color = instanceColor(instance.status), description = dotDescription, size = INSTANCE_DOT_SIZE)
            Icon(
                imageVector = WorkersGlyphs.Server,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = WorkersProjection.shortHost(instance.host),
                modifier =
                    Modifier
                        .weight(1f)
                        .clearAndSetSemantics { contentDescription = instance.host },
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Badge(text = instanceLabel, variant = instanceBadgeVariant(instance.status))
            Text(
                text = WorkersProjection.formatLatency(instance.latencyMs),
                modifier = Modifier.width(LATENCY_WIDTH),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.End,
                maxLines = 1,
            )
        }
        instance.error?.let { message -> WorkerInstanceError(message = message) }
    }
}

/** The per-instance error callout — a danger-tinted box with the AlertTriangle glyph and the probe error. */
@Composable
private fun WorkerInstanceError(message: String) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.small)
                .background(TeslaTokens.status.danger.copy(alpha = ERROR_TINT_ALPHA))
                .border(1.dp, TeslaTokens.status.danger.copy(alpha = ERROR_BORDER_ALPHA), MaterialTheme.shapes.small)
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.AlertTriangle,
            contentDescription = null,
            size = IconSize.Xs,
            tint = TeslaTokens.status.danger,
        )
        Text(
            text = message,
            style = MaterialTheme.typography.labelSmall,
            color = TeslaTokens.status.danger,
        )
    }
}

/**
 * The "set *_HOSTS to scale" callout — the web footer guidance, shown only when no worker is replicated. The
 * three `*_HOSTS` environment-variable names are rendered monospace (web `<code>`) via an [AnnotatedString].
 */
@Composable
private fun WorkersScaleHint() {
    val template =
        stringResource(
            R.string.translation_system_workers_scaleHint,
            WorkerScaleHosts.NOTIFICATION,
            WorkerScaleHosts.EXPORT,
            WorkerScaleHosts.AUTOMATION,
        )
    val codeColor = MaterialTheme.colorScheme.onSurface
    val annotated = remember(template, codeColor) { buildScaleHint(template, codeColor) }
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.small)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.small)
                .padding(Spacing.sm),
    ) {
        Text(
            text = annotated,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Styles each `*_HOSTS` name monospace inside the already-localized [template]. */
private fun buildScaleHint(
    template: String,
    codeColor: Color,
): AnnotatedString =
    buildAnnotatedString {
        append(template)
        val names = listOf(WorkerScaleHosts.NOTIFICATION, WorkerScaleHosts.EXPORT, WorkerScaleHosts.AUTOMATION)
        for (name in names) {
            var index = template.indexOf(name)
            while (index >= 0) {
                addStyle(SpanStyle(fontFamily = FontFamily.Monospace, color = codeColor), index, index + name.length)
                index = template.indexOf(name, index + name.length)
            }
        }
    }

/** The footer link to the API logs — web `<Link to="/api-logs">` with the Activity glyph. */
@Composable
private fun WorkersApiLogsFooter(onOpenApiLogs: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Button(
            label = stringResource(R.string.translation_system_workers_apiLogs),
            onClick = onOpenApiLogs,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = WorkersGlyphs.Activity,
        )
    }
}

/**
 * First-load skeleton — a title bar over a three-cell summary block and two group blocks, so the panel reads as
 * this surface (not a generic spinner) and is never blank while the first fetch runs. Carries a single TalkBack
 * "Loading" description.
 */
@Composable
private fun WorkersLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_WIDTH_FRACTION, height = LOADING_TITLE_HEIGHT)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            repeat(SUMMARY_CELL_COUNT) {
                Column(modifier = Modifier.weight(1f)) {
                    Skeleton(height = LOADING_SUMMARY_BAR_HEIGHT)
                }
            }
        }
        repeat(LOADING_GROUP_COUNT) {
            Skeleton(height = LOADING_GROUP_HEIGHT, rounded = false)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun WorkersError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty state — shown when no workers are reporting, so the panel is never a blank box (web empty branch). */
@Composable
private fun WorkersEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_system_workers_empty),
        icon = WorkersGlyphs.Boxes,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The header freshness chip — the honest "refreshing / stale / offline" affordance over cached figures. */
@Composable
private fun WorkersFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberWorkersFreshnessFormatter(),
    )
}

/** A small colored status dot exposing its meaning to TalkBack via [description] (web's `aria-label` on the dot). */
@Composable
private fun StatusDot(
    color: Color,
    description: String,
    size: Dp,
) {
    Box(
        modifier =
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(color)
                .clearAndSetSemantics { contentDescription = description },
    )
}

/** Group severity → dot color: healthy ⇒ success, degraded ⇒ warning, down ⇒ danger, unknown ⇒ muted. */
@Composable
private fun severityColor(severity: GroupSeverity): Color =
    when (severity) {
        GroupSeverity.Healthy -> TeslaTokens.status.success
        GroupSeverity.Degraded -> TeslaTokens.status.warning
        GroupSeverity.Down -> TeslaTokens.status.danger
        GroupSeverity.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Instance status → dot color: healthy ⇒ success, unhealthy ⇒ warning, down ⇒ danger. */
@Composable
private fun instanceColor(status: WorkerInstanceStatus): Color =
    when (status) {
        WorkerInstanceStatus.Healthy -> TeslaTokens.status.success
        WorkerInstanceStatus.Unhealthy -> TeslaTokens.status.warning
        WorkerInstanceStatus.Down -> TeslaTokens.status.danger
    }

/** Group severity → chip color variant. */
private fun severityBadgeVariant(severity: GroupSeverity): BadgeVariant =
    when (severity) {
        GroupSeverity.Healthy -> BadgeVariant.Success
        GroupSeverity.Degraded -> BadgeVariant.Warning
        GroupSeverity.Down -> BadgeVariant.Danger
        GroupSeverity.Unknown -> BadgeVariant.Neutral
    }

/** Instance status → chip color variant. */
private fun instanceBadgeVariant(status: WorkerInstanceStatus): BadgeVariant =
    when (status) {
        WorkerInstanceStatus.Healthy -> BadgeVariant.Success
        WorkerInstanceStatus.Unhealthy -> BadgeVariant.Warning
        WorkerInstanceStatus.Down -> BadgeVariant.Danger
    }

/** Group severity → its localized rollup label (web `severityClasses(...).label`). */
@StringRes
private fun severityLabelRes(severity: GroupSeverity): Int =
    when (severity) {
        GroupSeverity.Healthy -> R.string.translation_system_workers_severity_allHealthy
        GroupSeverity.Degraded -> R.string.translation_system_workers_severity_degraded
        GroupSeverity.Down -> R.string.translation_system_workers_severity_down
        GroupSeverity.Unknown -> R.string.translation_system_workers_severity_unknown
    }

/** Instance status → its localized label (web `instanceClasses(...).label`). */
@StringRes
private fun instanceLabelRes(status: WorkerInstanceStatus): Int =
    when (status) {
        WorkerInstanceStatus.Healthy -> R.string.translation_system_workers_status_healthy
        WorkerInstanceStatus.Unhealthy -> R.string.translation_system_workers_status_unhealthy
        WorkerInstanceStatus.Down -> R.string.translation_system_workers_status_down
    }

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberWorkersFreshnessFormatter(): (FreshnessAge) -> String {
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

private const val HEADER_TINT_ALPHA: Float = 0.4f
private const val ERROR_TINT_ALPHA: Float = 0.1f
private const val ERROR_BORDER_ALPHA: Float = 0.25f

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_SINGLE =
    WorkersHealthData(
        workers =
            listOf(
                WorkerInstance("automation-worker", "http://automation-worker:8083/healthz", WorkerInstanceStatus.Healthy, 9.0),
                WorkerInstance("export-worker", "http://export-worker:8082/healthz", WorkerInstanceStatus.Healthy, 12.0),
                WorkerInstance("notification-worker", "http://notification-worker:8081/healthz", WorkerInstanceStatus.Healthy, 7.0),
            ),
    )

private val PREVIEW_SCALED =
    WorkersHealthData(
        workers =
            listOf(
                WorkerInstance("notification-worker", "http://nw-1:8081/healthz", WorkerInstanceStatus.Healthy, 8.0),
                WorkerInstance(
                    name = "notification-worker",
                    host = "http://nw-2:8081/healthz",
                    status = WorkerInstanceStatus.Unhealthy,
                    latencyMs = 142.0,
                    error = "503 Service Unavailable",
                ),
                WorkerInstance(
                    name = "export-worker",
                    host = "http://export-worker:8082/healthz",
                    status = WorkerInstanceStatus.Down,
                    latencyMs = null,
                    error = "dial tcp: connection refused",
                ),
            ),
    )

@Preview(name = "Content (single instance)", showBackground = true)
@Composable
private fun WorkersSingleInstancePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkersCardContent(
            state = UiState(UiPhase.Content, data = PREVIEW_SINGLE),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Content (scaled + degraded)", showBackground = true)
@Composable
private fun WorkersScaledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkersCardContent(
            state = UiState(UiPhase.Content, data = PREVIEW_SCALED),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun WorkersLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkersCardContent(state = UiState(UiPhase.Loading), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun WorkersEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkersCardContent(state = UiState(UiPhase.Empty), onRetry = {}, locale = Locale.US)
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun WorkersErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkersCardContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun WorkersOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BackgroundWorkersCardContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SINGLE,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            locale = Locale.US,
        )
    }
}

// The native Jetpack Compose + Material 3 FleetTelemetryHealth feature view — a parity port of
// web/src/features/admin/components/devtools/FleetTelemetryHealth.tsx. The web component stacks two
// ToolCards: an "Error VINs" summary (a danger/success count badge, an optional "Filtered: {vin}" chip
// with a clear button, a "Refresh from Tesla" button, and a Skeleton / VIN table / "no VINs" body where
// each VIN toggles the filter and the Last Seen cell turns rose when seen within 24h else amber) and an
// "Error Log" (a "Refresh from Tesla" button and a Skeleton / paginated error table / "no errors" body
// where a present error_code shows a danger Badge and the Reported At cell turns rose when recent). This
// native port keeps that composition and, per the P3 contract, surfaces every state the web pair implies
// (loading / empty / content / stale / offline / error) by binding the two shared Telemetry feeds (P1/S8)
// through a [FleetTelemetryHealthViewModel]: a per-card DataFreshness chip covers stale/offline/fetching,
// a `QueryError` covers a hard failure with no cache, and last-known rows stay visible while stale. The
// view performs no HTTP; every visible string resolves through the P1/S10 catalog and every interactive
// element (VIN toggle, clear filter, refresh, retry, pagination) carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FleetTelemetryHealth) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")
@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.featureviews.fleettelemetryhealth

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.toolcard.ToolCardContent
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryError
import io.teslasync.shared.core.presentation.telemetry.FleetTelemetryErrorVIN
import java.time.Instant

// Web `<Skeleton className="h-24" />` (error-VINs) and `h-40` (error-log) loading skeleton heights.
private val VINS_SKELETON_HEIGHT = 96.dp
private val ERRORS_SKELETON_HEIGHT = 160.dp

// The Error-Log message column is given extra weight so long messages don't crowd the other cells.
private const val MESSAGE_COLUMN_WEIGHT = 2f

// Preview clock + sample stamps (tooling-only).
private const val PREVIEW_NOW = 1_781_000_000_000L

/**
 * The surface's six callbacks, bundled so the stateless [FleetTelemetryHealthContent] (the test/preview
 * entry point) stays readable. Every member defaults to a no-op so a preview/test can supply only the
 * ones it exercises.
 *
 * @property onSelectVin toggle the VIN filter (web `setSelectedVin`).
 * @property onClearVin clear the VIN filter (web the Filtered chip's `×`).
 * @property onRefreshVins run the Error-VINs "Refresh from Tesla" mutation.
 * @property onRefreshErrors run the Error-Log "Refresh from Tesla" mutation.
 * @property onRetryVins retry the Error-VINs feed after a hard failure.
 * @property onRetryErrors retry the Error-Log feed after a hard failure.
 */
data class FleetTelemetryHealthActions(
    val onSelectVin: (String) -> Unit = {},
    val onClearVin: () -> Unit = {},
    val onRefreshVins: () -> Unit = {},
    val onRefreshErrors: () -> Unit = {},
    val onRetryVins: () -> Unit = {},
    val onRetryErrors: () -> Unit = {},
)

/**
 * Stateful entry point. Binds the shared Telemetry feeds via [source] into a
 * [FleetTelemetryHealthViewModel], records the one-shot `view.opened` diagnostic, collects the two
 * projected states + the filter + the per-card refresh-pending flags, and renders. A host page supplies
 * the [source] (an adapter over the shared S7/S8 Telemetry layer).
 *
 * @param source the cache-then-network Telemetry seam (`TelemetryRepository`/`TelemetryStore` adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey distinguishes multiple instances hosted in one composition.
 */
@Composable
fun FleetTelemetryHealth(
    source: FleetTelemetryHealthSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = FLEET_TELEMETRY_HEALTH_SLUG,
) {
    val viewModel: FleetTelemetryHealthViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { FleetTelemetryHealthViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val vinsState by viewModel.vinsState.collectAsStateWithLifecycle()
    val errorsState by viewModel.errorsState.collectAsStateWithLifecycle()
    val selectedVin by viewModel.selectedVin.collectAsStateWithLifecycle()
    val vinsRefreshing by viewModel.vinsRefreshing.collectAsStateWithLifecycle()
    val errorsRefreshing by viewModel.errorsRefreshing.collectAsStateWithLifecycle()

    FleetTelemetryHealthContent(
        vinsState = vinsState,
        errorsState = errorsState,
        selectedVin = selectedVin,
        vinsRefreshing = vinsRefreshing,
        errorsRefreshing = errorsRefreshing,
        actions =
            FleetTelemetryHealthActions(
                onSelectVin = viewModel::selectVin,
                onClearVin = viewModel::clearVin,
                onRefreshVins = viewModel::refreshVins,
                onRefreshErrors = viewModel::refreshErrors,
                onRetryVins = viewModel::retryVins,
                onRetryErrors = viewModel::retryErrors,
            ),
        modifier = modifier,
    )
}

/**
 * Stateless renderer for both cards — the unit/UI-test and preview entry point. Stacks the Error-VINs
 * summary above the Error-Log (web `space-y-4`); each card renders the full state matrix independently.
 * [nowMillis] is the clock the recency/relative-time math reads (injectable for deterministic UI tests).
 */
@Composable
fun FleetTelemetryHealthContent(
    vinsState: UiState<List<FleetTelemetryErrorVIN>>,
    errorsState: UiState<List<FleetTelemetryError>>,
    selectedVin: String,
    vinsRefreshing: Boolean,
    errorsRefreshing: Boolean,
    actions: FleetTelemetryHealthActions,
    modifier: Modifier = Modifier,
    nowMillis: Long = System.currentTimeMillis(),
) {
    val labels = rememberFleetHealthLabels()
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        ErrorVinsCard(
            state = vinsState,
            selectedVin = selectedVin,
            refreshing = vinsRefreshing,
            labels = labels,
            nowMillis = nowMillis,
            actions = actions,
        )
        ErrorLogCard(
            state = errorsState,
            refreshing = errorsRefreshing,
            labels = labels,
            nowMillis = nowMillis,
            actions = actions,
        )
    }
}

// ── Error VINs card ─────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ErrorVinsCard(
    state: UiState<List<FleetTelemetryErrorVIN>>,
    selectedVin: String,
    refreshing: Boolean,
    labels: FleetTelemetryHealthLabels,
    nowMillis: Long,
    actions: FleetTelemetryHealthActions,
) {
    ToolCardContent(
        icon = DataDisplayGlyphs.AlertTriangle,
        color = "red",
        title = stringResource(R.string.translation_devtools_health_errorVinsTitle),
        description = stringResource(R.string.translation_devtools_health_errorVinsDesc),
    ) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ErrorVinsControls(state = state, selectedVin = selectedVin, refreshing = refreshing, actions = actions)
            ErrorVinsBody(state = state, selectedVin = selectedVin, labels = labels, nowMillis = nowMillis, actions = actions)
        }
    }
}

@Composable
private fun ErrorVinsControls(
    state: UiState<List<FleetTelemetryErrorVIN>>,
    selectedVin: String,
    refreshing: Boolean,
    actions: FleetTelemetryHealthActions,
) {
    val count = state.data?.size ?: 0
    val affected = stringResource(R.string.translation_devtools_health_affectedVehicles)
    val filteredBy = stringResource(R.string.translation_devtools_health_filteredBy)
    val clearLabel = stringResource(R.string.translation_devtools_health_clearVinFilter)
    val refreshLabel = stringResource(R.string.translation_devtools_health_refreshVins)
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Badge(
            text = "$count $affected",
            variant = if (count > 0) BadgeVariant.Danger else BadgeVariant.Success,
            modifier = Modifier.align(Alignment.CenterVertically),
        )
        if (selectedVin.isNotEmpty()) {
            Badge(
                text = "$filteredBy: $selectedVin",
                variant = BadgeVariant.Info,
                modifier = Modifier.align(Alignment.CenterVertically),
            )
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = clearLabel,
                onClick = actions.onClearVin,
                size = IconSize.Xs,
                modifier = Modifier.align(Alignment.CenterVertically),
            )
        }
        Button(
            label = refreshLabel,
            onClick = actions.onRefreshVins,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            loading = refreshing,
            leadingIcon = FeedbackGlyphs.Refresh,
            modifier = Modifier.align(Alignment.CenterVertically),
        )
        FleetFreshnessChip(state = state, modifier = Modifier.align(Alignment.CenterVertically))
    }
}

@Composable
private fun ErrorVinsBody(
    state: UiState<List<FleetTelemetryErrorVIN>>,
    selectedVin: String,
    labels: FleetTelemetryHealthLabels,
    nowMillis: Long,
    actions: FleetTelemetryHealthActions,
) {
    val rows =
        remember(state.data, labels) {
            FleetTelemetryHealthProjection.projectVins(state.data ?: emptyList(), labels, nowMillis)
        }
    when {
        state.isError ->
            QueryError(kind = state.toQueryErrorKind(), onRetry = actions.onRetryVins, modifier = Modifier.fillMaxWidth())

        state.isLoading ->
            Skeleton(height = VINS_SKELETON_HEIGHT)

        rows.isEmpty() ->
            NoDataText(stringResource(R.string.translation_devtools_health_noErrorVins))

        else ->
            VinsTable(rows = rows, selectedVin = selectedVin, onSelectVin = actions.onSelectVin)
    }
}

@Composable
private fun VinsTable(
    rows: List<FleetVinRow>,
    selectedVin: String,
    onSelectVin: (String) -> Unit,
) {
    val columns =
        fleetVinColumns(
            vinHeader = stringResource(R.string.translation_devtools_health_vin),
            firstSeenHeader = stringResource(R.string.translation_devtools_health_firstSeen),
            lastSeenHeader = stringResource(R.string.translation_devtools_health_lastSeen),
            selectedVin = selectedVin,
            onSelectVin = onSelectVin,
        )
    DataTable(columns = columns, rows = rows, keyOf = { it.vin })
}

/** Builds the three-column VIN summary table (web `vinColumns`); headers arrive already-localized. */
private fun fleetVinColumns(
    vinHeader: String,
    firstSeenHeader: String,
    lastSeenHeader: String,
    selectedVin: String,
    onSelectVin: (String) -> Unit,
): List<TableColumn<FleetVinRow>> =
    listOf(
        TableColumn(key = "vin", header = vinHeader) { row ->
            VinCell(vin = row.vin, selected = row.vin == selectedVin, onClick = { onSelectVin(row.vin) })
        },
        TableColumn(key = "first_seen_at", header = firstSeenHeader) { row ->
            Caption(row.firstSeenText)
        },
        TableColumn(key = "last_seen_at", header = lastSeenHeader) { row ->
            RecencyText(text = row.lastSeenText, color = if (row.lastSeenRecent) recentColor() else agedColor())
        },
    )

// ── Error Log card ──────────────────────────────────────────────────────────────────────────────────

@Composable
private fun ErrorLogCard(
    state: UiState<List<FleetTelemetryError>>,
    refreshing: Boolean,
    labels: FleetTelemetryHealthLabels,
    nowMillis: Long,
    actions: FleetTelemetryHealthActions,
) {
    ToolCardContent(
        icon = AlertCircleIcon,
        color = "amber",
        title = stringResource(R.string.translation_devtools_health_errorLogTitle),
        description = stringResource(R.string.translation_devtools_health_errorLogDesc),
    ) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ErrorLogControls(state = state, refreshing = refreshing, onRefresh = actions.onRefreshErrors)
            ErrorLogBody(state = state, labels = labels, nowMillis = nowMillis, onRetry = actions.onRetryErrors)
        }
    }
}

@Composable
private fun ErrorLogControls(
    state: UiState<List<FleetTelemetryError>>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
) {
    val refreshLabel = stringResource(R.string.translation_devtools_health_refreshErrors)
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Button(
            label = refreshLabel,
            onClick = onRefresh,
            variant = ButtonVariant.Secondary,
            size = ButtonSize.Sm,
            loading = refreshing,
            leadingIcon = FeedbackGlyphs.Refresh,
            modifier = Modifier.align(Alignment.CenterVertically),
        )
        FleetFreshnessChip(state = state, modifier = Modifier.align(Alignment.CenterVertically))
    }
}

@Composable
private fun ErrorLogBody(
    state: UiState<List<FleetTelemetryError>>,
    labels: FleetTelemetryHealthLabels,
    nowMillis: Long,
    onRetry: () -> Unit,
) {
    val rows =
        remember(state.data, labels) {
            FleetTelemetryHealthProjection.projectErrors(state.data ?: emptyList(), labels, nowMillis)
        }
    when {
        state.isError ->
            QueryError(kind = state.toQueryErrorKind(), onRetry = onRetry, modifier = Modifier.fillMaxWidth())

        state.isLoading ->
            Skeleton(height = ERRORS_SKELETON_HEIGHT)

        rows.isEmpty() ->
            NoDataText(stringResource(R.string.translation_devtools_health_noErrors))

        else ->
            ErrorLogTable(rows = rows)
    }
}

@Composable
private fun ErrorLogTable(rows: List<FleetErrorRow>) {
    val columns =
        fleetErrorColumns(
            vinHeader = stringResource(R.string.translation_devtools_health_vin),
            errorCodeHeader = stringResource(R.string.translation_devtools_health_errorCode),
            messageHeader = stringResource(R.string.translation_devtools_health_message),
            reportedAtHeader = stringResource(R.string.translation_devtools_health_reportedAt),
        )
    val total = rows.size
    val pageCount = maxOf(1, (total + FLEET_HEALTH_ERRORS_PAGE_SIZE - 1) / FLEET_HEALTH_ERRORS_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * FLEET_HEALTH_ERRORS_PAGE_SIZE
    val visible = rows.subList(from, minOf(from + FLEET_HEALTH_ERRORS_PAGE_SIZE, total))

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    DataTable(
        columns = columns,
        rows = visible,
        keyOf = { it.key },
        footer = {
            Pagination(
                page = current,
                pageSize = FLEET_HEALTH_ERRORS_PAGE_SIZE,
                total = total,
                onPageChange = { page = it },
                firstLabel = firstLabel,
                previousLabel = previousLabel,
                nextLabel = nextLabel,
                lastLabel = lastLabel,
                showingText = { start, end, count ->
                    context.getString(R.string.translation_pagination_showing, start, end, count)
                },
            )
        },
    )
}

/** Builds the four-column error-log table (web `errorColumns`); headers arrive already-localized. */
private fun fleetErrorColumns(
    vinHeader: String,
    errorCodeHeader: String,
    messageHeader: String,
    reportedAtHeader: String,
): List<TableColumn<FleetErrorRow>> =
    listOf(
        TableColumn(key = "vin", header = vinHeader) { row -> CodeText(row.vin) },
        TableColumn(key = "error_code", header = errorCodeHeader) { row ->
            val code = row.errorCode
            if (code != null) Badge(text = code, variant = BadgeVariant.Danger) else Caption(FLEET_HEALTH_EM_DASH)
        },
        TableColumn(key = "error_message", header = messageHeader, weight = MESSAGE_COLUMN_WEIGHT) { row ->
            Caption(row.errorMessage)
        },
        TableColumn(key = "reported_at", header = reportedAtHeader) { row ->
            RecencyText(text = row.reportedAtText, color = if (row.reportedAtRecent) recentColor() else neutralColor())
        },
    )

// ── Shared pieces ─────────────────────────────────────────────────────────────────────────────────────

/**
 * A single clickable VIN cell — the native analogue of the web ghost button that toggles the filter.
 * Mono cyan text with a Button role + the VIN as its click label so screen readers announce the action.
 */
@Composable
private fun VinCell(
    vin: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val color = if (selected) TeslaTokens.status.warning else TeslaTokens.status.info
    Text(
        text = vin,
        modifier = Modifier.clickable(role = Role.Button, onClickLabel = vin, onClick = onClick),
        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        color = color,
    )
}

/** A recency-colored relative-time cell (web `TimeStamp` with the `isRecent ? rose : …` className). */
@Composable
private fun RecencyText(
    text: String,
    color: Color,
) {
    Text(text = text, style = MaterialTheme.typography.labelMedium, color = color)
}

/** Web rose-300 recency color (token: status.danger) for a value seen within the last 24h. */
@Composable
private fun recentColor(): Color = TeslaTokens.status.danger

/** Web amber-300 color (token: status.warning) for a Last-Seen value older than 24h. */
@Composable
private fun agedColor(): Color = TeslaTokens.status.warning

/** Web secondary text color for a non-recent Reported-At value. */
@Composable
private fun neutralColor(): Color = MaterialTheme.colorScheme.onSurfaceVariant

/**
 * The per-card freshness chip — surfaces the feed's stale / offline / fetching / error health (P3
 * mandated states). Hidden until there is something to report so a first load shows only its Skeleton.
 */
@Composable
private fun FleetFreshnessChip(
    state: UiState<*>,
    modifier: Modifier = Modifier,
) {
    val show = state.fetchedAt != null || state.refreshing || state.hasError || state.stale
    if (!show) return
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_freshness_updating),
        errorLabel = stringResource(R.string.translation_freshness_error),
        modifier = modifier,
    )
}

/** Centered muted message, the native analogue of the web `<p className="py-4 text-center …muted">`. */
@Composable
private fun NoDataText(message: String) {
    Box(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        Caption(message)
    }
}

@Composable
private fun rememberFleetHealthLabels(): FleetTelemetryHealthLabels =
    FleetTelemetryHealthLabels(
        justNow = stringResource(R.string.translation_freshness_justNow),
        ago = stringResource(R.string.translation_widget_ago),
    )

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

// ── Locally-authored stroked icon (the web `lucide-react` AlertCircle) ────────────────────────────────
// Authored here because the app's shared icon set has no AlertCircle and the shared glyph objects are
// out of this surface's allowed files (the same approach as the sibling TelemetryErrorsWidget). A 24×24
// stroked vector recolored at render time by [io.teslasync.android.components.ui.Icon]'s tint.

private fun lucideIcon(
    name: String,
    block: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(name = name, defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 24f, viewportHeight = 24f)
        .apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = block,
            )
        }.build()

/** lucide `alert-circle` — the ring, the exclamation stroke and the dot. */
private val AlertCircleIcon: ImageVector =
    lucideIcon("AlertCircle") {
        moveTo(21f, 12f)
        arcToRelative(9f, 9f, 0f, true, true, -18f, 0f)
        arcToRelative(9f, 9f, 0f, true, true, 18f, 0f)
        close()
        moveTo(12f, 8f)
        lineTo(12f, 12f)
        moveTo(12f, 16f)
        lineToRelative(0.01f, 0f)
    }

// ── Previews — one per rendered state (loading / content+filter / empty / error / offline) ────────────

private fun previewVin(
    vin: String,
    hoursAgoLast: Long,
): FleetTelemetryErrorVIN =
    FleetTelemetryErrorVIN(
        id = vin.hashCode().toLong(),
        vin = vin,
        active = true,
        firstSeenAt = "2026-06-01T00:00:00Z",
        lastSeenAt = Instant.ofEpochMilli(PREVIEW_NOW - hoursAgoLast * 3_600_000L).toString(),
    )

private fun previewError(
    id: Long,
    vin: String,
    code: String?,
    hoursAgo: Long,
): FleetTelemetryError =
    FleetTelemetryError(
        id = id,
        vin = vin,
        errorCode = code,
        errorMessage = code?.let { "Telemetry configuration rejected ($it)" },
        reportedAt = Instant.ofEpochMilli(PREVIEW_NOW - hoursAgo * 3_600_000L).toString(),
        fetchedAt = "2026-06-11T12:00:00Z",
    )

private fun previewVins(): List<FleetTelemetryErrorVIN> =
    listOf(previewVin("5YJ3E1EA1KF000001", hoursAgoLast = 2), previewVin("5YJ3E1EA1KF000002", hoursAgoLast = 40))

private fun previewErrors(): List<FleetTelemetryError> =
    listOf(
        previewError(1, "5YJ3E1EA1KF000001", "STREAM_DISCONNECTED", hoursAgo = 1),
        previewError(2, "5YJ3E1EA1KF000002", null, hoursAgo = 30),
    )

@Preview(name = "FleetTelemetryHealth · content", showBackground = true)
@Composable
private fun FleetTelemetryHealthContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetTelemetryHealthContent(
            vinsState = UiState(phase = UiPhase.Content, data = previewVins(), fetchedAt = PREVIEW_NOW),
            errorsState =
                UiState(phase = UiPhase.Content, data = previewErrors(), fetchedAt = PREVIEW_NOW),
            selectedVin = "5YJ3E1EA1KF000001",
            vinsRefreshing = false,
            errorsRefreshing = false,
            actions = FleetTelemetryHealthActions(),
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "FleetTelemetryHealth · loading", showBackground = true)
@Composable
private fun FleetTelemetryHealthLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetTelemetryHealthContent(
            vinsState = UiState.loading(),
            errorsState = UiState.loading(),
            selectedVin = "",
            vinsRefreshing = false,
            errorsRefreshing = false,
            actions = FleetTelemetryHealthActions(),
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "FleetTelemetryHealth · empty", showBackground = true)
@Composable
private fun FleetTelemetryHealthEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetTelemetryHealthContent(
            vinsState = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = PREVIEW_NOW),
            errorsState = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = PREVIEW_NOW),
            selectedVin = "",
            vinsRefreshing = false,
            errorsRefreshing = false,
            actions = FleetTelemetryHealthActions(),
            nowMillis = PREVIEW_NOW,
        )
    }
}

@Preview(name = "FleetTelemetryHealth · error + offline", showBackground = true)
@Composable
private fun FleetTelemetryHealthErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FleetTelemetryHealthContent(
            vinsState =
                UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            errorsState =
                UiState(
                    phase = UiPhase.Content,
                    data = previewErrors(),
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            selectedVin = "",
            vinsRefreshing = false,
            errorsRefreshing = true,
            actions = FleetTelemetryHealthActions(),
            nowMillis = PREVIEW_NOW,
        )
    }
}

// The native Jetpack Compose + Material 3 TelemetryErrorsPanel feature view — a parity port of
// web/src/features/admin/components/devtools/TelemetryErrorsPanel.tsx. The web component is purely
// presentational: it renders one of five branches (idle / loading / error / data / empty) chosen from
// its props, with a raw-response disclosure beneath the unknown-shape empty state so an operator can
// tell "Tesla returned zero errors" (healthy) from "Tesla returned a shape we did not recognise". This
// port keeps that contract — every display string arrives as an already-localized label (the surface is
// anonymous), the data-table paginates at 50 like the web `DataTable`, and the one-shot `view.opened`
// diagnostic is emitted on first composition. No HTTP, no business logic — a thin render layer over the
// pure [TelemetryErrorsPanelProjection].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TelemetryErrorsPanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.telemetryerrorspanel

import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.ErrorText
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.serialization.json.JsonElement

private val RAW_JSON_MAX_HEIGHT = 256.dp
private const val SUBTLE_BG_ALPHA = 0.4f
private const val DANGER_BG_ALPHA = 0.08f

/** The web `DataTable` `pagination={{ defaultPageSize: 50 }}` page size. */
private const val ERRORS_PAGE_SIZE = 50

private const val SKELETON_LINES = 3
private const val MESSAGE_MAX_LINES = 2
private const val MESSAGE_COLUMN_WEIGHT = 2f

/**
 * Stateful entry point — the faithful 1:1 port of the web `TelemetryErrorsPanel({...})` props. Records
 * the one-shot `view.opened` diagnostic on first composition (P1/S11), projects the props onto a
 * [TelemetryErrorsPanelState] via the pure [TelemetryErrorsPanelProjection], and renders. [columns] are
 * supplied by the host (the web component receives them as a prop too); [onDownload] defaults to a
 * system share-sheet export of the JSON blob.
 */
@Composable
fun TelemetryErrorsPanel(
    title: String,
    loading: Boolean,
    error: String?,
    requested: Boolean,
    ok: Boolean,
    errors: List<TelemetryError>,
    columns: List<TableColumn<TelemetryError>>,
    vin: String,
    idleMessage: String,
    emptyMessage: String,
    rawData: JsonElement?,
    rawDisclosureLabel: String,
    downloadLabel: String,
    modifier: Modifier = Modifier,
    onDownload: (TelemetryErrorsDownload) -> Unit = rememberTelemetryErrorsDownloadHandler(),
) {
    val logger = LocalDataContainer.current.logger
    LaunchedEffect(Unit) { recordTelemetryErrorsPanelOpened(logger) }
    val state =
        remember(requested, loading, error, errors, ok, vin, rawData) {
            TelemetryErrorsPanelProjection.project(requested, loading, error, errors, ok, vin, rawData)
        }
    val labels = TelemetryErrorsPanelLabels(title, idleMessage, emptyMessage, rawDisclosureLabel, downloadLabel)
    TelemetryErrorsPanelContent(state = state, labels = labels, columns = columns, modifier = modifier, onDownload = onDownload)
}

/**
 * Stateless renderer for every branch — the unit/UI-test entry point. Each branch is always rendered
 * (never a hidden surface): idle and loading and empty share the subtle panel chrome, error uses a
 * danger-tinted panel, and the data branch shows the paginated table plus the export button.
 */
@Composable
fun TelemetryErrorsPanelContent(
    state: TelemetryErrorsPanelState,
    labels: TelemetryErrorsPanelLabels,
    columns: List<TableColumn<TelemetryError>>,
    modifier: Modifier = Modifier,
    onDownload: (TelemetryErrorsDownload) -> Unit = {},
) {
    when (state) {
        TelemetryErrorsPanelState.Idle -> IdleBranch(labels, modifier)
        TelemetryErrorsPanelState.Loading -> LoadingBranch(labels, modifier)
        is TelemetryErrorsPanelState.Failure -> FailureBranch(labels, state.message, modifier)
        is TelemetryErrorsPanelState.Data -> DataBranch(labels, state, columns, onDownload, modifier)
        is TelemetryErrorsPanelState.Empty -> EmptyBranch(labels, state, modifier)
    }
}

/**
 * Builds the three-column error table layout the web parent passes in — timestamp, code, and message.
 * Headers arrive already-localized so this helper carries no English literal; hosts, previews, and tests
 * use it to construct the [TableColumn] list the panel renders.
 */
fun telemetryErrorColumns(
    timestampHeader: String,
    codeHeader: String,
    messageHeader: String,
): List<TableColumn<TelemetryError>> =
    listOf(
        TableColumn(key = "timestamp", header = timestampHeader) { Caption(it.timestamp) },
        TableColumn(key = "code", header = codeHeader) { CodeText(it.code) },
        TableColumn(key = "message", header = messageHeader, weight = MESSAGE_COLUMN_WEIGHT) {
            BodyText(it.message, maxLines = MESSAGE_MAX_LINES)
        },
    )

/**
 * The default download handler — opens the system share sheet with the JSON export, the native analogue
 * of the web browser file download. Uses `ACTION_SEND` so no `FileProvider`/manifest wiring is needed.
 */
@Composable
fun rememberTelemetryErrorsDownloadHandler(): (TelemetryErrorsDownload) -> Unit {
    val context = LocalContext.current
    return remember(context) {
        { download ->
            val send =
                Intent(Intent.ACTION_SEND).apply {
                    type = "application/json"
                    putExtra(Intent.EXTRA_SUBJECT, download.fileName)
                    putExtra(Intent.EXTRA_TEXT, download.json)
                }
            val chooser = Intent.createChooser(send, download.fileName).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            context.startActivity(chooser)
        }
    }
}

@Composable
private fun IdleBranch(
    labels: TelemetryErrorsPanelLabels,
    modifier: Modifier,
) {
    SubtlePanel(modifier) {
        PanelLabel(labels.title)
        IdleMessageText(labels.idleMessage, modifier = Modifier.padding(top = Spacing.xs))
    }
}

@Composable
private fun LoadingBranch(
    labels: TelemetryErrorsPanelLabels,
    modifier: Modifier,
) {
    SubtlePanel(modifier) {
        PanelLabel(labels.title)
        SkeletonLines(modifier = Modifier.padding(top = Spacing.sm), lines = SKELETON_LINES)
    }
}

@Composable
private fun FailureBranch(
    labels: TelemetryErrorsPanelLabels,
    message: String,
    modifier: Modifier,
) {
    DangerPanel(modifier) {
        PanelLabel(labels.title)
        ErrorText(message, modifier = Modifier.padding(top = Spacing.xs))
    }
}

@Composable
private fun DataBranch(
    labels: TelemetryErrorsPanelLabels,
    state: TelemetryErrorsPanelState.Data,
    columns: List<TableColumn<TelemetryError>>,
    onDownload: (TelemetryErrorsDownload) -> Unit,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        PagedErrorTable(errors = state.errors, columns = columns)
        Button(
            label = labels.downloadLabel,
            onClick = { onDownload(state.download) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            leadingIcon = FeedbackGlyphs.Download,
        )
    }
}

@Composable
private fun PagedErrorTable(
    errors: List<TelemetryError>,
    columns: List<TableColumn<TelemetryError>>,
) {
    val total = errors.size
    val pageCount = maxOf(1, (total + ERRORS_PAGE_SIZE - 1) / ERRORS_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * ERRORS_PAGE_SIZE
    val visible = errors.subList(from, minOf(from + ERRORS_PAGE_SIZE, total))

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    DataTable(
        columns = columns,
        rows = visible,
        keyOf = { it.rowKey },
        footer = {
            Pagination(
                page = current,
                pageSize = ERRORS_PAGE_SIZE,
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

@Composable
private fun EmptyBranch(
    labels: TelemetryErrorsPanelLabels,
    state: TelemetryErrorsPanelState.Empty,
    modifier: Modifier,
) {
    SubtlePanel(modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelLabel(labels.title)
            Badge(text = state.badge.text, variant = emptyBadgeVariant(state.badge), dot = true)
        }
        HelperText(labels.emptyMessage, modifier = Modifier.padding(top = Spacing.xs))
        if (state.rawJson != null) {
            RawDisclosure(label = labels.rawDisclosureLabel, json = state.rawJson, modifier = Modifier.padding(top = Spacing.sm))
        }
    }
}

@Composable
private fun RawDisclosure(
    label: String,
    json: String,
    modifier: Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    Column(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(Radius.sm))
                    .clickable(role = Role.Button, onClickLabel = label) { expanded = !expanded }
                    .semantics(mergeDescendants = true) {}
                    .padding(vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = if (expanded) TeslaGlyphs.ChevronDown else TeslaGlyphs.ChevronRight,
                contentDescription = null,
                size = IconSize.Xs,
            )
            HelperText(label)
        }
        if (expanded) {
            Surface(
                modifier = Modifier.padding(top = Spacing.xs),
                shape = RoundedCornerShape(Radius.sm),
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                CodeText(
                    text = json,
                    modifier =
                        Modifier
                            .heightIn(max = RAW_JSON_MAX_HEIGHT)
                            .verticalScroll(rememberScrollState())
                            .padding(Spacing.sm),
                )
            }
        }
    }
}

@Composable
private fun SubtlePanel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = SUBTLE_BG_ALPHA),
    ) {
        Column(modifier = Modifier.padding(Spacing.md), content = content)
    }
}

@Composable
private fun DangerPanel(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = TeslaTokens.status.danger.copy(alpha = DANGER_BG_ALPHA),
    ) {
        Column(modifier = Modifier.padding(Spacing.md), content = content)
    }
}

@Composable
private fun PanelLabel(text: String) {
    Caption(text)
}

@Composable
private fun IdleMessageText(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

private fun emptyBadgeVariant(badge: TelemetryErrorsEmptyBadge): BadgeVariant =
    when (badge) {
        TelemetryErrorsEmptyBadge.Healthy -> BadgeVariant.Success
        TelemetryErrorsEmptyBadge.Unknown -> BadgeVariant.Warning
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_LABELS =
    TelemetryErrorsPanelLabels(
        title = "Fleet API errors",
        idleMessage = "Press View Errors to query Tesla.",
        emptyMessage = "No telemetry errors reported.",
        rawDisclosureLabel = "Show raw response",
        downloadLabel = "Download JSON",
    )

private val PREVIEW_ERRORS =
    listOf(
        TelemetryError(
            rowKey = "0",
            timestamp = "2026-06-11T12:00:00Z",
            code = "STREAM_DISCONNECTED",
            message = "Telemetry stream dropped",
        ),
        TelemetryError(rowKey = "1", timestamp = "2026-06-11T11:30:00Z", code = "GATEWAY_TIMEOUT", message = "Upstream timed out"),
    )

private val PREVIEW_COLUMNS = telemetryErrorColumns("Time", "Code", "Message")

@Preview(name = "Idle", showBackground = true)
@Composable
private fun TelemetryErrorsPanelIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsPanelContent(TelemetryErrorsPanelState.Idle, PREVIEW_LABELS, PREVIEW_COLUMNS)
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TelemetryErrorsPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsPanelContent(TelemetryErrorsPanelState.Loading, PREVIEW_LABELS, PREVIEW_COLUMNS)
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TelemetryErrorsPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsPanelContent(
            TelemetryErrorsPanelState.Failure("Request failed: 502 Bad Gateway"),
            PREVIEW_LABELS,
            PREVIEW_COLUMNS,
        )
    }
}

@Preview(name = "Data", showBackground = true)
@Composable
private fun TelemetryErrorsPanelDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsPanelContent(
            TelemetryErrorsPanelState.Data(PREVIEW_ERRORS, TelemetryErrorsPanelProjection.downloadOf("VIN123", PREVIEW_ERRORS)),
            PREVIEW_LABELS,
            PREVIEW_COLUMNS,
        )
    }
}

@Preview(name = "Empty healthy", showBackground = true)
@Composable
private fun TelemetryErrorsPanelEmptyHealthyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsPanelContent(
            TelemetryErrorsPanelState.Empty(TelemetryErrorsEmptyBadge.Healthy, rawJson = null),
            PREVIEW_LABELS,
            PREVIEW_COLUMNS,
        )
    }
}

@Preview(name = "Empty unknown shape", showBackground = true)
@Composable
private fun TelemetryErrorsPanelEmptyUnknownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TelemetryErrorsPanelContent(
            TelemetryErrorsPanelState.Empty(TelemetryErrorsEmptyBadge.Unknown, rawJson = "{\n  \"response\": {}\n}"),
            PREVIEW_LABELS,
            PREVIEW_COLUMNS,
        )
    }
}

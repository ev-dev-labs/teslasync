// File hosts the AlertFeed Compose surface (stateful + stateless + per-state previews); named after
// the surface rather than a single declaration.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.alertfeed

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.Severity
import io.teslasync.android.components.datadisplay.severityColor
import io.teslasync.android.components.datadisplay.severityGlyph
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.CardPadding
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.presentation.notifications.Alert
import java.util.Locale

/**
 * The native Android (Jetpack Compose / Material 3) Alert Feed dashboard surface — a parity port of
 * `web/src/features/dashboard/widgets/AlertFeedWidget.tsx`. It mirrors the web `WidgetShell`
 * (skeleton while loading, a retry surface on error, otherwise a title + bell + freshness header)
 * wrapping `WidgetEventFeed` (newest-first severity-iconed rows with drill-through, or a friendly
 * empty state). All data flows through the [AlertFeedWidgetViewModel] (P1/S8); the view performs no
 * HTTP. Every string resolves from `strings.xml` (P1/S10) and every row carries a TalkBack label.
 *
 * @param viewModel the state holder bound to the shared alert feed.
 * @param size the grid footprint; controls row budget + subtitle (web `isWide`/`isTall`).
 * @param onAlertClick raised with a row's [AlertDrillthrough] so the host navigates to the context page.
 */
@Composable
fun AlertFeedWidget(
    viewModel: AlertFeedWidgetViewModel,
    modifier: Modifier = Modifier,
    size: AlertFeedSize = AlertFeedRegistration.DEFAULT_SIZE,
    onAlertClick: (AlertDrillthrough) -> Unit = {},
) {
    val state by viewModel.alerts.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { viewModel.onViewOpened() }
    AlertFeedWidgetContent(
        state = state,
        size = size,
        modifier = modifier,
        onAlertClick = onAlertClick,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless Alert Feed panel — renders every state the web widget does (loading / content / empty /
 * error, plus stale + offline via the header freshness chip over cached rows). Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun AlertFeedWidgetContent(
    state: UiState<List<Alert>>,
    size: AlertFeedSize,
    modifier: Modifier = Modifier,
    onAlertClick: (AlertDrillthrough) -> Unit = {},
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    Card(modifier = modifier.fillMaxWidth(), padding = CardPadding.None) {
        AlertFeedHeader(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            onRefresh = onRefresh,
        )
        Box(modifier = Modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT)) {
            when {
                state.isLoading -> AlertFeedLoading()
                state.isError -> AlertFeedErrorState(state = state, onRetry = onRetry)
                else -> AlertFeedResolved(alerts = state.data.orEmpty(), size = size, onAlertClick = onAlertClick)
            }
        }
    }
}

@Composable
private fun AlertFeedHeader(
    updatedAtMillis: Long?,
    isFetching: Boolean,
    isStale: Boolean,
    isError: Boolean,
    onRefresh: () -> Unit,
) {
    val title = stringResource(R.string.translation_widget_alertFeed)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.xs, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = FeedbackGlyphs.Bell,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        Caption(
            text = title.uppercase(Locale.getDefault()),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = updatedAtMillis,
            isFetching = isFetching,
            isStale = isStale,
            isError = isError,
            compact = true,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !isFetching,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun AlertFeedLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROWS) { Skeleton(height = LOADING_ROW_HEIGHT) }
    }
}

@Composable
private fun AlertFeedErrorState(
    state: UiState<List<Alert>>,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(kind = queryErrorKindOf(state), onRetry = onRetry)
    }
}

@Composable
private fun AlertFeedResolved(
    alerts: List<Alert>,
    size: AlertFeedSize,
    onAlertClick: (AlertDrillthrough) -> Unit,
) {
    if (alerts.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize().padding(Spacing.md),
            contentAlignment = Alignment.Center,
        ) {
            EmptyState(
                message = stringResource(R.string.translation_widget_noAlerts),
                icon = FeedbackGlyphs.Bell,
            )
        }
        return
    }
    val rows = remember(alerts, size) { AlertFeedProjection.project(alerts, size) }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = Spacing.md, vertical = Spacing.xs),
    ) {
        items(rows, key = { it.id }) { row -> AlertFeedRowItem(row = row, onAlertClick = onAlertClick) }
    }
}

@Composable
private fun AlertFeedRowItem(
    row: AlertFeedRow,
    onAlertClick: (AlertDrillthrough) -> Unit,
) {
    val severityLabel = severityLabel(row.severity)
    val relative =
        alertRelativeTimeLabel(
            timestampMillis = row.timestampMillis,
            nowMillis = System.currentTimeMillis(),
            justNow = stringResource(R.string.translation_freshness_justNow),
            ago = stringResource(R.string.translation_widget_ago),
        )
    val description = alertRowContentDescription(severityLabel, row.title, relative)
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable { onAlertClick(row.drillthrough) }
                .padding(vertical = Spacing.sm)
                .semantics(mergeDescendants = true) { contentDescription = description },
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = severityGlyph(row.severity),
            contentDescription = null,
            size = IconSize.Sm,
            tint = severityColor(row.severity),
        )
        Column(modifier = Modifier.weight(1f)) {
            BodyText(text = row.title, maxLines = 1)
            AlertRowSubtitleText(subtitle = row.subtitle, severityLabel = severityLabel)
        }
        Spacer(Modifier.width(Spacing.xs))
        Caption(text = relative)
    }
}

@Composable
private fun AlertRowSubtitleText(
    subtitle: AlertRowSubtitle,
    severityLabel: String,
) {
    val text =
        when (subtitle) {
            AlertRowSubtitle.None -> null
            is AlertRowSubtitle.Message -> subtitle.text
            AlertRowSubtitle.SeverityLabel -> severityLabel
        }
    if (text != null) {
        Caption(text = text)
    }
}

@Composable
private fun severityLabel(severity: Severity): String =
    stringResource(
        when (severity) {
            Severity.Info -> R.string.translation_notifications_alertStudio_severity_info
            Severity.Warn -> R.string.translation_notifications_alertStudio_severity_warn
            Severity.Critical -> R.string.translation_notifications_alertStudio_severity_critical
            Severity.Success -> R.string.translation_Success
        },
    )

/**
 * Folds an [UiState] hard failure onto a [QueryErrorKind] for the [QueryError] surface: an
 * [ErrorKind.Network]/[ErrorKind.Timeout] is treated as offline, [ErrorKind.CircuitOpen] as
 * transient back-pressure, and an HTTP status selects the not-found / unauthorized / server bucket.
 */
private fun queryErrorKindOf(state: UiState<List<Alert>>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

private const val LOADING_ROWS = 4
private val LOADING_ROW_HEIGHT = 16.dp
private val BODY_MIN_HEIGHT = 120.dp

// ── Previews — one per rendered state (loading / content / empty / error) ──────────────────

private fun sampleAlert(
    id: Long,
    severity: String,
    title: String,
    message: String,
): Alert =
    Alert(
        id = id,
        vehicleId = 1,
        type = "battery",
        severity = severity,
        title = title,
        message = message,
        createdAt = "2024-01-01T00:00:00Z",
        ruleSignal = "BatteryLevel",
    )

@Preview(name = "AlertFeed · content", showBackground = true)
@Composable
private fun AlertFeedContentPreview() {
    TeslaSyncTheme {
        AlertFeedWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        listOf(
                            sampleAlert(1, "critical", "Battery critically low", "SoC dropped below 5%"),
                            sampleAlert(2, "warn", "Tire pressure low", "Front-left at 32 psi"),
                            sampleAlert(3, "info", "Charging started", "Home charger connected"),
                        ),
                    fetchedAt = System.currentTimeMillis(),
                ),
            size = AlertFeedRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "AlertFeed · empty", showBackground = true)
@Composable
private fun AlertFeedEmptyPreview() {
    TeslaSyncTheme {
        AlertFeedWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = System.currentTimeMillis()),
            size = AlertFeedRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "AlertFeed · loading", showBackground = true)
@Composable
private fun AlertFeedLoadingPreview() {
    TeslaSyncTheme {
        AlertFeedWidgetContent(state = UiState.loading(), size = AlertFeedRegistration.DEFAULT_SIZE)
    }
}

@Preview(name = "AlertFeed · error", showBackground = true)
@Composable
private fun AlertFeedErrorPreview() {
    TeslaSyncTheme {
        AlertFeedWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = AlertFeedRegistration.DEFAULT_SIZE,
        )
    }
}

// The native Jetpack Compose + Material 3 Uptime Monitor dashboard surface — a parity port of
// web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a QueryError retry surface on a hard cold-start error, otherwise a title + health icon +
// freshness header) wrapping one of: the always-present overall-status row, then either the compact
// `healthy/total` hero (cols==1 && rows==1) or the per-service rows (a status dot + label + status
// badge), and — at rows>=2 — a DB-size / table-count footer. A null snapshot renders the friendly
// "No system health data" empty surface (web `data ? body : <EmptyState>`). All data flows through the
// shared [UptimeMonitorWidgetViewModel]; the view never performs HTTP. Every catalog-backed string
// resolves through the i18n catalog (P1/S10) and the refresh control + compact hero carry TalkBack labels.
//
// Icon note: the web uses the lucide `Activity` glyph; Android's shared data-display set has no Activity
// equivalent, so the `Gauge` glyph (a monitoring dial) is the closest system-health analogue — tinted
// success-green to match the web `text-neon-green`. Same substitution precedent the sibling MQTTStatusWidget
// sets (Wifi for the absent lucide `Radio`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/UptimeMonitorWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.uptimemonitor

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.SystemHealth
import io.teslasync.android.components.datadisplay.SystemHealthDot
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val LOADING_ROWS = 4
private val SKELETON_HEIGHT = 16.dp

/**
 * Stateful entry point. Binds the shared Admin system-health feed via [source] into a
 * [UptimeMonitorWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface
 * for the given [size]. A dashboard host supplies [source] (an [io.teslasync.shared.core.presentation.admin.AdminStore]
 * / [io.teslasync.shared.core.data.repo.AdminRepository] adapter over the shared S7/S8 data layer) and a
 * unique [instanceKey] per placement.
 *
 * @param source the cache-then-network system-health seam (a shared-data-layer adapter).
 * @param size the grid footprint; selects the compact hero vs the standard layout (web `size`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun UptimeMonitorWidget(
    source: UptimeMonitorSource,
    modifier: Modifier = Modifier,
    size: UptimeMonitorSize = UptimeMonitorRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = UptimeMonitorRegistration.ID,
) {
    val viewModel: UptimeMonitorWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { UptimeMonitorWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    UptimeMonitorWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (first load → skeleton, hard error with no cache → QueryError + retry) and
 * otherwise the title + freshness header above the overall row + (compact hero / service list) + optional
 * tall footer, or the "No system health data" empty surface when no snapshot resolved (web
 * `data ? body : <EmptyState>`). Stale (non-error) data auto-refreshes, mirroring the web
 * `refetchInterval`; offline/stale keeps the cached body visible (never blanked).
 */
@Composable
fun UptimeMonitorWidgetContent(
    state: UiState<UptimeHealth?>,
    size: UptimeMonitorSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberUptimeMonitorStrings()
    Column(modifier = modifier.fillMaxSize()) {
        UptimeHeader(size = size, state = state, onRefresh = onRefresh, strings = strings)
        Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
            val health = state.data
            when {
                state.isLoading -> UptimeLoading(label = stringResource(R.string.translation_common_loading))
                state.isError -> UptimeError(state = state, onRetry = onRefresh)
                health == null -> UptimeEmpty(strings = strings)
                else -> {
                    val display = remember(health, strings, size) { UptimeMonitorProjection.project(health, strings, size) }
                    UptimeBody(display = display, strings = strings)
                }
            }
        }
    }
}

@Composable
private fun UptimeHeader(
    size: UptimeMonitorSize,
    state: UiState<UptimeHealth?>,
    onRefresh: () -> Unit,
    strings: UptimeMonitorStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        // Web uses the lucide `Activity` glyph tinted neon-green; Gauge is the closest monitoring analogue.
        Icon(
            imageVector = DataDisplayGlyphs.Gauge,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.success,
        )
        if (size.isCompact) {
            // Compact (1×1) hides the title exactly as the web shell does (`title={isCompact ? undefined …`).
            Spacer(modifier = Modifier.weight(1f))
        } else {
            PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.refreshingLabel,
            errorLabel = strings.offlineLabel,
            formatAge = strings.formatRelative,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun UptimeBody(
    display: UptimeMonitorDisplay,
    strings: UptimeMonitorStrings,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = Spacing.md, end = Spacing.md, bottom = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        UptimeOverallRow(display = display, strings = strings)
        if (display.isCompact) {
            UptimeCompactHero(display = display)
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                display.services.forEach { service -> UptimeServiceRowView(service = service) }
            }
        }
        if (display.isTall && !display.isCompact) {
            Spacer(modifier = Modifier.heightIn(min = Spacing.xs))
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            UptimeFooterRow(label = strings.dbSize, value = display.databaseSize)
            UptimeFooterRow(label = strings.tables, value = display.tableCount)
        }
    }
}

@Composable
private fun UptimeOverallRow(
    display: UptimeMonitorDisplay,
    strings: UptimeMonitorStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MetricLabel(strings.overall)
        Badge(text = display.overallBadgeLabel, variant = badgeVariant(display.overallTone))
    }
}

@Composable
private fun UptimeCompactHero(display: UptimeMonitorDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET)
                .clearAndSetSemantics { contentDescription = display.overallContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        MetricValue(display.countLabel)
    }
}

@Composable
private fun UptimeServiceRowView(service: UptimeServiceRow) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = MIN_TOUCH_TARGET)
                .clearAndSetSemantics { contentDescription = "${service.label}, ${service.badgeLabel}" },
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            SystemHealthDot(health = dotHealth(service.tone))
            Caption(service.label)
        }
        Badge(text = service.badgeLabel, variant = badgeVariant(service.tone))
    }
}

@Composable
private fun UptimeFooterRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Caption(label)
        Caption(value, modifier = Modifier.padding(start = Spacing.sm))
    }
}

@Composable
private fun UptimeLoading(label: String) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_ROWS) { Skeleton(height = SKELETON_HEIGHT, rounded = true) }
    }
}

@Composable
private fun UptimeError(
    state: UiState<UptimeHealth?>,
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
private fun UptimeEmpty(strings: UptimeMonitorStrings) {
    Box(
        modifier = Modifier.fillMaxSize().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(message = strings.noData, icon = DataDisplayGlyphs.Gauge)
    }
}

private fun badgeVariant(tone: UptimeTone): BadgeVariant =
    when (tone) {
        UptimeTone.Success -> BadgeVariant.Success
        UptimeTone.Warning -> BadgeVariant.Warning
        UptimeTone.Danger -> BadgeVariant.Danger
    }

private fun dotHealth(tone: UptimeTone): SystemHealth =
    when (tone) {
        UptimeTone.Success -> SystemHealth.Healthy
        UptimeTone.Warning -> SystemHealth.Degraded
        UptimeTone.Danger -> SystemHealth.Down
    }

/**
 * Folds an [UiState] hard failure onto a [QueryErrorKind] for the [QueryError] surface (identical to the
 * sibling MQTTStatus mapping): [ErrorKind.Network]/[ErrorKind.Timeout] is treated as offline,
 * [ErrorKind.CircuitOpen] as transient back-pressure, and an HTTP status selects the not-found /
 * unauthorized / server bucket.
 */
private fun queryErrorKindOf(state: UiState<UptimeHealth?>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

/**
 * Builds the localized [UptimeMonitorStrings] from the i18n catalog (P1/S10): the six `widget.uptime.*`
 * keys the web reads, the per-service `OK` word (`widget.ok`), the header refresh/refreshing/offline
 * microcopy, and the `translation_freshness_*`-backed relative-time formatter shared with the freshness
 * chip. Remembered against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberUptimeMonitorStrings(): UptimeMonitorStrings {
    val title = stringResource(R.string.translation_widget_uptime_title)
    val overall = stringResource(R.string.translation_widget_uptime_overall)
    val allOk = stringResource(R.string.translation_widget_uptime_allOk)
    val ok = stringResource(R.string.translation_widget_ok)
    val dbSize = stringResource(R.string.translation_widget_uptime_dbSize)
    val tables = stringResource(R.string.translation_widget_uptime_tables)
    val noData = stringResource(R.string.translation_widget_uptime_noData)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        overall,
        allOk,
        ok,
        dbSize,
        tables,
        noData,
        refresh,
        refreshing,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        UptimeMonitorStrings(
            title = title,
            overall = overall,
            allOk = allOk,
            ok = ok,
            dbSize = dbSize,
            tables = tables,
            noData = noData,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> UPTIME_EM_DASH
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}

private val MIN_TOUCH_TARGET = 44.dp

// ── Previews — one per rendered state (standard / compact / tall / loading / error / empty / offline) ───

private fun sampleHealth(
    overall: String = STATUS_HEALTHY,
    teslaApi: String = STATUS_HEALTHY,
): UptimeHealth =
    UptimeHealth(
        overallStatus = overall,
        componentStatuses =
            mapOf(
                "database" to STATUS_HEALTHY,
                "mqtt" to STATUS_HEALTHY,
                "tesla_api" to teslaApi,
                "fleet_telemetry" to STATUS_HEALTHY,
            ),
        databaseSize = "1.4 GB",
        tableCount = 87L,
    )

private fun contentState(health: UptimeHealth = sampleHealth()): UiState<UptimeHealth?> =
    UiState(phase = UiPhase.Content, data = health, fetchedAt = System.currentTimeMillis())

@Preview(name = "UptimeMonitor · standard", showBackground = true)
@Composable
private fun UptimeStandardPreview() {
    TeslaSyncTheme {
        UptimeMonitorWidgetContent(
            state = contentState(sampleHealth(overall = STATUS_DEGRADED, teslaApi = STATUS_DEGRADED)),
            size = UptimeMonitorRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "UptimeMonitor · tall", showBackground = true)
@Composable
private fun UptimeTallPreview() {
    TeslaSyncTheme {
        UptimeMonitorWidgetContent(
            state = contentState(),
            size = UptimeMonitorSize(cols = 2, rows = 4),
            onRefresh = {},
        )
    }
}

@Preview(name = "UptimeMonitor · compact", showBackground = true)
@Composable
private fun UptimeCompactPreview() {
    TeslaSyncTheme {
        UptimeMonitorWidgetContent(
            state = contentState(),
            size = UptimeMonitorSize(cols = 1, rows = 1),
            onRefresh = {},
        )
    }
}

@Preview(name = "UptimeMonitor · offline (stale cache)", showBackground = true)
@Composable
private fun UptimeOfflinePreview() {
    TeslaSyncTheme {
        UptimeMonitorWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = sampleHealth(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            size = UptimeMonitorRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "UptimeMonitor · loading", showBackground = true)
@Composable
private fun UptimeLoadingPreview() {
    TeslaSyncTheme {
        UptimeMonitorWidgetContent(
            state = UiState.loading(),
            size = UptimeMonitorRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "UptimeMonitor · empty", showBackground = true)
@Composable
private fun UptimeEmptyPreview() {
    TeslaSyncTheme {
        UptimeMonitorWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = null, fetchedAt = System.currentTimeMillis()),
            size = UptimeMonitorRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "UptimeMonitor · error", showBackground = true)
@Composable
private fun UptimeErrorPreview() {
    TeslaSyncTheme {
        UptimeMonitorWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = UptimeMonitorRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

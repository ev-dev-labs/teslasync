// The native Jetpack Compose + Material 3 AlertsListPage notifications surface — a parity port of
// web/src/features/notifications/pages/AlertsListPage.tsx, the fleet alert-entity dashboard. It reproduces the page's
// overview KPI card (the six metric tiles — Total / Critical / Warnings / Info / Unread / Read-rate — plus the
// no-alerts empty panel), the 7-day severity-stacked trend bar chart, the alerts-by-type donut, the pinned-rule
// "Watching" panel, the search + tab filter bar with active-filter chips, the paginated alert list with its
// acknowledge dialog + audit-timeline modal, the mark-read / acknowledge / reopen mutations (with the success toasts),
// every data state (loading / empty / error / success, plus the cache-then-network stale/offline tier the bound state
// holder carries), and every visible string (resolved from the res/values catalog, ADR-014).
//
// Composition: [AlertsListPage] is the stateful entry (constructs the view-model over the host-wired source, records
// the one-shot `view.opened` diagnostic, collects the four feeds + the interaction snapshot, and bridges the
// view-model's one-shot toast events onto a Material 3 snackbar); [AlertsListPageContent] is the stateless render
// layer. The loaded alerts + rules + pins + interaction are folded by the framework-free model
// (deriveAlertsListData) into the slices the panels read — exactly as the web page threads its `alerts` through the
// long useMemo chain. No field in this domain is unit-bearing, so there is no SI conversion here — only locale/zone
// formatting at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/notifications) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located stateless content + sub-components; `LongMethod`/`TooManyFunctions`/`LongParameterList` for the
// parity-complete panel set.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName", "TooManyFunctions", "LongMethod", "LongParameterList")

package io.teslasync.android.notifications.alertslist

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.os.ConfigurationCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.charts.BarChartWrapper
import io.teslasync.android.components.charts.ChartContainer
import io.teslasync.android.components.charts.ChartSeries
import io.teslasync.android.components.charts.ChartSeriesKind
import io.teslasync.android.components.charts.ChartStatus
import io.teslasync.android.components.charts.paletteColor
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.KpiOverviewCard
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.datadisplay.SeverityBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.InlineCallout
import io.teslasync.android.components.feedback.PageLoader
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.forms.SearchInput
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Modal
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TabNav
import io.teslasync.android.components.ui.TabNavItem
import io.teslasync.android.components.ui.Textarea
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.android.notifications.QuietHours
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.Alert
import io.teslasync.shared.core.presentation.notifications.AlertDetail
import io.teslasync.shared.core.presentation.notifications.AlertEvent
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import java.time.ZoneId
import java.util.Locale

/** Stagger between the body panels' entrance fades (web `FadeIn` cascade), in ms per panel ordinal. */
private const val FADE_STEP_MS = 50

/** The em dash shown for a missing read-rate / most-common value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** The middot separator the overview secondary line uses (web `·`). */
private const val DOT = " \u00b7 "

/** The percent suffix the read-rate card appends (web `%`). */
private const val PERCENT_UNIT = "%"

/** Palette accents per KPI card so the tiles stay visually distinct yet theme-aware (web per-card colors). */
private const val ACCENT_TOTAL = 0
private const val ACCENT_CRITICAL = 3
private const val ACCENT_WARNING = 2
private const val ACCENT_INFO = 0
private const val ACCENT_UNREAD = 4
private const val ACCENT_READRATE = 1

private val CHART_HEIGHT = 180.dp
private val PIE_SIZE = 160.dp
private val PIE_RING = 28.dp
private val LEGEND_DOT = 10.dp
private val SEVERITY_ICON_BOX = 36.dp
private val PIE_START_ANGLE = -90f
private const val PIE_FULL_SWEEP = 360f

// ── Action bundle ─────────────────────────────────────────────────────────────────────────────────────────────

/** The callbacks the stateless content invokes — the page's interaction + mutation surface (web handler props). */
data class AlertsListActions(
    val onSetFilter: (AlertFilter) -> Unit,
    val onSetSearch: (String) -> Unit,
    val onSetPage: (Int) -> Unit,
    val onResetFilters: () -> Unit,
    val onMarkRead: (Long) -> Unit,
    val onOpenAck: (Long) -> Unit,
    val onCloseAck: () -> Unit,
    val onSubmitAck: (Long, String) -> Unit,
    val onReopen: (Long) -> Unit,
    val onOpenDetail: (Long) -> Unit,
    val onCloseDetail: () -> Unit,
    val onRetry: () -> Unit,
)

// ── Stateful entry ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [AlertsListPageViewModel] over the supplied [source] (the host wires the page-local
 * Notifications + Pinned repositories via [alertsListPageSourceOf]). Records the one-shot `view.opened` diagnostic,
 * collects every feed + the interaction snapshot, and bridges the view-model's toast events onto a snackbar.
 */
@Composable
fun AlertsListPage(
    source: AlertsListPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: AlertsListPageViewModel =
        viewModel(
            key = AlertsListPageRegistration.SLUG,
            factory = viewModelFactory { initializer { AlertsListPageViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val alerts by viewModel.alertsState.collectAsStateWithLifecycle()
    val rules by viewModel.rulesState.collectAsStateWithLifecycle()
    val pins by viewModel.pinsState.collectAsStateWithLifecycle()
    val detail by viewModel.detailState.collectAsStateWithLifecycle()
    val interaction by viewModel.interaction.collectAsStateWithLifecycle()
    val detailId by viewModel.detailId.collectAsStateWithLifecycle()
    val ackDialogId by viewModel.ackDialogId.collectAsStateWithLifecycle()
    val acknowledging by viewModel.acknowledging.collectAsStateWithLifecycle()

    val snackbarHostState = remember { SnackbarHostState() }
    val markReadText = stringResource(R.string.translation_Alert_marked_as_read)
    val ackText = stringResource(R.string.translation_alerts_ack_success)
    val undoText = stringResource(R.string.translation_alerts_ack_undo)
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            if (event !is UiEvent.Message) return@collect
            when (event.messageKey) {
                AlertsListPageViewModel.MSG_MARK_READ_SUCCESS -> snackbarHostState.showSnackbar(markReadText)
                AlertsListPageViewModel.MSG_ACK_SUCCESS -> {
                    val id = event.args.firstOrNull()?.toLongOrNull()
                    val result = snackbarHostState.showSnackbar(message = ackText, actionLabel = undoText)
                    if (result == SnackbarResult.ActionPerformed && id != null) viewModel.reopen(id)
                }
            }
        }
    }

    AlertsListPageContent(
        alerts = alerts,
        rules = rules,
        pins = pins,
        detail = detail,
        interaction = interaction,
        detailId = detailId,
        ackDialogId = ackDialogId,
        acknowledging = acknowledging,
        quietHours = viewModel.quietHours,
        snackbarHostState = snackbarHostState,
        actions =
            AlertsListActions(
                onSetFilter = viewModel::setFilter,
                onSetSearch = viewModel::setSearch,
                onSetPage = viewModel::setPage,
                onResetFilters = viewModel::resetFilters,
                onMarkRead = viewModel::markRead,
                onOpenAck = viewModel::openAckDialog,
                onCloseAck = viewModel::closeAckDialog,
                onSubmitAck = viewModel::acknowledge,
                onReopen = viewModel::reopen,
                onOpenDetail = viewModel::openDetail,
                onCloseDetail = viewModel::closeDetail,
                onRetry = viewModel::retry,
            ),
        modifier = modifier,
    )
}

// ── Stateless content ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body: the chrome (title + subtitle + freshness chip + quiet-hours badge), then the alerts-feed
 * body — a centered loader on a first load, a retryable error panel on a hard failure, or the loaded body (the
 * overview / charts / pinned panels, the filter bar and the paginated list) otherwise — plus the acknowledge dialog,
 * the audit-timeline modal and the toast snackbar overlay.
 */
@Composable
fun AlertsListPageContent(
    alerts: UiState<List<Alert>>,
    rules: UiState<List<AlertRule>>,
    pins: UiState<List<PinnedItem>>,
    detail: UiState<AlertDetail>,
    interaction: AlertsInteraction,
    detailId: Long?,
    ackDialogId: Long?,
    acknowledging: Boolean,
    quietHours: QuietHours,
    snackbarHostState: SnackbarHostState,
    actions: AlertsListActions,
    modifier: Modifier = Modifier,
) {
    val locale = ConfigurationCompat.getLocales(LocalConfiguration.current).get(0) ?: Locale.ROOT
    val zone = remember { ZoneId.systemDefault() }
    val nowMillis = remember { System.currentTimeMillis() }
    val quietActive = remember(quietHours, nowMillis, zone) { quietHoursActive(quietHours, nowMillis, zone) }

    Box(modifier = modifier.fillMaxSize()) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            AlertsChrome(state = alerts, quietActive = quietActive)

            when {
                alerts.isLoading -> AlertsLoading()
                alerts.isError -> AlertsError(onRetry = actions.onRetry)
                else -> {
                    val data =
                        remember(alerts.data, rules.data, pins.data, interaction, nowMillis, locale) {
                            deriveAlertsListData(
                                alerts = alerts.data.orEmpty(),
                                rules = rules.data.orEmpty(),
                                pins = pins.data.orEmpty(),
                                interaction = interaction,
                                nowMillis = nowMillis,
                                zone = zone,
                                locale = locale,
                            )
                        }
                    AlertsBody(
                        data = data,
                        interaction = interaction,
                        quietActive = quietActive,
                        nowMillis = nowMillis,
                        locale = locale,
                        actions = actions,
                    )
                }
            }
        }

        SnackbarHost(
            hostState = snackbarHostState,
            modifier = Modifier.align(Alignment.BottomCenter).padding(Spacing.lg),
        )
    }

    if (ackDialogId != null) {
        AcknowledgeDialog(
            alertId = ackDialogId,
            submitting = acknowledging,
            onSubmit = actions.onSubmitAck,
            onDismiss = actions.onCloseAck,
        )
    }
    if (detailId != null) {
        DetailModal(detail = detail, onClose = actions.onCloseDetail)
    }
}

/** The page chrome — title + subtitle (web `PageContainer`), the freshness chip, and the quiet-hours badge. */
@Composable
private fun AlertsChrome(
    state: UiState<List<Alert>>,
    quietActive: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PageTitle(stringResource(R.string.translation_Alerts))
                BodyText(
                    stringResource(R.string.translation_alerts_subtitle),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            DataFreshness(
                updatedAtMillis = state.fetchedAt,
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
                errorLabel = stringResource(R.string.translation_freshness_error),
            )
        }
        if (quietActive) {
            Badge(stringResource(R.string.translation_Quiet_hours), variant = BadgeVariant.Info)
        }
    }
}

/** The first-load surface — a centered brand loader (web `PageContainer loading`). */
@Composable
private fun AlertsLoading() {
    PageLoader(
        modifier = Modifier.fillMaxWidth(),
        label = stringResource(R.string.translation_common_loading),
    )
}

/** The hard-failure surface — a localized error panel with retry (web `PageContainer error`). */
@Composable
private fun AlertsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_loadFailed),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** The loaded body — the overview / charts / pinned panels, the filter bar and the paginated list, each fading in. */
@Composable
private fun AlertsBody(
    data: AlertsListData,
    interaction: AlertsInteraction,
    quietActive: Boolean,
    nowMillis: Long,
    locale: Locale,
    actions: AlertsListActions,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
        FadeIn {
            if (data.stats.total > 0) {
                OverviewCard(data = data, quietActive = quietActive, locale = locale, actions = actions)
            } else {
                NoDataPanel()
            }
        }
        if (data.stats.total > 0) {
            FadeIn(delayMs = FADE_STEP_MS) { TrendChartPanel(data = data) }
            FadeIn(delayMs = FADE_STEP_MS * 2) { ByTypePanel(data = data, locale = locale) }
            if (data.pinned.isNotEmpty()) {
                FadeIn(delayMs = FADE_STEP_MS * 3) { PinnedPanel(pinned = data.pinned) }
            }
        }
        FadeIn(delayMs = FADE_STEP_MS * 4) { FilterBar(data = data, interaction = interaction, locale = locale, actions = actions) }
        AlertListSection(data = data, interaction = interaction, nowMillis = nowMillis, locale = locale, actions = actions)
    }
}

// ── Panels 1-6 — overview KPI card ──────────────────────────────────────────────────────────────────────────────

/** The overview KpiOverviewCard — the six metric tiles, the rules/most-common/last-7d secondary, and the critical callout. */
@Composable
private fun OverviewCard(
    data: AlertsListData,
    quietActive: Boolean,
    locale: Locale,
    actions: AlertsListActions,
) {
    val stats = data.stats
    val activeRulesLabel = stringResource(R.string.translation_Active_Rules)
    val mostCommonLabel = stringResource(R.string.translation_Most_Common)
    val last7Label = stringResource(R.string.translation_Last_7_Days)
    val quietActiveLabel = stringResource(R.string.translation_Quiet_hours_active)
    val secondary =
        buildString {
            append(activeRulesLabel).append(' ').append(data.enabledRules).append('/').append(data.totalRules).append(DOT)
            append(mostCommonLabel).append(": ").append(data.mostCommon ?: EM_DASH).append(DOT)
            append(last7Label).append(": ").append(formatCount(data.weekCount, locale))
            if (quietActive) append(DOT).append(quietActiveLabel)
        }

    KpiOverviewCard(
        header = { PanelTitle(stringResource(R.string.translation_alerts_overview)) },
        kpis = {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                MetricPairRow {
                    // Panel 1 — Total.
                    AlertMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_Total),
                        value = formatCount(stats.total, locale),
                        icon = AlertsListGlyphs.Notifications,
                        accentIndex = ACCENT_TOTAL,
                    )
                    // Panel 2 — Critical.
                    AlertMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_Critical),
                        value = formatCount(stats.critical, locale),
                        icon = AlertsListGlyphs.AlertCircle,
                        accentIndex = ACCENT_CRITICAL,
                    )
                }
                MetricPairRow {
                    // Panel 3 — Warnings.
                    AlertMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_Warnings),
                        value = formatCount(stats.warning, locale),
                        icon = AlertsListGlyphs.AlertCircle,
                        accentIndex = ACCENT_WARNING,
                    )
                    // Panel 4 — Info.
                    AlertMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_Info),
                        value = formatCount(stats.info, locale),
                        icon = AlertsListGlyphs.Notifications,
                        accentIndex = ACCENT_INFO,
                    )
                }
                MetricPairRow {
                    // Panel 5 — Unread.
                    AlertMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_Unread),
                        value = formatCount(stats.unread, locale),
                        icon = AlertsListGlyphs.Notifications,
                        accentIndex = ACCENT_UNREAD,
                    )
                    // Panel 6 — Read-rate.
                    AlertMetric(
                        modifier = Modifier.weight(1f),
                        label = stringResource(R.string.translation_alerts_readRate),
                        value = stats.readRatePct?.let { "$it$PERCENT_UNIT" } ?: EM_DASH,
                        icon = AlertsListGlyphs.Acknowledge,
                        accentIndex = ACCENT_READRATE,
                    )
                }
            }
        },
        secondary = secondary,
        footer =
            if (stats.critical > 0) {
                {
                    InlineCallout(
                        message = stringResource(R.string.translation_alerts_criticalCallout, stats.critical),
                        tone = Tone.Danger,
                        icon = AlertsListGlyphs.AlertCircle,
                        actionLabel = stringResource(R.string.translation_alerts_viewCritical),
                        onClick = {
                            actions.onSetFilter(AlertFilter.Critical)
                            actions.onSetPage(1)
                        },
                    )
                }
            } else {
                null
            },
    )
}

/** Panel 7 — the no-alerts empty panel (web `<GlassPanel><EmptyState noAlertsInRange/></GlassPanel>`). */
@Composable
private fun NoDataPanel() {
    GlassPanel(padding = PanelPadding.Lg) {
        EmptyState(
            message = stringResource(R.string.translation_alerts_noAlertsInRange),
            title = stringResource(R.string.translation_No_alerts),
            icon = AlertsListGlyphs.NotificationsMuted,
        )
    }
}

// ── Panel 8 — Alert trend (bar chart) ─────────────────────────────────────────────────────────────────────────

/** Panel 8 — the 7-day severity trend bar chart (web `Alert Trend (7 Days)` `<BarChart>`). */
@Composable
private fun TrendChartPanel(data: AlertsListData) {
    val criticalLabel = stringResource(R.string.translation_Critical)
    val warningLabel = stringResource(R.string.translation_Warning)
    val infoLabel = stringResource(R.string.translation_Info)
    val criticalColor = TeslaTokens.status.danger
    val warningColor = TeslaTokens.status.warning
    val infoColor = TeslaTokens.status.info
    val ready = data.byDay.any { it.total > 0 }
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_Alert_Trend_7_Days),
        accessibleDescription = stringResource(R.string.translation_Alert_Trend_7_Days),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_No_alerts),
        height = CHART_HEIGHT,
    ) {
        BarChartWrapper(
            series =
                listOf(
                    ChartSeries("critical", criticalLabel, data.byDay.map { it.critical * 1.0 }, ChartSeriesKind.Bar, criticalColor),
                    ChartSeries("warning", warningLabel, data.byDay.map { it.warning * 1.0 }, ChartSeriesKind.Bar, warningColor),
                    ChartSeries("info", infoLabel, data.byDay.map { it.info * 1.0 }, ChartSeriesKind.Bar, infoColor),
                ),
            xLabels = data.byDay.map { it.day },
            height = CHART_HEIGHT,
        )
    }
}

// ── Panel 9 — Alerts by type (pie chart) ──────────────────────────────────────────────────────────────────────

/** Panel 9 — the alerts-by-type donut + legend (web `Alerts by Type` `<PieChart>`). */
@Composable
private fun ByTypePanel(
    data: AlertsListData,
    locale: Locale,
) {
    val ready = data.byType.isNotEmpty()
    ChartContainer(
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_Alerts_by_Type),
        accessibleDescription = stringResource(R.string.translation_Alerts_by_Type),
        status = if (ready) ChartStatus.Ready else ChartStatus.Empty,
        emptyMessage = stringResource(R.string.translation_No_alerts),
        height = CHART_HEIGHT,
    ) {
        ByTypeChart(shares = data.byType, locale = locale)
    }
}

/** The page-local Compose-canvas donut + legend for the by-type shares (the A3 chart library carries no pie wrapper). */
@Composable
private fun ByTypeChart(
    shares: List<AlertTypeShare>,
    locale: Locale,
) {
    val colors = remember(shares) { shares.map { paletteColor(it.colorIndex) } }
    val total = remember(shares) { shares.sumOf { it.value }.coerceAtLeast(1) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Canvas(modifier = Modifier.size(PIE_SIZE)) {
                val strokePx = PIE_RING.toPx()
                val diameter = size.minDimension - strokePx
                val topLeft = Offset((size.width - diameter) / 2f, (size.height - diameter) / 2f)
                val arcSize = Size(diameter, diameter)
                var startAngle = PIE_START_ANGLE
                shares.forEachIndexed { index, share ->
                    val sweep = share.value.toFloat() / total.toFloat() * PIE_FULL_SWEEP
                    drawArc(
                        color = colors.getOrElse(index) { Color.Gray },
                        startAngle = startAngle,
                        sweepAngle = sweep,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = strokePx),
                    )
                    startAngle += sweep
                }
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            shares.forEachIndexed { index, share ->
                LegendRow(
                    color = colors.getOrElse(index) { Color.Gray },
                    label = share.name,
                    value = formatCount(share.value, locale),
                )
            }
        }
    }
}

/** One legend row — a color swatch + the type name and its count. */
@Composable
private fun LegendRow(
    color: Color,
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Box(modifier = Modifier.size(LEGEND_DOT).clip(CircleShape).background(color))
        Caption(label, modifier = Modifier.weight(1f))
        Caption(value)
    }
}

// ── Panel 10 — Pinned "Watching" ──────────────────────────────────────────────────────────────────────────────

/** Panel 10 — the pinned-rule "Watching" panel (web pinned-rules `<GlassPanel>`). */
@Composable
private fun PinnedPanel(pinned: List<PinnedRuleRow>) {
    val ruleWord = stringResource(R.string.translation_alerts_rule)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(AlertsListGlyphs.Notifications, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.warning)
            PanelTitle(stringResource(R.string.translation_pinned_section_watching))
            Caption("(${pinned.size})")
        }
        Spacer(modifier = Modifier.height(Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            pinned.forEach { rule ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    BodyText(
                        text = rule.name.ifBlank { "$ruleWord #${rule.id}" },
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                    )
                    if (rule.enabled) {
                        Badge(stringResource(R.string.translation_common_enabled), variant = BadgeVariant.Success)
                    } else {
                        Badge(stringResource(R.string.translation_common_disabled), variant = BadgeVariant.Neutral)
                    }
                }
            }
        }
    }
}

// ── Filter bar (search + tabs + active chips) ───────────────────────────────────────────────────────────────────

/** The filter bar — search input, the all/unread/critical tab switcher, and the active-filter chips. */
@Composable
private fun FilterBar(
    data: AlertsListData,
    interaction: AlertsInteraction,
    locale: Locale,
    actions: AlertsListActions,
) {
    val allLabel = stringResource(R.string.translation_All)
    val unreadLabel = stringResource(R.string.translation_Unread)
    val criticalLabel = stringResource(R.string.translation_Critical)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SearchInput(
            value = interaction.search,
            onValueChange = actions.onSetSearch,
            modifier = Modifier.fillMaxWidth(),
            hint = stringResource(R.string.translation_alerts_searchPlaceholder), // parity:allow web i18n key id contains 'searchPlaceholder', not a stub
        )
        TabNav(
            items =
                listOf(
                    TabNavItem("all", "$allLabel (${formatCount(data.stats.total, locale)})", AlertsListGlyphs.Filter),
                    TabNavItem("unread", "$unreadLabel (${formatCount(data.stats.unread, locale)})"),
                    TabNavItem("critical", "$criticalLabel (${formatCount(data.stats.critical, locale)})"),
                ),
            selectedKey = interaction.filter.tabKey(),
            onSelect = { key -> actions.onSetFilter(filterFromKey(key)) },
        )
        AlertActiveChips(interaction = interaction)
    }
}

/** The active-filter chips (web `ActiveFilterChips`) — surfaces the search + status filter labels. */
@Composable
private fun AlertActiveChips(interaction: AlertsInteraction) {
    val searchLabel = stringResource(R.string.translation_alerts_filterLabel_search)
    val statusLabel = stringResource(R.string.translation_alerts_filterLabel_status)
    val unreadLabel = stringResource(R.string.translation_Unread)
    val criticalLabel = stringResource(R.string.translation_Critical)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (interaction.search.isNotBlank()) {
            Badge("$searchLabel: ${interaction.search}", variant = BadgeVariant.Info)
        }
        if (interaction.filter != AlertFilter.All) {
            val value = if (interaction.filter == AlertFilter.Unread) unreadLabel else criticalLabel
            Badge("$statusLabel: $value", variant = BadgeVariant.Neutral)
        }
    }
}

// ── Alert list + pagination ─────────────────────────────────────────────────────────────────────────────────────

/** The alert list — the loaded rows + pagination, or the empty state (web list section). */
@Composable
private fun AlertListSection(
    data: AlertsListData,
    interaction: AlertsInteraction,
    nowMillis: Long,
    locale: Locale,
    actions: AlertsListActions,
) {
    if (data.filtered.isEmpty()) {
        AlertListEmpty(interaction = interaction)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        data.paged.forEach { alert ->
            AlertRow(alert = alert, nowMillis = nowMillis, actions = actions)
        }
    }
    AlertsPagination(page = data.currentPage, total = data.filtered.size, locale = locale, onPageChange = actions.onSetPage)
}

/** The list empty state (web `EmptyState`): "no match" copy when searching, else the friendly first-run message. */
@Composable
private fun AlertListEmpty(interaction: AlertsInteraction) {
    val message =
        if (interaction.search.isNotBlank()) {
            stringResource(R.string.translation_No_alerts_match_your_search)
        } else {
            stringResource(R.string.translation_Your_fleet_is_running_smoothly_Alerts_will_appear_here)
        }
    EmptyState(
        title = stringResource(R.string.translation_No_alerts),
        message = message,
        icon = AlertsListGlyphs.NotificationsMuted,
    )
}

@Composable
private fun AlertsPagination(
    page: Int,
    total: Int,
    locale: Locale,
    onPageChange: (Int) -> Unit,
) {
    val showingTemplate = stringResource(R.string.translation_pagination_showing)
    Pagination(
        page = page,
        pageSize = AlertsListPageRegistration.PAGE_SIZE,
        total = total,
        onPageChange = onPageChange,
        firstLabel = stringResource(R.string.translation_pagination_first),
        previousLabel = stringResource(R.string.translation_pagination_previous),
        nextLabel = stringResource(R.string.translation_pagination_next),
        lastLabel = stringResource(R.string.translation_pagination_last),
        showingText = { start, end, count ->
            String.format(locale, showingTemplate, start.toString(), end.toString(), count.toString())
        },
    )
}

/** A single alert row (web `AlertCard`) — severity icon, title/message, relative time + badges, and the row actions. */
@Composable
private fun AlertRow(
    alert: Alert,
    nowMillis: Long,
    actions: AlertsListActions,
) {
    val severity = severityOf(alert)
    val accent = severityColor(severity)
    val acked = !alert.acknowledgedAt.isNullOrBlank()
    val unreadLabel = stringResource(R.string.translation_Unread)
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Box(
                modifier =
                    Modifier
                        .size(SEVERITY_ICON_BOX)
                        .clip(RoundedCornerShape(Spacing.sm))
                        .background(accent.copy(alpha = 0.15f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(AlertsListGlyphs.Notifications, contentDescription = null, size = IconSize.Sm, tint = accent)
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    BodyText(alert.title, modifier = Modifier.weight(1f), maxLines = 2)
                    if (!alert.isRead) {
                        Box(
                            modifier =
                                Modifier
                                    .size(LEGEND_DOT)
                                    .clip(CircleShape)
                                    .background(accent)
                                    .semantics { contentDescription = unreadLabel },
                        )
                    }
                }
                if (alert.message.isNotBlank()) {
                    HelperText(alert.message)
                }
                AlertRowMeta(alert = alert, severity = severity, nowMillis = nowMillis, acked = acked)
                AlertRowActions(alert = alert, acked = acked, actions = actions)
            }
        }
    }
}

/** The metadata strip under an alert — relative time, the severity chip, the type label, and the acked badge. */
@Composable
private fun AlertRowMeta(
    alert: Alert,
    severity: String,
    nowMillis: Long,
    acked: Boolean,
) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        val rel = relativeTimeOrNull(alert.createdAt, nowMillis)
        if (rel != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Icon(AlertsListGlyphs.Clock, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Caption(relativeTimeLabel(rel))
            }
        }
        SeverityBadge(severity = alert.severity.ifBlank { severity }, showIcon = false, label = severity)
        Caption(typeLabel(alert.type))
        if (acked) {
            Badge(stringResource(R.string.translation_alerts_ack_ackedByAnonymous), variant = BadgeVariant.Success)
        }
    }
}

/** The action row of an alert — view-context, audit timeline, acknowledge/reopen, and mark-read. */
@Composable
private fun AlertRowActions(
    alert: Alert,
    acked: Boolean,
    actions: AlertsListActions,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = stringResource(R.string.translation_alerts_timeline_title),
            onClick = { actions.onOpenDetail(alert.id) },
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        )
        if (acked) {
            Button(
                label = stringResource(R.string.translation_alerts_timeline_kindAnonymous_reopened),
                onClick = { actions.onReopen(alert.id) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        } else {
            Button(
                label = stringResource(R.string.translation_alerts_ack_button),
                onClick = { actions.onOpenAck(alert.id) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
        if (!alert.isRead) {
            Button(
                label = stringResource(R.string.translation_Mark_read),
                onClick = { actions.onMarkRead(alert.id) },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
    }
}

// ── Acknowledge dialog + detail modal ─────────────────────────────────────────────────────────────────────────

/** The acknowledge-with-note dialog (web `AcknowledgeAlertDialog`). */
@Composable
private fun AcknowledgeDialog(
    alertId: Long,
    submitting: Boolean,
    onSubmit: (Long, String) -> Unit,
    onDismiss: () -> Unit,
) {
    var note by rememberSaveable(alertId) { mutableStateOf("") }
    Modal(
        onDismissRequest = onDismiss,
        title = stringResource(R.string.translation_alerts_ack_dialogTitle),
        closeLabel = stringResource(R.string.translation_common_close),
    ) {
        Textarea(
            value = note,
            onValueChange = { note = it },
            label = stringResource(R.string.translation_alerts_ack_noteLabel),
            hint = stringResource(R.string.translation_alerts_ack_notePlaceholder), // parity:allow web i18n key id contains 'notePlaceholder', not a stub
            enabled = !submitting,
        )
        Spacer(modifier = Modifier.height(Spacing.md))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        ) {
            Button(
                label = stringResource(R.string.translation_alerts_ack_cancel),
                onClick = onDismiss,
                variant = ButtonVariant.Ghost,
                enabled = !submitting,
            )
            Button(
                label = stringResource(R.string.translation_alerts_ack_submit),
                onClick = { onSubmit(alertId, note) },
                variant = ButtonVariant.Primary,
                loading = submitting,
            )
        }
    }
}

/** The audit-timeline modal (web `Modal` + `AlertDetailTimeline`). */
@Composable
private fun DetailModal(
    detail: UiState<AlertDetail>,
    onClose: () -> Unit,
) {
    Modal(
        onDismissRequest = onClose,
        title = stringResource(R.string.translation_alerts_timeline_title),
        closeLabel = stringResource(R.string.translation_common_close),
    ) {
        val data = detail.data
        when {
            detail.isLoading || data == null -> Skeleton(modifier = Modifier.fillMaxWidth().height(120.dp))
            else -> {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    BodyText(data.title)
                    HelperText(data.message)
                }
                Spacer(modifier = Modifier.height(Spacing.md))
                if (data.events.isEmpty()) {
                    EmptyState(
                        message = stringResource(R.string.translation_alerts_timeline_empty),
                        title = stringResource(R.string.translation_alerts_timeline_empty),
                        icon = AlertsListGlyphs.Notifications,
                    )
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        data.events.forEach { TimelineRow(event = it) }
                    }
                }
            }
        }
    }
}

/** One audit-timeline entry — the event kind/actor + its optional note. */
@Composable
private fun TimelineRow(event: AlertEvent) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Icon(AlertsListGlyphs.Clock, contentDescription = null, size = IconSize.Sm, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            BodyText(event.actor?.let { "${event.kind} \u00b7 $it" } ?: event.kind)
            if (!event.note.isNullOrBlank()) {
                HelperText(event.note.orEmpty())
            }
        }
    }
}

// ── Shared small pieces ─────────────────────────────────────────────────────────────────────────────────────────

/** A two-up metric row (the phone-width grid cell the web `grid-cols-2/3` collapses to). */
@Composable
private fun MetricPairRow(content: @Composable RowScope.() -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        content = content,
    )
}

/** A [MetricCard] whose accent resolves from the theme-aware chart palette by [accentIndex] (web per-card color). */
@Composable
private fun AlertMetric(
    label: String,
    value: String,
    icon: ImageVector,
    accentIndex: Int,
    modifier: Modifier = Modifier,
) {
    MetricCard(
        modifier = modifier,
        label = label,
        value = value,
        icon = icon,
        accent = paletteColor(accentIndex),
    )
}

/** The per-theme status color for a normalized [severity]. */
@Composable
private fun severityColor(severity: String): Color =
    when (severity) {
        "critical" -> TeslaTokens.status.danger
        "warning" -> TeslaTokens.status.warning
        else -> TeslaTokens.status.info
    }

/** The "{value}{unit} ago" label for a [RelativeTime], resolved from the catalog (web `getTimeAgo`). */
@Composable
private fun relativeTimeLabel(rel: RelativeTime): String =
    when (rel.unit) {
        RelativeUnit.Minutes -> stringResource(R.string.translation_alerts_relativeMinutes, rel.value)
        RelativeUnit.Hours -> stringResource(R.string.translation_alerts_relativeHours, rel.value)
        RelativeUnit.Days -> stringResource(R.string.translation_alerts_relativeDays, rel.value)
    }

/** A grouped integer in the active [locale] (web `fmtInt`). */
private fun formatCount(
    value: Int,
    locale: Locale,
): String = String.format(locale, "%,d", value)

/** The stable tab key for a filter (web tab `key`). */
private fun AlertFilter.tabKey(): String =
    when (this) {
        AlertFilter.All -> "all"
        AlertFilter.Unread -> "unread"
        AlertFilter.Critical -> "critical"
    }

/** Resolves a tab key back to its [AlertFilter] (web `onChange`). */
private fun filterFromKey(key: String): AlertFilter =
    when (key) {
        "unread" -> AlertFilter.Unread
        "critical" -> AlertFilter.Critical
        else -> AlertFilter.All
    }

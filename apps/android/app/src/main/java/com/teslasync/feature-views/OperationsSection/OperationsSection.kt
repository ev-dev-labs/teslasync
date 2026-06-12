// The native Jetpack Compose + Material 3 OperationsSection feature view — a parity port of
// web/src/features/system/components/status/OperationsSection.tsx. The web component fans three React-Query
// feeds (notification-stats, the latest notification-logs, the recent audit log) into one `AccordionSection`
// titled "Operations": a Bell glyph, the title + "Notification delivery and audit trail" description, and a
// header `Badge` of the delivery success rate. Its body is a loading skeleton pair while any feed is in
// flight, otherwise a "Notification Delivery" block (four `MetricCard`s, a `RadialGauge`, and the
// notification-logs `DataTable`/`EmptyState`) shown only when stats exist, followed by an always-present
// "Audit Log" block (the audit `DataTable` or a friendly empty state).
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook beyond `useQuery` is `useTranslation`, mapped here to the i18n catalog, P1/S10). The host owns the
// three feeds (P1/S8) and supplies them as one combined [OperationsData] inside a [UiState], so this surface
// also renders every lifecycle the layer can carry — loading, hard error with retry, empty, content, and
// stale/offline ("last known") — without ever fetching. A web-parity overload taking the raw `(data,
// loading)` is also provided for hosts that already hold the loaded feeds. The shared native [AccordionSection],
// [MetricCard], [RadialGauge], [DataTable], [Badge], [EmptyState], and [Skeleton] are the faithful
// counterparts of the web shared components; the notification-status icon + color reuse the sibling `helpers`
// surface ([StatusIconContent] / [statusColor]), exactly as the web reuses `./helpers`.
//
// Web -> token mapping (no ported Tailwind, ADR-005): the metric accents map the web `MetricCard` `color`
// names onto design tokens — cyan -> `TeslaTokens.chart.regen`, red -> `TeslaTokens.status.danger`,
// green -> `TeslaTokens.status.success`, purple -> `TeslaTokens.chart.power`. The gauge + header badge bucket
// the success rate identically (>= 95 success/green, >= 80 warning/amber, else danger/red) via the pure
// [OperationsSectionProjection]. The three lucide glyphs the shared set lacks (Send, XCircle, Activity) are
// authored locally as 24x24 stroked vectors, recolored by the `Icon` tint — exactly as the sibling surfaces
// author their local glyphs.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/OperationsSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.operationssection

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.accordionsection.AccordionSection
import io.teslasync.android.featureviews.helpers.StatusIconContent
import io.teslasync.android.featureviews.helpers.StatusKind
import io.teslasync.android.featureviews.helpers.statusColor
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

/** The web `RadialGauge` `size={120}` diameter. */
private val GAUGE_SIZE: Dp = 120.dp

/** Loading skeleton heights — the web `<Skeleton className="h-32"/>` (128dp) and `h-48` (192dp). */
private val SKELETON_STATS_HEIGHT: Dp = 128.dp
private val SKELETON_TABLE_HEIGHT: Dp = 192.dp

/** The web `DataTable` `pagination={{ defaultPageSize: 50 }}` page size (both tables). */
private const val PAGE_SIZE: Int = 50

// Column weights — the relative horizontal share each column gets in the responsive Material tables.
private const val WEIGHT_NOTIF_STATUS = 1.0f
private const val WEIGHT_NOTIF_TITLE = 1.4f
private const val WEIGHT_NOTIF_MESSAGE = 1.8f
private const val WEIGHT_NOTIF_TIME = 1.2f
private const val WEIGHT_AUDIT_TIME = 1.2f
private const val WEIGHT_AUDIT_ACTION = 1.0f
private const val WEIGHT_AUDIT_RESOURCE = 1.2f
private const val WEIGHT_AUDIT_DETAILS = 1.8f

// ── By-name i18n keys whose English fallback is used until the catalog carries them (P1/S10) ────────────────
// The catalog already carries the single-word keys (Operations / Status / Title / Message / Time / Action /
// Resource / Details / Channels / Failed / Success) and the common chrome keys; these multi-word labels are
// resolved by-name so they localize the moment a catalog entry exists, falling back to the verbatim web text.
private const val KEY_DESCRIPTION = "translation_Notification_delivery_and_audit_trail"
private const val KEY_SUCCESS_RATE_SUFFIX = "translation_success_rate"
private const val KEY_DELIVERY = "translation_Notification_Delivery"
private const val KEY_TOTAL_SENT = "translation_Total_Sent"
private const val KEY_SUCCESS_RATE = "translation_Success_Rate"
private const val KEY_NO_RECENT = "translation_No_recent_notifications"
private const val KEY_AUDIT_LOG = "translation_Audit_Log"
private const val KEY_NO_AUDIT_ENTRIES = "translation_No_audit_entries"
private const val KEY_NO_AUDIT_LOG_ENTRIES = "translation_No_audit_log_entries"

private const val DEFAULT_DESCRIPTION = "Notification delivery and audit trail"
private const val DEFAULT_SUCCESS_RATE_SUFFIX = "success rate"
private const val DEFAULT_DELIVERY = "Notification Delivery"
private const val DEFAULT_TOTAL_SENT = "Total Sent"
private const val DEFAULT_SUCCESS_RATE = "Success Rate"
private const val DEFAULT_NO_RECENT = "No recent notifications"
private const val DEFAULT_AUDIT_LOG = "Audit Log"
private const val DEFAULT_NO_AUDIT_ENTRIES = "No audit entries"
private const val DEFAULT_NO_AUDIT_LOG_ENTRIES = "No audit log entries"

/**
 * The already-localized strings the section renders — resolved once at the Compose boundary (a mix of catalog
 * `R.string` reads for the keys the catalog carries and by-name reads with a verbatim web fallback for the
 * rest, P1/S10) and handed down so the rest of the surface holds no English literal.
 */
data class OperationsSectionStrings(
    val title: String,
    val description: String,
    val successRateSuffix: String,
    val delivery: String,
    val totalSent: String,
    val failed: String,
    val successRate: String,
    val channels: String,
    val gaugeLabel: String,
    val noRecentNotifications: String,
    val noData: String,
    val auditLog: String,
    val noAuditEntries: String,
    val noAuditLogEntries: String,
    val colStatus: String,
    val colTitle: String,
    val colMessage: String,
    val colTime: String,
    val colAction: String,
    val colResource: String,
    val colDetails: String,
)

/**
 * Stateful entry point for the Operations section. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the combined operations feed can carry. The host owns the feed
 * (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the combined [OperationsData].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param defaultOpen whether the accordion starts expanded (web `AccordionSection` default `false`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun OperationsSection(
    state: UiState<OperationsData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    defaultOpen: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordOperationsSectionOpened(logger) }
    OperationsSectionContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        defaultOpen = defaultOpen,
        logger = logger,
    )
}

/**
 * Web-parity overload mirroring the web component's `(data, isLoading)` inputs, for hosts that already hold
 * the loaded feeds. Projects them onto a [UiState] via [OperationsSectionProjection.projectUiState]
 * (content / loading / empty), then renders. Records `view.opened` like the stateful entry. There is no fetch
 * behind it, so it offers no retry affordance.
 */
@Composable
fun OperationsSection(
    data: OperationsData,
    loading: Boolean,
    modifier: Modifier = Modifier,
    defaultOpen: Boolean = false,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(data, loading) { OperationsSectionProjection.projectUiState(data, loading) }
    OperationsSection(
        state = state,
        onRetry = {},
        modifier = modifier,
        defaultOpen = defaultOpen,
        logger = logger,
    )
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Wraps the shared [AccordionSection] (Bell icon,
 * title, description, and the success-rate header badge when stats exist) over the section body, and wires the
 * lifecycle chrome the host's feed implies: stale (non-error) data auto-refreshes, mirroring the freshness
 * contract the sibling surfaces use. [locale]/[zoneId] format the counts and each row's `created_at`
 * absolutely (web `formatDateTime`). The [logger] is passed to [AccordionSection] explicitly so this renderer
 * never touches `LocalDataContainer`; it defaults to a no-op so previews/tests need not provide one.
 */
@Composable
fun OperationsSectionContent(
    state: UiState<OperationsData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    defaultOpen: Boolean = false,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: OperationsSectionStrings = rememberOperationsSectionStrings(),
    logger: Logger = SilentLogger,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val stats = state.data?.stats
    val rate = OperationsSectionProjection.successRate(stats)
    val level = OperationsSectionProjection.successLevel(rate)
    val badgeSlot: (@Composable RowScope.() -> Unit)? =
        if (stats != null) {
            { SuccessRateBadge(rate = rate, level = level, suffix = strings.successRateSuffix, locale = locale) }
        } else {
            null
        }
    AccordionSection(
        title = strings.title,
        description = strings.description,
        modifier = modifier,
        icon = { Icon(FeedbackGlyphs.Bell, contentDescription = null, size = IconSize.Lg) },
        badges = badgeSlot,
        defaultOpen = defaultOpen,
        logger = logger,
    ) {
        OperationsBody(state = state, onRetry = onRetry, locale = locale, zoneId = zoneId, strings = strings)
    }
}

/**
 * The accordion body — the web `{isLoading ? <skeletons> : <content>}`. A first load shows the two-skeleton
 * chrome; a hard error shows the retry surface; otherwise a freshness chip (when stale/refreshing/offline)
 * precedes the "Notification Delivery" block (only when stats exist, web `{notifStats && (...)}`) and the
 * always-present "Audit Log" block. Settled-but-empty falls here too, rendering the audit log's friendly empty
 * state rather than a blank box.
 */
@Composable
private fun OperationsBody(
    state: UiState<OperationsData>,
    onRetry: () -> Unit,
    locale: Locale,
    zoneId: ZoneId,
    strings: OperationsSectionStrings,
) {
    when {
        state.isLoading -> OperationsLoading(label = stringResource(R.string.translation_common_loading))
        state.isError -> OperationsError(onRetry = onRetry)
        else -> {
            if (state.stale || state.refreshing || state.hasError) {
                OperationsFreshnessRow(state)
            }
            val data = state.data
            val formatTime: (String) -> String =
                remember(zoneId, locale) { { iso -> OperationsTimeFormatting.format(iso, zoneId, locale) } }
            val stats = data?.stats
            if (stats != null) {
                NotificationDeliverySection(
                    stats = stats,
                    notifLogs = data.notificationLogs,
                    strings = strings,
                    locale = locale,
                    formatTime = formatTime,
                )
            }
            AuditLogSection(rows = data?.auditLogs ?: emptyList(), strings = strings, formatTime = formatTime)
        }
    }
}

/** The header success-rate chip — the web `<Badge variant={...}>{fmtPercent(rate,1)} {t('success rate')}</Badge>`. */
@Composable
private fun SuccessRateBadge(
    rate: Double,
    level: SuccessLevel,
    suffix: String,
    locale: Locale,
) {
    val percent = OperationsSectionProjection.formatPercent(rate, locale)
    Badge(text = "$percent $suffix", variant = OperationsSectionProjection.badgeVariant(level))
}

/**
 * The "Notification Delivery" block — the web `{notifStats && (...)}`: a [Subhead], the four-metric grid, the
 * centered success [RadialGauge], and the notification-logs table (or its friendly empty state).
 */
@Composable
private fun NotificationDeliverySection(
    stats: NotificationStats,
    notifLogs: List<NotificationLogRow>?,
    strings: OperationsSectionStrings,
    locale: Locale,
    formatTime: (String) -> String,
) {
    val rate = OperationsSectionProjection.successRate(stats)
    val level = OperationsSectionProjection.successLevel(rate)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Subhead(strings.delivery)
        DeliveryMetrics(stats = stats, rate = rate, strings = strings, locale = locale)
        SuccessGauge(rate = rate, level = level, label = strings.gaugeLabel)
        NotificationLogsTable(rows = notifLogs, strings = strings, formatTime = formatTime)
    }
}

/**
 * The 2x4 (phone: two-up) metric grid — the web `<Grid cols={{ default: 2, md: 4 }}>` of `MetricCard`s. The
 * accent colors map the web `MetricCard` `color` names onto design tokens (cyan/red/green/purple).
 */
@Composable
private fun DeliveryMetrics(
    stats: NotificationStats,
    rate: Double,
    strings: OperationsSectionStrings,
    locale: Locale,
) {
    val cyan = TeslaTokens.chart.regen
    val red = TeslaTokens.status.danger
    val green = TeslaTokens.status.success
    val purple = TeslaTokens.chart.power
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                label = strings.totalSent,
                value = OperationsSectionProjection.formatInt(stats.totalSent, locale),
                icon = OperationsGlyphs.Send,
                accent = cyan,
                modifier = Modifier.weight(1f),
            )
            MetricCard(
                label = strings.failed,
                value = OperationsSectionProjection.formatInt(stats.failed, locale),
                icon = OperationsGlyphs.XCircle,
                accent = red,
                modifier = Modifier.weight(1f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            MetricCard(
                label = strings.successRate,
                value = OperationsSectionProjection.formatPercent(rate, locale),
                icon = DataDisplayGlyphs.CheckCircle,
                accent = green,
                modifier = Modifier.weight(1f),
            )
            MetricCard(
                label = strings.channels,
                value = OperationsSectionProjection.channelsLabel(stats),
                icon = FeedbackGlyphs.Bell,
                accent = purple,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/** The centered success gauge — the web `<div className="flex justify-center"><RadialGauge .../></div>`. */
@Composable
private fun SuccessGauge(
    rate: Double,
    level: SuccessLevel,
    label: String,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        RadialGauge(
            value = rate,
            max = PERCENT_MAX,
            label = label,
            unit = "%",
            color = gaugeColor(level),
            size = GAUGE_SIZE,
            decimals = PERCENT_DECIMALS,
        )
    }
}

/**
 * The notification-logs table — the web `notifLogs ? <DataTable .../> : <EmptyState .../>`. A present feed
 * (even empty) renders the table with its "No recent notifications" empty text; an absent feed renders the
 * friendly "No data available" state with an Activity glyph, never a blank box.
 */
@Composable
private fun NotificationLogsTable(
    rows: List<NotificationLogRow>?,
    strings: OperationsSectionStrings,
    formatTime: (String) -> String,
) {
    if (rows != null) {
        val columns = remember(strings, formatTime) { notifLogColumns(strings, formatTime) }
        OperationsTable(
            columns = columns,
            rows = rows,
            keyOf = { it.id },
            emptyText = strings.noRecentNotifications,
        )
    } else {
        EmptyState(
            message = strings.noData,
            icon = OperationsGlyphs.Activity,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/**
 * The "Audit Log" block — the web `auditLogs && auditLogs.length > 0 ? <DataTable .../> : <EmptyState .../>`.
 * Always shows its [Subhead]; a non-empty feed renders the table, otherwise the friendly "No audit log
 * entries" empty state.
 */
@Composable
private fun AuditLogSection(
    rows: List<AuditLogRow>,
    strings: OperationsSectionStrings,
    formatTime: (String) -> String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        Subhead(strings.auditLog)
        if (rows.isNotEmpty()) {
            val columns = remember(strings, formatTime) { auditColumns(strings, formatTime) }
            OperationsTable(
                columns = columns,
                rows = rows,
                keyOf = { it.id },
                emptyText = strings.noAuditEntries,
            )
        } else {
            EmptyState(message = strings.noAuditLogEntries, modifier = Modifier.fillMaxWidth())
        }
    }
}

/**
 * A paginated table — the shared [DataTable] with a client-side page window (web
 * `pagination.defaultPageSize = 50`). The pagination footer appears only once the row count exceeds a page;
 * with the capped operations feeds it stays a single page, exactly as the web renders.
 */
@Composable
private fun <T> OperationsTable(
    columns: List<TableColumn<T>>,
    rows: List<T>,
    keyOf: (T) -> Any,
    emptyText: String,
) {
    val total = rows.size
    val pageCount = maxOf(1, (total + PAGE_SIZE - 1) / PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * PAGE_SIZE
    val visible = if (total == 0) emptyList() else rows.subList(from, minOf(from + PAGE_SIZE, total))

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    DataTable(
        columns = columns,
        rows = visible,
        keyOf = keyOf,
        modifier = Modifier.fillMaxWidth(),
        emptyText = emptyText,
        footer =
            if (total > PAGE_SIZE) {
                {
                    Pagination(
                        page = current,
                        pageSize = PAGE_SIZE,
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
                }
            } else {
                null
            },
    )
}

/** First-load skeleton pair — the web `<Skeleton className="h-32"/><Skeleton className="h-48"/>`. */
@Composable
private fun OperationsLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = SKELETON_STATS_HEIGHT)
        Skeleton(height = SKELETON_TABLE_HEIGHT)
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun OperationsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The freshness chip rendered above the body when cached data is refreshing / stale / offline — the honest
 * "last known + retry" affordance. Offline (a failed refresh over cached data) reads the localized "Offline"
 * label; a stale-but-reachable value reads its relative age.
 */
@Composable
private fun OperationsFreshnessRow(state: UiState<*>) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = Arrangement.End,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberOperationsFreshnessFormatter(),
        )
    }
}

/** The notification-logs columns — status (icon + colored verbatim value), title, message, and absolute time. */
private fun notifLogColumns(
    strings: OperationsSectionStrings,
    formatTime: (String) -> String,
): List<TableColumn<NotificationLogRow>> =
    listOf(
        TableColumn(key = "status", header = strings.colStatus, weight = WEIGHT_NOTIF_STATUS) { row ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                StatusIconContent(status = row.status, size = IconSize.Sm)
                BodyText(text = row.status, color = statusColor(StatusKind.fromStatus(row.status)), maxLines = 1)
            }
        },
        TableColumn(key = "title", header = strings.colTitle, weight = WEIGHT_NOTIF_TITLE) { row ->
            BodyText(text = row.title, maxLines = 1)
        },
        TableColumn(key = "message", header = strings.colMessage, weight = WEIGHT_NOTIF_MESSAGE) { row ->
            HelperText(row.message)
        },
        TableColumn(key = "created_at", header = strings.colTime, weight = WEIGHT_NOTIF_TIME) { row ->
            Caption(formatTime(row.createdAt))
        },
    )

/** The audit-log columns — absolute time, the info-badge action, the mono resource, and the muted details. */
private fun auditColumns(
    strings: OperationsSectionStrings,
    formatTime: (String) -> String,
): List<TableColumn<AuditLogRow>> =
    listOf(
        TableColumn(key = "created_at", header = strings.colTime, weight = WEIGHT_AUDIT_TIME) { row ->
            Caption(formatTime(row.createdAt))
        },
        TableColumn(key = "action", header = strings.colAction, weight = WEIGHT_AUDIT_ACTION) { row ->
            Badge(text = row.action, variant = BadgeVariant.Info)
        },
        TableColumn(key = "resource", header = strings.colResource, weight = WEIGHT_AUDIT_RESOURCE) { row ->
            CodeText(row.resource)
        },
        TableColumn(key = "details", header = strings.colDetails, weight = WEIGHT_AUDIT_DETAILS) { row ->
            HelperText(row.details)
        },
    )

/** The gauge arc color for a [level] — the web `successRate >= 95 ? green : >= 80 ? amber : red`. */
@Composable
private fun gaugeColor(level: SuccessLevel): Color =
    when (level) {
        SuccessLevel.Good -> TeslaTokens.status.success
        SuccessLevel.Fair -> TeslaTokens.status.warning
        SuccessLevel.Poor -> TeslaTokens.status.danger
    }

/**
 * Builds the localized [OperationsSectionStrings] — catalog `R.string` reads for the keys the catalog carries,
 * and by-name reads with the verbatim web fallback for the multi-word labels the catalog does not yet carry
 * (P1/S10). Remembered against the resolved values so a locale change rebuilds the bundle.
 */
@Composable
private fun rememberOperationsSectionStrings(): OperationsSectionStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_Operations)
    val failed = stringResource(R.string.translation_Failed)
    val channels = stringResource(R.string.translation_Channels)
    val gaugeLabel = stringResource(R.string.translation_Success)
    val noData = stringResource(R.string.translation_common_noData)
    val colStatus = stringResource(R.string.translation_Status)
    val colTitle = stringResource(R.string.translation_Title)
    val colMessage = stringResource(R.string.translation_Message)
    val colTime = stringResource(R.string.translation_Time)
    val colAction = stringResource(R.string.translation_Action)
    val colResource = stringResource(R.string.translation_Resource)
    val colDetails = stringResource(R.string.translation_Details)

    val description = context.optionalString(KEY_DESCRIPTION) ?: DEFAULT_DESCRIPTION
    val suffix = context.optionalString(KEY_SUCCESS_RATE_SUFFIX) ?: DEFAULT_SUCCESS_RATE_SUFFIX
    val delivery = context.optionalString(KEY_DELIVERY) ?: DEFAULT_DELIVERY
    val totalSent = context.optionalString(KEY_TOTAL_SENT) ?: DEFAULT_TOTAL_SENT
    val successRate = context.optionalString(KEY_SUCCESS_RATE) ?: DEFAULT_SUCCESS_RATE
    val noRecent = context.optionalString(KEY_NO_RECENT) ?: DEFAULT_NO_RECENT
    val auditLog = context.optionalString(KEY_AUDIT_LOG) ?: DEFAULT_AUDIT_LOG
    val noAuditEntries = context.optionalString(KEY_NO_AUDIT_ENTRIES) ?: DEFAULT_NO_AUDIT_ENTRIES
    val noAuditLogEntries = context.optionalString(KEY_NO_AUDIT_LOG_ENTRIES) ?: DEFAULT_NO_AUDIT_LOG_ENTRIES

    return remember(
        title,
        failed,
        channels,
        gaugeLabel,
        noData,
        colStatus,
        colTitle,
        colMessage,
        colTime,
        colAction,
        colResource,
        colDetails,
        description,
        suffix,
        delivery,
        totalSent,
        successRate,
        noRecent,
        auditLog,
        noAuditEntries,
        noAuditLogEntries,
    ) {
        OperationsSectionStrings(
            title = title,
            description = description,
            successRateSuffix = suffix,
            delivery = delivery,
            totalSent = totalSent,
            failed = failed,
            successRate = successRate,
            channels = channels,
            gaugeLabel = gaugeLabel,
            noRecentNotifications = noRecent,
            noData = noData,
            auditLog = auditLog,
            noAuditEntries = noAuditEntries,
            noAuditLogEntries = noAuditLogEntries,
            colStatus = colStatus,
            colTitle = colTitle,
            colMessage = colMessage,
            colTime = colTime,
            colAction = colAction,
            colResource = colResource,
            colDetails = colDetails,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberOperationsFreshnessFormatter(): (FreshnessAge) -> String {
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

/**
 * Optional by-name read from the Android string catalog — the seam that reproduces i18next's `t(key, default)`
 * for the labels the catalog does not yet carry. `getIdentifier` is the only way to attempt a key that may be
 * absent, so `DiscouragedApi` is suppressed; release builds keep resource names (shrinking is off) so the
 * lookup stays stable. A blank result is treated as absent so an empty catalog entry never wins.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id).takeIf { it.isNotBlank() } else null
}

/**
 * A no-op [Logger] used as the [OperationsSectionContent] default so previews and on-device UI tests render
 * without an injected diagnostics sink (and without touching `LocalDataContainer`). The production stateful
 * entry passes the real redacting logger instead.
 */
private object SilentLogger : Logger {
    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) = Unit
}

// ── Local lucide glyphs the shared sets do not carry (Send / XCircle / Activity) ────────────────────────────
// Authored here as 24x24 round-capped stroked vectors in the shared monochrome style, recolored at render
// time by the `Icon` tint, exactly as the sibling surfaces author their local glyphs.
private object OperationsGlyphs {
    private const val VIEWPORT = 24f
    private const val STROKE_WIDTH = 2f
    private const val RING_RADIUS = 9f
    private const val CENTER = 12f
    private const val CROSS_NEAR = 9f
    private const val CROSS_FAR = 15f

    /** lucide `Send` — a paper plane: the outline polygon plus the inner fold line. */
    val Send: ImageVector =
        stroked("Send") {
            moveTo(22f, 2f)
            lineTo(15f, 22f)
            lineTo(11f, 13f)
            lineTo(2f, 9f)
            close()
            moveTo(22f, 2f)
            lineTo(11f, 13f)
        }

    /** lucide `XCircle` — a ring enclosing a cross (the web "Failed" metric icon). */
    val XCircle: ImageVector =
        stroked("XCircle") {
            circle(CENTER, CENTER, RING_RADIUS)
            moveTo(CROSS_NEAR, CROSS_NEAR)
            lineTo(CROSS_FAR, CROSS_FAR)
            moveTo(CROSS_FAR, CROSS_NEAR)
            lineTo(CROSS_NEAR, CROSS_FAR)
        }

    /** lucide `Activity` — the heartbeat polyline (the web empty-notifications icon). */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = VIEWPORT,
                viewportHeight = VIEWPORT,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = STROKE_WIDTH,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()

    /** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
    private fun PathBuilder.circle(
        cx: Float,
        cy: Float,
        r: Float,
    ) {
        moveTo(cx - r, cy)
        arcTo(r, r, 0f, false, true, cx + r, cy)
        arcTo(r, r, 0f, false, true, cx - r, cy)
        close()
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────────

private val PREVIEW_STRINGS =
    OperationsSectionStrings(
        title = "Operations",
        description = DEFAULT_DESCRIPTION,
        successRateSuffix = DEFAULT_SUCCESS_RATE_SUFFIX,
        delivery = DEFAULT_DELIVERY,
        totalSent = DEFAULT_TOTAL_SENT,
        failed = "Failed",
        successRate = DEFAULT_SUCCESS_RATE,
        channels = "Channels",
        gaugeLabel = "Success",
        noRecentNotifications = DEFAULT_NO_RECENT,
        noData = "No data available",
        auditLog = DEFAULT_AUDIT_LOG,
        noAuditEntries = DEFAULT_NO_AUDIT_ENTRIES,
        noAuditLogEntries = DEFAULT_NO_AUDIT_LOG_ENTRIES,
        colStatus = "Status",
        colTitle = "Title",
        colMessage = "Message",
        colTime = "Time",
        colAction = "Action",
        colResource = "Resource",
        colDetails = "Details",
    )

private val PREVIEW_STATS =
    NotificationStats(
        totalSent = 1_284,
        sent = 1_250,
        failed = 34,
        pending = 0,
        totalChannels = 5,
        enabledChannels = 4,
    )

private val PREVIEW_NOTIF_LOGS =
    listOf(
        NotificationLogRow(
            id = 1,
            status = "sent",
            title = "Charge complete",
            message = "Model Y reached 80% at Harris Ranch",
            createdAt = "2026-06-11T12:00:00Z",
        ),
        NotificationLogRow(
            id = 2,
            status = "failed",
            title = "Sentry alert",
            message = "Discord webhook returned 500",
            createdAt = "2026-06-11T11:30:00Z",
        ),
    )

private val PREVIEW_AUDIT =
    listOf(
        AuditLogRow(
            id = 1,
            createdAt = "2026-06-11T12:05:00Z",
            action = "settings.update",
            resource = "settings/units",
            details = "distance: km -> mi",
        ),
        AuditLogRow(
            id = 2,
            createdAt = "2026-06-11T11:45:00Z",
            action = "api_key.create",
            resource = "api-keys/42",
            details = "name: grafana-reader",
        ),
    )

private val PREVIEW_DATA =
    OperationsData(stats = PREVIEW_STATS, notificationLogs = PREVIEW_NOTIF_LOGS, auditLogs = PREVIEW_AUDIT)

@Preview(name = "Content", showBackground = true)
@Composable
private fun OperationsSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OperationsSectionContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DATA),
            onRetry = {},
            defaultOpen = true,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun OperationsSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OperationsSectionContent(
            state = UiState.loading(),
            onRetry = {},
            defaultOpen = true,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun OperationsSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OperationsSectionContent(
            state =
                UiState(
                    phase = UiPhase.Empty,
                    data = OperationsData(stats = null, notificationLogs = null, auditLogs = emptyList()),
                ),
            onRetry = {},
            defaultOpen = true,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun OperationsSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OperationsSectionContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            defaultOpen = true,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true)
@Composable
private fun OperationsSectionOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        OperationsSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_DATA,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            defaultOpen = true,
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

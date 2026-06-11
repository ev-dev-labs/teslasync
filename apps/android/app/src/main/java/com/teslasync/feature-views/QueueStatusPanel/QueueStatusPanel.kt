// The native Jetpack Compose + Material 3 QueueStatusPanel feature view — a parity port of
// web/src/features/admin/components/QueueStatusPanel.tsx. The web component is an operator-facing view of
// the background-worker fleet: a header (title, description, "Updated {when}", Refresh) above one card per
// worker, each card showing the heartbeat-severity badge, the pending+in-progress queue depth, the 24-hour
// succeeded/failed counts, the oldest-pending age, and the reporting host+version. Clicking a card opens the
// per-worker job drawer.
//
// The native surface keeps that contract. It performs NO HTTP and binds no data hook of its own (its web
// hooks `useSystemQueues`/`useQueueStatus` are mapped to the shared P1/S8 state-holder layer): the host owns
// the `GET /system/queues` feed and passes it down as a [UiState], so this view renders every lifecycle
// state that layer can carry — loading, hard error, empty, content, and stale/offline ("last known") — plus
// the always-present header and Refresh affordance. The per-worker drawer is a separate surface with its own
// prompt, so card activation is delegated to the host via [onOpenWorker] (preserving the web card's
// click target + accessible "Show recent {worker} jobs" label) rather than rendered here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/QueueStatusPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.queuestatuspanel

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.computeAgeSeconds
import io.teslasync.android.components.datadisplay.relativeAge
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.systemqueues.QueueStat
import io.teslasync.shared.core.presentation.systemqueues.QueueStatusResponse
import java.util.Locale

private const val CARD_BG_ALPHA = 0.4f
private const val DANGER_BG_ALPHA = 0.08f
private const val OLDEST_TONE_ALPHA = 0.8f
private const val SUBTITLE_MAX_LINES = 4
private const val CARD_WEIGHT = 1f

/**
 * Stable test/semantics tag for a worker card — the native analogue of the web
 * `data-testid="queue-worker-card-${worker}"`. Exposed so the companion UI test can address a specific
 * card's click target deterministically.
 */
internal fun queueWorkerCardTestTag(worker: String): String = "queue-worker-card-$worker"

/** Long → Double widening for the [MetricBar] `value`/`max` inputs (kept as a named helper for clarity). */
private fun Long.asDouble(): Double = this + 0.0

/**
 * The already-localized fixed strings the panel renders. The web component resolves every label through
 * `useTranslation`, so these arrive through the P1/S10 i18n facade at the Compose boundary (via
 * [rememberQueueStatusStrings]) and are passed down, keeping the panel free of any English literal. The
 * argument-bearing strings (`Updated {when}`, `{host} · {version}`, `Show recent {worker} jobs`,
 * `Last beat {when}`, `Oldest pending: {duration}`, `{pending} pending · {inProgress} in progress`) are
 * resolved at their call sites with `Context.getString(..., args)`.
 */
data class QueueStatusStrings(
    val title: String,
    val subtitle: String,
    val refresh: String,
    val loading: String,
    val error: String,
    val empty: String,
    val queueDepth: String,
    val succeeded24h: String,
    val failed24h: String,
    val heartbeatNever: String,
    val hostUnknown: String,
    val versionUnknown: String,
    val severityOk: String,
    val severityWarn: String,
    val severityCritical: String,
    val severityDown: String,
)

/**
 * Stateful entry point for the worker-fleet panel. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared `GET /system/queues` feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRefresh] (the web `refetch`) and [onOpenWorker] (the web card → drawer
 * navigation); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [QueueStatusResponse].
 * @param onRefresh re-runs the host's load — wired to the header Refresh button and the stale auto-refresh.
 * @param onOpenWorker invoked with a worker id when its card is activated (opens the per-worker drawer).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun QueueStatusPanel(
    state: UiState<QueueStatusResponse>,
    onRefresh: () -> Unit,
    onOpenWorker: (String) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordQueueStatusPanelOpened(logger) }
    QueueStatusPanelContent(state = state, onRefresh = onRefresh, onOpenWorker = onOpenWorker, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `useQueueStatus` hook fields
 * (`{ data: { workers, generated_at }, isLoading, isFetching, error, refetch }`) — the native analogue of the
 * `testHookOverride` prop, for hosts that already hold the decoded feed. Projects the fields onto a [UiState]
 * via [QueueStatusPanelProjection.projectUiState], then renders. Records `view.opened` like the stateful entry.
 */
@Composable
fun QueueStatusPanel(
    workers: List<QueueStat>,
    generatedAt: String,
    isLoading: Boolean,
    isFetching: Boolean,
    error: Boolean,
    onRefresh: () -> Unit,
    onOpenWorker: (String) -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(workers, generatedAt, isLoading, isFetching, error) {
            QueueStatusPanelProjection.projectUiState(workers, generatedAt, isLoading, isFetching, error)
        }
    QueueStatusPanel(state = state, onRefresh = onRefresh, onOpenWorker = onOpenWorker, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. The header (title,
 * description, "Updated {when}", and the Refresh button) is always shown, then the body switches between the
 * web component's branches: a "Loading worker status…" spinner during a first load, a danger alert on a hard
 * error (the header Refresh is the retry), the italic "no workers registered" message when empty, and the
 * worker cards otherwise. Stale/offline (cached) content adds a freshness chip and auto-refreshes, mirroring
 * the ADR-013 freshness contract.
 */
@Composable
fun QueueStatusPanelContent(
    state: UiState<QueueStatusResponse>,
    onRefresh: () -> Unit,
    onOpenWorker: (String) -> Unit,
    modifier: Modifier = Modifier,
    strings: QueueStatusStrings = rememberQueueStatusStrings(),
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val now = remember(state) { System.currentTimeMillis() }
    val formatAge = rememberQueueFreshnessFormatter()

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        QueueStatusHeader(
            strings = strings,
            state = state,
            generatedAtMillis = state.data?.let { QueueStatusPanelProjection.parseIsoMillis(it.generatedAt) },
            now = now,
            formatAge = formatAge,
            onRefresh = onRefresh,
        )
        when {
            state.isLoading -> LoadingBranch(strings)
            state.isError -> ErrorBranch(strings)
            state.isEmpty -> EmptyBranch(strings)
            else ->
                ContentBranch(
                    workers = state.data?.workers ?: emptyList(),
                    state = state,
                    strings = strings,
                    locale = locale,
                    now = now,
                    formatAge = formatAge,
                    onOpenWorker = onOpenWorker,
                )
        }
    }
}

@Composable
private fun QueueStatusHeader(
    strings: QueueStatusStrings,
    state: UiState<QueueStatusResponse>,
    generatedAtMillis: Long?,
    now: Long,
    formatAge: (FreshnessAge) -> String,
    onRefresh: () -> Unit,
) {
    val context = LocalContext.current
    val busy = state.isLoading || state.refreshing
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Column(modifier = Modifier.weight(CARD_WEIGHT), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Heading(strings.title, level = HeadingLevel.Panel)
            BodyText(strings.subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = SUBTITLE_MAX_LINES)
            if (generatedAtMillis != null) {
                val updated = formatAge(relativeAge(computeAgeSeconds(generatedAtMillis, now)))
                Caption(context.getString(R.string.translation_queueStatus_lastUpdated, updated))
            }
        }
        Button(
            label = strings.refresh,
            onClick = onRefresh,
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
            enabled = !busy,
            loading = state.refreshing,
            leadingIcon = FeedbackGlyphs.Refresh,
        )
    }
}

@Composable
private fun LoadingBranch(strings: QueueStatusStrings) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.lg),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spinner(size = SpinnerSize.Sm, accessibleLabel = strings.loading)
        BodyText(strings.loading, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ErrorBranch(strings: QueueStatusStrings) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = TeslaTokens.status.danger.copy(alpha = DANGER_BG_ALPHA),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(TeslaGlyphs.Warning, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.danger)
            BodyText(strings.error, color = TeslaTokens.status.danger)
        }
    }
}

@Composable
private fun EmptyBranch(strings: QueueStatusStrings) {
    Text(
        text = strings.empty,
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.sm),
        style = MaterialTheme.typography.bodySmall.copy(fontStyle = FontStyle.Italic),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
private fun ContentBranch(
    workers: List<QueueStat>,
    state: UiState<QueueStatusResponse>,
    strings: QueueStatusStrings,
    locale: Locale,
    now: Long,
    formatAge: (FreshnessAge) -> String,
    onOpenWorker: (String) -> Unit,
) {
    if (state.stale || state.refreshing || state.hasError) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
            horizontalArrangement = Arrangement.End,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = formatAge,
            )
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        workers.forEach { stat ->
            WorkerCard(
                stat = stat,
                strings = strings,
                locale = locale,
                now = now,
                formatAge = formatAge,
                onOpenWorker = onOpenWorker,
            )
        }
    }
}

/**
 * One worker card — the native mirror of the web `WorkerCard`. The whole card is a single activatable
 * target (web `<button>`) carrying the accessible "Show recent {worker} jobs" label, so TalkBack announces
 * the whole row and a tap opens the per-worker drawer via [onOpenWorker]. Inside: the display name + host
 * line, the severity label, the queue-depth bar + detail, the 24-hour counts, the heartbeat footnote, and
 * the oldest-pending age when there is a backlog.
 */
@Composable
private fun WorkerCard(
    stat: QueueStat,
    strings: QueueStatusStrings,
    locale: Locale,
    now: Long,
    formatAge: (FreshnessAge) -> String,
    onOpenWorker: (String) -> Unit,
) {
    val context = LocalContext.current
    val severity = QueueStatusPanelProjection.severityOf(stat.heartbeatSeverity)
    val tone = severityToneColor(severity)
    val openLabel = context.getString(R.string.translation_queueStatus_openDrawer, stat.displayName)

    Surface(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .clickable(role = Role.Button, onClickLabel = openLabel) { onOpenWorker(stat.worker) }
                .testTag(queueWorkerCardTestTag(stat.worker)),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = CARD_BG_ALPHA),
    ) {
        Column(modifier = Modifier.padding(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            WorkerCardHeader(stat = stat, strings = strings, severity = severity, tone = tone)
            WorkerDepthSection(stat = stat, strings = strings, locale = locale, barColor = tone)
            WorkerCountsRow(stat = stat, strings = strings, locale = locale)
            WorkerHeartbeatLines(stat = stat, strings = strings, tone = tone, now = now, formatAge = formatAge)
        }
    }
}

@Composable
private fun WorkerCardHeader(
    stat: QueueStat,
    strings: QueueStatusStrings,
    severity: QueueSeverity,
    tone: Color,
) {
    val context = LocalContext.current
    val hostLine =
        if (QueueStatusPanelProjection.hasHost(stat.host)) {
            val version = stat.version.ifBlank { strings.versionUnknown }
            context.getString(R.string.translation_queueStatus_hostVersion, stat.host, version)
        } else {
            strings.hostUnknown
        }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(CARD_WEIGHT), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(
                text = stat.displayName,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
            )
            Caption(hostLine)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
            Text(text = severityLabel(severity, strings), style = MaterialTheme.typography.labelSmall, color = tone)
            Icon(
                TeslaGlyphs.ChevronRight,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun WorkerDepthSection(
    stat: QueueStat,
    strings: QueueStatusStrings,
    locale: Locale,
    barColor: Color,
) {
    val total = QueueStatusPanelProjection.total(stat)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        MetricBar(
            value = total.asDouble(),
            max = QueueStatusPanelProjection.metricMax(stat).asDouble(),
            label = strings.queueDepth,
            valueText = QueueStatusPanelProjection.formatCount(total, locale),
            color = barColor,
        )
        Caption(
            LocalContext.current.getString(
                R.string.translation_queueStatus_queueDepthDetail,
                QueueStatusPanelProjection.formatCount(stat.pending, locale),
                QueueStatusPanelProjection.formatCount(stat.inProgress, locale),
            ),
        )
    }
}

@Composable
private fun WorkerCountsRow(
    stat: QueueStat,
    strings: QueueStatusStrings,
    locale: Locale,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        WorkerCountCell(
            modifier = Modifier.weight(CARD_WEIGHT),
            label = strings.succeeded24h,
            value = QueueStatusPanelProjection.formatCount(stat.succeeded24h, locale),
            valueColor = TeslaTokens.status.success,
        )
        WorkerCountCell(
            modifier = Modifier.weight(CARD_WEIGHT),
            label = strings.failed24h,
            value = QueueStatusPanelProjection.formatCount(stat.failed24h, locale),
            valueColor =
                if (stat.failed24h > 0L) TeslaTokens.status.danger else MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun WorkerCountCell(
    label: String,
    value: String,
    valueColor: Color,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
            color = valueColor,
        )
    }
}

@Composable
private fun WorkerHeartbeatLines(
    stat: QueueStat,
    strings: QueueStatusStrings,
    tone: Color,
    now: Long,
    formatAge: (FreshnessAge) -> String,
) {
    val context = LocalContext.current
    val heartbeatLine =
        stat.heartbeatDetail.ifBlank {
            if (QueueStatusPanelProjection.hasHeartbeat(stat.lastHeartbeatAt)) {
                val ageSeconds = computeAgeSeconds(QueueStatusPanelProjection.parseIsoMillis(stat.lastHeartbeatAt), now)
                context.getString(R.string.translation_queueStatus_heartbeatRelative, formatAge(relativeAge(ageSeconds)))
            } else {
                strings.heartbeatNever
            }
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(text = heartbeatLine, style = MaterialTheme.typography.labelMedium, color = tone)
        if (QueueStatusPanelProjection.showOldestPending(stat.oldestPendingAgeSeconds)) {
            Text(
                text =
                    context.getString(
                        R.string.translation_queueStatus_oldestPending,
                        QueueStatusPanelProjection.formatOldestPending(stat.oldestPendingAgeSeconds),
                    ),
                style = MaterialTheme.typography.labelMedium,
                color = TeslaTokens.status.warning.copy(alpha = OLDEST_TONE_ALPHA),
            )
        }
    }
}

/** Severity → tone color — the native mirror of the web `SEVERITY_TONE_CLASS` / `SEVERITY_COLOR` maps. */
@Composable
private fun severityToneColor(severity: QueueSeverity): Color =
    when (severity) {
        QueueSeverity.Ok -> TeslaTokens.status.success
        QueueSeverity.Warn -> TeslaTokens.status.warning
        QueueSeverity.Critical -> TeslaTokens.status.danger
        QueueSeverity.Down -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun severityLabel(
    severity: QueueSeverity,
    strings: QueueStatusStrings,
): String =
    when (severity) {
        QueueSeverity.Ok -> strings.severityOk
        QueueSeverity.Warn -> strings.severityWarn
        QueueSeverity.Critical -> strings.severityCritical
        QueueSeverity.Down -> strings.severityDown
    }

/**
 * Builds the localized [QueueStatusStrings] from the i18n catalog (P1/S10): the `queueStatus.*` keys the web
 * component reads through `useTranslation`. Resolved once at the Compose boundary so the rest of the surface
 * stays free of any English literal.
 */
@Composable
private fun rememberQueueStatusStrings(): QueueStatusStrings {
    val title = stringResource(R.string.translation_queueStatus_title)
    val subtitle = stringResource(R.string.translation_queueStatus_subtitle)
    val refresh = stringResource(R.string.translation_queueStatus_refresh)
    val loading = stringResource(R.string.translation_queueStatus_loading)
    val error = stringResource(R.string.translation_queueStatus_error)
    val empty = stringResource(R.string.translation_queueStatus_empty)
    val queueDepth = stringResource(R.string.translation_queueStatus_queueDepth)
    val succeeded24h = stringResource(R.string.translation_queueStatus_metric_succeeded24h)
    val failed24h = stringResource(R.string.translation_queueStatus_metric_failed24h)
    val heartbeatNever = stringResource(R.string.translation_queueStatus_heartbeatNever)
    val hostUnknown = stringResource(R.string.translation_queueStatus_hostUnknown)
    val versionUnknown = stringResource(R.string.translation_queueStatus_versionUnknown)
    val severityOk = stringResource(R.string.translation_queueStatus_severity_ok)
    val severityWarn = stringResource(R.string.translation_queueStatus_severity_warn)
    val severityCritical = stringResource(R.string.translation_queueStatus_severity_critical)
    val severityDown = stringResource(R.string.translation_queueStatus_severity_down)
    return remember(
        title,
        subtitle,
        refresh,
        loading,
        error,
        empty,
        queueDepth,
        succeeded24h,
        failed24h,
        heartbeatNever,
        hostUnknown,
        versionUnknown,
        severityOk,
        severityWarn,
        severityCritical,
        severityDown,
    ) {
        QueueStatusStrings(
            title = title,
            subtitle = subtitle,
            refresh = refresh,
            loading = loading,
            error = error,
            empty = empty,
            queueDepth = queueDepth,
            succeeded24h = succeeded24h,
            failed24h = failed24h,
            heartbeatNever = heartbeatNever,
            hostUnknown = hostUnknown,
            versionUnknown = versionUnknown,
            severityOk = severityOk,
            severityWarn = severityWarn,
            severityCritical = severityCritical,
            severityDown = severityDown,
        )
    }
}

/**
 * Localized relative-age formatter for the heartbeat / "Updated" / freshness-chip labels
 * (`translation_freshness_*`) — the same render-only concern the sibling surfaces resolve, kept out of the
 * pure projection so the catalog stays the single source of microcopy (P1/S10).
 */
@Composable
private fun rememberQueueFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    QueueStatusStrings(
        title = "Background workers",
        subtitle =
            "Live view of the notification, export, and automation worker queues. Heartbeat colour switches " +
                "from green to amber after 60 seconds and to red after 5 minutes of silence.",
        refresh = "Refresh",
        loading = "Loading worker status\u2026",
        error = "Could not load worker status. Check API logs and try again.",
        empty = "No workers are currently registered. The notification, export, and automation processes report here once they start.",
        queueDepth = "Queue depth",
        succeeded24h = "Succeeded 24h",
        failed24h = "Failed 24h",
        heartbeatNever = "No heartbeat recorded",
        hostUnknown = "No host reported",
        versionUnknown = "unknown",
        severityOk = "Healthy",
        severityWarn = "Lagging",
        severityCritical = "Stale",
        severityDown = "Down",
    )

private val PREVIEW_WORKERS =
    listOf(
        QueueStat(
            worker = "notification",
            displayName = "Notification worker",
            pending = 3,
            inProgress = 1,
            succeeded24h = 1284,
            failed24h = 0,
            oldestPendingAgeSeconds = 0,
            heartbeatSeverity = "ok",
            heartbeatDetail = "",
            lastHeartbeatAt = "2026-06-11T12:00:00Z",
            host = "worker-01",
            version = "v1.8.0",
        ),
        QueueStat(
            worker = "export",
            displayName = "Export worker",
            pending = 12,
            inProgress = 2,
            succeeded24h = 96,
            failed24h = 4,
            oldestPendingAgeSeconds = 90,
            heartbeatSeverity = "warn",
            heartbeatDetail = "",
            lastHeartbeatAt = "2026-06-11T11:58:00Z",
            host = "worker-02",
            version = "",
        ),
        QueueStat(
            worker = "automation",
            displayName = "Automation worker",
            pending = 0,
            inProgress = 0,
            succeeded24h = 0,
            failed24h = 0,
            oldestPendingAgeSeconds = 0,
            heartbeatSeverity = "down",
            heartbeatDetail = "",
            lastHeartbeatAt = null,
            host = "",
            version = "",
        ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun QueueStatusPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueueStatusPanelContent(
            state = UiState(phase = UiPhase.Content, data = QueueStatusResponse("2026-06-11T12:00:00Z", PREVIEW_WORKERS)),
            onRefresh = {},
            onOpenWorker = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun QueueStatusPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueueStatusPanelContent(state = UiState.loading(), onRefresh = {}, onOpenWorker = {}, strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun QueueStatusPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueueStatusPanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Unknown),
            onRefresh = {},
            onOpenWorker = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun QueueStatusPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueueStatusPanelContent(
            state = UiState(phase = UiPhase.Empty, data = QueueStatusResponse("2026-06-11T12:00:00Z", emptyList())),
            onRefresh = {},
            onOpenWorker = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline (stale)", showBackground = true)
@Composable
private fun QueueStatusPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        QueueStatusPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = QueueStatusResponse("2026-06-11T11:30:00Z", PREVIEW_WORKERS),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            onRefresh = {},
            onOpenWorker = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

// The native Jetpack Compose + Material 3 AutomationActivityFeed feature view — a parity port of
// web/src/features/automations/pages/AutomationActivityFeed.tsx. The web component is purely presentational:
// inside a `<FadeIn delay={0.1}>` it wraps a `<GlassPanel>` around an always-visible header (an `Activity`
// glyph + the "Recent Activity" title + a `Wifi`/`Live` or `WifiOff`/`Reconnecting` connection chip, with the
// run-summary stats on the right when `historyStats.total_executions > 0`), then the most recent five live SSE
// events, then either five loading skeletons (`isLoading`), the execution-history rows, or a friendly
// `<EmptyState>` ("No execution history yet").
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The host supplies the execution-history feed
// through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of
// `AutomationHistoryListResponse`), so this feature view renders every lifecycle state that layer can carry —
// loading, hard error with retry, empty, content, and stale/offline ("last known") — without ever fetching.
// The live SSE events and the SSE [connectionState] are separate live inputs (the web `useAutomationEvents`
// stream) that render above the history area regardless of its load state, exactly as on the web. The native
// [GlassPanel] + [EmptyState] + [ErrorDisplay] + [Skeleton] + [Badge] + [DataFreshness] + [FadeIn] are faithful
// counterparts of the web shared components; a web-parity overload taking the raw props is also provided for
// hosts that already hold the loaded values.
//
// Marker colors map to design tokens (never raw hex in render code): success → `status.success`, partial →
// `status.warning`, failed/cancelled → `status.danger`/muted, test/triggered → `status.info` (web
// `neon-cyan`), undo/state-changed → `chart.power` (web `purple-400`), running → `chart.speed` (web
// `blue-400`), and skipped → the muted `onSurfaceVariant` (web `text-muted`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AutomationActivityFeed — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.automationactivityfeed

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** The web `<FadeIn delay={0.1}>` entrance delay, in milliseconds. */
private const val FADE_DELAY_MS: Int = 100

/** Loading skeleton rows — the web `Array.from({ length: 5 })`. */
private const val SKELETON_ROWS: Int = 5

/** Skeleton row height — the web `h-10` (40 dp). */
private val SKELETON_ROW_HEIGHT: Dp = 40.dp

/** Subtle wash behind a live-event row — the web `bg-neon-cyan/[0.03]`, nudged up for mobile legibility. */
private const val LIVE_ROW_WASH_ALPHA: Float = 0.06f

/** Min alpha of the live/reconnecting pulse — the web `animate-pulse` trough. */
private const val PULSE_MIN_ALPHA: Float = 0.45f

/** Pulse half-cycle, in milliseconds (Tailwind `animate-pulse` is ~2 s round-trip). */
private const val PULSE_DURATION_MS: Int = 1000

/** Max detail-line wrapping for an error/reason subtitle. */
private const val DETAIL_MAX_LINES: Int = 2

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10): the panel [recentActivity]
 * heading, the [live]/[reconnecting] connection chips, the [totalRuns]/[successRate]/[avgDuration] stat words,
 * and the [noHistory] empty message. The lifecycle-chrome strings (loading / error / retry / offline /
 * freshness) are resolved inline at the Compose boundary, so this holder stays a thin content carrier.
 */
data class AutomationActivityFeedStrings(
    val recentActivity: String,
    val live: String,
    val reconnecting: String,
    val totalRuns: String,
    val successRate: String,
    val avgDuration: String,
    val noHistory: String,
)

/**
 * Stateful entry point for the automation activity feed. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared history feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); [liveEvents] + [connectionState] are the separate
 * live SSE inputs. This view never performs HTTP.
 *
 * @param state the cache-then-network projection of the execution-history feed (web `AutomationHistory[]` + summary).
 * @param liveEvents the most recent live SSE events (web `liveEvents`); the first five are shown.
 * @param connectionState the SSE wire health (web `connectionState`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AutomationActivityFeed(
    state: UiState<AutomationActivityData>,
    liveEvents: List<AutomationLiveEvent>,
    connectionState: LiveConnectionStatus,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        recordAutomationActivityFeedOpened(logger)
    }
    AutomationActivityFeedContent(
        state = state,
        liveEvents = liveEvents,
        connectionState = connectionState,
        onRetry = onRetry,
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's props (`history`, `historyStats`, `isLoading`, `liveEvents`,
 * `connectionState`) for hosts that already hold the loaded values. Maps them onto a [UiState] — a first load
 * with [isLoading] shows the loading surface, an empty [history] shows the empty state (web
 * `items.length > 0`), and anything else shows the rows. Records `view.opened` like the stateful entry; there is
 * no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun AutomationActivityFeed(
    history: List<AutomationHistoryEntry>,
    historyStats: AutomationHistoryStatsModel?,
    isLoading: Boolean,
    liveEvents: List<AutomationLiveEvent>,
    connectionState: LiveConnectionStatus,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(history, historyStats, isLoading) {
            val phase =
                when {
                    isLoading -> UiPhase.Loading
                    history.isEmpty() -> UiPhase.Empty
                    else -> UiPhase.Content
                }
            UiState(phase = phase, data = AutomationActivityData(history, historyStats))
        }
    AutomationActivityFeed(
        state = state,
        liveEvents = liveEvents,
        connectionState = connectionState,
        onRetry = {},
        modifier = modifier,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * always-on header (glyph + title + connection chip + stats), its live-event list and its history
 * content/empty branches, and adds the lifecycle chrome the host's feed implies: a loading skeleton, a
 * hard-error retry surface, and a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data
 * auto-refreshes, mirroring the web freshness contract. [locale] formats the percent; [nowMillis] anchors the
 * relative "time ago".
 */
@Composable
fun AutomationActivityFeedContent(
    state: UiState<AutomationActivityData>,
    liveEvents: List<AutomationLiveEvent>,
    connectionState: LiveConnectionStatus,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    nowMillis: Long = System.currentTimeMillis(),
    strings: AutomationActivityFeedStrings = rememberAutomationActivityFeedStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val palette = rememberAutomationAccentPalette()
    val formatAge = rememberAutomationFreshnessFormatter()
    val pulse = rememberPulseAlpha()

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            AutomationActivityHeader(
                state = state,
                connectionState = connectionState,
                locale = locale,
                strings = strings,
                pulse = pulse,
            )
            Spacer(Modifier.height(Spacing.md))

            val liveRows = remember(liveEvents) { AutomationActivityFeedProjection.projectLive(liveEvents) }
            if (liveRows.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    liveRows.forEach { row -> LiveEventRow(row = row, palette = palette, pulse = pulse) }
                }
                Spacer(Modifier.height(Spacing.sm))
            }

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

            when (automationHistorySurfaceFor(state.isLoading, state.isError)) {
                AutomationHistorySurface.Loading ->
                    HistoryLoading(label = stringResource(R.string.translation_common_loading))
                AutomationHistorySurface.Error -> HistoryError(onRetry = onRetry)
                AutomationHistorySurface.Ready -> {
                    val rows =
                        remember(state.data, nowMillis, formatAge) {
                            AutomationActivityFeedProjection.projectHistory(
                                entries = state.data?.history ?: emptyList(),
                                formatTimeAgo = { iso ->
                                    formatAge(
                                        AutomationTimeFormatting.relativeAge(
                                            AutomationTimeFormatting.ageSeconds(iso, nowMillis),
                                        ),
                                    )
                                },
                                formatDuration = { millis -> formatDurationMs(millis) },
                            )
                        }
                    if (rows.isEmpty()) {
                        HistoryEmpty(message = strings.noHistory)
                    } else {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                            modifier = Modifier.semantics { contentDescription = strings.recentActivity },
                        ) {
                            rows.forEach { row -> HistoryRow(row = row, palette = palette) }
                        }
                    }
                }
            }
        }
    }
}

/** Always-visible header — the web glyph + title + connection chip, with the run-summary stats below. */
@Composable
private fun AutomationActivityHeader(
    state: UiState<AutomationActivityData>,
    connectionState: LiveConnectionStatus,
    locale: Locale,
    strings: AutomationActivityFeedStrings,
    pulse: Float,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                AutomationActivityFeedGlyphs.Activity,
                contentDescription = null,
                size = IconSize.Lg,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Heading(
                text = strings.recentActivity,
                modifier = Modifier.weight(1f, fill = false),
                level = HeadingLevel.Section,
                maxLines = 1,
            )
            ConnectionIndicator(connectionState = connectionState, strings = strings, pulse = pulse)
        }
        val stats =
            remember(state.data, locale) {
                AutomationActivityFeedProjection.projectStats(
                    stats = state.data?.stats,
                    formatDuration = { millis -> formatDurationMs(millis) },
                    formatPercent = { value -> formatPercentInt(value, locale) },
                )
            }
        if (stats != null) {
            StatsRow(stats = stats, strings = strings)
        }
    }
}

/** The run-summary stats — web "{total} total" · "{pct} success" (green) · "{avg} avg". */
@Composable
private fun StatsRow(
    stats: AutomationStatsRow,
    strings: AutomationActivityFeedStrings,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatChip(value = stats.total, label = strings.totalRuns, color = MaterialTheme.colorScheme.onSurfaceVariant)
        StatChip(value = stats.successRate, label = strings.successRate, color = TeslaTokens.status.success)
        StatChip(value = stats.avgDuration, label = strings.avgDuration, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun StatChip(
    value: String,
    label: String,
    color: Color,
) {
    Text(
        text = "$value $label",
        style = MaterialTheme.typography.labelSmall,
        color = color,
        maxLines = 1,
    )
}

/** The connection chip — web Wifi/"Live" (green) when connected, WifiOff/"Reconnecting" (amber, pulsing). */
@Composable
private fun ConnectionIndicator(
    connectionState: LiveConnectionStatus,
    strings: AutomationActivityFeedStrings,
    pulse: Float,
) {
    when (connectionState) {
        LiveConnectionStatus.Connected ->
            ConnectionChip(
                icon = DataDisplayGlyphs.Wifi,
                label = strings.live,
                color = TeslaTokens.status.success,
                alpha = 1f,
            )
        LiveConnectionStatus.Reconnecting ->
            ConnectionChip(
                icon = DataDisplayGlyphs.WifiOff,
                label = strings.reconnecting,
                color = TeslaTokens.status.warning,
                alpha = pulse,
            )
        else -> Unit
    }
}

@Composable
private fun ConnectionChip(
    icon: ImageVector,
    label: String,
    color: Color,
    alpha: Float,
) {
    Row(
        modifier = Modifier.graphicsLayer { this.alpha = alpha },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(icon, contentDescription = null, size = IconSize.Xs, tint = color)
        Text(label, style = MaterialTheme.typography.labelSmall, color = color, maxLines = 1)
    }
}

/** One live SSE event row — web `LiveEventRow` (pulsing accent glyph + name + error/reason + type badge). */
@Composable
private fun LiveEventRow(
    row: AutomationLiveRow,
    palette: AutomationAccentPalette,
    pulse: Float,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.sm))
                .background(TeslaTokens.status.info.copy(alpha = LIVE_ROW_WASH_ALPHA))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            AutomationActivityFeedGlyphs.resolve(row.glyph),
            contentDescription = null,
            size = IconSize.Sm,
            tint = palette.colorFor(row.accent),
            modifier = Modifier.graphicsLayer { this.alpha = pulse },
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            RowTitle(row.name)
            if (row.error != null) DetailText(row.error, MaterialTheme.colorScheme.error)
            if (row.reason != null) DetailText(row.reason, MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Badge(text = row.badgeLabel, variant = BadgeVariant.Neutral)
    }
}

/** One execution-history row — web `HistoryRow` (accent glyph + name/error + timeAgo + duration + actions). */
@Composable
private fun HistoryRow(
    row: AutomationHistoryRow,
    palette: AutomationAccentPalette,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            AutomationActivityFeedGlyphs.resolve(row.glyph),
            contentDescription = null,
            size = IconSize.Sm,
            tint = palette.colorFor(row.accent),
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            RowTitle(row.name)
            if (row.error != null) DetailText(row.error, MaterialTheme.colorScheme.error)
        }
        MetaText(row.timeAgo)
        MetaText(row.duration)
        row.actionsLabel?.let { MetaText(it) }
    }
}

/** Row primary line — the web `font-medium text-[var(--text-primary)]` name. */
@Composable
private fun RowTitle(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Row detail subtitle (error → danger, reason → muted) — the web `text-xs` spans. */
@Composable
private fun DetailText(
    text: String,
    color: Color,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = color,
        maxLines = DETAIL_MAX_LINES,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Trailing muted meta (time / duration / actions) — the web `text-xs text-[var(--text-muted)]` spans. */
@Composable
private fun MetaText(text: String) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        maxLines = 1,
    )
}

/** First-load skeleton — five shimmering rows so the panel is never blank (web `isLoading` branch). */
@Composable
private fun HistoryLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) {
            Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun HistoryError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty state — web parity: the "No execution history yet" message with the Activity glyph, never a blank box. */
@Composable
private fun HistoryEmpty(message: String) {
    EmptyState(
        message = message,
        icon = AutomationActivityFeedGlyphs.Activity,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Resolved per-theme accent palette — the native analogue of the web marker colors, mapped to design tokens
 * (never raw hex in render code).
 */
private class AutomationAccentPalette(
    private val colors: Map<AutomationAccent, Color>,
    private val fallback: Color,
) {
    fun colorFor(role: AutomationAccent): Color = colors[role] ?: fallback
}

@Composable
private fun rememberAutomationAccentPalette(): AutomationAccentPalette {
    val success = TeslaTokens.status.success
    val warning = TeslaTokens.status.warning
    val danger = TeslaTokens.status.danger
    val test = TeslaTokens.status.info
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val stateChange = TeslaTokens.chart.power
    val running = TeslaTokens.chart.speed
    return remember(success, warning, danger, test, muted, stateChange, running) {
        AutomationAccentPalette(
            colors =
                mapOf(
                    AutomationAccent.Success to success,
                    AutomationAccent.Warning to warning,
                    AutomationAccent.Danger to danger,
                    AutomationAccent.Muted to muted,
                    AutomationAccent.Test to test,
                    AutomationAccent.StateChange to stateChange,
                    AutomationAccent.Running to running,
                ),
            fallback = muted,
        )
    }
}

/**
 * Builds the localized [AutomationActivityFeedStrings] from the i18n catalog (P1/S10): the `automations.*` keys
 * the web component reads through `useTranslation`.
 */
@Composable
private fun rememberAutomationActivityFeedStrings(): AutomationActivityFeedStrings {
    val recentActivity = stringResource(R.string.translation_automations_recentActivity)
    val live = stringResource(R.string.translation_automations_live)
    val reconnecting = stringResource(R.string.translation_automations_reconnecting)
    val totalRuns = stringResource(R.string.translation_automations_totalRuns)
    val successRate = stringResource(R.string.translation_automations_successRate)
    val avgDuration = stringResource(R.string.translation_automations_avgDuration)
    val noHistory = stringResource(R.string.translation_automations_noHistory)
    return remember(recentActivity, live, reconnecting, totalRuns, successRate, avgDuration, noHistory) {
        AutomationActivityFeedStrings(
            recentActivity = recentActivity,
            live = live,
            reconnecting = reconnecting,
            totalRuns = totalRuns,
            successRate = successRate,
            avgDuration = avgDuration,
            noHistory = noHistory,
        )
    }
}

/**
 * Localized relative-age formatter for both the row "time ago" and the freshness chip
 * (`translation_freshness_*`) — the same render-only concern the sibling surfaces resolve, kept out of the
 * pure projection.
 */
@Composable
private fun rememberAutomationFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Pulsing alpha for the live glyphs / reconnecting chip — the web `animate-pulse`, honoring reduce-motion. */
@Composable
private fun rememberPulseAlpha(): Float {
    if (rememberReducedMotion()) return 1f
    val transition = rememberInfiniteTransition(label = "automation-activity-pulse")
    val alpha by transition.animateFloat(
        initialValue = PULSE_MIN_ALPHA,
        targetValue = 1f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = PULSE_DURATION_MS),
                repeatMode = RepeatMode.Reverse,
            ),
        label = "automation-activity-pulse-alpha",
    )
    return alpha
}

// ── Previews ──────────────────────────────────────────────────────────────────────────────────────────────

@Preview(name = "Content + live + stats", showBackground = true)
@Composable
private fun AutomationActivityFeedContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutomationActivityFeedContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data =
                        AutomationActivityData(
                            history = previewHistory(),
                            stats = AutomationHistoryStatsModel(totalExecutions = 128, successRate = 94.0, avgDurationMs = 1450),
                        ),
                ),
            liveEvents = previewLiveEvents(),
            connectionState = LiveConnectionStatus.Connected,
            onRetry = {},
            locale = Locale.US,
            nowMillis = PREVIEW_NOW_MILLIS,
        )
    }
}

@Preview(name = "Empty + reconnecting", showBackground = true)
@Composable
private fun AutomationActivityFeedEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AutomationActivityFeedContent(
            state = UiState(phase = UiPhase.Empty, data = AutomationActivityData(emptyList(), null)),
            liveEvents = emptyList(),
            connectionState = LiveConnectionStatus.Reconnecting,
            onRetry = {},
            locale = Locale.US,
            nowMillis = PREVIEW_NOW_MILLIS,
        )
    }
}

private const val PREVIEW_NOW_MILLIS: Long = 1_700_000_600_000L

private fun previewHistory(): List<AutomationHistoryEntry> =
    listOf(
        AutomationHistoryEntry(
            id = 1,
            automationName = "Precondition before commute",
            status = AutomationRunStatus.Success,
            error = null,
            triggeredAt = "2023-11-14T22:20:00Z",
            durationMs = 1450,
            actionsSucceeded = 3,
            actionsTotal = 3,
        ),
        AutomationHistoryEntry(
            id = 2,
            automationName = "Charge to 80% overnight",
            status = AutomationRunStatus.Failed,
            error = "Vehicle offline",
            triggeredAt = "2023-11-14T21:50:00Z",
            durationMs = 320,
            actionsSucceeded = 1,
            actionsTotal = 2,
        ),
        AutomationHistoryEntry(
            id = 3,
            automationName = "Lock when I leave home",
            status = AutomationRunStatus.Skipped,
            error = null,
            triggeredAt = "2023-11-14T20:00:00Z",
            durationMs = null,
            actionsSucceeded = 0,
            actionsTotal = 0,
        ),
    )

private fun previewLiveEvents(): List<AutomationLiveEvent> =
    listOf(
        AutomationLiveEvent(
            id = "ae-1",
            type = AutomationEventType.Triggered,
            name = "Precondition before commute",
            automationId = 1,
            error = null,
            reason = null,
        ),
        AutomationLiveEvent(
            id = "ae-2",
            type = AutomationEventType.Failed,
            name = "Charge to 80% overnight",
            automationId = 2,
            error = "Vehicle offline",
            reason = null,
        ),
    )

// The native Jetpack Compose + Material 3 Alert Detail Timeline feature view — a parity port of
// web/src/features/admin/components/AlertDetailTimeline.tsx. The web component is purely presentational: its
// parent (the alerts list page) loads the alert's `AlertEvent[]` via `useAlertDetail` and passes it down,
// and the component renders the shared `<Timeline>` (created → acknowledged → commented → reopened → …) or a
// friendly `<EmptyState>` when there are no events.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog). The host supplies the events through the
// shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the alert-detail
// feed), so this feature view also renders every lifecycle state that layer can carry — loading, hard error
// with retry, empty, content, and stale/offline (cached "last known") — without ever fetching. The empty +
// content branches reproduce the web component exactly. A web-parity overload that takes the raw event list
// is also provided for hosts that already hold the loaded events.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AlertDetailTimeline — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertdetailtimeline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.Timeline
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertEvent
import java.time.ZoneId
import java.util.Locale

private const val TIMELINE_SKELETON_ROWS = 3
private const val SKELETON_TITLE_FRACTION = 0.6f
private const val SKELETON_SUBTITLE_FRACTION = 0.3f
private val SKELETON_MARKER: Dp = 32.dp
private val SKELETON_TITLE_HEIGHT: Dp = 14.dp
private val SKELETON_SUBTITLE_HEIGHT: Dp = 10.dp

/**
 * Stateful entry point for the alert audit timeline. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11) and renders every lifecycle [state] the shared alert-detail feed can carry. The host owns the
 * feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the alert's `AlertEvent[]` (web `useAlertDetail`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AlertDetailTimeline(
    state: UiState<List<AlertEvent>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to AlertDetailTimelineRegistration.SLUG))
    }
    AlertDetailTimelineContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `events: AlertEvent[] | undefined` prop, for hosts that
 * already hold the loaded list. A `null`/empty list renders the empty state (web `!events ||
 * events.length === 0`); a non-empty list renders the timeline. Records `view.opened` like the stateful
 * entry. There is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun AlertDetailTimeline(
    events: List<AlertEvent>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(events) {
            val items = events ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    AlertDetailTimeline(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * empty/content branches (an [EmptyState] when there are no events, otherwise the [Timeline]) and adds the
 * lifecycle chrome the host's feed implies: a loading skeleton, a hard-error retry surface, and a freshness
 * chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web
 * freshness contract. [locale]/[zoneId] format each event's timestamp.
 */
@Composable
fun AlertDetailTimelineContent(
    state: UiState<List<AlertEvent>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: AlertDetailTimelineStrings = rememberAlertDetailTimelineStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val palette = rememberAlertTimelinePalette()
    val formatAge = rememberAlertFreshnessFormatter()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                AlertDetailTimelineLoading(label = stringResource(R.string.translation_common_loading))
            state.isError -> AlertDetailTimelineError(onRetry = onRetry)
            else -> {
                val rows =
                    remember(state.data, strings, locale, zoneId) {
                        AlertDetailTimelineProjection.project(
                            events = state.data,
                            strings = strings,
                            formatTime = { iso -> AlertDetailTimeFormatting.format(iso, zoneId, locale) },
                        )
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
                if (rows.isEmpty()) {
                    AlertDetailTimelineEmpty(strings = strings)
                } else {
                    Timeline(
                        items = rows.map { row -> row.toEntry(palette) },
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .semantics { contentDescription = strings.title },
                    )
                }
            }
        }
    }
}

/** Maps a projected row to the shared [TimelineEntry], resolving the kind's design-token accent + glyph. */
private fun AlertTimelineRow.toEntry(palette: AlertTimelinePalette): TimelineEntry =
    TimelineEntry(
        title = title,
        time = time,
        subtitle = subtitle,
        icon = glyphFor(kind),
        accent = palette.colorFor(kind),
    )

/** Empty state — web parity: notifications/bell icon, "Audit timeline" title, "No events yet" message. */
@Composable
private fun AlertDetailTimelineEmpty(strings: AlertDetailTimelineStrings) {
    EmptyState(
        message = strings.empty,
        icon = FeedbackGlyphs.Bell,
        title = strings.title,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** First-load skeleton — shimmering marker + title/subtitle rows so the panel is never blank while loading. */
@Composable
private fun AlertDetailTimelineLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(TIMELINE_SKELETON_ROWS) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Box(modifier = Modifier.size(SKELETON_MARKER)) {
                    Skeleton(height = SKELETON_MARKER, rounded = true)
                }
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
                    Skeleton(widthFraction = SKELETON_SUBTITLE_FRACTION, height = SKELETON_SUBTITLE_HEIGHT)
                }
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun AlertDetailTimelineError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Resolved per-theme accent palette — the native analogue of the web `KIND_COLOR` table, mapped to design
 * tokens (never raw hex in render code). The dark-theme tokens equal the web hexes exactly: created →
 * info(#00F0FF), acknowledged → success(#10B981), reopened → warning(#F59E0B), commented → chart.power
 * (#A855F7); an unknown kind reuses the created accent (web `?? KIND_COLOR.created`).
 */
private class AlertTimelinePalette(
    val created: Color,
    val acknowledged: Color,
    val reopened: Color,
    val commented: Color,
) {
    fun colorFor(kind: AlertTimelineKind): Color =
        when (kind) {
            AlertTimelineKind.Created -> created
            AlertTimelineKind.Acknowledged -> acknowledged
            AlertTimelineKind.Reopened -> reopened
            AlertTimelineKind.Commented -> commented
            AlertTimelineKind.Other -> created
        }
}

@Composable
private fun rememberAlertTimelinePalette(): AlertTimelinePalette {
    val created = TeslaTokens.status.info
    val acknowledged = TeslaTokens.status.success
    val reopened = TeslaTokens.status.warning
    val commented = TeslaTokens.chart.power
    return remember(created, acknowledged, reopened, commented) {
        AlertTimelinePalette(
            created = created,
            acknowledged = acknowledged,
            reopened = reopened,
            commented = commented,
        )
    }
}

/** Kind → glyph, mirroring the web `kindIcon` switch (bell / check / refresh / edit, info for the rest). */
private fun glyphFor(kind: AlertTimelineKind): ImageVector =
    when (kind) {
        AlertTimelineKind.Created -> FeedbackGlyphs.Bell
        AlertTimelineKind.Acknowledged -> TeslaGlyphs.Check
        AlertTimelineKind.Reopened -> FeedbackGlyphs.Refresh
        AlertTimelineKind.Commented -> TeslaGlyphs.Edit
        AlertTimelineKind.Other -> TeslaGlyphs.Info
    }

/**
 * Builds the localized [AlertDetailTimelineStrings] from the i18n catalog (P1/S10): the `alerts.timeline.*`
 * keys the web component reads. The actor-interpolated variants resolve through `Context.getString` so the
 * `%1$s` argument is filled by the catalog; `created` reads the same "Alert created" string for both the
 * named and anonymous case, matching the web fallbacks.
 */
@Composable
private fun rememberAlertDetailTimelineStrings(): AlertDetailTimelineStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_alerts_timeline_title)
    val empty = stringResource(R.string.translation_alerts_timeline_empty)
    val created = stringResource(R.string.translation_alerts_timeline_kind_created)
    val acknowledgedAnonymous = stringResource(R.string.translation_alerts_timeline_kindAnonymous_acknowledged)
    val reopenedAnonymous = stringResource(R.string.translation_alerts_timeline_kindAnonymous_reopened)
    val commentedAnonymous = stringResource(R.string.translation_alerts_timeline_kindAnonymous_commented)
    return remember(title, empty, created, acknowledgedAnonymous, reopenedAnonymous, commentedAnonymous, context) {
        AlertDetailTimelineStrings(
            title = title,
            empty = empty,
            kinds =
                AlertKindTitles(
                    created = created,
                    acknowledgedAnonymous = acknowledgedAnonymous,
                    reopenedAnonymous = reopenedAnonymous,
                    commentedAnonymous = commentedAnonymous,
                    acknowledgedByActor = { actor ->
                        context.getString(R.string.translation_alerts_timeline_kind_acknowledged, actor)
                    },
                    reopenedByActor = { actor ->
                        context.getString(R.string.translation_alerts_timeline_kind_reopened, actor)
                    },
                    commentedByActor = { actor ->
                        context.getString(R.string.translation_alerts_timeline_kind_commented, actor)
                    },
                ),
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberAlertFreshnessFormatter(): (FreshnessAge) -> String {
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

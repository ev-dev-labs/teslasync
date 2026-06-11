// The native Jetpack Compose + Material 3 Security Event Timeline feature view — a parity port of
// web/src/features/admin/components/security-access/EventTimeline.tsx. The web component is purely
// presentational: its parent (the security-access page) derives the `TimelineEvent[]` via `deriveTimeline`
// and passes it down, and the component renders an always-visible `<h2>` heading followed by either the
// scrollable list of state-change rows or a friendly `<EmptyState>` when there are none. Its only hooks are
// `useTranslation` and the local `useTimelineLabels` (an i18n label resolver), so it performs NO HTTP.
//
// The native surface keeps that contract — it binds no data hook of its own. The host supplies the events
// through the shared P1/S8 state-holder layer as a [UiState] (the cache-then-network projection of the
// derived timeline), so this feature view also renders every lifecycle state that layer can carry — loading,
// hard error with retry, empty, content, and stale/offline ("last known") — without ever fetching. The
// heading, empty, and content branches reproduce the web component exactly; the lifecycle chrome mirrors the
// sibling timeline surface. A web-parity overload that takes the raw `TimelineEvent[]` is also provided for
// hosts that already hold the derived list.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EventTimeline — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for
// the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.eventtimeline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
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
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.ZoneId
import java.util.Locale

// Web `<FadeIn delay={0.35}>` — the entrance delay in milliseconds. FadeIn honours reduce-motion itself.
private const val FADE_DELAY_MS = 350
private const val TIMELINE_SKELETON_ROWS = 3
private const val SKELETON_TITLE_FRACTION = 0.6f
private const val SKELETON_SUBTITLE_FRACTION = 0.3f
private val SKELETON_MARKER: Dp = 32.dp
private val SKELETON_TITLE_HEIGHT: Dp = 14.dp
private val SKELETON_SUBTITLE_HEIGHT: Dp = 10.dp

/**
 * Stateful entry point for the security event timeline. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared timeline feed can carry. The host owns
 * the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the derived `TimelineEvent[]` (web `deriveTimeline`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun EventTimeline(
    state: UiState<List<TimelineEvent>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to EventTimelineRegistration.SLUG))
    }
    EventTimelineContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `timelineEvents: TimelineEvent[]` prop, for hosts that
 * already hold the derived list. An empty list renders the empty state (web `timelineEvents.length > 0`); a
 * non-empty list renders the timeline. Records `view.opened` like the stateful entry. There is no fetch
 * behind it, so it offers no retry affordance.
 */
@Composable
fun EventTimeline(
    timelineEvents: List<TimelineEvent>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(timelineEvents) {
            val items = timelineEvents ?: emptyList()
            val phase = if (items.isEmpty()) UiPhase.Empty else UiPhase.Content
            UiState(phase = phase, data = items)
        }
    EventTimeline(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * always-on heading and its content/empty branches (the [Timeline] of rows, or an [EmptyState] when there are
 * none) and adds the lifecycle chrome the host's feed implies: a loading skeleton, a hard-error retry surface,
 * and a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract. [locale]/[zoneId] format each event's timestamp.
 */
@Composable
fun EventTimelineContent(
    state: UiState<List<TimelineEvent>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: EventTimelineStrings = rememberEventTimelineStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val palette = rememberEventTimelinePalette()
    val formatAge = rememberEventFreshnessFormatter()

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            // Web `<h2>` — always visible, above every state.
            SectionTitle(strings.title)
            Spacer(Modifier.height(Spacing.md))
            when (eventTimelineSurfaceFor(state.isLoading, state.isError)) {
                EventTimelineSurface.Loading ->
                    EventTimelineLoading(label = stringResource(R.string.translation_common_loading))
                EventTimelineSurface.Error -> EventTimelineError(onRetry = onRetry)
                EventTimelineSurface.Ready -> {
                    val rows =
                        remember(state.data, strings, locale, zoneId) {
                            EventTimelineProjection.project(
                                events = state.data,
                                strings = strings,
                                formatTime = { iso -> EventTimeFormatting.format(iso, zoneId, locale) },
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
                        EventTimelineEmpty(message = strings.noEvents)
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
}

/** Maps a projected row to the shared [TimelineEntry], resolving the glyph + design-token accent. */
private fun EventTimelineRow.toEntry(palette: EventTimelinePalette): TimelineEntry =
    TimelineEntry(
        title = title,
        time = time,
        subtitle = subtitle,
        icon = EventTimelineGlyphs.resolve(glyph),
        accent = palette.colorFor(accent),
    )

/** Empty state — web parity: the "No state changes detected in the history." message, never a blank box. */
@Composable
private fun EventTimelineEmpty(message: String) {
    EmptyState(
        message = message,
        icon = EventTimelineGlyphs.ShieldCheck,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** First-load skeleton — shimmering marker + title/subtitle rows so the panel is never blank while loading. */
@Composable
private fun EventTimelineLoading(
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
private fun EventTimelineError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Resolved per-theme accent palette — the native analogue of the web JSX marker colors, mapped to design
 * tokens (never raw hex in render code): positive → success green, negative → danger red, neutral → muted.
 */
private class EventTimelinePalette(
    val success: Color,
    val danger: Color,
    val muted: Color,
) {
    fun colorFor(role: TimelineAccentRole): Color =
        when (role) {
            TimelineAccentRole.Success -> success
            TimelineAccentRole.Danger -> danger
            TimelineAccentRole.Muted -> muted
        }
}

@Composable
private fun rememberEventTimelinePalette(): EventTimelinePalette {
    val success = TeslaTokens.status.success
    val danger = TeslaTokens.status.danger
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    return remember(success, danger, muted) {
        EventTimelinePalette(success = success, danger = danger, muted = muted)
    }
}

/**
 * Builds the localized [EventTimelineStrings] from the i18n catalog (P1/S10): the
 * `admin.security.timeline.*` keys the web component reads through `useTranslation` + `useTimelineLabels`.
 */
@Composable
private fun rememberEventTimelineStrings(): EventTimelineStrings {
    val title = stringResource(R.string.translation_admin_security_timeline_title)
    val noEvents = stringResource(R.string.translation_admin_security_timeline_noEvents)
    val lockPositive = stringResource(R.string.translation_admin_security_timeline_lock_positive)
    val lockPositiveDesc = stringResource(R.string.translation_admin_security_timeline_lock_positiveDesc)
    val lockNegative = stringResource(R.string.translation_admin_security_timeline_lock_negative)
    val lockNegativeDesc = stringResource(R.string.translation_admin_security_timeline_lock_negativeDesc)
    val sentryPositive = stringResource(R.string.translation_admin_security_timeline_sentry_positive)
    val sentryPositiveDesc = stringResource(R.string.translation_admin_security_timeline_sentry_positiveDesc)
    val sentryNegative = stringResource(R.string.translation_admin_security_timeline_sentry_negative)
    val sentryNegativeDesc = stringResource(R.string.translation_admin_security_timeline_sentry_negativeDesc)
    val doorPositive = stringResource(R.string.translation_admin_security_timeline_door_positive)
    val doorNegative = stringResource(R.string.translation_admin_security_timeline_door_negative)
    return remember(
        title,
        noEvents,
        lockPositive,
        lockPositiveDesc,
        lockNegative,
        lockNegativeDesc,
        sentryPositive,
        sentryPositiveDesc,
        sentryNegative,
        sentryNegativeDesc,
        doorPositive,
        doorNegative,
    ) {
        EventTimelineStrings(
            title = title,
            noEvents = noEvents,
            lockPositive = lockPositive,
            lockPositiveDesc = lockPositiveDesc,
            lockNegative = lockNegative,
            lockNegativeDesc = lockNegativeDesc,
            sentryPositive = sentryPositive,
            sentryPositiveDesc = sentryPositiveDesc,
            sentryNegative = sentryNegative,
            sentryNegativeDesc = sentryNegativeDesc,
            doorPositive = doorPositive,
            doorNegative = doorNegative,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberEventFreshnessFormatter(): (FreshnessAge) -> String {
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
